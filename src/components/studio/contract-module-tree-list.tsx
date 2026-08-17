"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";

import styles from "@/src/components/studio/contract-module-tree-list.module.css";
import {
  buildContractModuleGraph,
  toggleContractModuleGraphNode,
  type ContractModuleGraphNode,
} from "@/src/domain/contract-module-graph";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";

type StatusFilter = "all" | "enabled" | "disabled";

interface TreeRow {
  node: ContractModuleGraphNode;
  depth: number;
}

export interface ContractModuleTreeListProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  contractType: string;
  disabled?: boolean;
  onDraftChange: (draft: PermissionDraft) => void;
}

function TreeCheckbox({
  node,
  label,
  disabled,
  onChange,
}: {
  node: ContractModuleGraphNode;
  label: string;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = node.indeterminate;
  }, [node.indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      aria-label={label}
      aria-checked={node.indeterminate ? "mixed" : node.checked}
      checked={node.checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
}

function nodeState(node: ContractModuleGraphNode): "enabled" | "mixed" | "disabled" {
  if (node.checked) return "enabled";
  if (node.indeterminate) return "mixed";
  return "disabled";
}

function stateLabel(node: ContractModuleGraphNode): string {
  if (node.checked) return "已启用";
  if (node.indeterminate) return "部分启用";
  return "未启用";
}

function statusMatches(node: ContractModuleGraphNode, status: StatusFilter): boolean {
  if (status === "all") return true;
  if (status === "enabled") return node.checked || node.indeterminate;
  return !node.checked;
}

function moduleOwnerCounts(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  contractType: string,
): { enabled: number; total: number } {
  const menuCodes = new Set(Object.keys(model.menuRegistry));
  const widgetCodes = new Set(
    Object.values(model.permissionRegistry)
      .map((permission) => permission.belongToMenuCode)
      .filter((owner) => !menuCodes.has(owner)),
  );
  const currentMenus = draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [];
  const currentWidgets =
    draft.contractWidgets[contractType] ?? model.contractWidgets[contractType] ?? [];
  return {
    enabled:
      currentMenus.filter((code) => menuCodes.has(code)).length +
      currentWidgets.filter((code) => widgetCodes.has(code)).length,
    total: menuCodes.size + widgetCodes.size,
  };
}

export function ContractModuleTreeList({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
  contractType,
  disabled = false,
  onDraftChange,
}: ContractModuleTreeListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [collapsedByContract, setCollapsedByContract] = useState<Record<string, string[]>>({});
  const collapsed = useMemo(
    () => new Set(collapsedByContract[contractType] ?? []),
    [collapsedByContract, contractType],
  );
  const projection = useMemo(
    () =>
      buildContractModuleGraph(model, draft, contractType, {
        collapsed: new Set(),
        query,
        locale,
      }),
    [contractType, draft, locale, model, query],
  );
  const counts = useMemo(
    () => moduleOwnerCounts(model, draft, contractType),
    [contractType, draft, model],
  );

  useEffect(() => {
    setQuery("");
    setStatus("all");
  }, [contractType]);

  const nodesById = useMemo(
    () => new Map(projection.nodes.map((node) => [node.id, node])),
    [projection.nodes],
  );
  const childrenByParent = useMemo(() => {
    const result = new Map<string, ContractModuleGraphNode[]>();
    for (const node of projection.nodes) {
      if (!node.parentId) continue;
      result.set(node.parentId, [...(result.get(node.parentId) ?? []), node]);
    }
    return result;
  }, [projection.nodes]);

  const { rows, resultCount } = useMemo(() => {
    const queryActive = query.trim().length > 0;
    const visible = new Set<string>();
    const matched = projection.nodes.filter((node) => {
      if (node.kind === "contract" || node.kind === "empty") return false;
      if (node.kind === "group") return queryActive && status === "all" && node.searchMatch;
      return (!queryActive || node.searchMatch) && statusMatches(node, status);
    });

    const includeWithAncestors = (node: ContractModuleGraphNode) => {
      let current: ContractModuleGraphNode | undefined = node;
      while (current && current.kind !== "contract") {
        visible.add(current.id);
        current = current.parentId ? nodesById.get(current.parentId) : undefined;
      }
    };

    if (!queryActive && status === "all") {
      for (const node of projection.nodes) {
        if (node.kind !== "contract") visible.add(node.id);
      }
    } else {
      for (const node of matched) includeWithAncestors(node);
    }

    const forceOpen = new Set<string>();
    if (queryActive || status !== "all") {
      for (const node of matched) {
        let parentId = node.parentId;
        while (parentId) {
          forceOpen.add(parentId);
          parentId = nodesById.get(parentId)?.parentId ?? null;
        }
      }
    }

    const nextRows: TreeRow[] = [];
    const visit = (node: ContractModuleGraphNode, depth: number) => {
      if (!visible.has(node.id)) return;
      nextRows.push({ node, depth });
      if (collapsed.has(node.id) && !forceOpen.has(node.id)) return;
      for (const child of childrenByParent.get(node.id) ?? []) visit(child, depth + 1);
    };
    const contractId = `contract:${contractType}`;
    for (const root of childrenByParent.get(contractId) ?? []) visit(root, 0);
    return { rows: nextRows, resultCount: matched.length };
  }, [childrenByParent, collapsed, contractType, nodesById, projection.nodes, query, status]);

  const expandableIds = useMemo(
    () => projection.nodes.filter((node) => node.hasChildren).map((node) => node.id),
    [projection.nodes],
  );
  const updateCollapsed = (next: Set<string>) => {
    setCollapsedByContract((current) => ({ ...current, [contractType]: [...next] }));
  };
  const toggleCollapsed = (nodeId: string) => {
    const next = new Set(collapsed);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    updateCollapsed(next);
  };
  const expandEnabled = () => {
    updateCollapsed(
      new Set(
        projection.nodes
          .filter((node) => node.hasChildren && !node.checked && !node.indeterminate)
          .map((node) => node.id),
      ),
    );
  };
  const toggleModule = (node: ContractModuleGraphNode, checked: boolean) => {
    if (disabled || !node.code || (node.kind !== "menu" && node.kind !== "widget")) return;
    onDraftChange(
      toggleContractModuleGraphNode(model, draft, contractType, {
        kind: node.kind,
        code: node.code,
        checked,
      }),
    );
  };
  const toggleGroup = (group: ContractModuleGraphNode, checked: boolean) => {
    if (disabled) return;
    let nextDraft = draft;
    const children = projection.nodes.filter((node) => {
      if (group.id.endsWith(":menus")) return node.kind === "menu" && node.parentId === group.id;
      return node.kind === "widget";
    });
    for (const child of children) {
      nextDraft = toggleContractModuleGraphNode(model, nextDraft, contractType, {
        kind: child.kind as "menu" | "widget",
        code: child.code!,
        checked,
      });
    }
    onDraftChange(nextDraft);
  };
  const changeStatus = (event: ChangeEvent<HTMLSelectElement>) => {
    setStatus(event.currentTarget.value as StatusFilter);
  };

  return (
    <section className={styles.listShell} aria-label={`${contractType} 合同模块列表`}>
      <header className={styles.summaryBar}>
        <div className={styles.contractSummary}>
          <span className={styles.summaryEyebrow}>当前合同</span>
          <strong>{contractType}</strong>
          <span
            className={styles.summaryCount}
            aria-label={`${counts.enabled} / ${counts.total} 已启用`}
          >
            <b>{counts.enabled}</b> / {counts.total} 已启用
          </span>
        </div>
        <div className={styles.summaryTrack} aria-hidden="true">
          <span
            style={{ width: counts.total ? `${(counts.enabled / counts.total) * 100}%` : "0%" }}
          />
        </div>
      </header>

      <div className={styles.toolRow}>
        <label className={styles.searchBox}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <span className={styles.srOnly}>搜索菜单、代码或路径</span>
          <input
            type="search"
            value={query}
            placeholder="搜索菜单、Code 或 Path"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query ? <small>{resultCount} 个结果</small> : null}
        </label>
        <label className={styles.filterSelect}>
          <span>状态</span>
          <select aria-label="按启用状态筛选" value={status} onChange={changeStatus}>
            <option value="all">全部</option>
            <option value="enabled">已启用</option>
            <option value="disabled">未启用</option>
          </select>
        </label>
        <div className={styles.treeActions} aria-label="树形列表操作">
          <button type="button" onClick={() => updateCollapsed(new Set())}>
            全部展开
          </button>
          <button type="button" onClick={() => updateCollapsed(new Set(expandableIds))}>
            全部收起
          </button>
          <button type="button" onClick={expandEnabled}>
            仅展开已启用
          </button>
        </div>
      </div>

      <div className={styles.tableFrame}>
        <div className={styles.columnHeader} aria-hidden="true">
          <span>模块名称</span>
          <span>Code</span>
          <span>路径 / 说明</span>
          <span>状态</span>
        </div>
        <div className={styles.rowScroller} role="tree" aria-label="合同模块树">
          {rows.length ? (
            rows.map(({ node, depth }) => {
              const isGroup = node.kind === "group";
              const editable = node.kind === "menu" || node.kind === "widget";
              const isCollapsed = collapsed.has(node.id);
              const checkboxLabel = isGroup ? `启用全部${node.label}` : `启用${node.label}`;
              return (
                <div
                  key={node.id}
                  className={styles.listRow}
                  data-kind={node.kind}
                  data-state={nodeState(node)}
                  data-search-match={node.searchMatch || undefined}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={node.hasChildren ? !isCollapsed : undefined}
                  style={{ "--tree-depth": depth } as CSSProperties}
                >
                  <div className={styles.nameCell}>
                    <span className={styles.permissionRail} aria-hidden="true" />
                    {node.hasChildren ? (
                      <button
                        type="button"
                        className={styles.disclosure}
                        aria-label={`${isCollapsed ? "展开" : "收起"}${node.label}`}
                        onClick={() => toggleCollapsed(node.id)}
                      >
                        <svg aria-hidden="true" viewBox="0 0 16 16">
                          <path d="m5 3 5 5-5 5" />
                        </svg>
                      </button>
                    ) : (
                      <span className={styles.leafSpacer} aria-hidden="true" />
                    )}
                    {isGroup || editable ? (
                      <TreeCheckbox
                        node={node}
                        label={checkboxLabel}
                        disabled={disabled}
                        onChange={(checked) =>
                          isGroup ? toggleGroup(node, checked) : toggleModule(node, checked)
                        }
                      />
                    ) : null}
                    <span className={styles.nameCopy}>
                      <strong>{node.label}</strong>
                      {isGroup ? <small>{node.description}</small> : null}
                    </span>
                  </div>
                  <code className={styles.codeCell}>{node.code ?? "—"}</code>
                  <span className={styles.pathCell}>{node.description ?? "—"}</span>
                  <span className={styles.stateCell}>
                    <span className={styles.stateBadge}>{stateLabel(node)}</span>
                    {node.change ? (
                      <span className={styles.changeBadge} data-change={node.change}>
                        {node.change === "added" ? "待新增" : "待移除"}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyResult}>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M4 7.5h16M7 4v7M12 7.5V15m-4 0h8" />
                <circle cx="7" cy="15" r="1.5" />
                <circle cx="17" cy="15" r="1.5" />
              </svg>
              <strong>没有匹配的模块</strong>
              <span>调整搜索词或状态筛选后再试。</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
