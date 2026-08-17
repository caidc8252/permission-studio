"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/src/components/studio/dual-list-editor.module.css";

export interface TransferItem {
  id: string;
  label: string;
  description?: string;
  group: string;
  depth?: number;
  kind?: "permission" | "menu" | "widget";
}

export interface TransferRequest {
  direction: "assign" | "unassign";
  ids: string[];
}

export interface TransferLabels {
  search: string;
  available: string;
  assigned: string;
  assignSelected: string;
  unassignSelected: string;
  empty: string;
  actions: string;
  dragHandle: (item: TransferItem) => string;
  dragPreview: (count: number) => string;
  noSelection: string;
  moved: (direction: TransferRequest["direction"], count: number) => string;
  sameSideDrop: string;
}

export interface DualListEditorProps {
  ariaLabel: string;
  available: TransferItem[];
  assigned: TransferItem[];
  labels: TransferLabels;
  onTransfer: (request: TransferRequest) => void;
  renderItem?: (item: TransferItem) => React.ReactNode;
  reduceSelection?: (change: TransferSelectionChange) => ReadonlySet<string>;
  isItemIndeterminate?: (state: TransferSelectionState) => boolean;
}

type Side = "available" | "assigned";

export interface TransferSelectionState {
  side: Side;
  item: TransferItem;
  selection: ReadonlySet<string>;
}

export interface TransferSelectionChange extends TransferSelectionState {
  checked: boolean;
}

interface TransferDragData {
  type: "transfer-item";
  side: Side;
  id: string;
}

interface TransferPanelData {
  type: "transfer-panel";
  side: Side;
}

function isTransferDragData(
  data: Record<string, unknown>,
): data is Record<string, unknown> & TransferDragData {
  return (
    data.type === "transfer-item" &&
    (data.side === "available" || data.side === "assigned") &&
    typeof data.id === "string"
  );
}

function isTransferPanelData(
  data: Record<string | symbol, unknown>,
): data is Record<string | symbol, unknown> & TransferPanelData {
  return data.type === "transfer-panel" && (data.side === "available" || data.side === "assigned");
}

function defaultRenderItem(item: TransferItem) {
  return (
    <span
      className={styles.itemCopy}
      style={{ paddingInlineStart: `${(item.depth ?? 0) * 1.25}rem` }}
    >
      <strong>{item.label}</strong>
      <code>{item.id}</code>
      {item.description ? <span>{item.description}</span> : null}
    </span>
  );
}

function uniqueSorted(ids: readonly string[]) {
  return [...new Set(ids)].sort();
}

interface TransferRowProps {
  item: TransferItem;
  side: Side;
  checked: boolean;
  indeterminate: boolean;
  onCheckedChange: (checked: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  getDragCount: () => number;
  dragHandleLabel: string;
  dragPreview: (count: number) => string;
  itemRef: (element: HTMLInputElement | null) => void;
  renderItem: (item: TransferItem) => React.ReactNode;
}

function TransferRow({
  item,
  side,
  checked,
  indeterminate,
  onCheckedChange,
  onDragStart,
  onDragEnd,
  getDragCount,
  dragHandleLabel,
  dragPreview,
  itemRef,
  renderItem,
}: TransferRowProps) {
  const rowRef = useRef<HTMLLIElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const checkboxRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  useEffect(() => {
    const row = rowRef.current;
    const handle = handleRef.current;
    if (!row || !handle) return;
    return draggable({
      element: row,
      dragHandle: handle,
      getInitialData: () => ({ type: "transfer-item", side, id: item.id }),
      onDragStart: () => {
        setDragging(true);
        onDragStart();
      },
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        if (!nativeSetDragImage) return;
        const preview = document.createElement("div");
        const count = getDragCount();
        preview.className = styles.dragPreview;
        preview.textContent = dragPreview(count);
        document.body.append(preview);
        nativeSetDragImage(preview, 0, 0);
        queueMicrotask(() => preview.remove());
      },
      onDrop: () => {
        setDragging(false);
        onDragEnd();
      },
    });
  }, [item.id, onDragEnd, onDragStart, side]);

  return (
    <li
      ref={rowRef}
      className={styles.row}
      data-dragging={dragging || undefined}
      data-selected={checked || indeterminate || undefined}
      onClick={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("button, input, select, textarea, a[href], [role='button']")
        ) {
          return;
        }
        onCheckedChange(!checked);
      }}
    >
      <input
        ref={(element) => {
          checkboxRef.current = element;
          itemRef(element);
        }}
        type="checkbox"
        aria-label={item.label}
        aria-checked={indeterminate ? "mixed" : checked}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {renderItem(item)}
      <button
        ref={handleRef}
        type="button"
        className={styles.dragHandle}
        aria-label={dragHandleLabel}
        title={dragHandleLabel}
      >
        <span aria-hidden="true">⠿</span>
      </button>
    </li>
  );
}

interface TransferPanelProps {
  side: Side;
  label: string;
  items: TransferItem[];
  selection: Set<string>;
  onSelectionChange: (selection: Set<string>) => void;
  panelRef: (element: HTMLElement | null) => void;
  itemRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
  renderItem: (item: TransferItem) => React.ReactNode;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
  emptyLabel: string;
  dragHandle: (item: TransferItem) => string;
  dragPreview: (count: number) => string;
  reduceSelection?: DualListEditorProps["reduceSelection"];
  isItemIndeterminate?: DualListEditorProps["isItemIndeterminate"];
}

function TransferPanel({
  side,
  label,
  items,
  selection,
  onSelectionChange,
  panelRef,
  itemRefs,
  renderItem,
  onDragStart,
  onDragEnd,
  isDropTarget,
  emptyLabel,
  dragHandle,
  dragPreview,
  reduceSelection,
  isItemIndeterminate,
}: TransferPanelProps) {
  const groups = useMemo(() => {
    const grouped = new Map<string, TransferItem[]>();
    for (const item of items) grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
    return [...grouped.entries()];
  }, [items]);

  return (
    <section
      ref={panelRef}
      className={styles.panel}
      data-drop-target={isDropTarget || undefined}
      aria-label={label}
    >
      <h3>{label}</h3>
      {groups.length ? (
        groups.map(([group, groupItems]) => (
          <section className={styles.group} aria-label={group} key={group}>
            <h4>{group}</h4>
            <ul>
              {groupItems.map((item) => (
                <TransferRow
                  key={item.id}
                  item={item}
                  side={side}
                  checked={selection.has(item.id)}
                  indeterminate={isItemIndeterminate?.({ side, item, selection }) ?? false}
                  onCheckedChange={(checked) => {
                    if (reduceSelection) {
                      onSelectionChange(
                        new Set(reduceSelection({ side, item, checked, selection })),
                      );
                      return;
                    }
                    const next = new Set(selection);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    onSelectionChange(next);
                  }}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  getDragCount={() => (selection.has(item.id) ? selection.size : 1)}
                  dragHandleLabel={dragHandle(item)}
                  dragPreview={dragPreview}
                  itemRef={(element) => {
                    if (element) itemRefs.current.set(item.id, element);
                    else itemRefs.current.delete(item.id);
                  }}
                  renderItem={renderItem}
                />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className={styles.empty}>{emptyLabel}</p>
      )}
    </section>
  );
}

export function DualListEditor({
  ariaLabel,
  available,
  assigned,
  labels,
  onTransfer,
  renderItem = defaultRenderItem,
  reduceSelection,
  isItemIndeterminate,
}: DualListEditorProps) {
  const [availableSelection, setAvailableSelection] = useState<Set<string>>(new Set());
  const [assignedSelection, setAssignedSelection] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [draggedSide, setDraggedSide] = useState<Side | null>(null);
  const [dropTargetSide, setDropTargetSide] = useState<Side | null>(null);
  const destinationRefs = useRef(new Map<string, HTMLInputElement>());
  const sourceRefs = useRef(new Map<string, HTMLInputElement>());
  const availablePanelRef = useRef<HTMLElement | null>(null);
  const assignedPanelRef = useRef<HTMLElement | null>(null);
  const selectionsRef = useRef({ available: availableSelection, assigned: assignedSelection });
  const pendingFocusRef = useRef<{ side: Side; id: string } | null>(null);

  selectionsRef.current = { available: availableSelection, assigned: assignedSelection };

  const transfer = (direction: TransferRequest["direction"], ids: readonly string[]) => {
    const unique = uniqueSorted(ids);
    const destination = direction === "assign" ? "assigned" : "available";
    if (!unique.length) {
      setAnnouncement(labels.noSelection);
      return;
    }
    pendingFocusRef.current = { side: destination, id: unique[0]! };
    onTransfer({ direction, ids: unique });
    setAnnouncement(labels.moved(direction, unique.length));
    if (direction === "assign") setAvailableSelection(new Set());
    else setAssignedSelection(new Set());
  };

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const refs = pending.side === "assigned" ? destinationRefs : sourceRefs;
    const target = refs.current.get(pending.id);
    if (!target) return;
    pendingFocusRef.current = null;
    queueMicrotask(() => target.focus());
  }, [assigned, available]);

  useEffect(() => {
    const panels: Array<[Side, HTMLElement | null]> = [
      ["available", availablePanelRef.current],
      ["assigned", assignedPanelRef.current],
    ];
    const cleanups = panels.flatMap(([side, panel]) => {
      if (!panel) return [];
      return [
        dropTargetForElements({
          element: panel,
          getData: () => ({ type: "transfer-panel", side }),
          onDragEnter: () => setDropTargetSide(side),
          onDragLeave: () => setDropTargetSide(null),
          onDrop: () => setDropTargetSide(null),
        }),
      ];
    });
    return combine(...cleanups);
  }, []);

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isTransferDragData(source.data),
      onDrop: ({ source, location }) => {
        if (!isTransferDragData(source.data)) return;
        const target = location.current.dropTargets
          .map((dropTarget) => dropTarget.data)
          .find(isTransferPanelData);
        if (!target) return;
        if (target.side === source.data.side) {
          setAnnouncement(labels.sameSideDrop);
          return;
        }
        const selected = selectionsRef.current[source.data.side];
        const ids = selected.has(source.data.id) ? [...selected] : [source.data.id];
        transfer(source.data.side === "available" ? "assign" : "unassign", ids);
      },
    });
  });

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = (items: TransferItem[]) =>
    normalizedQuery
      ? items.filter((item) =>
          [item.id, item.label, item.description, item.group]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
        )
      : items;

  return (
    <section aria-label={ariaLabel} className={styles.transfer}>
      <label className={styles.search}>
        <span>{labels.search}</span>
        <input
          type="search"
          aria-label={labels.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.editor}>
        <TransferPanel
          side="available"
          label={labels.available}
          items={matching(available)}
          selection={availableSelection}
          onSelectionChange={setAvailableSelection}
          panelRef={(element) => {
            availablePanelRef.current = element;
          }}
          itemRefs={sourceRefs}
          renderItem={renderItem}
          onDragStart={() => setDraggedSide("available")}
          onDragEnd={() => setDraggedSide(null)}
          isDropTarget={dropTargetSide === "available" && draggedSide !== "available"}
          emptyLabel={labels.empty}
          dragHandle={labels.dragHandle}
          dragPreview={labels.dragPreview}
          reduceSelection={reduceSelection}
          isItemIndeterminate={isItemIndeterminate}
        />
        <div className={styles.actions} aria-label={labels.actions}>
          <button
            type="button"
            disabled={!availableSelection.size}
            onClick={() => transfer("assign", [...availableSelection])}
          >
            {labels.assignSelected}
          </button>
          <button
            type="button"
            disabled={!assignedSelection.size}
            onClick={() => transfer("unassign", [...assignedSelection])}
          >
            {labels.unassignSelected}
          </button>
        </div>
        <TransferPanel
          side="assigned"
          label={labels.assigned}
          items={matching(assigned)}
          selection={assignedSelection}
          onSelectionChange={setAssignedSelection}
          panelRef={(element) => {
            assignedPanelRef.current = element;
          }}
          itemRefs={destinationRefs}
          renderItem={renderItem}
          onDragStart={() => setDraggedSide("assigned")}
          onDragEnd={() => setDraggedSide(null)}
          isDropTarget={dropTargetSide === "assigned" && draggedSide !== "assigned"}
          emptyLabel={labels.empty}
          dragHandle={labels.dragHandle}
          dragPreview={labels.dragPreview}
          reduceSelection={reduceSelection}
          isItemIndeterminate={isItemIndeterminate}
        />
      </div>
      <p role="status" aria-live="polite" className={styles.srOnly}>
        {announcement}
      </p>
    </section>
  );
}
