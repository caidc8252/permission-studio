import { isAbsolute, relative, resolve } from "node:path";

import type { CommandRunner } from "@/src/system/command-runner";
import type { PnpmCommand } from "@/src/system/package-manager";

export const ALLOWED_CATALOG_PATHS = Object.freeze([
  "apps/web/manifest/catalog/roles.ts",
  "apps/web/manifest/catalog/contract-types.ts",
]);

export interface ValidationStep {
  name: string;
  status: "passed";
  durationMs: number;
}

export interface ValidationResult {
  steps: ValidationStep[];
  diff: string;
}

interface ValidationOptions {
  runner: CommandRunner;
  worktreeRoot: string;
  worktreePath: string;
  pnpmCommand: PnpmCommand;
}

function assertOwnedWorktree(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const pathFromRoot = relative(absoluteRoot, absoluteCandidate);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Validation worktree is outside the owned root");
  }
  return absoluteCandidate;
}

function statusPaths(status: string): string[] {
  return status
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      const path = line.slice(3);
      return path.includes(" -> ") ? path.split(" -> ") : [path];
    });
}

function assertApprovedPaths(paths: readonly string[]): void {
  const approved = new Set<string>(ALLOWED_CATALOG_PATHS);
  if (paths.some((path) => !approved.has(path))) {
    throw new Error("Worktree contains a change to an unapproved path");
  }
}

export async function runTargetValidation(options: ValidationOptions): Promise<ValidationResult> {
  const cwd = assertOwnedWorktree(options.worktreeRoot, options.worktreePath);
  const pnpm = async (name: string, args: readonly string[], timeoutMs: number) => {
    const result = await options.runner.run({
      executable: options.pnpmCommand.executable,
      args: [...options.pnpmCommand.argsPrefix, ...args],
      cwd,
      timeoutMs,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    return { name, status: "passed" as const, durationMs: result.durationMs };
  };
  const git = async (name: string, args: readonly string[], timeoutMs = 120_000) => {
    const result = await options.runner.run({
      executable: "git",
      args,
      cwd,
      timeoutMs,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    return { step: { name, status: "passed" as const, durationMs: result.durationMs }, result };
  };

  const steps: ValidationStep[] = [];
  steps.push(await pnpm("install", ["install", "--frozen-lockfile"], 600_000));
  steps.push(await pnpm("generate catalog", ["gen:coc"], 300_000));
  steps.push(
    await pnpm("format catalogs", ["prettier", "--write", ...ALLOWED_CATALOG_PATHS], 120_000),
  );
  steps.push(
    await pnpm(
      "catalog tests",
      [
        "vitest",
        "run",
        "apps/web/manifest/catalog/roles.test.ts",
        "apps/web/manifest/catalog/contract-types.test.ts",
      ],
      300_000,
    ),
  );
  steps.push(await pnpm("typecheck", ["typecheck"], 600_000));
  const diffCheck = await git("diff check", ["diff", "--check"]);
  steps.push(diffCheck.step);
  const status = await git("worktree status", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  assertApprovedPaths(statusPaths(status.result.stdout));
  const staged = await git("staged paths", ["diff", "--cached", "--name-only"]);
  if (staged.result.stdout.trim()) {
    throw new Error("Validation scripts left staged changes");
  }
  const diff = await git("final diff", ["diff", "--binary"]);
  return { steps, diff: diff.result.stdout };
}
