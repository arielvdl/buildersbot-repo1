import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    execArgv: ["--disable-warning=ExperimentalWarning"],
    include: ["test/**/*.test.ts"],
    // The first case of a route test imports the whole server layer on a cold module graph. The
    // desktop project sets the same budget for the same reason.
    testTimeout: 20_000,
  },
});
