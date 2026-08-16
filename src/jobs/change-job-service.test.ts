import { describe, expect, it, vi } from "vitest";

import { createChangeJobService, ChangeJobError } from "@/src/jobs/change-job-service";
import { createChangeJobStore } from "@/src/jobs/change-job-store";
import type { PermissionChange } from "@/src/domain/change";
import { validModel } from "@/tests/fixtures/model";

const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
const change: PermissionChange = {
  version: 1,
  requestId,
  baseSha: validModel.sourceSha,
  reason: "为运营角色增加订单查看能力",
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.manage"], remove: [] }],
  contractChanges: [],
};

function setup(overrides: Record<string, unknown> = {}) {
  const store = createChangeJobStore();
  const removeWorktree = vi.fn().mockResolvedValue(undefined);
  const createWorktree = vi.fn().mockResolvedValue({
    requestId,
    sha: validModel.sourceSha,
    path: "C:\\owned\\worktrees\\job",
  });
  const service = createChangeJobService({
    store,
    cache: {
      refresh: vi
        .fn()
        .mockResolvedValue({ sha: validModel.sourceSha, ref: "refs/remotes/origin/develop" }),
      createWorktree,
      removeWorktree,
    },
    applyChange: vi
      .fn()
      .mockResolvedValue({ touchedFiles: ["apps/web/manifest/catalog/roles.ts"] }),
    validate: vi.fn().mockResolvedValue({
      steps: [{ name: "target validation", status: "passed", durationMs: 2 }],
      diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
    }),
    now: () => new Date("2026-08-16T10:00:00.000Z"),
    nonce: () => "confirmation-nonce",
    ...overrides,
  });
  return { service, store, createWorktree, removeWorktree };
}

describe("change job service", () => {
  it("prepares an exact-SHA job and exposes no local path", async () => {
    const { service } = setup();
    const prepared = await service.prepareChange(change);

    expect(prepared.state).toBe("awaiting-confirmation");
    expect(prepared.diff).toContain("roles.ts");
    expect(prepared.confirmationNonce).toBe("confirmation-nonce");
    expect(JSON.stringify(prepared)).not.toContain("C:\\owned");
  });

  it("rejects stale SHA before creating a worktree", async () => {
    const createWorktree = vi.fn();
    const { service } = setup({
      cache: {
        refresh: vi
          .fn()
          .mockResolvedValue({ sha: "f".repeat(40), ref: "refs/remotes/origin/develop" }),
        createWorktree,
        removeWorktree: vi.fn(),
      },
    });
    await expect(service.prepareChange(change)).rejects.toMatchObject({ code: "STALE_MODEL" });
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it("enforces one global prepare lock", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = setup({
      validate: vi.fn().mockImplementation(async () => {
        await gate;
        return {
          steps: [],
          diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
        };
      }),
    });
    const first = service.prepareChange(change);
    await vi.waitFor(() => expect(service.getChangeJob(requestId)?.state).toBe("validating"));
    await expect(
      service.prepareChange({ ...change, requestId: "01J6AAAAAAAAAAAAAAAAAAAAAA" }),
    ).rejects.toMatchObject({ code: "OPERATION_BUSY" });
    release();
    await first;
  });

  it("starts validation in the background and returns the polling state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = setup({
      validate: vi.fn().mockImplementation(async () => {
        await gate;
        return {
          steps: [],
          diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
        };
      }),
    });

    const started = await service.startPrepareChange(change);
    expect(started.state).toBe("validating");
    release();
    await vi.waitFor(() =>
      expect(service.getChangeJob(requestId)?.state).toBe("awaiting-confirmation"),
    );
  });

  it("records validation failures and preserves their worktree until discard", async () => {
    const { service, removeWorktree } = setup({
      validate: vi.fn().mockRejectedValue(new Error("typecheck failed at C:\\secret")),
    });
    await expect(service.prepareChange(change)).rejects.toBeInstanceOf(ChangeJobError);
    expect(service.getChangeJob(requestId)).toMatchObject({
      state: "failed",
      errorCode: "PREPARE_FAILED",
    });
    expect(JSON.stringify(service.getChangeJob(requestId))).not.toContain("secret");
    expect(removeWorktree).not.toHaveBeenCalled();
    await service.discardPreparedChange(requestId);
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it("exposes only the bounded redacted failure summary returned by the logger", async () => {
    const { service } = setup({
      validate: vi.fn().mockRejectedValue(new Error("secret")),
      logFailure: vi.fn().mockResolvedValue('{"error":"typecheck failed","stderr":"[REDACTED]"}'),
    });

    await expect(service.prepareChange(change)).rejects.toBeInstanceOf(ChangeJobError);
    expect(service.getChangeJob(requestId)?.failureSummary).toContain("[REDACTED]");
    expect(service.getChangeJob(requestId)?.failureSummary).not.toContain("C:\\owned");
  });

  it("rejects unapproved diff paths and supports discard", async () => {
    const { service, removeWorktree } = setup({
      validate: vi
        .fn()
        .mockResolvedValue({ steps: [], diff: "diff --git a/package.json b/package.json\n" }),
    });
    await expect(service.prepareChange(change)).rejects.toMatchObject({ code: "UNAPPROVED_DIFF" });
    await service.discardPreparedChange(requestId);
    expect(service.getChangeJob(requestId)).toBeNull();
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it("expires prepared jobs after thirty minutes and schedules cleanup", async () => {
    let current = new Date("2026-08-16T10:00:00.000Z");
    const { service, removeWorktree } = setup({ now: () => current });
    await service.prepareChange(change);
    current = new Date("2026-08-16T10:31:00.000Z");

    expect(service.getChangeJob(requestId)).toBeNull();
    await vi.waitFor(() => expect(removeWorktree).toHaveBeenCalledOnce());
  });
});
