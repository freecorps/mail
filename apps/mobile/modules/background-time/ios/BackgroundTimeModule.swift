// Background execution time for the app's notification actions (src/lib/background-time.ts). expo-notifications
// reports an action handled as soon as it reaches JS, so iOS would suspend the app before an action's request goes
// out; `begin` asks for the usual background task time (about 30 s) and `end` gives it back.
import ExpoModulesCore
import UIKit

public class BackgroundTimeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundTime")

    AsyncFunction("begin") { (name: String) -> Int in
      var task: UIBackgroundTaskIdentifier = .invalid
      task = UIApplication.shared.beginBackgroundTask(withName: name) {
        // Out of time: give it back, or iOS ends the app.
        UIApplication.shared.endBackgroundTask(task)
      }
      return task.rawValue
    }.runOnQueue(.main)

    AsyncFunction("end") { (id: Int) in
      let task = UIBackgroundTaskIdentifier(rawValue: id)
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }.runOnQueue(.main)
  }
}
