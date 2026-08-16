import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRepositoryCache, type WorktreeHandle } from "@/src/git/repository-cache";
import {
  CommandExecutionError,
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
    const { cache } = setup();
    const revision = await cache.refresh();

    const worktree = await cache.createWorktree("01J5ZZZZZZZZZZZZZZZZZZZZZZ", revision.sha);

    expect(readFileSync(join(worktree.path, "fixture.txt"), "utf8").trim()).toBe("develop");
    await cache.removeWorktree(worktree);
    expect(existsSync(worktree.path)).toBe(false);
  });

  it("removes an owned worktree with Node when Git hits a Windows long path", async () => {
    const delegate = createCommandRunner();
    let failRemoval = false;
    let pruneCalls = 0;
    const runner: CommandRunner = {
      async run(spec): Promise<CommandResult> {
        if (spec.args.includes("remove") && failRemoval) {
          throw new CommandExecutionError({
            code: "COMMAND_FAILED",
            executable: "git",
            exitCode: 255,
            stdout: "",
            stderr: "error: failed to delete 'owned/path': Filename too long",
            durationMs: 1,
          });
        }
        if (spec.args.includes("prune")) pruneCalls += 1;
        return delegate.run(spec);
      },
    };
    const { cache } = setup(runner);
    const revision = await cache.refresh();
    const worktree = await cache.createWorktree("01J5ZZZZZZZZZZZZZZZZZZZZZZ", revision.sha);
    failRemoval = true;

    await cache.removeWorktree(worktree);

    expect(existsSync(worktree.path)).toBe(false);
    expect(pruneCalls).toBe(1);
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

  it("retries clone without a refused loopback Git proxy", async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const calls: CommandSpec[] = [];
    let cloneAttempts = 0;
    const runner: CommandRunner = {
      async run(spec): Promise<CommandResult> {
        calls.push(spec);
        if (spec.executable === "gh") {
          cloneAttempts += 1;
          if (cloneAttempts === 1) {
            throw new CommandExecutionError({
              code: "COMMAND_FAILED",
              executable: "gh",
              exitCode: 1,
              stdout: "",
              stderr: "fatal: Failed to connect to 127.0.0.1 port 7897: Connection refused",
              durationMs: 1,
            });
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (spec.args.includes("rev-parse")) {
          return {
            exitCode: 0,
            stdout: `${fixture.initialSha}\n`,
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      },
    };
    const cache = createRepositoryCache({
      runner,
      cacheRepoPath: join(fixture.root, "cache", "pep-webapp.git"),
      worktreeRoot: join(fixture.root, "worktrees"),
      targetSlug: "fixture/pep-webapp",
      baseBranch: "develop",
      fallbackProxyUrl: "",
    });

    expect((await cache.refresh()).sha).toBe(fixture.initialSha);
    expect(cloneAttempts).toBe(2);
    expect(calls[0]?.args).toEqual([
      "repo",
      "clone",
      "fixture/pep-webapp",
      join(fixture.root, "cache", "pep-webapp.git"),
      "--",
      "--bare",
      "--depth=1",
      "--single-branch",
      "--branch=develop",
    ]);
    expect(calls[0]?.timeoutMs).toBe(600_000);
    expect(calls[1]?.env).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.proxy",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "https.proxy",
      GIT_CONFIG_VALUE_1: "",
    });
  });

  it("retries clone directly when a configured proxy times out upstream", async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const calls: CommandSpec[] = [];
    let cloneAttempts = 0;
    const runner: CommandRunner = {
      async run(spec): Promise<CommandResult> {
        calls.push(spec);
        if (spec.executable === "gh") {
          cloneAttempts += 1;
          if (cloneAttempts === 1) {
            throw new CommandExecutionError({
              code: "COMMAND_FAILED",
              executable: "gh",
              exitCode: 1,
              stdout: "",
              stderr: "fatal: Failed to connect to github.com port 443: Timed out",
              durationMs: 1,
            });
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        if (spec.args.includes("rev-parse")) {
          return {
            exitCode: 0,
            stdout: `${fixture.initialSha}\n`,
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      },
    };
    const cache = createRepositoryCache({
      runner,
      cacheRepoPath: join(fixture.root, "cache", "pep-webapp.git"),
      worktreeRoot: join(fixture.root, "worktrees"),
      targetSlug: "fixture/pep-webapp",
      baseBranch: "develop",
      fallbackProxyUrl: "http://127.0.0.1:10808",
    });

    expect((await cache.refresh()).sha).toBe(fixture.initialSha);
    expect(cloneAttempts).toBe(2);
    expect(calls[1]?.env).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.proxy",
      GIT_CONFIG_VALUE_0: "http://127.0.0.1:10808",
      GIT_CONFIG_KEY_1: "https.proxy",
      GIT_CONFIG_VALUE_1: "http://127.0.0.1:10808",
    });
  });

  it("retries fetch without a refused loopback Git proxy", async () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    const cacheRepoPath = join(fixture.root, "cache", "pep-webapp.git");
    mkdirSync(cacheRepoPath, { recursive: true });
    const calls: CommandSpec[] = [];
    let fetchAttempts = 0;
    const runner: CommandRunner = {
      async run(spec): Promise<CommandResult> {
        calls.push(spec);
        if (spec.args.includes("fetch")) {
          fetchAttempts += 1;
          if (fetchAttempts === 1) {
            throw new CommandExecutionError({
              code: "COMMAND_FAILED",
              executable: "git",
              exitCode: 1,
              stdout: "",
              stderr: "fatal: Failed to connect to localhost port 7897: Connection refused",
              durationMs: 1,
            });
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        }
        return {
          exitCode: 0,
          stdout: `${fixture.initialSha}\n`,
          stderr: "",
          durationMs: 1,
        };
      },
    };
    const cache = createRepositoryCache({
      runner,
      cacheRepoPath,
      worktreeRoot: join(fixture.root, "worktrees"),
      targetSlug: "fixture/pep-webapp",
      baseBranch: "develop",
      fallbackProxyUrl: "",
    });

    expect((await cache.refresh()).sha).toBe(fixture.initialSha);
    expect(fetchAttempts).toBe(2);
    const lastFetch = calls.findLast((call) => call.args.includes("fetch"));
    expect(lastFetch?.timeoutMs).toBe(600_000);
    expect(lastFetch?.env).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.proxy",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "https.proxy",
      GIT_CONFIG_VALUE_1: "",
    });
  });
});
