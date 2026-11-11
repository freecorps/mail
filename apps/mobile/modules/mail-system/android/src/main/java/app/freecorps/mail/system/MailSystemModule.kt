// Android system glue the app needs and Expo has no JS API for (src/widgets/store.android.ts): the home-screen
// widgets' snapshots. The app writes each widget's JSON (src/widgets/snapshot.ts) here; MailWidgets.kt draws it.
package app.freecorps.mail.system

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MailSystemModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MailSystem")

    AsyncFunction("setWidget") Coroutine { kind: String, json: String ->
      val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
      MailWidgets.write(context, kind, json)
    }
  }
}
