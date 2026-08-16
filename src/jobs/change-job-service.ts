import type { PermissionChange } from "@/src/domain/change";
import type { RepositoryCache, WorktreeHandle } from "@/src/git/repository-cache";
import {
  type ChangeJob,
  type ChangeJobStore,
  type PublicChangeJob,
  toPublicChangeJob,
} from "@/src/jobs/change-job-store";
import { ALLOWED_CATALOG_PATHS, type ValidationResult } from "@/src/jobs/validation";

const PREPARED_TTL_MS = 30 * 60 * 1000;
const MAX_DIFF_BYTES = 1024 * 1024;

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
}

export interface ChangeJobService {
  prepareChange(change: PermissionChange): Promise<PublicChangeJob>;
  getChangeJob(id: string): PublicChangeJob | null;
  discardPreparedChange(id: string): Promise<void>;
  getInternalJob(id: string): ChangeJob | undefined;
}

function diffPaths(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)].flatMap((match) => [
    match[1]!,
    match[2]!,
  ]);
}

export function createChangeJobService(options: ChangeJobServiceOptions): ChangeJobService {
  const now = options.now ?? (() => new Date());
  let preparing = false;

  const discardWorktree = async (worktree?: WorktreeHandle) => {
    if (worktree) await options.cache.removeWorktree(worktree);
  };

  return {
    async prepareChange(change) {
      if (preparing) throw new ChangeJobError("PREPARE_BUSY", 409, "Another change is validating");
      preparing = true;
      let job: ChangeJob | undefined;
      try {
        const revision = await options.cache.refresh();
        if (revision.sha !== change.baseSha) {
          throw new ChangeJobError("STALE_MODEL", 409, "develop changed; refresh the model");
        }
        if (options.store.get(change.requestId)) {
          throw new ChangeJobError("CHANGE_EXISTS", 409, "Change request already exists");
        }
        const worktree = await options.cache.createWorktree(change.requestId, revision.sha);
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
          worktree,
        };
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
        if (job) {
          await discardWorktree(job.worktree).catch(() => undefined);
          job.worktree = undefined;
          job.state = "failed";
          job.errorCode = error instanceof ChangeJobError ? error.code : "PREPARE_FAILED";
          job.diff = "";
          job.validationSteps = [];
          options.store.set(job);
        }
        if (error instanceof ChangeJobError) throw error;
        throw new ChangeJobError("PREPARE_FAILED", 422, "Permission change validation failed");
      } finally {
        preparing = false;
      }
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

    getInternalJob(id) {
      return options.store.get(id);
    },
  };
}
