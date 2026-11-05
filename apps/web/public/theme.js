// Theme before first paint (no flash): same key and rules as src/lib/prefs.ts. External file so the CSP needs no
// 'unsafe-inline' for scripts.
try {
  var p = JSON.parse(localStorage.getItem("ember-mail:prefs") || "{}").theme;
  if (p === "dark" || (p !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) document.documentElement.classList.add("dark");
} catch (e) {}
