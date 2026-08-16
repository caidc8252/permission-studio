// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PermissionWorkbench } from "@/src/components/permission-workbench";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

afterEach(cleanup);

describe("PermissionWorkbench", () => {
  it("renders semantic simulation controls, permission states, modules, and source metadata", async () => {
    const user = userEvent.setup();
    render(<PermissionWorkbench initialModel={model} loadModel={vi.fn()} />);

    expect(screen.getByRole("group", { name: "成员类型" })).toBeVisible();
    expect(screen.getByRole("group", { name: "契约与套餐" })).toBeVisible();
    expect(screen.getByRole("group", { name: "角色" })).toBeVisible();
    expect(screen.getByLabelText("ISO 契约")).toBeChecked();
    expect(screen.getByLabelText("ISO 套餐")).toHaveValue("STANDARD");
    expect(screen.getByLabelText("角色 preset_ops")).toBeChecked();
    expect(screen.getByText("有效")).toBeVisible();
    expect(screen.getByText("套餐阻止")).toBeVisible();
    expect(within(screen.getByRole("tree", { name: "可见菜单" })).getByText("订单")).toBeVisible();
    expect(screen.getByText(model.sourceSha)).toBeVisible();
    expect(screen.getByRole("button", { name: "刷新 develop" })).toBeEnabled();

    await user.clear(screen.getByRole("searchbox", { name: "搜索权限" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索权限" }), "manage");
    expect(screen.getByText("管理订单")).toBeVisible();
    expect(screen.queryByText("查看订单")).not.toBeInTheDocument();
  });

  it("refreshes the complete model and clears stale role selections", async () => {
    const user = userEvent.setup();
    const refreshed = structuredClone(model);
    refreshed.sourceSha = "fedcba9876543210fedcba9876543210fedcba98";
    refreshed.roles = [];
    const loadModel = vi.fn().mockResolvedValue(refreshed);
    render(<PermissionWorkbench initialModel={model} loadModel={loadModel} />);

    await user.click(screen.getByRole("button", { name: "刷新 develop" }));

    expect(await screen.findByText(refreshed.sourceSha)).toBeVisible();
    expect(screen.queryByLabelText("角色 preset_ops")).not.toBeInTheDocument();
    expect(loadModel).toHaveBeenCalledOnce();
  });

  it("shows a recoverable no-model state", async () => {
    const loadModel = vi.fn().mockRejectedValue(new Error("offline"));
    render(<PermissionWorkbench loadModel={loadModel} />);

    expect(await screen.findByText("无法加载权限模型")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试加载" })).toBeEnabled();
    await waitFor(() => expect(loadModel).toHaveBeenCalledOnce());
  });
});
