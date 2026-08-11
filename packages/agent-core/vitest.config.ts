import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Avoid CJS/ESM config loader noise on Windows
  },
});
