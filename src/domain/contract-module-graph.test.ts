import { describe, expect, it } from "vitest";

import {
  buildContractModuleGraph,
  toggleContractModuleGraphNode,
} from "@/src/domain/contract-module-graph";
import { createEmptyDraft, type PermissionDraft } from "@/src/domain/draft";
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
  contractMenus: {
    ...baseModel.contractMenus,
    ISO: ["orders", "orders.history"],
  },
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

function node(projection: ReturnType<typeof buildContractModuleGraph>, id: string) {
  const result = projection.nodes.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing node ${id}`);
  return result;
}

describe("buildContractModuleGraph", () => {
  it("projects a contract, groups, menu hierarchy, and widgets with tri-state membership", () => {
    const projection = buildContractModuleGraph(model, createEmptyDraft(), "ISO", {
      collapsed: new Set(),
      query: "",
    });

    expect(projection.nodes.map(({ id }) => id)).toEqual([
      "contract:ISO",
      "group:ISO:menus",
      "menu:dashboard",
      "menu:orders",
      "menu:orders.history",
      "menu:orders.pending",
      "group:ISO:widgets",
      "widget:quick-widget",
    ]);
    expect(projection.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "contract:ISO", target: "group:ISO:menus" }),
        expect.objectContaining({ source: "group:ISO:menus", target: "menu:orders" }),
        expect.objectContaining({ source: "menu:orders", target: "menu:orders.history" }),
        expect.objectContaining({ source: "group:ISO:widgets", target: "widget:quick-widget" }),
      ]),
    );
    expect(node(projection, "menu:orders")).toMatchObject({
      checked: false,
      indeterminate: true,
      change: null,
      hasChildren: true,
    });
    expect(node(projection, "menu:orders.history")).toMatchObject({
      checked: true,
      indeterminate: false,
      change: null,
    });
    expect(node(projection, "menu:orders.pending")).toMatchObject({ checked: false });
  });

  it("marks exact baseline changes independently from aggregate parent state", () => {
    const draft: PermissionDraft = {
      ...createEmptyDraft(),
      contractMenus: { ISO: ["orders", "orders.pending"] },
      contractWidgets: { ISO: ["quick-widget"] },
    };
    const projection = buildContractModuleGraph(model, draft, "ISO", {
      collapsed: new Set(),
      query: "",
    });

    expect(node(projection, "menu:orders.history").change).toBe("removed");
    expect(node(projection, "menu:orders.pending").change).toBe("added");
    expect(node(projection, "widget:quick-widget")).toMatchObject({
      checked: true,
      change: "added",
    });
    expect(node(projection, "menu:orders")).toMatchObject({
      checked: false,
      indeterminate: true,
      change: null,
    });
  });

  it("hides collapsed descendants but reveals a matching node and its ancestors for search", () => {
    const collapsed = new Set(["orders"]);
    const collapsedProjection = buildContractModuleGraph(model, createEmptyDraft(), "ISO", {
      collapsed,
      query: "",
    });
    expect(collapsedProjection.nodes.map(({ id }) => id)).not.toContain("menu:orders.history");

    const searched = buildContractModuleGraph(model, createEmptyDraft(), "ISO", {
      collapsed,
      query: "history",
    });
    expect(searched.nodes.map(({ id }) => id)).toContain("menu:orders.history");
    expect(node(searched, "menu:orders.history").searchMatch).toBe(true);
    expect(node(searched, "menu:orders").searchMatch).toBe(false);
    expect(searched.matchIds).toEqual(["menu:orders.history"]);
    expect(collapsed).toEqual(new Set(["orders"]));
  });

  it("collapses whole menu and widget groups while search reveals matching descendants", () => {
    const collapsed = new Set(["group:ISO:menus", "group:ISO:widgets"]);
    const projection = buildContractModuleGraph(model, createEmptyDraft(), "ISO", {
      collapsed,
      query: "",
    });

    expect(node(projection, "group:ISO:menus").collapsed).toBe(true);
    expect(node(projection, "group:ISO:widgets").collapsed).toBe(true);
    expect(projection.nodes.some(({ kind }) => kind === "menu" || kind === "widget")).toBe(false);

    const searched = buildContractModuleGraph(model, createEmptyDraft(), "ISO", {
      collapsed,
      query: "history",
    });
    expect(searched.nodes.map(({ id }) => id)).toContain("menu:orders.history");
    expect(searched.nodes.map(({ id }) => id)).not.toContain("widget:quick-widget");
  });
});

describe("toggleContractModuleGraphNode", () => {
  it("checks and unchecks a complete menu subtree regardless of collapse state", () => {
    const checked = toggleContractModuleGraphNode(model, createEmptyDraft(), "ISO", {
      kind: "menu",
      code: "orders",
      checked: true,
    });
    expect(checked.contractMenus.ISO).toEqual(["orders", "orders.history", "orders.pending"]);

    const unchecked = toggleContractModuleGraphNode(model, checked, "ISO", {
      kind: "menu",
      code: "orders",
      checked: false,
    });
    expect(unchecked.contractMenus.ISO).toEqual([]);
  });

  it("checks ancestors after the final child and makes them mixed after one child is removed", () => {
    const partial: PermissionDraft = {
      ...createEmptyDraft(),
      contractMenus: { ISO: ["orders.history"] },
    };
    const complete = toggleContractModuleGraphNode(model, partial, "ISO", {
      kind: "menu",
      code: "orders.pending",
      checked: true,
    });
    expect(complete.contractMenus.ISO).toEqual(["orders", "orders.history", "orders.pending"]);

    const mixed = toggleContractModuleGraphNode(model, complete, "ISO", {
      kind: "menu",
      code: "orders.history",
      checked: false,
    });
    expect(mixed.contractMenus.ISO).toEqual(["orders.pending"]);
    const projection = buildContractModuleGraph(model, mixed, "ISO", {
      collapsed: new Set(["orders"]),
      query: "",
    });
    expect(node(projection, "menu:orders")).toMatchObject({
      checked: false,
      indeterminate: true,
    });
  });

  it("toggles a widget without changing menu membership", () => {
    const next = toggleContractModuleGraphNode(model, createEmptyDraft(), "ISO", {
      kind: "widget",
      code: "quick-widget",
      checked: true,
    });

    expect(next.contractWidgets.ISO).toEqual(["quick-widget"]);
    expect(next.contractMenus).toEqual({});
  });
});
