// Hardware keyboard shortcuts (src/keys.tsx). React Native has no UIKeyCommand API outside its dev menu, and Expo has
// none, so a view at the root of the app declares the commands JS gives it (`commands`) and reports the one pressed
// (`onCommand`). UIKit asks every responder from the first responder up for its `keyCommands`: a focused field's chain
// passes through this view, which wraps the whole app (a presented sheet's chain too, through its presenting
// controller); with nothing focused, the view is the first responder itself. The same commands fill the ⌘-hold overlay.
import ExpoModulesCore
import UIKit

struct KeyCommandRecord: Record {
  @Field var id: String = ""
  /** A character, or "up", "down", "escape", "enter". */
  @Field var input: String = ""
  /** "command", "shift", "alternate", "control". */
  @Field var modifiers: [String] = []
  @Field var title: String = ""
  /** Listed in the ⌘-hold overlay (an alias such as ↓ beside J is not). */
  @Field var discoverable: Bool = true
  /** Also while a text field is being edited: chords only (a bare letter or arrow belongs to the field). */
  @Field var whileTyping: Bool = false
}

public class MailKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MailKeys")

    View(KeyCommandsView.self) {
      Events("onCommand")

      Prop("commands") { (view: KeyCommandsView, commands: [KeyCommandRecord]) in
        view.setCommands(commands)
      }
    }
  }
}

/** The first responder, found with a nil-targeted action (UIKit has no getter). Main thread only. */
private weak var foundResponder: UIResponder?

extension UIResponder {
  @objc fileprivate func mailKeysCaptureFirstResponder(_ sender: Any?) {
    foundResponder = self
  }
}

private func currentFirstResponder() -> UIResponder? {
  foundResponder = nil
  UIApplication.shared.sendAction(#selector(UIResponder.mailKeysCaptureFirstResponder(_:)), to: nil, from: nil, for: nil)
  return foundResponder
}

/** A field taking text: React Native's and SwiftUI's single-line fields and search bars (UITextField), and editable text views. */
private func isEditingText(_ responder: UIResponder?) -> Bool {
  if responder is UITextField { return true }
  if let view = responder as? UITextView { return view.isEditable }
  return false
}

private func keyInput(_ input: String) -> String {
  switch input {
  case "up": return UIKeyCommand.inputUpArrow
  case "down": return UIKeyCommand.inputDownArrow
  case "escape": return UIKeyCommand.inputEscape
  case "enter": return "\r"
  default: return input
  }
}

private func modifierFlags(_ names: [String]) -> UIKeyModifierFlags {
  var flags: UIKeyModifierFlags = []
  for name in names {
    switch name {
    case "command": flags.insert(.command)
    case "shift": flags.insert(.shift)
    case "alternate": flags.insert(.alternate)
    case "control": flags.insert(.control)
    default: break
    }
  }
  return flags
}

final class KeyCommandsView: ExpoView {
  let onCommand = EventDispatcher()
  private var commands: [(command: UIKeyCommand, whileTyping: Bool)] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Focus left a field (or the app came back): nothing may be first responder now, so the view takes the role again.
    let names = [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification, UIApplication.didBecomeActiveNotification, UIWindow.didBecomeKeyNotification]
    for name in names {
      NotificationCenter.default.addObserver(self, selector: #selector(reclaimSoon), name: name, object: nil)
    }
  }

  override var canBecomeFirstResponder: Bool { true }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reclaimSoon()
  }

  func setCommands(_ records: [KeyCommandRecord]) {
    commands = records.map { r in
      let command = UIKeyCommand(title: r.title, image: nil, action: #selector(mailKeysFire(_:)), input: keyInput(r.input), modifierFlags: modifierFlags(r.modifiers), propertyList: r.id)
      command.discoverabilityTitle = r.title
      if !r.discoverable { command.attributes = [.hidden] }
      // ⌘F and the like win over a field's own handling of the chord (Find in a text view).
      if r.whileTyping { command.wantsPriorityOverSystemBehavior = true }
      return (command, r.whileTyping)
    }
    reclaimSoon()
  }

  override var keyCommands: [UIKeyCommand]? {
    let typing = isEditingText(currentFirstResponder())
    return commands.filter { !typing || $0.whileTyping }.map { $0.command }
  }

  @objc private func mailKeysFire(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    onCommand(["id": id])
  }

  @objc private func reclaimSoon() {
    // After the field has resigned (the notification comes first) and the view is in its window.
    DispatchQueue.main.async { [weak self] in self?.reclaim() }
  }

  /** Becomes the first responder only when there is none: never takes the keyboard from a field. */
  private func reclaim() {
    guard let window, window.isKeyWindow, currentFirstResponder() == nil else { return }
    becomeFirstResponder()
  }
}
