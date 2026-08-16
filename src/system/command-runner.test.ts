import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createCommandRunner } from "@/src/system/command-runner";
import type { CommandExecutionError } from "@/src/system/command-runner";

describe("createCommandRunner", () => {
  it("captures bounded stdout from a successful process", async () => {
    const runner = createCommandRunner();
    const result = await runner.run({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('ok')"],
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects non-zero exits with a redacted bounded error", async () => {
    const runner = createCommandRunner();
    const secret = "github_pat_not-for-logs";

    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "process.stderr.write(process.env.TEST_SECRET); process.exit(7)"],
        env: { TEST_SECRET: secret },
        timeoutMs: 5_000,
        redactions: [secret],
      }),
    ).rejects.toMatchObject({
      exitCode: 7,
      stderr: "[REDACTED]",
    } satisfies Partial<CommandExecutionError>);
  });

  it("terminates processes that exceed the timeout", async () => {
    const runner = createCommandRunner();

    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "setTimeout(() => {}, 10000)"],
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({
      code: "COMMAND_TIMEOUT",
    } satisfies Partial<CommandExecutionError>);
  });

  it("terminates descendant processes on timeout", async () => {
    const runner = createCommandRunner();
    const root = mkdtempSync(join(tmpdir(), "permission-command-tree-"));
    const marker = join(root, "descendant-finished");
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'), 500)`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }); setTimeout(() => {}, 10000)`;

    await expect(
      runner.run({ executable: process.execPath, args: ["-e", parent], timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "COMMAND_TIMEOUT" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(existsSync(marker)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects output beyond the configured byte limit", async () => {
    const runner = createCommandRunner();

    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(2048))"],
        timeoutMs: 5_000,
        maxOutputBytes: 128,
      }),
    ).rejects.toMatchObject({
      code: "COMMAND_OUTPUT_LIMIT",
    } satisfies Partial<CommandExecutionError>);
  });
});
