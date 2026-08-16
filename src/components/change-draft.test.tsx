// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeDraft, type PrepareIntent } from "@/src/components/change-draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

afterEach(cleanup);

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
});
