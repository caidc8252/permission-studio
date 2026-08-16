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
    label: "Invite user",
    description: "Invite a new workspace user",
    group: "Users",
    kind: "permission",
  },
  {
    id: "report.export",
    label: "Export reports",
    description: "Download report data",
    group: "Reports",
    kind: "permission",
  },
];

const assigned: TransferItem[] = [
  {
    id: "orders.view",
    label: "View orders",
    description: "Read order details",
    group: "Orders",
    kind: "permission",
  },
];

const props: Omit<DualListEditorProps, "onTransfer"> = {
  ariaLabel: "Role permissions",
  available,
  assigned,
  labels: {
    search: "Search permissions",
    available: "Available permissions",
    assigned: "Assigned permissions",
    assignSelected: "Assign selected",
    unassignSelected: "Unassign selected",
  },
};

afterEach(cleanup);

describe("DualListEditor", () => {
  it("moves selected rows with the explicit assign button", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.click(screen.getByRole("checkbox", { name: "Invite user" }));
    await user.click(screen.getByRole("button", { name: "Assign selected" }));

    expect(onTransfer).toHaveBeenCalledWith({ direction: "assign", ids: ["user.invite"] });
    expect(screen.getByRole("status")).toHaveTextContent("Assigned permissions: 1 item");
  });

  it("filters visible rows without changing assignment", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.type(screen.getByRole("searchbox", { name: "Search permissions" }), "report");

    expect(screen.getByText("Export reports")).toBeVisible();
    expect(screen.queryByText("Invite user")).not.toBeInTheDocument();
    expect(onTransfer).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole("checkbox", { name: "Invite user" }));
    await user.click(screen.getByRole("button", { name: "Assign selected" }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Invite user" })).toHaveFocus(),
    );
  });

  it("moves the selected rows when dropped into the opposite panel", async () => {
    const user = userEvent.setup();
    const onTransfer = vi.fn();
    render(<DualListEditor {...props} onTransfer={onTransfer} />);

    await user.click(screen.getByRole("checkbox", { name: "Invite user" }));
    await user.click(screen.getByRole("checkbox", { name: "Export reports" }));

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

    await user.click(screen.getByRole("checkbox", { name: "Invite user" }));
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
    expect(screen.getByRole("status")).toHaveTextContent("Item is already in that list.");
  });

  it("uses a selected-item count in the drag preview", async () => {
    const user = userEvent.setup();
    render(<DualListEditor {...props} onTransfer={vi.fn()} />);
    await user.click(screen.getByRole("checkbox", { name: "Invite user" }));
    await user.click(screen.getByRole("checkbox", { name: "Export reports" }));

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
      expect.objectContaining({ textContent: "2 selected" }),
      0,
      0,
    );
  });
});
