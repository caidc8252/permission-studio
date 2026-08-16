import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  CommandExecutionError,
  type CommandRunner,
  type CommandSpec,
} from "@/src/system/command-runner";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RETRYABLE_PROXY_FAILURE =
  /Failed to connect to (?:(?:127\.0\.0\.1|localhost) port \d+.*Connection refused|github\.com port 443.*Timed out)/i;
const WINDOWS_LONG_PATH_FAILURE = /Filename too long/i;
export interface RemoteRevision {
  sha: string;
  ref: string;
}

export interface WorktreeHandle {
  requestId: string;
  sha: string;
  path: string;
}

export interface RepositoryCache {
  refresh(): Promise<RemoteRevision>;
  createWorktree(requestId: string, sha: string): Promise<WorktreeHandle>;
  removeWorktree(handle: WorktreeHandle): Promise<void>;
}

export interface RepositoryCacheOptions {
  runner: CommandRunner;
  cacheRepoPath: string;
  worktreeRoot: string;
  targetSlug: string;
  baseBranch: string;
  cloneUrl?: string;
  fallbackProxyUrl?: string;
}

function assertOwnedPath(root: string, candidate: string): void {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Path is not an owned worktree: ${candidate}`);
  }
}

export function createRepositoryCache(options: RepositoryCacheOptions): RepositoryCache {
  const cacheRepoPath = resolve(options.cacheRepoPath);
  const worktreeRoot = resolve(options.worktreeRoot);
  const remoteRef = `refs/remotes/origin/${options.baseBranch}`;
  const fallbackProxyUrl =
    options.fallbackProxyUrl ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? "";
  const fallbackGitProxyEnv = Object.freeze({
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.proxy",
    GIT_CONFIG_VALUE_0: fallbackProxyUrl,
    GIT_CONFIG_KEY_1: "https.proxy",
    GIT_CONFIG_VALUE_1: fallbackProxyUrl,
  });
  let refreshInFlight: Promise<RemoteRevision> | undefined;

  const runWithLoopbackProxyRetry = async (spec: CommandSpec) => {
    try {
      return await options.runner.run(spec);
    } catch (error) {
      if (
        !(error instanceof CommandExecutionError) ||
        !RETRYABLE_PROXY_FAILURE.test(error.stderr)
      ) {
        throw error;
      }
      return options.runner.run({
        ...spec,
        env: fallbackGitProxyEnv,
      });
    }
  };

  const git = (args: readonly string[], timeoutMs = 120_000, retryLoopbackProxy = false) => {
    const spec = {
      executable: "git",
      args,
      timeoutMs,
    } satisfies CommandSpec;
    return retryLoopbackProxy ? runWithLoopbackProxyRetry(spec) : options.runner.run(spec);
  };

  const performRefresh = async (): Promise<RemoteRevision> => {
    if (!existsSync(cacheRepoPath)) {
      await mkdir(dirname(cacheRepoPath), { recursive: true });
      if (options.cloneUrl) {
        await git(
          [
            "clone",
            "--bare",
            "--depth=1",
            "--single-branch",
            `--branch=${options.baseBranch}`,
            options.cloneUrl,
            cacheRepoPath,
          ],
          600_000,
        );
      } else {
        const cloneSpec = {
          executable: "gh",
          args: [
            "repo",
            "clone",
            options.targetSlug,
            cacheRepoPath,
            "--",
            "--bare",
            "--depth=1",
            "--single-branch",
            `--branch=${options.baseBranch}`,
          ],
          timeoutMs: 600_000,
        } as const;
        await runWithLoopbackProxyRetry(cloneSpec);
      }
    }

    await git(
      [
        "-C",
        cacheRepoPath,
        "fetch",
        "--prune",
        "origin",
        `+refs/heads/${options.baseBranch}:${remoteRef}`,
      ],
      600_000,
      true,
    );
    const result = await git(["-C", cacheRepoPath, "rev-parse", "--verify", remoteRef]);
    const sha = result.stdout.trim();
    if (!SHA_PATTERN.test(sha)) {
      throw new Error(`Remote ${options.baseBranch} returned an invalid SHA`);
    }
    return { sha, ref: remoteRef };
  };

  return {
    async refresh() {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = performRefresh();
      try {
        return await refreshInFlight;
      } finally {
        refreshInFlight = undefined;
      }
    },

    async createWorktree(requestId, sha) {
      if (!ULID_PATTERN.test(requestId)) {
        throw new Error("Invalid worktree request ID");
      }
      if (!SHA_PATTERN.test(sha)) {
        throw new Error("Invalid worktree SHA");
      }
      await mkdir(worktreeRoot, { recursive: true });
      const path = resolve(join(worktreeRoot, requestId.toLowerCase()));
      assertOwnedPath(worktreeRoot, path);
      if (existsSync(path)) {
        throw new Error(`Worktree already exists for request "${requestId}"`);
      }

      try {
        await git(["-C", cacheRepoPath, "worktree", "add", "--detach", path, sha]);
      } catch (error) {
        if (existsSync(path)) {
          assertOwnedPath(worktreeRoot, path);
          await rm(path, { recursive: true, force: true });
        }
        throw error;
      }
      return Object.freeze({ requestId, sha, path });
    },

    async removeWorktree(handle) {
      if (!ULID_PATTERN.test(handle.requestId) || !SHA_PATTERN.test(handle.sha)) {
        throw new Error("Invalid owned worktree handle");
      }
      const expectedPath = resolve(join(worktreeRoot, handle.requestId.toLowerCase()));
      const actualPath = resolve(handle.path);
      assertOwnedPath(worktreeRoot, actualPath);
      if (actualPath !== expectedPath) {
        throw new Error("Path is not the owned worktree for this request");
      }
      if (existsSync(actualPath)) {
        try {
          await git(["-C", cacheRepoPath, "worktree", "remove", "--force", actualPath]);
        } catch (error) {
          if (
            !(error instanceof CommandExecutionError) ||
            !WINDOWS_LONG_PATH_FAILURE.test(error.stderr)
          ) {
            throw error;
          }
          assertOwnedPath(worktreeRoot, actualPath);
          await rm(actualPath, { recursive: true, force: true });
        }
      }
      await git(["-C", cacheRepoPath, "worktree", "prune"]);
    },
  };
}
