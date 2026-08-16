import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.next/**", "**/.worktrees/**"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
