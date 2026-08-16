// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PullRequestFlow } from "@/src/components/studio/pull-request-flow";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;
const draft: PermissionDraft = {
  rolePermissions: { preset_ops: ["orders.manage", "orders.view"] },
  contractMenus: {},
  contractWidgets: {},
};
const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
const exactDiff =
  "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n" +
  "index 1111111..2222222 100644\n" +
  "--- a/apps/web/manifest/catalog/roles.ts\n" +
  "+++ b/apps/web/manifest/catalog/roles.ts\n" +
  "+orders.manage\n";
const awaitingJob = {
  requestId,
  state: "awaiting-confirmation" as const,
  baseSha: model.sourceSha,
  title: "chore(permissions): grant report export",
  reason: "允许运营角色导出报表数据",
  branchName: `permission-studio/${requestId.toLowerCase()}`,
  createdAt: "2026-08-16T10:00:00.000Z",
  expiresAt: "2026-08-16T10:30:00.000Z",
  confirmationNonce: "confirm-once",
  touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
  validationSteps: [
    { name: "typecheck", status: "passed" as const, durationMs: 12 },
    { name: "lint", status: "passed" as const, durationMs: 8 },
  ],
  diff: exactDiff,
};

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function fillValidMetadata(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("PR 标题"), awaitingJob.title);
  await user.type(screen.getByLabelText("变更原因"), awaitingJob.reason);
}

describe("PullRequestFlow", () => {
  it("validates title and reason against server constraints before preparation", async () => {
    const user = userEvent.setup();
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "第 1 步：检查业务变更" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "运营" })).toBeVisible();
    expect(screen.getByText("管理订单")).toBeVisible();
    expect(screen.getByRole("button", { name: "校验变更" })).toBeDisabled();

    await user.type(screen.getByLabelText("PR 标题"), "short");
    await user.type(screen.getByLabelText("变更原因"), "足够长的变更原因");
    expect(screen.getByRole("button", { name: "校验变更" })).toBeDisabled();
    expect(screen.getByText("PR 标题必须为 8–120 个字符，且不能包含控制字符")).toBeVisible();

    await user.clear(screen.getByLabelText("PR 标题"));
    await user.type(screen.getByLabelText("PR 标题"), awaitingJob.title);
    expect(screen.getByRole("button", { name: "校验变更" })).toBeEnabled();
  });

  it("shows validation and exact Git diff, then requires explicit final confirmation", async () => {
    const user = userEvent.setup();
    const completedJob = {
      ...awaitingJob,
      state: "completed" as const,
      confirmationNonce: "",
      prUrl: "https://github.com/org/repo/pull/42",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(Response.json(completedJob, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));

    expect(await screen.findByRole("heading", { name: "第 2 步：校验与完整 diff" })).toBeVisible();
    expect(screen.getByText("typecheck")).toBeVisible();
    expect(screen.getByText("通过 · 12 ms")).toBeVisible();
    expect(screen.getByLabelText("服务器生成的完整 Git diff").textContent).toBe(exactDiff);
    expect(screen.getByRole("heading", { name: "第 3 步：最终确认" })).toBeVisible();
    const confirm = screen.getByRole("button", { name: "确认推送并创建 Draft PR" });
    expect(confirm).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("已检查完整 diff"));
    expect(confirm).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(confirm);

    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/changes/${requestId}/confirm`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ nonce: "confirm-once" }) }),
    );
    expect(await screen.findByRole("link", { name: "打开 Draft PR" })).toHaveAttribute(
      "href",
      completedJob.prUrl,
    );
  });

  it.each(["", "  \n\t"])(
    "fails closed when an awaiting job has no visible diff (%j)",
    async (diff) => {
      const user = userEvent.setup();
      const fetchMock = vi
        .fn()
        .mockResolvedValue(Response.json({ ...awaitingJob, diff }, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);
      render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

      await fillValidMetadata(user);
      await user.click(screen.getByRole("button", { name: "校验变更" }));

      expect(
        await screen.findByRole("heading", { name: "第 2 步：校验与完整 diff" }),
      ).toBeVisible();
      expect(screen.queryByLabelText("服务器生成的完整 Git diff")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("已检查完整 diff")).not.toBeInTheDocument();
      const confirm = screen.getByRole("button", { name: "确认推送并创建 Draft PR" });
      expect(confirm).toBeDisabled();
      await user.click(confirm);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
    },
  );

  it("keeps a preparation failure in validation stage", async () => {
    const user = userEvent.setup();
    const failedJob = {
      ...awaitingJob,
      state: "failed" as const,
      errorCode: "PREPARE_FAILED",
      validationSteps: [],
      diff: "",
      failureSummary: '{"error":"validation failed"}',
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(failedJob, { status: 202 })));
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));

    expect(await screen.findByText("变更校验失败，未进入最终确认")).toBeVisible();
    expect(screen.getByText("2. 校验与 diff")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("3. 最终确认")).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("heading", { name: "第 3 步：最终确认" })).not.toBeInTheDocument();
  });

  it("discards a prepared result without triggering finalization", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));
    await user.click(await screen.findByRole("button", { name: "丢弃准备结果" }));

    expect(fetchMock).toHaveBeenLastCalledWith(`/api/changes/${requestId}`, {
      method: "DELETE",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
    expect(await screen.findByRole("status")).toHaveTextContent("变更草稿已丢弃");
  });

  it.each([
    ["FINALIZE_FAILED", "推送失败，未创建 Draft PR"],
    ["PR_CREATE_FAILED", "远端分支已保留，请手动创建 Draft PR"],
    ["FINALIZE_DIFF_MISMATCH", "最终处理失败，未创建 Draft PR"],
  ])("renders sanitized %s recovery without leaking credentials", async (errorCode, copy) => {
    const user = userEvent.setup();
    const failedJob = {
      ...awaitingJob,
      state: "failed" as const,
      confirmationNonce: "",
      errorCode,
      recoveryCommand:
        errorCode === "PR_CREATE_FAILED"
          ? "gh pr create --repo org/repo --base develop --head permission-studio/id --draft"
          : "powershell -Command Get-Content C:\\private\\credential.txt",
      failureSummary: `[REDACTED]\n${"x".repeat(3_750)} github_pat_supersecret123 Authorization: Bearer bearer-secret-456 token=token-secret-789 Authorization: token authorization-secret-123 token bare-secret-456 --token flag-secret-789 ghp_supersecrettoken123 at C:\\private\\credential.txt`,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({ code: errorCode, message: "远端写入失败" }, { status: 502 }),
      )
      .mockResolvedValueOnce(Response.json(failedJob));
    vi.stubGlobal("fetch", fetchMock);
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));
    await user.click(await screen.findByLabelText("已检查完整 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));

    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.getByLabelText("脱敏失败日志")).toHaveTextContent("[REDACTED]");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("ghp_");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("github_pat_");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("bearer-secret-456");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("token-secret-789");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("authorization-secret-123");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("bare-secret-456");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("flag-secret-789");
    expect(screen.queryByText(/ghp_supersecrettoken123/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private\\credential/)).not.toBeInTheDocument();
    if (errorCode === "PR_CREATE_FAILED") {
      expect(screen.getByText(failedJob.recoveryCommand)).toBeVisible();
    } else {
      expect(screen.queryByText(failedJob.recoveryCommand)).not.toBeInTheDocument();
    }
    expect(screen.getByText("3. 最终确认")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("2. 校验与 diff")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "丢弃并清理失败现场" })).toBeEnabled();
  });

  it("hides a credential-bearing recovery command", async () => {
    const user = userEvent.setup();
    const credentialCommand = "gh pr create --repo org/repo --token flag-secret-789 --draft";
    const failedJob = {
      ...awaitingJob,
      state: "failed" as const,
      confirmationNonce: "",
      errorCode: "PR_CREATE_FAILED",
      recoveryCommand: credentialCommand,
      failureSummary:
        "Authorization: token authorization-secret-123 token bare-secret-456 --token flag-secret-789",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(
        Response.json({ code: "PR_CREATE_FAILED", message: "远端写入失败" }, { status: 502 }),
      )
      .mockResolvedValueOnce(Response.json(failedJob));
    vi.stubGlobal("fetch", fetchMock);
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={vi.fn()} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));
    await user.click(await screen.findByLabelText("已检查完整 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));

    expect(await screen.findByText("恢复命令未通过安全检查，已隐藏。")).toBeVisible();
    expect(screen.queryByText(credentialCommand)).not.toBeInTheDocument();
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("authorization-secret-123");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("bare-secret-456");
    expect(screen.getByLabelText("脱敏失败日志")).not.toHaveTextContent("flag-secret-789");
  });

  it("starts a new change after success and clears completed state and draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
        .mockResolvedValueOnce(
          Response.json({
            ...awaitingJob,
            state: "completed",
            confirmationNonce: "",
            prUrl: "https://github.com/org/repo/pull/42",
          }),
        ),
    );
    render(<PullRequestFlow model={model} draft={draft} onDraftChange={onDraftChange} />);

    await fillValidMetadata(user);
    await user.click(screen.getByRole("button", { name: "校验变更" }));
    await user.click(await screen.findByLabelText("已检查完整 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));
    await user.click(await screen.findByRole("button", { name: "开始新变更" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: {},
    });
    expect(screen.getByLabelText("PR 标题")).toHaveValue("");
    expect(window.sessionStorage.getItem("permission-studio:active-change")).toBeNull();
  });
});
