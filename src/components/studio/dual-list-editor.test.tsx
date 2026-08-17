// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

import {
  DualListEditor,
  type DualListEditorProps,
  type TransferItem,
} from "@/src/components/studio/dual-list-editor";

const available: TransferItem[] = [
  {
    id: "user.invite",
    label: "邀请用户",
    description: "邀请新的工作区成员",
    group: "用户",
    kind: "permission",
  },
  {
    id: "report.export",
    label: "导出报表",
    description: "下载报表数据",
    group: "报表",
    kind: "permission",
  },
];

const assigned: TransferItem[] = [
  {
    id: "orders.view",
    label: "查看订单",
    description: "读取订单详情",
    group: "订单",
    kind: "permission",
  },
];

const props: Omit<DualListEditorProps, "onTransfer"> = {
  ariaLabel: "角色权限",
  available,
  assigned,
  labels: {
    search: "搜索权限",
    available: "可添加权限",
    assigned: "已分配权限",
    assignSelected: "添加已选权限",
    unassignSelected: "移除已选权限",
    empty: "没有匹配的权限",
    actions: "权限转移操作",
    dragHandle: (item: TransferItem) => `拖动${item.label}`,
    dragPreview: (count: number) => `已选择 ${count} 项`,
    noSelection: "请先选择权限",
    moved: (direction: "assign" | "unassign", count: number) =>
      direction === "assign" ? `已添加 ${count} 项权限` : `已移除 ${count} 项权限`,
    sameSideDrop: "该权限已在此列表中",
  },
};

afterEach(cleanup);

describe("DualListEditor", () => {
  it("toggles selection by clicking anywhere on a permission card", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    const card = screen.getByText("邀请用户").closest("li");
    expect(card).not.toBeNull();
    await user.click(card!);
    expect(screen.getByRole("checkbox", { name: "邀请用户" })).toBeChecked();
    expect(card).toHaveAttribute("data-selected", "true");

    await user.click(screen.getByText("邀请新的工作区成员"));
    expect(screen.getByRole("checkbox", { name: "邀请用户" })).not.toBeChecked();
  });

  it("does not toggle a card when its checkbox or drag handle handles the click", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: "邀请用户" });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole("button", { name: "拖动邀请用户" }));
    expect(checkbox).toBeChecked();
  });

  it("moves selected rows with the explicit assign button", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.click(screen.getByRole("checkbox", { name: "邀请用户" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));

    expect(onTransfer).toHaveBeenCalledWith({ direction: "assign", ids: ["user.invite"] });
    expect(screen.getByRole("status")).toHaveTextContent("已添加 1 项权限");
  });

  it("filters visible rows without changing assignment", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.type(screen.getByRole("searchbox", { name: "搜索权限" }), "报表");

    expect(screen.getByText("导出报表")).toBeVisible();
    expect(screen.queryByText("邀请用户")).not.toBeInTheDocument();
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("uses caller-supplied Chinese text for the empty state and drag handle", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    expect(screen.getByRole("button", { name: "拖动邀请用户" })).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索权限" }), "不存在");
    expect(screen.getAllByText("没有匹配的权限")).toHaveLength(2);
  });

  it("moves focus to the transferred row after its parent updates the lists", async () => {
    const user = userEvent.setup();

    function TransferHarness() {
      const [availableItems, setAvailableItems] = useState(available);
      const [assignedItems, setAssignedItems] = useState(assigned);
      return (
        <DualListEditor
          {...props}
          available={availableItems}
          assigned={assignedItems}
          onTransfer={({ direction, ids }) => {
            const source = direction === "assign" ? availableItems : assignedItems;
            const selected = source.filter((item) => ids.includes(item.id));
            if (direction === "assign") {
              setAvailableItems((items) => items.filter((item) => !ids.includes(item.id)));
              setAssignedItems((items) => [...items, ...selected]);
            }
          }}
        />
      );
    }

    render(<TransferHarness />);
    await user.click(screen.getByRole("checkbox", { name: "邀请用户" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "邀请用户" })).toHaveFocus());
  });

  it("moves the selected rows when dropped into the opposite panel", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.click(screen.getByRole("checkbox", { name: "邀请用户" }));
    await user.click(screen.getByRole("checkbox", { name: "导出报表" }));

    await waitFor(() => expect(dragAndDrop.monitorForElements).toHaveBeenCalled());
    const monitorCalls = dragAndDrop.monitorForElements.mock.calls as unknown as Array<
      [{ onDrop: (event: unknown) => void }]
    >;
    const monitor = monitorCalls.at(-1)?.[0];
    expect(monitor).toBeDefined();
    monitor!.onDrop({
      source: { data: { type: "transfer-item", side: "available", id: "report.export" } },
      location: {
        current: { dropTargets: [{ data: { type: "transfer-panel", side: "assigned" } }] },
      },
    });

    expect(onTransfer).toHaveBeenCalledWith({
      direction: "assign",
      ids: ["report.export", "user.invite"],
    });
  });

  it("announces a no-op when dropped back into the source panel", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.click(screen.getByRole("checkbox", { name: "邀请用户" }));
    await waitFor(() => expect(dragAndDrop.monitorForElements).toHaveBeenCalled());
    const monitorCalls = dragAndDrop.monitorForElements.mock.calls as unknown as Array<
      [{ onDrop: (event: unknown) => void }]
    >;
    const monitor = monitorCalls.at(-1)?.[0];
    expect(monitor).toBeDefined();

    act(() => {
      monitor!.onDrop({
        source: { data: { type: "transfer-item", side: "available", id: "user.invite" } },
        location: {
          current: { dropTargets: [{ data: { type: "transfer-panel", side: "available" } }] },
        },
      });
    });

    expect(onTransfer).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("该权限已在此列表中");
  });

  it("uses a selected-item count in the drag preview", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "邀请用户" }));
    await user.click(screen.getByRole("checkbox", { name: "导出报表" }));

    const registrations = dragAndDrop.draggable.mock.calls as unknown as Array<
      [{ getInitialData: () => unknown; onGenerateDragPreview: (event: unknown) => void }]
    >;
    const registration = registrations.findLast(
      ([options]) => (options.getInitialData() as { id?: string }).id === "report.export",
    )?.[0];
    expect(registration).toBeDefined();

    const nativeSetDragImage = vi.fn();
    registration!.onGenerateDragPreview({ nativeSetDragImage });

    expect(nativeSetDragImage).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: "已选择 2 项" }),
      0,
      0,
    );
  });
});
