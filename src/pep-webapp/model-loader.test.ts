import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRemoteModelLoader } from "@/src/pep-webapp/model-loader";
import type { RemoteRevision, RepositoryCache, WorktreeHandle } from "@/src/git/repository-cache";
import type { CommandResult, CommandRunner, CommandSpec } from "@/src/system/command-runner";
import { validModel } from "@/tests/fixtures/model";

const roots: string[] = [];
const revision: RemoteRevision = {
  sha: validModel.sourceSha,
  ref: "refs/remotes/origin/develop",
};

const ok = (stdout = ""): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  durationMs: 1,
});

function setup(exported: string = JSON.stringify(validModel)) {
  const root = mkdtempSync(join(tmpdir(), "permission-studio-model-"));
  roots.push(root);
  const worktree: WorktreeHandle = {
    requestId: revision.sha.slice(0, 26).toUpperCase(),
    sha: revision.sha,
    path: join(root, "target"),
  };
  const cacheCalls = {
    refresh: 0,
    create: 0,
    remove: 0,
  };
  const cache: RepositoryCache = {
    async refresh() {
      cacheCalls.refresh += 1;
      return revision;
    },
    async createWorktree() {
      cacheCalls.create += 1;
      return worktree;
    },
    async removeWorktree() {
      cacheCalls.remove += 1;
    },
  };
  const commandCalls: CommandSpec[] = [];
  const runner: CommandRunner = {
    async run(spec) {
      commandCalls.push(spec);
      if (spec.executable === process.execPath) return ok(exported);
      return ok();
    },
  };
  const loader = createRemoteModelLoader({
    cache,
    runner,
    modelCacheRoot: join(root, "models"),
    exporterPath: join(root, "export-model.mjs"),
  });
  return { loader, cacheCalls, commandCalls, worktree };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createRemoteModelLoader", () => {
  it("installs, generates, exports, validates, caches, and cleans a new SHA", async () => {
    const { loader, cacheCalls, commandCalls, worktree } = setup();

    const model = await loader.load();

    expect(model.sourceSha).toBe(revision.sha);
    expect(commandCalls.map((call) => [call.executable, call.args])).toEqual([
      ["corepack", ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"]],
      ["corepack", ["pnpm", "gen:coc"]],
      [
        process.execPath,
        [expect.stringMatching(/export-model\.mjs$/), worktree.path, revision.sha],
      ],
    ]);
    expect(commandCalls.every((call) => call.cwd === worktree.path)).toBe(true);
    expect(cacheCalls).toEqual({ refresh: 1, create: 1, remove: 1 });
  });

  it("reuses the validated disk model for the same SHA", async () => {
    const { loader, cacheCalls, commandCalls } = setup();
    const first = await loader.load();
    const second = await loader.load();

    expect(second).toEqual(first);
    expect(commandCalls).toHaveLength(3);
    expect(cacheCalls).toEqual({ refresh: 2, create: 1, remove: 1 });
  });

  it("always removes the worktree when export data is invalid", async () => {
    const { loader, cacheCalls } = setup("{not-json");

    await expect(loader.load()).rejects.toThrow(/model export/i);
    expect(cacheCalls.remove).toBe(1);
  });

  it("rejects a model whose embedded SHA differs from the fetched revision", async () => {
    const { loader, cacheCalls } = setup(
      JSON.stringify({
        ...validModel,
        sourceSha: "ffffffffffffffffffffffffffffffffffffffff",
      }),
    );

    await expect(loader.load()).rejects.toThrow(/source sha/i);
    expect(cacheCalls.remove).toBe(1);
  });
});
