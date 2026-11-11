// iOS system glue the app needs and Expo has no JS API for (src/lib/system.ts):
//
// - Background time for notification actions. expo-notifications reports an action handled as soon as it reaches JS,
//   so iOS would suspend the app before the action's request goes out; `beginBackgroundTask` asks for the usual
//   background task time (about 30 s) and `endBackgroundTask` gives it back.
// - The quick action that launched the app. Under the UIScene life cycle Expo forwards a cold-start shortcut as
//   `application(_:performActionFor:)`, before JS listens, and expo-quick-actions reads its `initial` only from the
//   launch options (empty with scenes). The subscriber below keeps the latest shortcut until JS takes it.
import ExpoModulesCore
import UIKit

/** The latest home-screen quick action, until JS takes it (main thread only). */
var pendingShortcutType: String?

public class MailSystemAppDelegate: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
    pendingShortcutType = shortcutItem.type
    completionHandler(true)
  }
}

public class MailSystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MailSystem")

    AsyncFunction("beginBackgroundTask") { (name: String) -> Int in
      var task: UIBackgroundTaskIdentifier = .invalid
      task = UIApplication.shared.beginBackgroundTask(withName: name) {
        // Out of time: give it back, or iOS ends the app.
        UIApplication.shared.endBackgroundTask(task)
      }
      return task.rawValue
    }.runOnQueue(.main)

    AsyncFunction("endBackgroundTask") { (id: Int) in
      let task = UIBackgroundTaskIdentifier(rawValue: id)
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }.runOnQueue(.main)

    AsyncFunction("takeShortcut") { () -> String? in
      defer { pendingShortcutType = nil }
      return pendingShortcutType
    }.runOnQueue(.main)
  }
}
