import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vitest only runs node-side logic tests here; skip PostCSS/Tailwind entirely.
  css: { postcss: { plugins: [] }, preprocessorOptions: {} },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: true,
    css: false,
  },
});
