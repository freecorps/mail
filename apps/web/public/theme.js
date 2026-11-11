// Theme and density before first paint (no flash): same key and rules as src/lib/prefs.ts. External file so the CSP
// needs no 'unsafe-inline' for scripts.
try {
  var prefs = JSON.parse(localStorage.getItem("ember-mail:prefs") || "{}") || {};
  var p = prefs.theme;
  var dark = p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
  // The status bar / browser chrome follows the app's theme, not only the OS one (THEME_COLOR in src/lib/prefs.ts).
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) metas[i].setAttribute("content", dark ? "#171513" : "#faf9f7");
  document.documentElement.dataset.density = prefs.density === "compact" ? "compact" : "comfortable";
} catch (e) {}
