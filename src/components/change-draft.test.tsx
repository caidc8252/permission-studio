// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeDraft, type PrepareIntent } from "@/src/components/change-draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("ChangeDraft", () => {
  it("edits preset role permissions and emits a normalized prepare intent", async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn<(intent: PrepareIntent) => void>();
    render(<ChangeDraft model={model} onPrepare={onPrepare} />);

    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    expect(screen.getByText("角色授权 +1 / -0")).toBeVisible();
    expect(screen.getByRole("button", { name: "验证变更" })).toBeDisabled();

    await user.type(screen.getByLabelText("变更原因"), "为运营角色增加订单查看能力");
    expect(screen.getByRole("button", { name: "验证变更" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "验证变更" }));

    expect(onPrepare).toHaveBeenCalledWith({
      baseSha: model.sourceSha,
      reason: "为运营角色增加订单查看能力",
      roleChanges: [{ roleCode: "preset_ops", add: ["orders.manage"], remove: [] }],
      contractChanges: [],
    });
  });

  it("hides unsupported roles and TEST, and undo restores the baseline", async () => {
    const user = userEvent.setup();
    const expanded = structuredClone(model);
    expanded.roles.push({
      roleId: 11,
      code: "custom_ops",
      roleName: "role.ops",
      remark: "role.opsDesc",
      permissionCodes: [],
    });
    render(<ChangeDraft model={expanded} onPrepare={vi.fn()} />);

    expect(screen.queryByText("custom_ops")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "契约 TEST 模块" })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    expect(screen.getByText("角色授权 +1 / -0")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销全部" }));
    expect(screen.getByText("角色授权 +0 / -0")).toBeVisible();
    expect(screen.getByLabelText("角色 preset_ops 的 orders.manage")).not.toBeChecked();
  });

  it("summarizes contract menu, widget, and affected scenario changes", async () => {
    const user = userEvent.setup();
    const withWidget = structuredClone(model);
    withWidget.permissionCodes.push("quick.view");
    withWidget.permissionRegistry["quick.view"] = {
      code: "quick.view",
      belongToMenuCode: "quick-widget",
      label: "quick.view",
      desc: "quick.view.desc",
    };
    withWidget.contractScope.ISO.push("quick.view");
    render(<ChangeDraft model={withWidget} onPrepare={vi.fn()} />);

    await user.click(screen.getByLabelText("契约 ISO 的菜单 orders"));
    await user.click(screen.getByLabelText("契约 ISO 的组件 quick-widget"));

    expect(screen.getByText("契约模块 +1 / -1")).toBeVisible();
    expect(screen.getByText("影响场景 1")).toBeVisible();
  });

  it("disables prepare for stale models and while pending", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ChangeDraft model={model} stale onPrepare={vi.fn()} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");

    expect(screen.getByText("模型已过期，请先刷新 develop")).toBeVisible();
    expect(screen.getByRole("button", { name: "验证变更" })).toBeDisabled();

    rerender(<ChangeDraft model={model} pending onPrepare={vi.fn()} />);
    expect(screen.getByRole("button", { name: "验证中…" })).toBeDisabled();
  });

  it("orchestrates prepare, polling, diff inspection, confirmation, and PR success", async () => {
    const user = userEvent.setup();
    const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const prepared = {
      requestId,
      state: "awaiting-confirmation",
      baseSha: model.sourceSha,
      reason: "为运营角色增加订单查看能力",
      branchName: `permission-studio/${requestId.toLowerCase()}`,
      createdAt: "2026-08-16T10:00:00.000Z",
      expiresAt: "2026-08-16T10:30:00.000Z",
      confirmationNonce: "confirm-once",
      touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
      validationSteps: [{ name: "typecheck", status: "passed", durationMs: 12 }],
      diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n+orders.manage\n",
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/changes/prepare") {
        return Response.json(
          { ...prepared, state: "validating", diff: "", validationSteps: [] },
          { status: 202 },
        );
      }
      if (url === `/api/changes/${requestId}`) return Response.json(prepared);
      if (url.endsWith("/confirm") && init?.method === "POST") {
        return Response.json({
          ...prepared,
          state: "completed",
          confirmationNonce: "",
          prUrl: "https://github.com/org/repo/pull/42",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChangeDraft model={model} />);

    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "为运营角色增加订单查看能力");
    await user.click(screen.getByRole("button", { name: "验证变更" }));

    expect(await screen.findByText("等待最终确认")).toBeVisible();
    expect(screen.getByLabelText("准备好的变更 diff")).toHaveTextContent("orders.manage");
    expect(screen.getByText("typecheck")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认推送并创建 Draft PR" })).toBeDisabled();
    await user.click(screen.getByLabelText("我已检查 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));

    expect(await screen.findByRole("link", { name: "打开 Draft PR" })).toHaveAttribute(
      "href",
      "https://github.com/org/repo/pull/42",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/changes/${requestId}/confirm`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it.each([
    ["STALE_MODEL", 409, "develop 已变化，请刷新后重试"],
    ["PREPARE_FAILED", 422, "权限变更校验失败"],
  ])("renders prepare failure %s", async (code, status, expected) => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code, message: expected }, { status })),
    );
    render(<ChangeDraft model={model} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");
    await user.click(screen.getByRole("button", { name: "验证变更" }));
    expect(await screen.findByText(expected)).toBeVisible();
  });

  it("supports discard and reports expired polling", async () => {
    const user = userEvent.setup();
    const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ requestId, state: "validating" }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ code: "CHANGE_NOT_FOUND" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChangeDraft model={model} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");
    await user.click(screen.getByRole("button", { name: "验证变更" }));
    expect(await screen.findByText("准备结果已过期或被丢弃")).toBeVisible();
  });

  it("discards an awaiting prepared change without a remote write", async () => {
    const user = userEvent.setup();
    const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            requestId,
            state: "awaiting-confirmation",
            confirmationNonce: "confirm-once",
            validationSteps: [],
            diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChangeDraft model={model} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");
    await user.click(screen.getByRole("button", { name: "验证变更" }));
    await user.click(await screen.findByRole("button", { name: "丢弃准备结果" }));

    expect(await screen.findByText("变更草稿已丢弃")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/changes/${requestId}`, { method: "DELETE" });
  });

  it("distinguishes a push failure from a PR creation recovery", async () => {
    const user = userEvent.setup();
    const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const prepared = {
      requestId,
      state: "awaiting-confirmation",
      confirmationNonce: "confirm-once",
      validationSteps: [],
      diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(prepared, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ code: "FINALIZE_FAILED" }, { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({
          ...prepared,
          state: "failed",
          confirmationNonce: "",
          errorCode: "FINALIZE_FAILED",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<ChangeDraft model={model} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");
    await user.click(screen.getByRole("button", { name: "验证变更" }));
    await user.click(await screen.findByLabelText("我已检查 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));
    expect(await screen.findByText("推送失败，未创建 Draft PR")).toBeVisible();
  });

  it("shows a safe recovery command when PR creation fails after push", async () => {
    const user = userEvent.setup();
    const requestId = "01J5ZZZZZZZZZZZZZZZZZZZZZZ";
    const prepared = {
      requestId,
      state: "awaiting-confirmation",
      confirmationNonce: "confirm-once",
      validationSteps: [],
      diff: "diff --git a/apps/web/manifest/catalog/roles.ts b/apps/web/manifest/catalog/roles.ts\n",
    };
    const failed = {
      ...prepared,
      state: "failed",
      confirmationNonce: "",
      errorCode: "PR_CREATE_FAILED",
      recoveryCommand:
        "gh pr create --repo org/repo --base develop --head permission-studio/id --draft",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(prepared, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ code: "PR_CREATE_FAILED" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json(failed));
    vi.stubGlobal("fetch", fetchMock);
    render(<ChangeDraft model={model} />);
    await user.click(screen.getByLabelText("角色 preset_ops 的 orders.manage"));
    await user.type(screen.getByLabelText("变更原因"), "这是一个足够长的变更原因");
    await user.click(screen.getByRole("button", { name: "验证变更" }));
    await user.click(await screen.findByLabelText("我已检查 diff"));
    await user.click(screen.getByRole("button", { name: "确认推送并创建 Draft PR" }));
    expect(await screen.findByText("远端分支已保留，请手动创建 Draft PR")).toBeVisible();
    expect(screen.getByText(failed.recoveryCommand)).toBeVisible();
  });
});
