import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRepositoryCache, type WorktreeHandle } from "@/src/git/repository-cache";
import {
  createCommandRunner,
  type CommandResult,
  type CommandRunner,
  type CommandSpec,
} from "@/src/system/command-runner";
import { createGitFixture, type GitFixture } from "@/tests/helpers/git-fixture";

const fixtures: GitFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function setup(runner: CommandRunner = createCommandRunner()) {
  const fixture = createGitFixture();
  fixtures.push(fixture);
  const cacheRepoPath = join(fixture.root, "cache", "pep-webapp.git");
  const worktreeRoot = join(fixture.root, "worktrees");
  return {
    fixture,
    cacheRepoPath,
    worktreeRoot,
    cache: createRepositoryCache({
      runner,
      cacheRepoPath,
      worktreeRoot,
      targetSlug: "fixture/pep-webapp",
      baseBranch: "develop",
      cloneUrl: fixture.remotePath,
    }),
  };
}

describe("RepositoryCache", () => {
  it("clones, fetches, and resolves the exact remote develop SHA", async () => {
    const { cache, cacheRepoPath, fixture } = setup();

    const revision = await cache.refresh();

    expect(existsSync(cacheRepoPath)).toBe(true);
    expect(revision).toEqual({
      sha: fixture.initialSha,
      ref: "refs/remotes/origin/develop",
    });
  });

  it("fetches a later develop commit without depending on a user checkout", async () => {
    const { cache, fixture } = setup();
    await cache.refresh();
    const nextSha = fixture.advance("next\n");

    expect((await cache.refresh()).sha).toBe(nextSha);
  });

  it("coalesces concurrent refreshes into one clone/fetch sequence", async () => {
    const delegate = createCommandRunner();
    let fetches = 0;
    const runner: CommandRunner = {
      async run(spec: CommandSpec): Promise<CommandResult> {
        if (spec.args.includes("fetch")) fetches += 1;
        return delegate.run(spec);
      },
    };
    const { cache, fixture } = setup(runner);

    const [left, right] = await Promise.all([cache.refresh(), cache.refresh()]);

    expect(left.sha).toBe(fixture.initialSha);
    expect(right).toEqual(left);
    expect(fetches).toBe(1);
  });

  it("creates and removes an owned detached worktree", async () => {
    const { cache, fixture } = setup();
    const revision = await cache.refresh();

    const worktree = await cache.createWorktree("01J5ZZZZZZZZZZZZZZZZZZZZZZ", revision.sha);

    expect(readFileSync(join(worktree.path, "fixture.txt"), "utf8").trim()).toBe("develop");
    await cache.removeWorktree(worktree);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("rejects invalid identifiers, SHAs, and cleanup outside the owned root", async () => {
    const { cache, fixture } = setup();
    const revision = await cache.refresh();

    await expect(cache.createWorktree("../escape", revision.sha)).rejects.toThrow(/request id/i);
    await expect(cache.createWorktree("01J5ZZZZZZZZZZZZZZZZZZZZZZ", "short")).rejects.toThrow(
      /sha/i,
    );
    await expect(
      cache.removeWorktree({
        requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
        sha: revision.sha,
        path: fixture.seedPath,
      } as WorktreeHandle),
    ).rejects.toThrow(/owned worktree/i);
    expect(existsSync(fixture.seedPath)).toBe(true);
  });

  it("removes an owned partial directory when worktree creation fails", async () => {
    const delegate = createCommandRunner();
    let partialPath = "";
    const runner: CommandRunner = {
      async run(spec: CommandSpec): Promise<CommandResult> {
        if (spec.args.includes("worktree") && spec.args.includes("add")) {
          partialPath = spec.args.at(-2)!;
          mkdirSync(partialPath, { recursive: true });
          throw new Error("simulated worktree failure");
        }
        return delegate.run(spec);
      },
    };
    const { cache } = setup(runner);
    const revision = await cache.refresh();

    await expect(cache.createWorktree("01J5ZZZZZZZZZZZZZZZZZZZZZZ", revision.sha)).rejects.toThrow(
      "simulated worktree failure",
    );
    expect(existsSync(partialPath)).toBe(false);
  });
});
