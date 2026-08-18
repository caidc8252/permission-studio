"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

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
  groupFilter: string;
  groupPlaceholder: string;
  clearGroupFilter: string;
  available: string;
  assigned: string;
  assignSelected: string;
  unassignSelected: string;
  empty: string;
  actions: string;
  noSelection: string;
  moved: (direction: TransferRequest["direction"], count: number) => string;
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
  directActions?: {
    assign: string;
    unassign: string;
  };
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

function DefaultTransferItem({ item }: { item: TransferItem }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyPermissionCode = async () => {
    try {
      await navigator.clipboard.writeText(item.id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span
      className={styles.itemCopy}
      style={{ paddingInlineStart: `${(item.depth ?? 0) * 1.25}rem` }}
    >
      <strong>{item.label}</strong>
      <span className={styles.codeRow}>
        <code>{item.id}</code>
        {item.kind === "permission" ? (
          <button
            type="button"
            className={styles.copyCode}
            data-copied={copied || undefined}
            aria-label={`${copied ? "已复制" : "复制"}权限代码：${item.id}`}
            title={copied ? "已复制" : "复制权限代码"}
            onClick={() => void copyPermissionCode()}
          >
            {copied ? (
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <path d="m3.5 8 3 3 6-7" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <rect x="5.25" y="5.25" width="7.5" height="7.5" rx="1.25" />
                <path d="M10.75 5.25V4.5A1.25 1.25 0 0 0 9.5 3.25h-6A1.25 1.25 0 0 0 2.25 4.5v6A1.25 1.25 0 0 0 3.5 11.75h.75" />
              </svg>
            )}
          </button>
        ) : null}
      </span>
      {item.description ? (
        <span
          className={styles.descriptionTooltip}
          data-tooltip={item.description}
          title={item.description}
        >
          <span className={styles.itemDescription}>{item.description}</span>
        </span>
      ) : null}
    </span>
  );
}

function defaultRenderItem(item: TransferItem) {
  return <DefaultTransferItem item={item} />;
}

function uniqueSorted(ids: readonly string[]) {
  return [...new Set(ids)].sort();
}

function countItemsByGroup(items: readonly TransferItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.group, (counts.get(item.group) ?? 0) + 1);
  return counts;
}

interface TransferRowProps {
  item: TransferItem;
  checked: boolean;
  indeterminate: boolean;
  onCheckedChange: (checked: boolean) => void;
  itemRef: (element: HTMLInputElement | null) => void;
  renderItem: (item: TransferItem) => React.ReactNode;
  directActionLabel?: string;
  onDirectAction?: () => void;
}

function TransferRow({
  item,
  checked,
  indeterminate,
  onCheckedChange,
  itemRef,
  renderItem,
  directActionLabel,
  onDirectAction,
}: TransferRowProps) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <li
      className={styles.row}
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
      {directActionLabel && onDirectAction ? (
        <button
          type="button"
          className={styles.directAction}
          aria-label={`${directActionLabel}：${item.label}`}
          onClick={onDirectAction}
        >
          {directActionLabel}
        </button>
      ) : null}
    </li>
  );
}

interface TransferPanelProps {
  side: Side;
  label: string;
  groups: string[];
  items: TransferItem[];
  groupCounts: ReadonlyMap<string, number>;
  totalGroupCounts: ReadonlyMap<string, number>;
  collapsedGroups: ReadonlySet<string>;
  onGroupToggle: (group: string) => void;
  expandAllGroups: boolean;
  selection: Set<string>;
  onSelectionChange: (selection: Set<string>) => void;
  itemRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
  renderItem: (item: TransferItem) => React.ReactNode;
  emptyLabel: string;
  reduceSelection?: DualListEditorProps["reduceSelection"];
  isItemIndeterminate?: DualListEditorProps["isItemIndeterminate"];
  selectedActionLabel?: string;
  directActionLabel?: string;
  onTransfer?: (ids: readonly string[]) => void;
}

function TransferPanel({
  side,
  label,
  groups,
  items,
  groupCounts,
  totalGroupCounts,
  collapsedGroups,
  onGroupToggle,
  expandAllGroups,
  selection,
  onSelectionChange,
  itemRefs,
  renderItem,
  emptyLabel,
  reduceSelection,
  isItemIndeterminate,
  selectedActionLabel,
  directActionLabel,
  onTransfer,
}: TransferPanelProps) {
  const groupId = useId();
  const groupedItems = useMemo(() => {
    const grouped = new Map<string, TransferItem[]>();
    for (const item of items) grouped.set(item.group, [...(grouped.get(item.group) ?? []), item]);
    return grouped;
  }, [items]);

  return (
    <section className={styles.panel} aria-label={label}>
      <header className={styles.panelHeader}>
        <h3>
          {label} <small>{items.length}</small>
        </h3>
        {selectedActionLabel && onTransfer ? (
          <button
            type="button"
            className={styles.batchAction}
            aria-label={selectedActionLabel}
            disabled={!selection.size}
            onClick={() => onTransfer([...selection])}
          >
            {selectedActionLabel}
            {selection.size ? `（${selection.size}）` : ""}
          </button>
        ) : null}
      </header>
      {groups.length ? (
        groups.map((group, index) => {
          const groupItems = groupedItems.get(group) ?? [];
          const expanded = expandAllGroups || !collapsedGroups.has(group);
          const headingId = `${groupId}-heading-${index}`;
          const contentId = `${groupId}-content-${index}`;
          return (
            <section className={styles.group} aria-labelledby={headingId} key={group}>
              <h4 id={headingId}>
                <button
                  type="button"
                  className={styles.groupToggle}
                  aria-controls={contentId}
                  aria-expanded={expanded}
                  aria-label={`${group} ${groupCounts.get(group) ?? 0} / ${totalGroupCounts.get(group) ?? 0}`}
                  onClick={() => onGroupToggle(group)}
                >
                  <span className={styles.groupChevron} aria-hidden="true">
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span className={styles.groupName}>{group}</span>
                  <span className={styles.groupCount}>
                    {groupCounts.get(group) ?? 0} / {totalGroupCounts.get(group) ?? 0}
                  </span>
                </button>
              </h4>
              {expanded ? (
                <ul id={contentId}>
                  {groupItems.map((item) => (
                    <TransferRow
                      key={item.id}
                      item={item}
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
                      itemRef={(element) => {
                        if (element) itemRefs.current.set(item.id, element);
                        else itemRefs.current.delete(item.id);
                      }}
                      renderItem={renderItem}
                      directActionLabel={directActionLabel}
                      onDirectAction={onTransfer ? () => onTransfer([item.id]) : undefined}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })
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
  directActions,
}: DualListEditorProps) {
  const groups = useMemo(
    () => [...new Set([...available, ...assigned].map((item) => item.group))],
    [assigned, available],
  );
  const availableGroupCounts = useMemo(() => countItemsByGroup(available), [available]);
  const assignedGroupCounts = useMemo(() => countItemsByGroup(assigned), [assigned]);
  const totalGroupCounts = useMemo(
    () => countItemsByGroup([...available, ...assigned]),
    [assigned, available],
  );
  const [availableSelection, setAvailableSelection] = useState<Set<string>>(new Set());
  const [assignedSelection, setAssignedSelection] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<Side, Set<string>>>(() => ({
    available: new Set(groups.filter((group) => group !== available[0]?.group)),
    assigned: new Set(groups.filter((group) => group !== assigned[0]?.group)),
  }));
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const groupFilterId = useId();
  const destinationRefs = useRef(new Map<string, HTMLInputElement>());
  const sourceRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusRef = useRef<{ side: Side; id: string } | null>(null);

  const toggleGroup = (side: Side, group: string) => {
    setCollapsedGroups((current) => {
      const nextSide = new Set(current[side]);
      if (nextSide.has(group)) nextSide.delete(group);
      else nextSide.add(group);
      return { ...current, [side]: nextSide };
    });
  };

  const transfer = (direction: TransferRequest["direction"], ids: readonly string[]) => {
    const unique = uniqueSorted(ids);
    const destination = direction === "assign" ? "assigned" : "available";
    if (!unique.length) {
      setAnnouncement(labels.noSelection);
      return;
    }
    const sourceItems = direction === "assign" ? available : assigned;
    const destinationGroups = new Set(
      sourceItems.filter((item) => unique.includes(item.id)).map((item) => item.group),
    );
    setCollapsedGroups((current) => {
      const nextDestination = new Set(current[destination]);
      for (const group of destinationGroups) nextDestination.delete(group);
      return { ...current, [destination]: nextDestination };
    });
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matching = (items: TransferItem[]) =>
    items.filter(
      (item) =>
        (!groupFilter || item.group === groupFilter) &&
        (!normalizedQuery ||
          [item.id, item.label, item.description, item.group]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))),
    );
  const matchingAvailable = matching(available);
  const matchingAssigned = matching(assigned);
  const matchingAvailableGroups = new Set(matchingAvailable.map((item) => item.group));
  const matchingAssignedGroups = new Set(matchingAssigned.map((item) => item.group));
  const visibleAvailableGroups = groups.filter((group) => matchingAvailableGroups.has(group));
  const visibleAssignedGroups = groups.filter((group) => matchingAssignedGroups.has(group));
  const expandFilteredGroups = Boolean(groupFilter || normalizedQuery);

  return (
    <section aria-label={ariaLabel} className={styles.transfer}>
      <div className={styles.filters}>
        <label className={styles.search}>
          <span>{labels.search}</span>
          <input
            type="search"
            aria-label={labels.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.groupFilter}>
          <label htmlFor={groupFilterId}>{labels.groupFilter}</label>
          <div className={styles.groupControl}>
            <select
              id={groupFilterId}
              aria-label={labels.groupFilter}
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value="" hidden>
                {labels.groupPlaceholder}
              </option>
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
            {groupFilter ? (
              <button
                className={styles.clearGroup}
                type="button"
                aria-label={labels.clearGroupFilter}
                title={labels.clearGroupFilter}
                onClick={() => setGroupFilter("")}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.editor} data-direct-actions={directActions ? "true" : undefined}>
        <TransferPanel
          side="available"
          label={labels.available}
          groups={visibleAvailableGroups}
          items={matchingAvailable}
          groupCounts={availableGroupCounts}
          totalGroupCounts={totalGroupCounts}
          collapsedGroups={collapsedGroups.available}
          onGroupToggle={(group) => toggleGroup("available", group)}
          expandAllGroups={expandFilteredGroups}
          selection={availableSelection}
          onSelectionChange={setAvailableSelection}
          itemRefs={sourceRefs}
          renderItem={renderItem}
          emptyLabel={labels.empty}
          reduceSelection={reduceSelection}
          isItemIndeterminate={isItemIndeterminate}
          selectedActionLabel={directActions ? labels.assignSelected : undefined}
          directActionLabel={directActions?.assign}
          onTransfer={directActions ? (ids) => transfer("assign", ids) : undefined}
        />
        {!directActions ? (
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
        ) : null}
        <TransferPanel
          side="assigned"
          label={labels.assigned}
          groups={visibleAssignedGroups}
          items={matchingAssigned}
          groupCounts={assignedGroupCounts}
          totalGroupCounts={totalGroupCounts}
          collapsedGroups={collapsedGroups.assigned}
          onGroupToggle={(group) => toggleGroup("assigned", group)}
          expandAllGroups={expandFilteredGroups}
          selection={assignedSelection}
          onSelectionChange={setAssignedSelection}
          itemRefs={destinationRefs}
          renderItem={renderItem}
          emptyLabel={labels.empty}
          reduceSelection={reduceSelection}
          isItemIndeterminate={isItemIndeterminate}
          selectedActionLabel={directActions ? labels.unassignSelected : undefined}
          directActionLabel={directActions?.unassign}
          onTransfer={directActions ? (ids) => transfer("unassign", ids) : undefined}
        />
      </div>
      <p role="status" aria-live="polite" className={styles.srOnly}>
        {announcement}
      </p>
    </section>
  );
}
