// Android home-screen widgets (Jetpack Glance, Material 3): "Não lidas" (unread per mailbox) and "Minhas" (open
// conversations assigned to me). The app cannot run here, so it writes a snapshot per widget (src/widgets/snapshot.ts,
// strings included, in the app's language) to this app's private SharedPreferences; a widget draws the latest one and
// redraws when it changes. Colors are the system's dynamic ones (wallpaper palette, Android 12+), else the ember
// scheme. Taps open the app's deep links (embermail://…, expo-router).
package app.freecorps.mail.system

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import org.json.JSONArray
import org.json.JSONObject

internal object MailWidgets {
  const val PREFS = "app.freecorps.mail.widgets"
  /** The snapshot format the app writes (WIDGET_SNAPSHOT_VERSION); another one draws "open the app". */
  const val VERSION = 1

  /** Stores a widget's snapshot (synchronously, so a widget starting now reads it) and redraws its instances. */
  suspend fun write(context: Context, kind: String, json: String) {
    val widget = when (kind) {
      "unread" -> MailUnreadWidget()
      "mine" -> MailMineWidget()
      else -> return
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(kind, json).commit()
    widget.updateAll(context)
  }

  fun read(context: Context, kind: String): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(kind, null)

  /** The snapshot as it changes: a widget still on screen redraws without waiting for a new session. */
  fun changes(context: Context, kind: String): Flow<String?> = callbackFlow {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val listener = SharedPreferences.OnSharedPreferenceChangeListener { p, key -> if (key == kind) trySend(p.getString(kind, null)) }
    prefs.registerOnSharedPreferenceChangeListener(listener)
    trySend(prefs.getString(kind, null))
    awaitClose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
  }

  fun parse(json: String?): JSONObject? =
    try {
      json?.let { JSONObject(it) }?.takeIf { it.optInt("v") == VERSION }
    } catch (_: Exception) {
      null
    }

  /** The app's home (the mailbox list): where a tap without a link of its own goes. */
  const val HOME = "embermail://"

  /**
   * Opens one of the app's deep links in its own task (the app's activity handles `embermail://`). A missing or empty
   * link (an older or damaged snapshot) opens the app's home instead of an intent nothing resolves.
   */
  fun open(context: Context, url: String?): Action =
    actionStartActivity(
      Intent(Intent.ACTION_VIEW, Uri.parse(url?.takeIf { it.isNotEmpty() } ?: HOME)).setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    )

  /** Below Android 12 (no dynamic colors): Material 3 schemes around the ember accent (src/theme/colors.ts). */
  val emberColors = ColorProviders(
    light = lightColorScheme(primary = Color(0xFFD9480F), onPrimary = Color.White, primaryContainer = Color(0xFFFFDBCF), onPrimaryContainer = Color(0xFF3A0B00), surface = Color(0xFFFFF8F6), onSurface = Color(0xFF231917), onSurfaceVariant = Color(0xFF53433F), secondaryContainer = Color(0xFFF8E2DB), background = Color(0xFFFFF8F6)),
    dark = darkColorScheme(primary = Color(0xFFFF7A3D), onPrimary = Color(0xFF5F1600), primaryContainer = Color(0xFF7F2B10), onPrimaryContainer = Color(0xFFFFDBCF), surface = Color(0xFF1A110F), onSurface = Color(0xFFF1DFDA), onSurfaceVariant = Color(0xFFD8C2BC), secondaryContainer = Color(0xFF3A2219), background = Color(0xFF1A110F)),
  )

  /** Small (2x2) and medium (4x2) layouts; the launcher picks the one that fits. */
  val SMALL = DpSize(110.dp, 110.dp)
  val MEDIUM = DpSize(250.dp, 110.dp)
}

/** One widget's frame: the system's widget background and corner radius, the theme, the snapshot as it changes. */
private abstract class MailWidget(private val kind: String) : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(MailWidgets.SMALL, MailWidgets.MEDIUM))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val initial = MailWidgets.read(context, kind)
    provideContent {
      val json by remember { MailWidgets.changes(context, kind) }.collectAsState(initial)
      val colors = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) GlanceTheme.colors else MailWidgets.emberColors
      GlanceTheme(colors = colors) {
        val snapshot = MailWidgets.parse(json)
        Column(
          modifier = GlanceModifier.fillMaxSize().appWidgetBackground().systemCorners().background(GlanceTheme.colors.widgetBackground)
            .padding(16.dp).clickable(MailWidgets.open(context, snapshot?.optString("url"))),
        ) {
          Content(snapshot, LocalSize.current.width >= MailWidgets.MEDIUM.width)
        }
      }
    }
  }

  @Composable abstract fun ColumnScope.Content(snapshot: JSONObject?, medium: Boolean)
}

/** The launcher's own widget corner radius (Android 12+; older launchers draw square widgets). */
private fun GlanceModifier.systemCorners(): GlanceModifier =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) cornerRadius(android.R.dimen.system_app_widget_background_radius) else this

@Composable
private fun Header(icon: Int, title: String, trailing: String? = null) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = GlanceModifier.fillMaxWidth()) {
    Image(ImageProvider(icon), contentDescription = null, colorFilter = ColorFilter.tint(GlanceTheme.colors.primary), modifier = GlanceModifier.size(16.dp))
    Spacer(GlanceModifier.width(6.dp))
    Text(title, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 13.sp, fontWeight = FontWeight.Medium), modifier = GlanceModifier.defaultWeight())
    if (!trailing.isNullOrEmpty()) Text(trailing, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp, fontWeight = FontWeight.Medium))
  }
}

@Composable
private fun BigCount(text: String, description: String) {
  Text(text, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 40.sp, fontWeight = FontWeight.Medium), modifier = GlanceModifier.semantics { contentDescription = description })
}

@Composable
private fun Secondary(text: String, lines: Int = 1) {
  Text(text, maxLines = lines, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp))
}

/** Not signed in (or the app never ran): the app's name and "sign in" / "open the app", nothing of an inbox. */
@Composable
private fun ColumnScope.Placeholder(icon: Int, snapshot: JSONObject?) {
  val context = LocalContext.current
  Header(icon, snapshot?.optString("title")?.takeIf { it.isNotEmpty() } ?: "Ember Mail")
  Spacer(GlanceModifier.defaultWeight())
  Secondary(snapshot?.optString("message")?.takeIf { it.isNotEmpty() } ?: context.getString(R.string.mail_widget_open_app), lines = 3)
}

@Composable
private fun Done(text: String) {
  Image(ImageProvider(R.drawable.mail_widget_ic_done), contentDescription = null, colorFilter = ColorFilter.tint(GlanceTheme.colors.primary), modifier = GlanceModifier.size(28.dp))
  Spacer(GlanceModifier.height(4.dp))
  Secondary(text, lines = 2)
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

private class MailUnreadWidget : MailWidget("unread") {
  @Composable
  override fun ColumnScope.Content(snapshot: JSONObject?, medium: Boolean) {
    if (snapshot?.optString("state") != "ready") return Placeholder(R.drawable.mail_widget_ic_mail, snapshot)
    val context = LocalContext.current
    val title = snapshot.optString("title")
    val total = snapshot.optInt("total")
    val caption = snapshot.optString("caption")
    if (!medium) {
      Header(R.drawable.mail_widget_ic_mail, title)
      Spacer(GlanceModifier.defaultWeight())
      if (total > 0) {
        BigCount(snapshot.optString("totalText"), caption)
        Secondary(snapshot.optJSONObject("top")?.optString("label").orEmpty())
      } else {
        Done(snapshot.optString("message"))
      }
      return
    }
    Header(R.drawable.mail_widget_ic_mail, title, if (total > 0) snapshot.optString("totalText") else null)
    Spacer(GlanceModifier.height(8.dp))
    val rows = snapshot.optJSONArray("rows")?.objects().orEmpty()
    if (total == 0 || rows.isEmpty()) {
      Spacer(GlanceModifier.defaultWeight())
      Done(snapshot.optString("message"))
      return
    }
    // One row per mailbox, opening it; its count in the accent while it has unread.
    for (row in rows) {
      val unread = row.optInt("unread") > 0
      Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp).clickable(MailWidgets.open(context, row.optString("url"))),
      ) {
        Text(row.optString("label"), maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp, fontWeight = if (unread) FontWeight.Medium else FontWeight.Normal), modifier = GlanceModifier.defaultWeight())
        Text(row.optString("count"), maxLines = 1, style = TextStyle(color = if (unread) GlanceTheme.colors.primary else GlanceTheme.colors.onSurfaceVariant, fontSize = 14.sp, fontWeight = FontWeight.Medium))
      }
    }
  }
}

private class MailMineWidget : MailWidget("mine") {
  @Composable
  override fun ColumnScope.Content(snapshot: JSONObject?, medium: Boolean) {
    if (snapshot?.optString("state") != "ready") return Placeholder(R.drawable.mail_widget_ic_mine, snapshot)
    val context = LocalContext.current
    val title = snapshot.optString("title")
    val count = snapshot.optInt("count")
    val caption = snapshot.optString("caption")
    val message = snapshot.optString("message")
    val rows = snapshot.optJSONArray("rows")?.objects().orEmpty()
    if (!medium || count == 0) {
      Header(R.drawable.mail_widget_ic_mine, title)
      Spacer(GlanceModifier.defaultWeight())
      if (count > 0) {
        // The number is right above: the label alone ("abertas").
        BigCount(snapshot.optString("countText"), caption)
        Secondary(snapshot.optString("label").ifEmpty { caption }, lines = 2)
      } else {
        Done(message)
      }
      return
    }
    Header(R.drawable.mail_widget_ic_mine, title, snapshot.optString("countText"))
    Spacer(GlanceModifier.height(8.dp))
    if (rows.isEmpty()) {
      Secondary(caption)
      // Previews off: counts only, and it says so. No rows otherwise (none on the page): just the count.
      if (!snapshot.optBoolean("hidden")) return
      Spacer(GlanceModifier.defaultWeight())
      Row(verticalAlignment = Alignment.CenterVertically) {
        Image(ImageProvider(R.drawable.mail_widget_ic_private), contentDescription = null, colorFilter = ColorFilter.tint(GlanceTheme.colors.onSurfaceVariant), modifier = GlanceModifier.size(16.dp))
        Spacer(GlanceModifier.width(6.dp))
        Secondary(message)
      }
      return
    }
    // The latest conversations: sender (bold while unread) over the subject, each opening its thread.
    for (row in rows) {
      val unread = row.optBoolean("unread")
      Column(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp).clickable(MailWidgets.open(context, row.optString("url")))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          if (unread) {
            Spacer(GlanceModifier.size(8.dp).cornerRadius(4.dp).background(GlanceTheme.colors.primary))
            Spacer(GlanceModifier.width(6.dp))
          }
          Text(row.optString("sender"), maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp, fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium))
        }
        Text(row.optString("subject"), maxLines = 1, style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp))
      }
    }
  }
}

class MailUnreadWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = MailUnreadWidget()
}

class MailMineWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = MailMineWidget()
}
