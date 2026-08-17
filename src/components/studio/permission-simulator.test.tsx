// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PermissionSimulator } from "@/src/components/studio/permission-simulator";
import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;
const empty = createEmptyDraft();
const draftAddingOrdersManage = setRolePermissionMembership(empty, model, "preset_ops", [
  "orders.manage",
  "orders.view",
]);

afterEach(cleanup);

describe("PermissionSimulator", () => {
  it("calculates simulation from the draft-applied model", async () => {
    const user = userEvent.setup();
    render(<PermissionSimulator model={model} draft={draftAddingOrdersManage} />);

    expect(screen.queryByText("PERMISSION SIMULATOR")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "权限模拟" })).not.toBeInTheDocument();
    expect(screen.queryByText("正在预览草稿")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /被阻止/ }));
    const results = screen.getByRole("region", { name: "模拟结果" });
    await user.click(within(results).getByRole("button", { name: /订单/ }));
    await user.click(within(results).getByText("管理订单"));
    expect(screen.getByLabelText("orders.manage evidence")).toHaveTextContent(
      "授予角色：preset_ops",
    );
  });

  it("labels membership type separately from roles", () => {
    render(<PermissionSimulator model={model} draft={empty} />);

    expect(screen.getByRole("group", { name: "成员身份" })).toBeVisible();
    expect(screen.getByRole("group", { name: /权限角色/ })).toBeVisible();
    expect(screen.getByRole("radio", { name: "平台管理员" })).toBeVisible();
  });

  it("uses the selected locale for model-backed role and module copy", () => {
    render(<PermissionSimulator model={model} draft={empty} locale="en" />);

    expect(screen.getAllByText("Operations").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Orders/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "模拟结果" })).toBeVisible();
  });

  it("prioritizes effective permissions and reveals restricted details on demand", async () => {
    const user = userEvent.setup();
    render(<PermissionSimulator model={model} draft={empty} />);

    const results = screen.getByRole("region", { name: "模拟结果" });
    expect(screen.getByRole("tab", { name: /有效权限/ })).toHaveAttribute("aria-selected", "true");
    expect(within(results).getByRole("button", { name: /订单/ })).toBeVisible();
    expect(within(results).queryByText("查看订单")).not.toBeInTheDocument();
    expect(within(results).queryByText("管理订单")).not.toBeInTheDocument();

    await user.click(within(results).getByRole("button", { name: /订单/ }));
    expect(within(results).getByText("查看订单")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /被阻止/ }));
    expect(within(results).getByText("管理订单")).toBeVisible();
    expect(screen.getByLabelText("orders.manage evidence")).not.toBeVisible();

    await user.click(within(results).getByText("管理订单"));
    expect(screen.getByLabelText("orders.manage evidence")).toBeVisible();
  });

  it("switches between permission results and the visible menu tree", async () => {
    const user = userEvent.setup();
    render(<PermissionSimulator model={model} draft={empty} />);

    await user.click(screen.getByRole("tab", { name: /可见菜单/ }));

    expect(screen.getByRole("tree", { name: "可见菜单" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: /订单/ })).toHaveAttribute("aria-level", "1");
  });

  it("guides a blocked permission back to a role that grants it", async () => {
    const user = userEvent.setup();
    render(<PermissionSimulator model={model} draft={empty} />);

    await user.click(screen.getByRole("checkbox", { name: "角色 preset_ops" }));
    await user.click(screen.getByRole("tab", { name: /被阻止/ }));
    await user.click(screen.getByRole("button", { name: /订单/ }));
    await user.click(screen.getByText("查看订单"));

    expect(screen.getAllByText("为什么没有？").some((item) => item.closest("details")?.open)).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "+ 添加 运营" }));
    expect(screen.getByRole("checkbox", { name: "角色 preset_ops" })).toBeChecked();
  });
});
