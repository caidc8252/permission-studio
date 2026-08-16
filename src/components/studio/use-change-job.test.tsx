// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useChangeJob,
  type ClientChangeJob,
  type PrepareIntent,
} from "@/src/components/studio/use-change-job";
import { validModel } from "@/tests/fixtures/model";

const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
const intent: PrepareIntent = {
  baseSha: validModel.sourceSha,
  title: "chore(permissions): grant report export",
  reason: "允许运营角色导出报表数据",
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.manage"], remove: [] }],
  contractChanges: [],
};
const awaitingJob: ClientChangeJob = {
  requestId,
  state: "awaiting-confirmation",
  baseSha: validModel.sourceSha,
  title: intent.title,
  reason: intent.reason,
  branchName: `permission-studio/${requestId.toLowerCase()}`,
  createdAt: "2026-08-16T10:00:00.000Z",
  expiresAt: "2026-08-16T10:30:00.000Z",
  confirmationNonce: "confirm-once",
  touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
  validationSteps: [{ name: "typecheck", status: "passed", durationMs: 12 }],
  diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n+orders.manage\n",
};

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useChangeJob", () => {
  it("prepares, stores, and polls a validating job after 1.2 seconds", async () => {
    const validatingJob = { ...awaitingJob, state: "validating" as const, diff: "" };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(validatingJob, { status: 202 }))
      .mockResolvedValueOnce(Response.json(awaitingJob));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    expect(result.current.job?.state).toBe("validating");
    expect(window.sessionStorage.getItem("permission-studio:active-change")).toContain(requestId);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1_199));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(result.current.job).toEqual(awaitingJob);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/changes/${requestId}`, {
      cache: "no-store",
    });
  });

  it("clears an expired job and active-job session on a polling 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...awaitingJob, state: "validating", diff: "" }, { status: 202 }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: "CHANGE_NOT_FOUND", message: "未找到变更请求。" }, { status: 404 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    await act(() => vi.advanceTimersByTimeAsync(1_200));

    expect(result.current.job).toBeNull();
    expect(result.current.message).toBe("准备结果已过期或被丢弃");
    expect(window.sessionStorage.getItem("permission-studio:active-change")).toBeNull();
  });

  it("restores an active job and retries after a transient read failure", async () => {
    window.sessionStorage.setItem(
      "permission-studio:active-change",
      JSON.stringify({ requestId, baseSha: validModel.sourceSha }),
    );
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline with token ghp_secret"))
      .mockResolvedValueOnce(Response.json(awaitingJob));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));
    await act(async () => undefined);

    expect(result.current.job?.requestId).toBe(requestId);
    expect(result.current.error).toBe("暂时无法恢复任务状态，将继续重试");
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(result.current.job).toEqual(awaitingJob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("confirms only with the server nonce and polls finalizing to completion", async () => {
    const finalizingJob = {
      ...awaitingJob,
      state: "finalizing" as const,
      confirmationNonce: "",
    };
    const completedJob = {
      ...finalizingJob,
      state: "completed" as const,
      prUrl: "https://github.com/org/repo/pull/42",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(Response.json(finalizingJob, { status: 202 }))
      .mockResolvedValueOnce(Response.json(completedJob));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    await act(() => result.current.confirm());

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/changes/${requestId}/confirm`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nonce: "confirm-once" }),
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(result.current.job).toEqual(completedJob);
  });

  it.each(["", "  \n\t"])("does not confirm without a visible server diff (%j)", async (diff) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...awaitingJob, diff }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    await act(() => result.current.confirm());

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
  });

  it.each([
    ["FINALIZE_FAILED", "推送失败，请检查远端状态。"],
    ["PR_CREATE_FAILED", "Draft PR 创建失败，请使用恢复信息。"],
  ])("refreshes the safe recovery job after %s", async (errorCode, message) => {
    const failedJob: ClientChangeJob = {
      ...awaitingJob,
      state: "failed",
      confirmationNonce: "",
      errorCode,
      recoveryCommand:
        errorCode === "PR_CREATE_FAILED"
          ? "gh pr create --repo org/repo --base develop --head permission-studio/id --draft"
          : undefined,
      failureSummary: '{"error":"failed","stderr":"[REDACTED]"}',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ code: errorCode, message }, { status: 502 }))
      .mockResolvedValueOnce(Response.json(failedJob));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    await act(() => result.current.confirm());

    expect(result.current.job).toEqual(failedJob);
    expect(result.current.error).toBe(message);
  });

  it("discards without finalizing and clears the active job", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(awaitingJob, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));
    await act(() => result.current.discard());

    expect(fetchMock).toHaveBeenLastCalledWith(`/api/changes/${requestId}`, {
      method: "DELETE",
    });
    expect(result.current.job).toBeNull();
    expect(result.current.message).toBe("变更草稿已丢弃");
    expect(window.sessionStorage.getItem("permission-studio:active-change")).toBeNull();
  });

  it("redacts GitHub and authorization credentials from response errors", async () => {
    const secrets = [
      "github_pat_supersecret123",
      "Authorization: Bearer bearer-secret-456",
      "token=token-secret-789",
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "PREPARE_FAILED", message: `远端失败 ${secrets.join(" ")}` },
            { status: 502 },
          ),
        ),
    );
    const { result } = renderHook(() => useChangeJob(validModel.sourceSha));

    await act(() => result.current.prepare(intent));

    expect(result.current.error).toContain("[REDACTED]");
    for (const secret of secrets) expect(result.current.error).not.toContain(secret);
  });
});
