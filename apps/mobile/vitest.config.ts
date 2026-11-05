import { defineConfig } from "vitest/config";
import { sourceResolve } from "../../vitest.shared.mjs";

// View models and the offline scenario run in happy-dom with @testing-library/react (like packages/react-native);
// nothing here imports react-native itself: screens are covered by the simulator run (README).
export default defineConfig({
  ...sourceResolve,
  // One React: the workspace packages (@freecorps/ember-react) would otherwise load their own dev copy.
  resolve: { ...sourceResolve.resolve, dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" },
  test: { environment: "happy-dom", testTimeout: 15_000, include: ["test/**/*.test.{ts,tsx}"] },
});
