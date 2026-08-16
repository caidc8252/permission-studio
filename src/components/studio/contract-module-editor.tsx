"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DualListEditor,
  type TransferItem,
  type TransferLabels,
  type TransferRequest,
  type TransferSelectionChange,
  type TransferSelectionState,
} from "@/src/components/studio/dual-list-editor";
import styles from "@/src/components/studio/contract-module-editor.module.css";
import { setContractOwnerMembership, type PermissionDraft } from "@/src/domain/draft";
import { buildContractEditorView } from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface ContractModuleEditorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  selectedContractType?: string;
  onSelectedContractTypeChange?: (contractType: string) => void;
  onDraftChange: (draft: PermissionDraft) => void;
}

const transferLabels: TransferLabels = {
  search: "搜索模块",
  available: "可启用模块",
  assigned: "已启用模块",
  assignSelected: "启用已选模块",
  unassignSelected: "移除已选模块",
  empty: "没有匹配的模块",
  actions: "模块转移操作",
  dragHandle: (item) => `拖动${item.label}`,
  dragPreview: (count) => `已选择 ${count} 项`,
  noSelection: "请先选择模块",
  moved: (direction, count) =>
    direction === "assign" ? `已启用 ${count} 个模块` : `已移除 ${count} 个模块`,
  sameSideDrop: "该模块已在此列表中",
};

function localizedGroup(group: string): string {
  if (group === "Menus") return "菜单";
  if (group === "Widgets") return "组件";
  return group;
}

function isVisibleMenu(
  model: PermissionStudioModel,
  item: TransferItem,
  expanded: ReadonlySet<string>,
): boolean {
  if (item.kind !== "menu") return true;
  const visited = new Set<string>([item.id]);
  let parent = model.menuRegistry[item.id]?.parentMenuCode;
  while (parent && model.menuRegistry[parent] && !visited.has(parent)) {
    if (!expanded.has(parent)) return false;
    visited.add(parent);
    parent = model.menuRegistry[parent].parentMenuCode;
  }
  return true;
}

export function ContractModuleEditor({
  model,
  draft,
  selectedContractType: initialContractType,
  onSelectedContractTypeChange,
  onDraftChange,
}: ContractModuleEditorProps) {
  const editableContracts = useMemo(
    () => model.contractTypes.filter((contractType) => contractType !== "TEST"),
    [model.contractTypes],
  );
  const firstContractType = editableContracts[0] ?? "";
  const [selectedContractType, setSelectedContractType] = useState(() =>
    editableContracts.includes(initialContractType ?? "")
      ? initialContractType!
      : firstContractType,
  );
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(
    () => new Set(Object.keys(model.menuRegistry)),
  );

  useEffect(() => {
    if (editableContracts.includes(initialContractType ?? "")) {
      setSelectedContractType(initialContractType!);
    } else if (!editableContracts.includes(selectedContractType)) {
      setSelectedContractType(firstContractType);
    }
  }, [editableContracts, firstContractType, initialContractType, selectedContractType]);

  const childrenByMenu = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const [code, menu] of Object.entries(model.menuRegistry)) {
      if (!menu.parentMenuCode || !model.menuRegistry[menu.parentMenuCode]) continue;
      children.set(menu.parentMenuCode, [...(children.get(menu.parentMenuCode) ?? []), code]);
    }
    return children;
  }, [model.menuRegistry]);
  const view = selectedContractType
    ? buildContractEditorView(model, draft, selectedContractType)
    : null;
  const visibleItems = (items: TransferItem[]) =>
    items.filter((item) => isVisibleMenu(model, item, expandedMenus));
  const localizeGroups = (items: TransferItem[]) =>
    items.map((item) => ({ ...item, group: localizedGroup(item.group) }));
  const menuDescendants = (menuCode: string): string[] => {
    const descendants: string[] = [];
    const visited = new Set<string>([menuCode]);
    const collect = (parentCode: string) => {
      for (const childCode of childrenByMenu.get(parentCode) ?? []) {
        if (visited.has(childCode)) continue;
        visited.add(childCode);
        descendants.push(childCode);
        collect(childCode);
      }
    };
    collect(menuCode);
    return descendants;
  };
  const menuDepth = (menuCode: string): number => {
    let depth = 0;
    const visited = new Set<string>([menuCode]);
    let parent = model.menuRegistry[menuCode]?.parentMenuCode;
    while (parent && model.menuRegistry[parent] && !visited.has(parent)) {
      visited.add(parent);
      depth += 1;
      parent = model.menuRegistry[parent].parentMenuCode;
    }
    return depth;
  };
  const menuIdsForSide = (side: TransferSelectionState["side"]): Set<string> =>
    new Set(
      (side === "available" ? view?.available : view?.assigned)
        ?.filter((item) => item.kind === "menu")
        .map((item) => item.id) ?? [],
    );
  const reduceTreeSelection = ({
    side,
    item,
    checked,
    selection,
  }: TransferSelectionChange): ReadonlySet<string> => {
    const next = new Set(selection);
    if (item.kind !== "menu") {
      if (checked) next.add(item.id);
      else next.delete(item.id);
      return next;
    }

    const menuIds = menuIdsForSide(side);
    const affected = [item.id, ...menuDescendants(item.id)].filter((code) => menuIds.has(code));
    for (const code of affected) {
      if (checked) next.add(code);
      else next.delete(code);
    }

    const deepestFirst = [...menuIds].sort(
      (left, right) => menuDepth(right) - menuDepth(left) || left.localeCompare(right),
    );
    for (const menuCode of deepestFirst) {
      const descendants = menuDescendants(menuCode).filter((code) => menuIds.has(code));
      if (!descendants.length) continue;
      if (descendants.every((code) => next.has(code))) next.add(menuCode);
      else next.delete(menuCode);
    }
    return next;
  };
  const isTreeItemIndeterminate = ({ side, item, selection }: TransferSelectionState): boolean => {
    if (item.kind !== "menu") return false;
    const menuIds = menuIdsForSide(side);
    const descendants = menuDescendants(item.id).filter((code) => menuIds.has(code));
    if (!descendants.length) return false;
    const selectedCount = descendants.filter((code) => selection.has(code)).length;
    return selectedCount > 0 && selectedCount < descendants.length;
  };
  const toggleMenu = (menuCode: string) => {
    setExpandedMenus((current) => {
      const next = new Set(current);
      if (next.has(menuCode)) next.delete(menuCode);
      else next.add(menuCode);
      return next;
    });
  };
  const renderItem = (item: TransferItem) => {
    const hasChildren = item.kind === "menu" && (childrenByMenu.get(item.id)?.length ?? 0) > 0;
    const expanded = expandedMenus.has(item.id);
    return (
      <span
        className={styles.item}
        data-menu-code={item.kind === "menu" ? item.id : undefined}
        style={{ paddingInlineStart: `${(item.depth ?? 0) * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.branchToggle}
            aria-label={`${expanded ? "收起" : "展开"}${item.label}`}
            aria-expanded={expanded}
            onClick={() => toggleMenu(item.id)}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span className={styles.branchPlaceholder} aria-hidden="true" />
        )}
        <span className={styles.itemCopy}>
          <strong>{item.label}</strong>
          <code>{item.id}</code>
          {item.description ? <span>{item.description}</span> : null}
        </span>
      </span>
    );
  };
  const transfer = (request: TransferRequest) => {
    if (!view) return;
    let nextDraft = draft;
    for (const kind of ["menu", "widget"] as const) {
      const owners = new Set(
        view.assigned.filter((item) => item.kind === kind).map((item) => item.id),
      );
      for (const id of request.ids) {
        const item = [...view.available, ...view.assigned].find((candidate) => candidate.id === id);
        if (item?.kind !== kind) continue;
        if (request.direction === "assign") owners.add(id);
        else owners.delete(id);
      }
      nextDraft = setContractOwnerMembership(nextDraft, model, view.contractType, kind, [
        ...owners,
      ]);
    }
    onDraftChange(nextDraft);
  };

  return (
    <section className={styles.editor} aria-label="合同模块编辑器">
      <aside className={styles.sidebar} aria-label="可编辑合同">
        <h2>合同类型</h2>
        <ul className={styles.contractList}>
          {editableContracts.map((contractType) => (
            <li key={contractType}>
              <button
                type="button"
                aria-pressed={contractType === selectedContractType}
                onClick={() => {
                  setSelectedContractType(contractType);
                  onSelectedContractTypeChange?.(contractType);
                }}
              >
                {contractType}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className={styles.content}>
        {view ? (
          <>
            <header className={styles.heading}>
              <div>
                <h2>{view.contractType}</h2>
                <p>选择菜单和组件后，再启用或移除已选模块。</p>
              </div>
            </header>
            <DualListEditor
              key={view.contractType}
              ariaLabel={`${view.contractType}的模块`}
              available={localizeGroups(visibleItems(view.available))}
              assigned={localizeGroups(visibleItems(view.assigned))}
              labels={transferLabels}
              onTransfer={transfer}
              renderItem={renderItem}
              reduceSelection={reduceTreeSelection}
              isItemIndeterminate={isTreeItemIndeterminate}
            />
          </>
        ) : (
          <p className={styles.empty}>没有可编辑的合同类型</p>
        )}
      </div>
    </section>
  );
}
