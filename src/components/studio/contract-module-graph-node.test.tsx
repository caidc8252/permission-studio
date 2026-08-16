// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContractModuleGraphNodeCard } from "@/src/components/studio/contract-module-graph-node";
import type { ContractModuleGraphNode } from "@/src/domain/contract-module-graph";

afterEach(cleanup);

const menuNode: ContractModuleGraphNode = {
  id: "menu:orders",
  kind: "menu",
  label: "订单",
  code: "orders",
  description: "/orders",
  parentId: "group:ISO:menus",
  checked: false,
  indeterminate: true,
  change: "added",
  hasChildren: true,
  collapsed: false,
  searchMatch: true,
};

describe("ContractModuleGraphNodeCard", () => {
  it("renders an accessible mixed menu with visible state and change badges", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCollapse = vi.fn();
    render(
      <ContractModuleGraphNodeCard
        node={menuNode}
        disabled={false}
        onToggle={onToggle}
        onCollapse={onCollapse}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBePartiallyChecked();
    expect(screen.getByText("待新增")).toBeVisible();
    expect(screen.getByText("搜索匹配")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "启用订单" }));
    expect(onToggle).toHaveBeenCalledWith("menu", "orders", true);
    await user.click(screen.getByRole("button", { name: "收起订单" }));
    expect(onCollapse).toHaveBeenCalledWith("orders");
  });

  it("renders removed and disabled states without relying on color", () => {
    render(
      <ContractModuleGraphNodeCard
        node={{ ...menuNode, checked: false, indeterminate: false, change: "removed" }}
        disabled
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "收起订单" })).toBeDisabled();
    expect(screen.getByText("待移除")).toBeVisible();
  });

  it("renders contract, group, and widget node variants with only valid controls", () => {
    const { rerender } = render(
      <ContractModuleGraphNodeCard
        node={{
          ...menuNode,
          id: "contract:ISO",
          kind: "contract",
          label: "ISO",
          code: "ISO",
          description: "当前合同",
          checked: true,
          indeterminate: false,
          change: null,
          hasChildren: true,
          searchMatch: false,
        }}
        disabled={false}
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "ISO" })).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    rerender(
      <ContractModuleGraphNodeCard
        node={{ ...menuNode, id: "group:ISO:menus", kind: "group", label: "菜单", code: null }}
        disabled={false}
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(screen.getByText("菜单")).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    rerender(
      <ContractModuleGraphNodeCard
        node={{
          ...menuNode,
          id: "widget:quick-widget",
          kind: "widget",
          label: "快捷入口",
          code: "quick-widget",
          hasChildren: false,
          collapsed: false,
        }}
        disabled={false}
        onToggle={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "启用快捷入口" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /快捷入口/ })).not.toBeInTheDocument();
  });
});
