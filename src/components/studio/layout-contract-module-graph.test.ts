import { describe, expect, it } from "vitest";

import { layoutContractModuleGraph } from "@/src/components/studio/layout-contract-module-graph";
import type { ContractModuleGraphProjection } from "@/src/domain/contract-module-graph";

const projection: ContractModuleGraphProjection = {
  nodes: [
    {
      id: "contract:ISO",
      kind: "contract",
      label: "ISO",
      code: "ISO",
      description: "当前合同",
      parentId: null,
      checked: true,
      indeterminate: false,
      change: null,
      hasChildren: true,
      collapsed: false,
      searchMatch: false,
    },
    {
      id: "group:ISO:menus",
      kind: "group",
      label: "菜单",
      code: null,
      description: "1 / 3 已启用",
      parentId: "contract:ISO",
      checked: false,
      indeterminate: true,
      change: null,
      hasChildren: true,
      collapsed: false,
      searchMatch: false,
    },
    {
      id: "menu:orders",
      kind: "menu",
      label: "订单",
      code: "orders",
      description: "/orders",
      parentId: "group:ISO:menus",
      checked: false,
      indeterminate: true,
      change: null,
      hasChildren: true,
      collapsed: false,
      searchMatch: false,
    },
    {
      id: "menu:orders.history",
      kind: "menu",
      label: "订单历史",
      code: "orders.history",
      description: "/orders/history",
      parentId: "menu:orders",
      checked: true,
      indeterminate: false,
      change: null,
      hasChildren: false,
      collapsed: false,
      searchMatch: false,
    },
    {
      id: "menu:orders.pending",
      kind: "menu",
      label: "待处理订单",
      code: "orders.pending",
      description: "/orders/pending",
      parentId: "menu:orders",
      checked: false,
      indeterminate: false,
      change: null,
      hasChildren: false,
      collapsed: false,
      searchMatch: false,
    },
  ],
  edges: [
    {
      id: "contract:ISO->group:ISO:menus",
      source: "contract:ISO",
      target: "group:ISO:menus",
      active: true,
      mixed: true,
    },
    {
      id: "group:ISO:menus->menu:orders",
      source: "group:ISO:menus",
      target: "menu:orders",
      active: true,
      mixed: true,
    },
    {
      id: "menu:orders->menu:orders.history",
      source: "menu:orders",
      target: "menu:orders.history",
      active: true,
      mixed: false,
    },
    {
      id: "menu:orders->menu:orders.pending",
      source: "menu:orders",
      target: "menu:orders.pending",
      active: false,
      mixed: false,
    },
  ],
  matchIds: [],
};

describe("layoutContractModuleGraph", () => {
  it("lays out stable left-to-right ranks without overlapping siblings", () => {
    const first = layoutContractModuleGraph(projection);
    const second = layoutContractModuleGraph(projection);
    const positions = new Map(first.nodes.map((node) => [node.id, node.position]));

    expect(positions.get("contract:ISO")!.x).toBeLessThan(positions.get("group:ISO:menus")!.x);
    expect(positions.get("group:ISO:menus")!.x).toBeLessThan(positions.get("menu:orders")!.x);
    expect(positions.get("menu:orders")!.x).toBeLessThan(positions.get("menu:orders.history")!.x);
    expect(positions.get("menu:orders.history")!.y).not.toBe(
      positions.get("menu:orders.pending")!.y,
    );
    expect(second.nodes.map(({ id, position }) => ({ id, position }))).toEqual(
      first.nodes.map(({ id, position }) => ({ id, position })),
    );
  });

  it("expresses active, mixed, and inactive relations without color alone", () => {
    const result = layoutContractModuleGraph(projection);

    expect(result.edges.find(({ target }) => target === "menu:orders")).toMatchObject({
      className: "contract-graph-edge contract-graph-edge--mixed",
      label: "部分启用",
    });
    expect(result.edges.find(({ target }) => target === "menu:orders.history")).toMatchObject({
      className: "contract-graph-edge contract-graph-edge--active",
    });
    expect(result.edges.find(({ target }) => target === "menu:orders.pending")).toMatchObject({
      className: "contract-graph-edge contract-graph-edge--inactive",
      style: expect.objectContaining({ strokeDasharray: "6 5" }),
    });
  });
});
