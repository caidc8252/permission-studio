import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { CommandRunner } from "@/src/system/command-runner";

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

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
  let refreshInFlight: Promise<RemoteRevision> | undefined;

  const git = (args: readonly string[], timeoutMs = 120_000) =>
    options.runner.run({
      executable: "git",
      args,
      timeoutMs,
    });

  const performRefresh = async (): Promise<RemoteRevision> => {
    if (!existsSync(cacheRepoPath)) {
      await mkdir(dirname(cacheRepoPath), { recursive: true });
      if (options.cloneUrl) {
        await git(["clone", "--bare", options.cloneUrl, cacheRepoPath]);
      } else {
        await options.runner.run({
          executable: "gh",
          args: ["repo", "clone", options.targetSlug, cacheRepoPath, "--", "--bare"],
          timeoutMs: 120_000,
        });
      }
    }

    await git([
      "-C",
      cacheRepoPath,
      "fetch",
      "--prune",
      "origin",
      `+refs/heads/${options.baseBranch}:${remoteRef}`,
    ]);
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
        await git(["-C", cacheRepoPath, "worktree", "remove", "--force", actualPath]);
      }
      await git(["-C", cacheRepoPath, "worktree", "prune"]);
    },
  };
}
