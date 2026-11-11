// Theme and density before first paint (no flash): same key and rules as src/lib/prefs.ts. External file so the CSP
// needs no 'unsafe-inline' for scripts.
try {
  var prefs = JSON.parse(localStorage.getItem("ember-mail:prefs") || "{}") || {};
  var p = prefs.theme;
  if (p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
  document.documentElement.dataset.density = prefs.density === "compact" ? "compact" : "comfortable";
} catch (e) {}
