import { defineConfig } from "vitest/config";

// View models and the offline scenario run in happy-dom with @testing-library/react (like packages/react-native);
// nothing here imports react-native itself: screens are covered by the simulator run (README).
export default defineConfig({
  // One React for the app and @freecorps/ember-react.
  resolve: { dedupe: ["react", "react-dom"] },
  esbuild: { jsx: "automatic" },
  test: { environment: "happy-dom", testTimeout: 15_000, include: ["test/**/*.test.{ts,tsx}"] },
});
