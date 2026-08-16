import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTargetValidation } from "@/src/jobs/validation";
import type { CommandResult, CommandRunner, CommandSpec } from "@/src/system/command-runner";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("runTargetValidation", () => {
  it("runs the fixed target validation sequence without shell interpolation", async () => {
    const worktreeRoot = mkdtempSync(join(tmpdir(), "permission-validation-"));
    roots.push(worktreeRoot);
    const worktreePath = join(worktreeRoot, "owned");
    const calls: CommandSpec[] = [];
    const runner: CommandRunner = {
      async run(spec): Promise<CommandResult> {
        calls.push(spec);
        return {
          exitCode: 0,
          stdout: spec.args.includes("--binary")
            ? "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n"
            : "ok",
          stderr: "",
          durationMs: 2,
        };
      },
    };

    const result = await runTargetValidation({
      runner,
      worktreeRoot,
      worktreePath,
      pnpmCommand: { executable: "corepack", argsPrefix: ["pnpm"] },
    });

    expect(calls.map(({ executable, args }) => [executable, ...args])).toEqual([
      ["corepack", "pnpm", "install", "--frozen-lockfile"],
      ["corepack", "pnpm", "gen:coc"],
      [
        "corepack",
        "pnpm",
        "prettier",
        "--write",
        "apps/web/manifest/catalog/roles.ts",
        "apps/web/manifest/catalog/contract-types.ts",
      ],
      [
        "corepack",
        "pnpm",
        "vitest",
        "run",
        "apps/web/manifest/catalog/roles.test.ts",
        "apps/web/manifest/catalog/contract-types.test.ts",
      ],
      ["corepack", "pnpm", "typecheck"],
      ["git", "diff", "--check"],
      [
        "git",
        "diff",
        "--binary",
        "--",
        "apps/web/manifest/catalog/roles.ts",
        "apps/web/manifest/catalog/contract-types.ts",
      ],
    ]);
    expect(calls.every((call) => call.cwd === worktreePath)).toBe(true);
    expect(result.steps).toHaveLength(6);
    expect(result.diff).toContain("roles.ts");
  });

  it("rejects a worktree outside the owned root before running commands", async () => {
    const runner: CommandRunner = {
      run: async () => {
        throw new Error("must not run");
      },
    };
    await expect(
      runTargetValidation({
        runner,
        worktreeRoot: join(tmpdir(), "owned-root"),
        worktreePath: join(tmpdir(), "escape"),
        pnpmCommand: { executable: "corepack", argsPrefix: ["pnpm"] },
      }),
    ).rejects.toThrow(/owned/i);
  });
});
