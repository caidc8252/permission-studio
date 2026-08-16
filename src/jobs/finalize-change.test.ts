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
  title: "chore(permissions): grant report export",
  reason: "为运营角色增加订单查看能力",
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.view"], remove: [] }],
  contractChanges: [],
};

function setup(
  options: {
    remoteSha?: string;
    prFailure?: boolean;
    worktreeDiff?: string;
    initiallyStaged?: boolean;
  } = {},
) {
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
  let staged = options.initiallyStaged ?? false;
  const runner: CommandRunner = {
    async run(spec): Promise<CommandResult> {
      calls.push(spec);
      const command = [spec.executable, ...spec.args].join(" ");
      if (command.startsWith("git add ")) staged = true;
      const stdout =
        command === "git status --porcelain=v1 --untracked-files=all"
          ? `${staged ? "M " : " M"} apps/web/manifest/catalog/roles.ts\n`
          : command === "git diff --cached --name-only"
            ? staged
              ? "apps/web/manifest/catalog/roles.ts\n"
              : ""
            : command === "git diff --binary" || command === "git diff --cached --binary"
              ? (options.worktreeDiff ?? job.diff)
              : "";
      return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
    },
  };
  const removeWorktree = vi.fn().mockResolvedValue(undefined);
  const createDraftPullRequest = options.prFailure
    ? vi.fn().mockRejectedValue(new Error("gh failed C:\\secret"))
    : vi.fn().mockResolvedValue("https://github.com/org/repo/pull/42");
  const service = createChangeJobService({
    store,
    cache: {
      refresh: vi.fn().mockResolvedValue({
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
      ["git", "status", "--porcelain=v1", "--untracked-files=all"],
      ["git", "diff", "--cached", "--name-only"],
      ["git", "diff", "--binary"],
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
      ["git", "diff", "--cached", "--name-only"],
      ["git", "diff", "--cached", "--binary"],
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
        title: "chore(permissions): grant report export",
      }),
    );
    expect(result).toMatchObject({
      state: "completed",
      prUrl: "https://github.com/org/repo/pull/42",
    });
    expect(removeWorktree).toHaveBeenCalledOnce();
    expect(await service.finalizeChange(requestId, "already-consumed")).toEqual(result);
  });

  it("rejects a stale second fetch before push and preserves evidence", async () => {
    const { service, calls, removeWorktree } = setup({ remoteSha: "f".repeat(40) });
    await expect(service.finalizeChange(requestId, "confirm-once")).rejects.toMatchObject({
      code: "STALE_MODEL",
    });
    expect(calls).toEqual([]);
    expect(removeWorktree).not.toHaveBeenCalled();
    await service.discardPreparedChange(requestId);
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it("uses the global operation lock while finalization is running", async () => {
    let release!: (value: { sha: string; ref: string }) => void;
    const refresh = vi.fn().mockImplementation(
      () =>
        new Promise<{ sha: string; ref: string }>((resolve) => {
          release = resolve;
        }),
    );
    const { service } = setup();
    const internal = service.getInternalJob(requestId)!;
    const lockedService = createChangeJobService({
      store: {
        get: (id) => (id === requestId ? internal : undefined),
        set: vi.fn(),
        delete: vi.fn(),
        values: () => [internal],
      },
      cache: {
        refresh,
        createWorktree: vi.fn(),
        removeWorktree: vi.fn().mockResolvedValue(undefined),
      },
      applyChange: vi.fn(),
      validate: vi.fn(),
      now: () => new Date("2026-08-16T10:05:00.000Z"),
      nonce: () => "unused",
      finalization: {
        runner: { run: vi.fn() },
        getViewer: vi.fn(),
        createDraftPullRequest: vi.fn(),
        writeBody: vi.fn(),
      },
    });

    const started = await lockedService.startFinalizeChange(requestId, "confirm-once");
    expect(started.state).toBe("finalizing");
    await expect(
      lockedService.prepareChange({ ...change, requestId: "01J6AAAAAAAAAAAAAAAAAAAAAA" }),
    ).rejects.toMatchObject({ code: "OPERATION_BUSY" });
    release({ sha: "f".repeat(40), ref: "refs/remotes/origin/develop" });
    await vi.waitFor(() => expect(lockedService.getChangeJob(requestId)?.state).toBe("failed"));
  });

  it("rejects an already staged file before finalization", async () => {
    const { service, calls } = setup({ initiallyStaged: true });

    await expect(service.finalizeChange(requestId, "confirm-once")).rejects.toMatchObject({
      code: "DIRTY_INDEX",
    });
    expect(calls.some((call) => call.args[0] === "commit")).toBe(false);
    expect(calls.some((call) => call.args[0] === "push")).toBe(false);
  });

  it("rejects a changed approved file when its diff no longer matches confirmation", async () => {
    const { service, calls } = setup({
      worktreeDiff:
        "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n+tampered\n",
    });

    await expect(service.finalizeChange(requestId, "confirm-once")).rejects.toMatchObject({
      code: "FINALIZE_DIFF_MISMATCH",
    });
    expect(calls.some((call) => call.args[0] === "commit")).toBe(false);
    expect(calls.some((call) => call.args[0] === "push")).toBe(false);
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
