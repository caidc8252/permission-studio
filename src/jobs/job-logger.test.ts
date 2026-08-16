import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createJobFailureLogger } from "@/src/jobs/job-logger";
import { CommandExecutionError } from "@/src/system/command-runner";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("job failure logger", () => {
  it("writes bounded redacted diagnostics under the owned log root", async () => {
    const root = mkdtempSync(join(tmpdir(), "permission-logs-"));
    roots.push(root);
    const id = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const logger = createJobFailureLogger(root);
    await logger(
      id,
      "prepare",
      new CommandExecutionError({
        code: "COMMAND_FAILED",
        executable: "pnpm",
        exitCode: 1,
        stdout: `github_pat_secret ${"x".repeat(100_000)}`,
        stderr: "C:\\Users\\alice\\repo",
        durationMs: 1,
      }),
    );

    const path = join(root, `${id}.log`);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("[REDACTED]");
    expect(content).not.toContain("github_pat_secret");
    expect(content).not.toContain("alice");
    expect(statSync(path).size).toBeLessThanOrEqual(64 * 1024);
  });
});
