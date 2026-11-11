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

/**
 * Background tasks begun and not ended yet (main thread only: `begin`, `end` and the expiration handler all run there).
 * An id is ended once, by whichever comes first: the expiration handler (out of time) or JS when the action is done.
 */
var activeBackgroundTasks = Set<Int>()

func endBackgroundTaskOnce(_ task: UIBackgroundTaskIdentifier) {
  guard task != .invalid, activeBackgroundTasks.remove(task.rawValue) != nil else { return }
  UIApplication.shared.endBackgroundTask(task)
}

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
        // Out of time: give it back (once), or iOS ends the app. JS's later `end` for it then does nothing.
        endBackgroundTaskOnce(task)
      }
      // Still on the main queue: the expiration handler cannot run before the id is recorded.
      if task != .invalid { activeBackgroundTasks.insert(task.rawValue) }
      return task.rawValue
    }.runOnQueue(.main)

    AsyncFunction("endBackgroundTask") { (id: Int) in
      endBackgroundTaskOnce(UIBackgroundTaskIdentifier(rawValue: id))
    }.runOnQueue(.main)

    AsyncFunction("takeShortcut") { () -> String? in
      defer { pendingShortcutType = nil }
      return pendingShortcutType
    }.runOnQueue(.main)
  }
}
