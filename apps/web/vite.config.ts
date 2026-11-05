// Vite+ config for the web inbox: dev server (with a same-origin proxy to the mail API), build, lint, format and tests.
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// The mail service (apps/api) the dev server proxies to: `ember dev` prints its URL. Same-origin in the browser,
// so Better Auth's session cookie and the Ember WebSocket need no CORS (production does the same in worker/).
const API = (process.env.MAIL_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

// Better Auth rejects state-changing calls whose Origin is not its own: the proxy is that origin's front door.
const proxyTo = (ws = false) => ({
  target: API,
  changeOrigin: true,
  ws,
  configure: (proxy: { on(event: "proxyReq", cb: (req: { setHeader(k: string, v: string): void }) => void): void }) => {
    proxy.on("proxyReq", (req) => req.setHeader("origin", new URL(API).origin));
  },
});

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: Number(process.env.PORT ?? 5180),
    strictPort: false,
    proxy: { "/api": proxyTo(), "/ws": proxyTo(true) },
  },
  preview: { proxy: { "/api": proxyTo(), "/ws": proxyTo(true) } },
  build: { target: "es2023", sourcemap: true, chunkSizeWarningLimit: 700 },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    server: { deps: { inline: [/@freecorps\//] } },
  },
  fmt: {
    printWidth: 140,
    ignorePatterns: ["dist/**", "docs/**", "worker/.wrangler/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "worker/.wrangler/**", "public/**"],
    plugins: ["react", "typescript", "oxc", "jsx-a11y"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    // shadcn/ui files export their variant helpers next to the component (upstream layout, kept as generated).
    overrides: [{ files: ["src/components/ui/**"], rules: { "react/only-export-components": "off" } }],
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
});
