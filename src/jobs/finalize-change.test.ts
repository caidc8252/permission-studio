import { describe, expect, it, vi } from "vitest";

import type { PermissionChange } from "@/src/domain/change";
import { createChangeJobService } from "@/src/jobs/change-job-service";
import { createChangeJobStore, type ChangeJob } from "@/src/jobs/change-job-store";
import type { CommandResult, CommandRunner, CommandSpec } from "@/src/system/command-runner";

const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
const baseSha = "0123456789abcdef0123456789abcdef01234567";
const branchName = `permission-studio/${requestId.toLowerCase()}`;
const change: PermissionChange = {
  version: 1,
  requestId,
  baseSha,
  reason: "为运营角色增加订单查看能力",
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.view"], remove: [] }],
  contractChanges: [],
};

function setup(options: { remoteSha?: string; prFailure?: boolean } = {}) {
  const store = createChangeJobStore();
  const job: ChangeJob = {
    requestId,
    state: "awaiting-confirmation",
    change,
    branchName,
    createdAt: "2026-08-16T10:00:00.000Z",
    expiresAt: "2026-08-16T10:30:00.000Z",
    confirmationNonce: "confirm-once",
    touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
    validationSteps: [{ name: "typecheck", status: "passed", durationMs: 2 }],
    diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
    worktree: { requestId, sha: baseSha, path: "C:\\owned\\worktrees\\job" },
  };
  store.set(job);
  const calls: CommandSpec[] = [];
  const runner: CommandRunner = {
    async run(spec): Promise<CommandResult> {
      calls.push(spec);
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    },
  };
  const removeWorktree = vi.fn().mockResolvedValue(undefined);
  const createDraftPullRequest = options.prFailure
    ? vi.fn().mockRejectedValue(new Error("gh failed C:\\secret"))
    : vi.fn().mockResolvedValue("https://github.com/org/repo/pull/42");
  const service = createChangeJobService({
    store,
    cache: {
      refresh: vi
        .fn()
        .mockResolvedValue({
          sha: options.remoteSha ?? baseSha,
          ref: "refs/remotes/origin/develop",
        }),
      createWorktree: vi.fn(),
      removeWorktree,
    },
    applyChange: vi.fn(),
    validate: vi.fn(),
    now: () => new Date("2026-08-16T10:05:00.000Z"),
    nonce: () => "unused",
    finalization: {
      runner,
      getViewer: async () => ({
        login: "caidc8252",
        id: 42,
        noreplyEmail: "42+caidc8252@users.noreply.github.com",
      }),
      createDraftPullRequest,
      writeBody: vi.fn().mockResolvedValue("C:\\owned\\worktrees\\job\\.permission-studio-pr.md"),
    },
  });
  return { service, calls, createDraftPullRequest, removeWorktree };
}

describe("finalizeChange", () => {
  it("configures local identity, commits, non-force pushes, and creates a draft PR", async () => {
    const { service, calls, createDraftPullRequest, removeWorktree } = setup();
    const result = await service.finalizeChange(requestId, "confirm-once");

    expect(calls.map(({ executable, args }) => [executable, ...args])).toEqual([
      ["git", "config", "user.name", "caidc8252"],
      ["git", "config", "user.email", "42+caidc8252@users.noreply.github.com"],
      ["git", "switch", "-c", branchName],
      [
        "git",
        "add",
        "--",
        "apps/web/manifest/catalog/roles.ts",
        "apps/web/manifest/catalog/contract-types.ts",
      ],
      ["git", "commit", "-m", "chore(permissions): apply Permission Studio change"],
      ["git", "push", "origin", `HEAD:refs/heads/${branchName}`],
    ]);
    expect(calls.every((call) => call.cwd === "C:\\owned\\worktrees\\job")).toBe(true);
    expect(calls.flatMap((call) => call.args)).not.toContain("--force");
    expect(createDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "develop",
        head: branchName,
        draft: true,
      }),
    );
    expect(result).toMatchObject({
      state: "completed",
      prUrl: "https://github.com/org/repo/pull/42",
    });
    expect(removeWorktree).toHaveBeenCalledOnce();
    expect(await service.finalizeChange(requestId, "already-consumed")).toEqual(result);
  });

  it("rejects a stale second fetch before push and cleans up", async () => {
    const { service, calls, removeWorktree } = setup({ remoteSha: "f".repeat(40) });
    await expect(service.finalizeChange(requestId, "confirm-once")).rejects.toMatchObject({
      code: "STALE_MODEL",
    });
    expect(calls).toEqual([]);
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it("keeps the remote branch and returns a redacted recovery command after PR failure", async () => {
    const { service, createDraftPullRequest } = setup({ prFailure: true });
    await expect(service.finalizeChange(requestId, "confirm-once")).rejects.toMatchObject({
      code: "PR_CREATE_FAILED",
    });
    const job = service.getChangeJob(requestId);
    expect(job).toMatchObject({
      state: "failed",
      recoveryCommand: `gh pr create --repo Newland-Payment-Technology-US-Co-Ltd/pep-webapp --base develop --head ${branchName} --draft`,
    });
    expect(JSON.stringify(job)).not.toContain("C:\\secret");
    expect(createDraftPullRequest).toHaveBeenCalledOnce();
  });
});
