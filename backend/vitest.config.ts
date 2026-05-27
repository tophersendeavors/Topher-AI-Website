import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@toburt/shared": path.resolve(__dirname, "../packages/shared/src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/agents/**",
        "src/emotional/**",
        "src/screenplay/**",
        "src/routes/emotional.ts",
      ],
    },
  },
});
