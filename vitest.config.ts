import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // 缓存写到项目内，避开沙箱对系统临时目录（H:\Temp）的写入拦截
  cacheDir: "./node_modules/.vitest-cache",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // 当前均为领域纯函数测试；不需要 DOM，避免 jsdom 偶发 teardown 抖动
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: true,
    // 沙箱环境并发 worker 写系统临时目录会 EPERM；单进程 fork 稳定
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
