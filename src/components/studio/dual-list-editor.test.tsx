// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    groupFilter: "权限分组",
    groupPlaceholder: "选择分组",
    clearGroupFilter: "清空权限分组",
    available: "可添加权限",
    assigned: "已分配权限",
    assignSelected: "添加已选权限",
    unassignSelected: "移除已选权限",
    empty: "没有匹配的权限",
    actions: "权限转移操作",
    noSelection: "请先选择权限",
    moved: (direction: "assign" | "unassign", count: number) =>
      direction === "assign" ? `已添加 ${count} 项权限` : `已移除 ${count} 项权限`,
  },
};

afterEach(cleanup);

describe("DualListEditor", () => {
  it("keeps the full permission description available as a hover tooltip", () => {
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    expect(screen.getByText("邀请新的工作区成员").parentElement).toHaveAttribute(
      "title",
      "邀请新的工作区成员",
    );
    expect(screen.getByText("邀请新的工作区成员").parentElement).toHaveAttribute(
      "data-tooltip",
      "邀请新的工作区成员",
    );
  });

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

  it("does not render drag handles", () => {
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    expect(screen.queryByText("⠿")).not.toBeInTheDocument();
  });

  it("copies the permission code without selecting the row", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    const copyButton = screen.getByRole("button", { name: "复制权限代码：user.invite" });
    await user.click(copyButton);

    expect(writeText).toHaveBeenCalledWith("user.invite");
    expect(copyButton).toHaveAccessibleName("已复制权限代码：user.invite");
    expect(screen.getByRole("checkbox", { name: "邀请用户" })).not.toBeChecked();
  });

  it("shows group assignment counts and supports collapsing and expanding groups", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);
    const availablePanel = screen.getByRole("region", { name: "可添加权限" });
    const assignedPanel = screen.getByRole("region", { name: "已分配权限" });

    expect(within(availablePanel).getByRole("button", { name: "用户 1 / 1" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(assignedPanel).getByRole("button", { name: "用户 0 / 1" })).toBeVisible();

    const reportGroup = within(availablePanel).getByRole("button", { name: "报表 1 / 1" });
    expect(reportGroup).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("导出报表")).not.toBeInTheDocument();
    await user.click(reportGroup);
    expect(reportGroup).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("导出报表")).toBeVisible();

    await user.click(within(availablePanel).getByRole("button", { name: "用户 1 / 1" }));
    expect(screen.queryByText("邀请用户")).not.toBeInTheDocument();
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

  it("supports direct row actions while keeping batch actions inside each list", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(
      <DualListEditor
        {...props}
        directActions={{ assign: "添加", unassign: "移除" }}
        onTransfer={onTransfer}
      />,
    );

    expect(screen.getByRole("button", { name: "添加已选权限" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "添加：邀请用户" }));

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

  it("filters both lists by group next to the permission search", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

    const groupFilter = screen.getByRole("combobox", { name: "权限分组" });
    expect(groupFilter).toHaveValue("");
    expect(screen.queryByRole("option", { name: "全部分组" })).not.toBeInTheDocument();
    await user.selectOptions(groupFilter, "报表");

    expect(screen.getByText("导出报表")).toBeVisible();
    expect(screen.queryByText("邀请用户")).not.toBeInTheDocument();
    expect(screen.queryByText("查看订单")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空权限分组" }));
    expect(groupFilter).toHaveValue("");
    expect(screen.getByText("邀请用户")).toBeVisible();
    expect(screen.getByRole("button", { name: "订单 1 / 1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "清空权限分组" })).not.toBeInTheDocument();
  });

  it("uses caller-supplied Chinese text for the empty state", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);

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
});
