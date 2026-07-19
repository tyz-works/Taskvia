import { defineConfig } from "vitest/config";
import path from "node:path";

// 最小構成: Next.js のビルド設定には触れず、テストランナー単体を追加する。
// tsconfig.json の "@/*" -> "./src/*" と同じエイリアスをここでも解決する。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
