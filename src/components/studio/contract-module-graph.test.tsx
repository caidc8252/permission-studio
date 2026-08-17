// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({
  fitView: vi.fn(),
  setCenter: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const React = await import("react");
  type MockNode = {
    id: string;
    type?: string;
    data: Record<string, unknown>;
  };
  type MockNodeComponent = React.ComponentType<{ data: Record<string, unknown> }>;
  interface MockFlowProps {
    nodes: MockNode[];
    nodeTypes?: Record<string, MockNodeComponent>;
    nodesConnectable?: boolean;
    edgesReconnectable?: boolean;
    nodesDraggable?: boolean;
    onInit?: (instance: unknown) => void;
    "aria-label"?: string;
    children?: React.ReactNode;
  }
  function ReactFlow({
    nodes,
    nodeTypes,
    nodesConnectable,
    edgesReconnectable,
    nodesDraggable,
    onInit,
    children,
    "aria-label": ariaLabel,
  }: MockFlowProps) {
    React.useEffect(() => {
      onInit?.(flow);
    }, [onInit]);
    return (
      <div
        aria-label={ariaLabel}
        data-testid="react-flow"
        data-connectable={String(nodesConnectable)}
        data-reconnectable={String(edgesReconnectable)}
        data-draggable={String(nodesDraggable)}
      >
        {nodes.map((node) => {
          const Component = nodeTypes?.[node.type ?? ""];
          return Component ? <Component key={node.id} data={node.data} /> : null;
        })}
        {children}
      </div>
    );
  }
  return {
    ...actual,
    ReactFlow,
    Handle: () => <span data-testid="flow-handle" />,
    Background: () => <div data-testid="flow-background" />,
    Controls: () => <div aria-label="画布缩放控件" />,
    MiniMap: () => <div aria-label="关系图小地图" />,
  };
});

import { ContractModuleGraph } from "@/src/components/studio/contract-module-graph";
import { createEmptyDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const baseModel = validModel as unknown as PermissionStudioModel;
const model: PermissionStudioModel = {
  ...baseModel,
  permissionCodes: [...baseModel.permissionCodes, "quick.open"],
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
    "quick.open": {
      code: "quick.open",
      belongToMenuCode: "quick-widget",
      label: "widget.quick",
      desc: "widget.quickDesc",
    },
  },
  contractWidgets: { ...baseModel.contractWidgets, ISO: [] },
  translations: {
    ...baseModel.translations,
    "zh-CN": {
      ...baseModel.translations["zh-CN"],
      "menu.orders.history": "订单历史",
      "widget.quick": "快捷入口",
      "widget.quickDesc": "快速打开常用页面",
    },
  },
};

afterEach(() => {
  cleanup();
  flow.fitView.mockReset();
  flow.setCenter.mockReset();
});

describe("ContractModuleGraph", () => {
  it("renders the complete relationship canvas with protected topology", () => {
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ISO 合同模块关系图")).toBeVisible();
    expect(screen.getByRole("heading", { name: "ISO" })).toBeVisible();
    expect(screen.getAllByText("菜单").length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBePartiallyChecked();
    expect(screen.getByRole("checkbox", { name: "启用订单历史" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "启用快捷入口" })).not.toBeChecked();
    expect(screen.getByLabelText("画布缩放控件")).toBeVisible();
    expect(screen.getByLabelText("关系图小地图")).toBeVisible();
    expect(screen.getByTestId("flow-background")).toBeVisible();
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-connectable", "false");
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-reconnectable", "false");
  });

  it("writes a cascaded module toggle to the existing permission draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "启用订单" }));
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ contractMenus: { ISO: ["orders", "orders.history"] } }),
    );
  });

  it("collapses a branch without changing the permission draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "收起订单" }));
    expect(screen.queryByRole("checkbox", { name: "启用订单历史" })).not.toBeInTheDocument();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("collapses and expands complete node groups", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "收起菜单" }));
    expect(screen.queryByRole("checkbox", { name: "启用订单" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用快捷入口" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "展开菜单" }));
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "全部收起" }));
    expect(screen.queryByText("菜单")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部展开" }));
    expect(screen.getAllByText("菜单").length).toBeGreaterThan(0);
  });

  it("reveals and locates a searched descendant through a collapsed branch", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "收起订单" }));
    const searchbox = screen.getByRole("searchbox", { name: "搜索模块" });
    const canvas = screen.getByTestId("react-flow").parentElement;

    expect(canvas).toContainElement(searchbox);
    expect(screen.queryByText("可按名称或代码定位节点")).not.toBeInTheDocument();
    await user.type(searchbox, "history");

    expect(screen.getByRole("checkbox", { name: "启用订单历史" })).toBeVisible();
    expect(screen.getByText("1 个结果")).toBeVisible();
    await waitFor(() => expect(flow.setCenter).toHaveBeenCalled());
    await user.clear(screen.getByRole("searchbox", { name: "搜索模块" }));
    expect(screen.queryByRole("checkbox", { name: "启用订单历史" })).not.toBeInTheDocument();
  });

  it("keeps canvas tools available without explanatory chrome", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("已启用：蓝色实线")).not.toBeInTheDocument();
    expect(screen.queryByText("部分启用：橙色关系")).not.toBeInTheDocument();
    expect(screen.queryByText("未启用：灰色虚线")).not.toBeInTheDocument();
    expect(screen.queryByText(/拖动空白处平移/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "适应画布" }));
    expect(flow.fitView).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "自动整理" })).toBeEnabled();
  });

  it("locks membership and layout changes while keeping view tools available", () => {
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "收起订单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "自动整理" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "适应画布" })).toBeEnabled();
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-draggable", "false");
  });
});
