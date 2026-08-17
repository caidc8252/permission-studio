"use client";

import { useEffect, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import styles from "@/src/components/studio/contract-module-graph.module.css";
import type { ContractModuleGraphNode } from "@/src/domain/contract-module-graph";

export interface ContractModuleGraphNodeData extends Record<string, unknown> {
  node: ContractModuleGraphNode;
  disabled: boolean;
  onToggle: (kind: "menu" | "widget", code: string, checked: boolean) => void;
  onCollapse: (nodeId: string) => void;
}

export type ContractModuleFlowNode = Node<ContractModuleGraphNodeData, "contractModule">;

export interface ContractModuleGraphNodeCardProps {
  node: ContractModuleGraphNode;
  disabled: boolean;
  onToggle: ContractModuleGraphNodeData["onToggle"];
  onCollapse: ContractModuleGraphNodeData["onCollapse"];
}

function stateName(node: ContractModuleGraphNode): "active" | "mixed" | "inactive" {
  if (node.checked) return "active";
  if (node.indeterminate) return "mixed";
  return "inactive";
}

export function ContractModuleGraphNodeCard({
  node,
  disabled,
  onToggle,
  onCollapse,
}: ContractModuleGraphNodeCardProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const editable = node.kind === "menu" || node.kind === "widget";
  const changeMembership = (checked: boolean) => {
    if (node.kind === "menu" || node.kind === "widget") {
      onToggle(node.kind, node.code!, checked);
    }
  };

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = node.indeterminate;
  }, [node.indeterminate]);

  return (
    <article
      className={`${styles.nodeCard} nopan`}
      data-kind={node.kind}
      data-state={stateName(node)}
      data-search-match={node.searchMatch || undefined}
      data-clickable={editable && !disabled ? "true" : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("input, button")) return;
        if (editable && !disabled) changeMembership(!node.checked);
      }}
    >
      <div className={styles.nodeHeader}>
        <span className={styles.nodeKind}>
          {
            {
              contract: "合同",
              group: "分组",
              menu: "菜单",
              widget: "组件",
              empty: "空状态",
            }[node.kind]
          }
        </span>
        <span className={styles.nodeBadges}>
          {node.searchMatch ? <span className={styles.searchBadge}>搜索匹配</span> : null}
          {node.change ? (
            <span className={node.change === "added" ? styles.addedBadge : styles.removedBadge}>
              {node.change === "added" ? "待新增" : "待移除"}
            </span>
          ) : null}
        </span>
      </div>

      <div className={styles.nodeMain}>
        {editable ? (
          <input
            ref={checkboxRef}
            className="nodrag nopan"
            type="checkbox"
            aria-label={`启用${node.label}`}
            aria-checked={node.indeterminate ? "mixed" : node.checked}
            checked={node.checked}
            disabled={disabled}
            onChange={(event) => changeMembership(event.currentTarget.checked)}
          />
        ) : null}
        <div className={styles.nodeCopy}>
          {node.kind === "contract" ? <h3>{node.label}</h3> : <strong>{node.label}</strong>}
          {node.code ? <code>{node.code}</code> : null}
          {node.description ? <span>{node.description}</span> : null}
        </div>
        {node.hasChildren ? (
          <button
            type="button"
            className={`${styles.collapseButton} nodrag nopan`}
            aria-label={`${node.collapsed ? "展开" : "收起"}${node.label}`}
            aria-expanded={!node.collapsed}
            disabled={disabled}
            onClick={() => onCollapse(node.id)}
          >
            <span aria-hidden="true">{node.collapsed ? "+" : "−"}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function ContractModuleGraphNode({ data }: NodeProps<ContractModuleFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <ContractModuleGraphNodeCard {...data} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}
