import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    setupFiles: ["dotenv/config"],
  },
  plugins: [tsconfigPaths()],
});
