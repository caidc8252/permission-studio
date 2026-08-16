import type { PermissionChange } from "@/src/domain/change";
import type { WorktreeHandle } from "@/src/git/repository-cache";
import type { ValidationStep } from "@/src/jobs/validation";

export type ChangeJobState =
  | "validating"
  | "awaiting-confirmation"
  | "finalizing"
  | "completed"
  | "failed";

export interface ChangeJob {
  requestId: string;
  state: ChangeJobState;
  change: PermissionChange;
  branchName: string;
  createdAt: string;
  expiresAt: string;
  confirmationNonce: string;
  touchedFiles: string[];
  validationSteps: ValidationStep[];
  diff: string;
  errorCode?: string;
  prUrl?: string;
  recoveryCommand?: string;
  worktree?: WorktreeHandle;
}

export interface PublicChangeJob {
  requestId: string;
  state: ChangeJobState;
  baseSha: string;
  reason: string;
  branchName: string;
  createdAt: string;
  expiresAt: string;
  confirmationNonce: string;
  touchedFiles: string[];
  validationSteps: ValidationStep[];
  diff: string;
  errorCode?: string;
  prUrl?: string;
  recoveryCommand?: string;
}

export interface ChangeJobStore {
  get(id: string): ChangeJob | undefined;
  set(job: ChangeJob): void;
  delete(id: string): void;
  values(): ChangeJob[];
}

export function createChangeJobStore(): ChangeJobStore {
  const jobs = new Map<string, ChangeJob>();
  return {
    get: (id) => jobs.get(id),
    set: (job) => jobs.set(job.requestId, job),
    delete: (id) => jobs.delete(id),
    values: () => [...jobs.values()],
  };
}

export function toPublicChangeJob(job: ChangeJob): PublicChangeJob {
  return {
    requestId: job.requestId,
    state: job.state,
    baseSha: job.change.baseSha,
    reason: job.change.reason,
    branchName: job.branchName,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    confirmationNonce: job.confirmationNonce,
    touchedFiles: [...job.touchedFiles],
    validationSteps: [...job.validationSteps],
    diff: job.diff,
    ...(job.errorCode ? { errorCode: job.errorCode } : {}),
    ...(job.prUrl ? { prUrl: job.prUrl } : {}),
    ...(job.recoveryCommand ? { recoveryCommand: job.recoveryCommand } : {}),
  };
}
