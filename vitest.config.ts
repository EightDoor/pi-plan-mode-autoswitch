import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
    },
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/vitest.global-setup.ts"],
    // 集成用例会拉起 Git / MCP 子进程；两个 fork worker 足够且不放大 5 秒单测预算。
    maxWorkers: Math.min(2, availableParallelism()),
    pool: "forks",
    runner: "./test/vitest.runner.ts",
    setupFiles: ["./test/vitest.setup.ts"],
    teardownTimeout: 10_000,
    testTimeout: 5_000,
  },
});
