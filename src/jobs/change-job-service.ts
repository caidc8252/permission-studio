import type { PermissionChange } from "@/src/domain/change";
import type { RepositoryCache, WorktreeHandle } from "@/src/git/repository-cache";
import type { GhViewer } from "@/src/github/gh-client";
import { buildPullRequestBody } from "@/src/github/pr-body";
import {
  type ChangeJob,
  type ChangeJobStore,
  type PublicChangeJob,
  toPublicChangeJob,
} from "@/src/jobs/change-job-store";
import { ALLOWED_CATALOG_PATHS, type ValidationResult } from "@/src/jobs/validation";
import type { CommandRunner } from "@/src/system/command-runner";

const PREPARED_TTL_MS = 30 * 60 * 1000;
const MAX_DIFF_BYTES = 1024 * 1024;

function gitRemoteEnvironment(): Readonly<Record<string, string>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? "";
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.proxy",
    GIT_CONFIG_VALUE_0: proxy,
    GIT_CONFIG_KEY_1: "https.proxy",
    GIT_CONFIG_VALUE_1: proxy,
  };
}

export class ChangeJobError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChangeJobError";
  }
}

interface ChangeJobServiceOptions {
  store: ChangeJobStore;
  cache: RepositoryCache;
  applyChange: (
    worktreePath: string,
    change: PermissionChange,
  ) => Promise<{ touchedFiles: string[] }>;
  validate: (worktreePath: string) => Promise<ValidationResult>;
  now?: () => Date;
  nonce: () => string;
  logFailure?: (requestId: string, phase: "prepare" | "finalize", error: unknown) => Promise<void>;
  finalization?: {
    runner: CommandRunner;
    getViewer: () => Promise<GhViewer>;
    createDraftPullRequest: (input: {
      repo: string;
      base: string;
      head: string;
      draft: true;
      title: string;
      bodyFile: string;
    }) => Promise<string>;
    writeBody: (worktreePath: string, body: string) => Promise<string>;
  };
}

export interface ChangeJobService {
  prepareChange(change: PermissionChange): Promise<PublicChangeJob>;
  startPrepareChange(change: PermissionChange): Promise<PublicChangeJob>;
  getChangeJob(id: string): PublicChangeJob | null;
  discardPreparedChange(id: string): Promise<void>;
  finalizeChange(id: string, confirmationNonce: string): Promise<PublicChangeJob>;
  startFinalizeChange(id: string, confirmationNonce: string): Promise<PublicChangeJob>;
  getInternalJob(id: string): ChangeJob | undefined;
}

function diffPaths(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)].flatMap((match) => [
    match[1]!,
    match[2]!,
  ]);
}

function porcelainPaths(status: string): string[] {
  return status
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      const path = line.slice(3);
      return path.includes(" -> ") ? path.split(" -> ") : [path];
    });
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u).filter(Boolean);
}

function samePathSet(actual: readonly string[], expected: readonly string[]): boolean {
  const normalized = (paths: readonly string[]) => [...new Set(paths)].sort();
  return JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected));
}

export function createChangeJobService(options: ChangeJobServiceOptions): ChangeJobService {
  const now = options.now ?? (() => new Date());
  let busy = false;

  const discardWorktree = async (worktree?: WorktreeHandle) => {
    if (worktree) await options.cache.removeWorktree(worktree);
  };

  const service: ChangeJobService = {
    async prepareChange(change) {
      if (busy) throw new ChangeJobError("OPERATION_BUSY", 409, "Another change is in progress");
      if (options.store.get(change.requestId)) {
        throw new ChangeJobError("CHANGE_EXISTS", 409, "Change request already exists");
      }
      busy = true;
      let job: ChangeJob | undefined;
      try {
        const createdAt = now();
        job = {
          requestId: change.requestId,
          state: "validating",
          change,
          branchName: `permission-studio/${change.requestId.toLowerCase()}`,
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + PREPARED_TTL_MS).toISOString(),
          confirmationNonce: options.nonce(),
          touchedFiles: [],
          validationSteps: [],
          diff: "",
        };
        options.store.set(job);
        const revision = await options.cache.refresh();
        if (revision.sha !== change.baseSha) {
          throw new ChangeJobError("STALE_MODEL", 409, "develop changed; refresh the model");
        }
        const worktree = await options.cache.createWorktree(change.requestId, revision.sha);
        job.worktree = worktree;
        options.store.set(job);
        const applied = await options.applyChange(worktree.path, change);
        if (applied.touchedFiles.some((path) => !ALLOWED_CATALOG_PATHS.includes(path))) {
          throw new ChangeJobError(
            "UNAPPROVED_DIFF",
            422,
            "Source editor touched an unapproved path",
          );
        }
        const validation = await options.validate(worktree.path);
        const approved = new Set<string>(ALLOWED_CATALOG_PATHS);
        if (diffPaths(validation.diff).some((path) => !approved.has(path))) {
          throw new ChangeJobError("UNAPPROVED_DIFF", 422, "Diff contains an unapproved path");
        }
        if (!validation.diff.trim()) {
          throw new ChangeJobError("EMPTY_DIFF", 422, "Prepared change produced no diff");
        }
        if (Buffer.byteLength(validation.diff, "utf8") > MAX_DIFF_BYTES) {
          throw new ChangeJobError("DIFF_TOO_LARGE", 422, "Prepared diff exceeds the limit");
        }
        job.state = "awaiting-confirmation";
        job.touchedFiles = [...applied.touchedFiles];
        job.validationSteps = validation.steps;
        job.diff = validation.diff;
        options.store.set(job);
        return toPublicChangeJob(job);
      } catch (error) {
        await options.logFailure?.(change.requestId, "prepare", error).catch(() => undefined);
        if (job) {
          job.state = "failed";
          job.errorCode = error instanceof ChangeJobError ? error.code : "PREPARE_FAILED";
          options.store.set(job);
        }
        if (error instanceof ChangeJobError) throw error;
        throw new ChangeJobError("PREPARE_FAILED", 422, "Permission change validation failed");
      } finally {
        busy = false;
      }
    },

    async startPrepareChange(change) {
      const pending = service.prepareChange(change);
      const job = options.store.get(change.requestId);
      if (!job) return pending;
      void pending.catch(() => undefined);
      return toPublicChangeJob(job);
    },

    getChangeJob(id) {
      const job = options.store.get(id);
      if (!job) return null;
      if (job.state === "awaiting-confirmation" && now().getTime() >= Date.parse(job.expiresAt)) {
        options.store.delete(id);
        void discardWorktree(job.worktree).catch(() => undefined);
        return null;
      }
      return toPublicChangeJob(job);
    },

    async discardPreparedChange(id) {
      const job = options.store.get(id);
      if (!job) throw new ChangeJobError("CHANGE_NOT_FOUND", 404, "Change request was not found");
      if (!new Set(["awaiting-confirmation", "failed"]).has(job.state)) {
        throw new ChangeJobError(
          "CHANGE_NOT_DISCARDABLE",
          409,
          "Change request cannot be discarded",
        );
      }
      await discardWorktree(job.worktree);
      options.store.delete(id);
    },

    async finalizeChange(id, confirmationNonce) {
      const job = options.store.get(id);
      if (!job) throw new ChangeJobError("CHANGE_NOT_FOUND", 404, "Change request was not found");
      if (job.state === "completed") return toPublicChangeJob(job);
      if (job.state !== "awaiting-confirmation") {
        throw new ChangeJobError(
          "CHANGE_NOT_CONFIRMABLE",
          409,
          "Change request cannot be confirmed",
        );
      }
      if (now().getTime() >= Date.parse(job.expiresAt)) {
        await discardWorktree(job.worktree);
        options.store.delete(id);
        throw new ChangeJobError("CHANGE_EXPIRED", 410, "Prepared change has expired");
      }
      if (!confirmationNonce || confirmationNonce !== job.confirmationNonce) {
        throw new ChangeJobError("CONFIRMATION_MISMATCH", 403, "Confirmation nonce is invalid");
      }
      if (!options.finalization || !job.worktree) {
        throw new ChangeJobError("FINALIZATION_UNAVAILABLE", 503, "Finalization is unavailable");
      }
      if (busy) throw new ChangeJobError("OPERATION_BUSY", 409, "Another change is in progress");

      busy = true;
      job.state = "finalizing";
      job.confirmationNonce = "";
      options.store.set(job);
      let pushed = false;
      try {
        const revision = await options.cache.refresh();
        if (revision.sha !== job.change.baseSha) {
          throw new ChangeJobError("STALE_MODEL", 409, "develop changed after validation");
        }
        const git = (
          args: readonly string[],
          timeoutMs = 120_000,
          env?: Readonly<Record<string, string>>,
        ) =>
          options.finalization!.runner.run({
            executable: "git",
            args,
            cwd: job.worktree!.path,
            timeoutMs,
            maxOutputBytes: 4 * 1024 * 1024,
            ...(env ? { env } : {}),
          });
        const approved = new Set<string>(ALLOWED_CATALOG_PATHS);
        const status = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
        if (porcelainPaths(status.stdout).some((path) => !approved.has(path))) {
          throw new ChangeJobError("UNAPPROVED_DIFF", 422, "Worktree contains an unapproved path");
        }
        const existingIndex = await git(["diff", "--cached", "--name-only"]);
        if (existingIndex.stdout.trim()) {
          throw new ChangeJobError("DIRTY_INDEX", 422, "Worktree index is not empty");
        }
        const currentDiff = await git(["diff", "--binary"]);
        if (currentDiff.stdout !== job.diff) {
          throw new ChangeJobError(
            "FINALIZE_DIFF_MISMATCH",
            409,
            "Worktree diff no longer matches the confirmed diff",
          );
        }

        const viewer = await options.finalization.getViewer();
        await git(["config", "user.name", viewer.login]);
        await git(["config", "user.email", viewer.noreplyEmail]);
        await git(["switch", "-c", job.branchName]);
        await git(["add", "--", ...ALLOWED_CATALOG_PATHS]);
        const stagedPaths = await git(["diff", "--cached", "--name-only"]);
        if (!samePathSet(lines(stagedPaths.stdout), job.touchedFiles)) {
          throw new ChangeJobError(
            "FINALIZE_DIFF_MISMATCH",
            409,
            "Staged paths no longer match the confirmed change",
          );
        }
        const stagedDiff = await git(["diff", "--cached", "--binary"]);
        if (stagedDiff.stdout !== job.diff) {
          throw new ChangeJobError(
            "FINALIZE_DIFF_MISMATCH",
            409,
            "Staged diff no longer matches the confirmed diff",
          );
        }
        await git(["commit", "-m", "chore(permissions): apply Permission Studio change"]);
        await git(
          ["push", "origin", `HEAD:refs/heads/${job.branchName}`],
          300_000,
          gitRemoteEnvironment(),
        );
        pushed = true;

        const body = buildPullRequestBody({
          change: job.change,
          actor: viewer.login,
          touchedFiles: job.touchedFiles,
          validationSteps: job.validationSteps,
        });
        const bodyFile = await options.finalization.writeBody(job.worktree.path, body);
        job.prUrl = await options.finalization.createDraftPullRequest({
          repo: "Newland-Payment-Technology-US-Co-Ltd/pep-webapp",
          base: "develop",
          head: job.branchName,
          draft: true,
          title: "chore(permissions): update permission catalogs",
          bodyFile,
        });
        job.state = "completed";
        await discardWorktree(job.worktree);
        job.worktree = undefined;
        options.store.set(job);
        return toPublicChangeJob(job);
      } catch (error) {
        await options.logFailure?.(job.requestId, "finalize", error).catch(() => undefined);
        job.state = "failed";
        const failure =
          error instanceof ChangeJobError
            ? error
            : new ChangeJobError(
                pushed ? "PR_CREATE_FAILED" : "FINALIZE_FAILED",
                502,
                pushed ? "Branch pushed but Draft PR creation failed" : "Finalization failed",
              );
        job.errorCode = failure.code;
        if (pushed) {
          job.recoveryCommand = `gh pr create --repo Newland-Payment-Technology-US-Co-Ltd/pep-webapp --base develop --head ${job.branchName} --draft`;
        }
        options.store.set(job);
        throw failure;
      } finally {
        busy = false;
      }
    },

    async startFinalizeChange(id, confirmationNonce) {
      const pending = service.finalizeChange(id, confirmationNonce);
      const job = options.store.get(id);
      if (!job || (job.state !== "finalizing" && job.state !== "completed")) return pending;
      void pending.catch(() => undefined);
      return toPublicChangeJob(job);
    },

    getInternalJob(id) {
      return options.store.get(id);
    },
  };
  return service;
}
