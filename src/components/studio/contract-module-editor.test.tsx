// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const dragAndDrop = vi.hoisted(() => ({
  combine: vi.fn(
    (...cleanups: Array<() => void>) =>
      () =>
        cleanups.forEach((cleanup) => cleanup()),
  ),
  draggable: vi.fn(() => () => undefined),
  dropTargetForElements: vi.fn(() => () => undefined),
  monitorForElements: vi.fn(() => () => undefined),
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: dragAndDrop.combine,
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: dragAndDrop.draggable,
  dropTargetForElements: dragAndDrop.dropTargetForElements,
  monitorForElements: dragAndDrop.monitorForElements,
}));

import { ContractModuleEditor } from "@/src/components/studio/contract-module-editor";
import { createEmptyDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const baseModel = validModel as unknown as PermissionStudioModel;
const model: PermissionStudioModel = {
  ...baseModel,
  permissionCodes: [...baseModel.permissionCodes, "widget.quick"],
  menuRegistry: {
    ...baseModel.menuRegistry,
    "orders.history": {
      menuCode: "orders.history",
      title: "menu.orders.history",
      parentMenuCode: "orders",
      path: "/orders/history",
      icon: "history",
      order: 1,
    },
  },
  permissionRegistry: {
    ...baseModel.permissionRegistry,
    "widget.quick": {
      code: "widget.quick",
      belongToMenuCode: "widget.quick",
      label: "widget.quick",
      desc: "widget.quickDesc",
    },
  },
  contractMenus: { ...baseModel.contractMenus, ISO: [] },
  translations: {
    ...baseModel.translations,
    "zh-CN": {
      ...baseModel.translations["zh-CN"],
      "menu.orders.history": "订单历史",
      "widget.quick": "快捷组件",
      "widget.quickDesc": "快速访问组件",
    },
  },
};

afterEach(cleanup);

describe("ContractModuleEditor", () => {
  it("moves selected menus and widgets without fabricating related codes", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "快捷组件" }));
    await user.click(screen.getByRole("button", { name: "启用已选模块" }));

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ contractWidgets: { ISO: ["widget.quick"] } }),
    );
    expect(onDraftChange.mock.lastCall?.[0].contractMenus).toEqual({});
  });

  it("expands and collapses a menu branch without changing the draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "订单历史" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "收起订单" }));
    expect(screen.queryByRole("checkbox", { name: "订单历史" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开订单" }));
    expect(screen.getByRole("checkbox", { name: "订单历史" })).toBeVisible();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("selects only currently displayed menu descendants before transfer", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "订单" }));
    expect(screen.getByRole("checkbox", { name: "订单历史" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "启用已选模块" }));

    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ contractMenus: { ISO: ["orders", "orders.history"] } }),
    );
  });
});
