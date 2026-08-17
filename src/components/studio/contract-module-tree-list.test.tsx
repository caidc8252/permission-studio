// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContractModuleTreeList } from "@/src/components/studio/contract-module-tree-list";
import { createEmptyDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const baseModel = validModel as unknown as PermissionStudioModel;
const model: PermissionStudioModel = {
  ...baseModel,
  permissionCodes: [...baseModel.permissionCodes, "quick.open"],
  menuRegistry: {
    dashboard: {
      menuCode: "dashboard",
      title: "menu.dashboard",
      parentMenuCode: null,
      path: "/dashboard",
      icon: "home",
      order: 1,
    },
    orders: { ...baseModel.menuRegistry.orders, order: 2 },
    "orders.history": {
      menuCode: "orders.history",
      title: "menu.orders.history",
      parentMenuCode: "orders",
      path: "/orders/history",
      icon: "history",
      order: 1,
    },
    "orders.pending": {
      menuCode: "orders.pending",
      title: "menu.orders.pending",
      parentMenuCode: "orders",
      path: "/orders/pending",
      icon: "clock",
      order: 2,
    },
  },
  permissionRegistry: {
    ...baseModel.permissionRegistry,
    "quick.open": {
      code: "quick.open",
      belongToMenuCode: "quick-widget",
      label: "widget.quick",
      desc: "widget.quickDesc",
    },
  },
  contractMenus: { ...baseModel.contractMenus, ISO: ["orders", "orders.history"] },
  contractWidgets: { ...baseModel.contractWidgets, ISO: [] },
  translations: {
    ...baseModel.translations,
    "zh-CN": {
      ...baseModel.translations["zh-CN"],
      "menu.dashboard": "工作台",
      "menu.orders.history": "订单历史",
      "menu.orders.pending": "待处理订单",
      "widget.quick": "快捷入口",
      "widget.quickDesc": "快速打开常用页面",
    },
  },
};

afterEach(cleanup);

describe("ContractModuleTreeList", () => {
  it("renders hierarchy, code, path, counts, and tri-state controls", () => {
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ISO 合同模块列表")).toBeVisible();
    expect(screen.getByLabelText("2 / 5 已启用")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBePartiallyChecked();
    expect(screen.getByRole("checkbox", { name: "启用订单历史" })).toBeChecked();
    expect(screen.getByText("orders.history")).toBeVisible();
    expect(screen.getByText("/orders/history")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "启用全部菜单" })).toBePartiallyChecked();
  });

  it("writes cascaded parent changes through the existing draft boundary", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "启用订单" }));
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        contractMenus: { ISO: ["orders", "orders.history", "orders.pending"] },
      }),
    );
  });

  it("filters search results while retaining their parent context", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        onDraftChange={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" }), "history");
    const tree = screen.getByRole("tree", { name: "合同模块树" });
    expect(within(tree).getByText("菜单")).toBeVisible();
    expect(within(tree).getByText("订单")).toBeVisible();
    expect(within(tree).getByText("订单历史")).toBeVisible();
    expect(within(tree).queryByText("工作台")).not.toBeInTheDocument();
    expect(screen.getByText("1 个结果")).toBeVisible();
  });

  it("finds menu paths and widget descriptions", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        onDraftChange={vi.fn()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" });
    await user.type(search, "/orders/history");
    expect(screen.getByText("订单历史")).toBeVisible();
    expect(screen.queryByText("工作台")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "快速打开常用页面");
    expect(screen.getByText("快捷入口")).toBeVisible();
    expect(screen.queryByText("订单历史")).not.toBeInTheDocument();
  });

  it("supports status filters and expansion shortcuts without changing the draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        onDraftChange={onDraftChange}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "按启用状态筛选" }), "enabled");
    expect(screen.getByText("订单历史")).toBeVisible();
    expect(screen.queryByText("工作台")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "按启用状态筛选" }), "all");
    await user.click(screen.getByRole("button", { name: "全部收起" }));
    expect(screen.queryByText("订单历史")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getByText("订单历史")).toBeVisible();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("keeps navigation available while locking membership changes", () => {
    render(
      <ContractModuleTreeList
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "全部收起" })).toBeEnabled();
  });
});
