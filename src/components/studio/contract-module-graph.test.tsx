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
    position: { x: number; y: number };
    draggable?: boolean;
    data: Record<string, unknown>;
  };
  type MockNodeComponent = React.ComponentType<{ data: Record<string, unknown> }>;
  interface MockFlowProps {
    nodes: MockNode[];
    nodeTypes?: Record<string, MockNodeComponent>;
    nodesConnectable?: boolean;
    edgesReconnectable?: boolean;
    nodesDraggable?: boolean;
    panOnDrag?: boolean;
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
    panOnDrag,
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
        data-pan-on-drag={String(panOnDrag)}
      >
        {nodes.map((node) => {
          const Component = nodeTypes?.[node.type ?? ""];
          return Component ? (
            <div
              key={node.id}
              data-testid={`flow-node-${node.id}`}
              data-position={`${node.position.x},${node.position.y}`}
              data-node-draggable={String(node.draggable)}
            >
              <Component data={node.data} />
            </div>
          ) : null;
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
    Controls: ({ children }: { children?: React.ReactNode }) => (
      <div aria-label="画布缩放控件">{children}</div>
    ),
    ControlButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props} />
    ),
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
  it("renders module nodes in the selected data locale", () => {
    render(
      <ContractModuleGraph
        model={baseModel}
        draft={createEmptyDraft()}
        locale="en"
        contractType="ISO"
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用Orders" })).toBeVisible();
    expect(screen.getByText("orders")).toBeVisible();
    expect(screen.getByRole("button", { name: "全屏显示画布" })).toBeVisible();
  });

  it("renders module nodes in the selected data locale", () => {
    render(
      <ContractModuleGraph
        model={baseModel}
        draft={createEmptyDraft()}
        contractType="ISO"
        locale="en"
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用Orders" })).toBeVisible();
    expect(screen.getByRole("button", { name: "全屏显示画布" })).toBeVisible();
  });

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
    expect(screen.getByRole("button", { name: "全屏显示画布" })).toBeVisible();
    expect(screen.getByLabelText("关系图小地图")).toBeVisible();
    expect(screen.getByTestId("flow-background")).toBeVisible();
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-draggable", "false");
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-pan-on-drag", "true");
    for (const node of screen.getAllByTestId(/^flow-node-/)) {
      expect(node).toHaveAttribute("data-node-draggable", "false");
    }
    for (const card of screen.getAllByRole("article")) {
      expect(card).toHaveClass("nopan");
    }
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-connectable", "false");
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-reconnectable", "false");
  });

  it("uses the canvas DOM element for native fullscreen and exits cleanly", async () => {
    const user = userEvent.setup();
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });

    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled={false}
        onDraftChange={vi.fn()}
        toolbar={<button type="button">ISO</button>}
      />,
    );

    const canvas = screen.getByTestId("contract-module-canvas");
    Object.defineProperty(canvas, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = canvas;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
    await user.click(screen.getByRole("button", { name: "全屏显示画布" }));
    expect(document.fullscreenElement).toBe(canvas);
    expect(screen.getByRole("button", { name: "退出画布全屏" })).toBeVisible();
    expect(screen.getByRole("button", { name: "ISO" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "退出画布全屏" }));
    expect(document.fullscreenElement).toBeNull();
    expect(screen.getByRole("button", { name: "全屏显示画布" })).toBeVisible();
  });

  it("falls back to a page-filling canvas when native fullscreen is denied", async () => {
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

    const canvas = screen.getByTestId("contract-module-canvas");
    Object.defineProperty(canvas, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.reject(new TypeError("not granted"))),
    });
    await user.click(screen.getByRole("button", { name: "全屏显示画布" }));

    expect(canvas).toHaveAttribute("data-page-fullscreen", "true");
    expect(screen.getByRole("button", { name: "退出画布全屏" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(canvas).not.toHaveAttribute("data-page-fullscreen");
    expect(screen.getByRole("button", { name: "全屏显示画布" })).toBeVisible();
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
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ contractMenus: { ISO: ["orders", "orders.history"] } }),
    );
  });

  it("toggles membership when clicking an editable card body", async () => {
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

    const card = screen.getByRole("checkbox", { name: "启用订单" }).closest("article");
    expect(card).toHaveAttribute("data-clickable", "true");
    await user.click(card!);

    expect(onDraftChange).toHaveBeenCalledTimes(1);
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

  it("collapses and expands individual node groups", async () => {
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

    const menuGroup = screen.getByTestId("flow-node-group:ISO:menus");
    flow.fitView.mockClear();
    await user.click(screen.getByRole("button", { name: "收起组件" }));
    expect(screen.queryByRole("checkbox", { name: "启用快捷入口" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeVisible();
    const menuY = Number(menuGroup.getAttribute("data-position")?.split(",")[1]);
    const widgetY = Number(
      screen
        .getByTestId("flow-node-group:ISO:widgets")
        .getAttribute("data-position")
        ?.split(",")[1],
    );
    expect(menuY).toBeLessThan(widgetY);
    expect(flow.fitView).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "展开组件" }));
    expect(screen.getByRole("checkbox", { name: "启用快捷入口" })).toBeVisible();
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

  it("keeps search available without extra canvas actions or explanatory chrome", () => {
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
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "全部收起" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "适应画布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "自动整理" })).not.toBeInTheDocument();
  });

  it("locks membership changes while keeping search available", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleGraph
        model={model}
        draft={createEmptyDraft()}
        contractType="ISO"
        disabled
        onDraftChange={onDraftChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "启用订单" });
    const card = checkbox.closest("article");
    expect(checkbox).toBeDisabled();
    expect(card).not.toHaveAttribute("data-clickable");
    await user.click(card!);
    expect(onDraftChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "收起订单" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "适应画布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "自动整理" })).not.toBeInTheDocument();
    expect(screen.getByTestId("react-flow")).toHaveAttribute("data-draggable", "false");
  });
});
