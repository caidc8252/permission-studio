"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";

import {
  ContractModuleGraphNode,
  type ContractModuleFlowNode,
} from "@/src/components/studio/contract-module-graph-node";
import styles from "@/src/components/studio/contract-module-graph.module.css";
import { layoutContractModuleGraph } from "@/src/components/studio/layout-contract-module-graph";
import {
  buildContractModuleGraph,
  toggleContractModuleGraphNode,
} from "@/src/domain/contract-module-graph";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface ContractModuleGraphProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  contractType: string;
  disabled?: boolean;
  onDraftChange: (draft: PermissionDraft) => void;
}

const nodeTypes = {
  contractModule: ContractModuleGraphNode,
} satisfies NodeTypes;

function structureKey(nodes: readonly ContractModuleFlowNode[]): string {
  return nodes.map(({ id }) => id).join("|");
}

export function ContractModuleGraph({
  model,
  draft,
  contractType,
  disabled = false,
  onDraftChange,
}: ContractModuleGraphProps) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [collapsedByContract, setCollapsedByContract] = useState<Record<string, string[]>>({});
  const collapsed = useMemo(
    () => new Set(collapsedByContract[contractType] ?? []),
    [collapsedByContract, contractType],
  );
  const projection = useMemo(
    () => buildContractModuleGraph(model, draft, contractType, { collapsed, query }),
    [collapsed, contractType, draft, model, query],
  );

  const toggleNode = useCallback(
    (kind: "menu" | "widget", code: string, checked: boolean) => {
      if (disabled) return;
      onDraftChange(
        toggleContractModuleGraphNode(model, draft, contractType, { kind, code, checked }),
      );
    },
    [contractType, disabled, draft, model, onDraftChange],
  );
  const toggleCollapse = useCallback(
    (nodeId: string) => {
      if (disabled) return;
      setCollapsedByContract((current) => {
        const next = new Set(current[contractType] ?? []);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return { ...current, [contractType]: [...next] };
      });
    },
    [contractType, disabled],
  );

  const automaticLayout = useMemo(
    () =>
      layoutContractModuleGraph(projection, {
        disabled,
        onToggle: toggleNode,
        onCollapse: toggleCollapse,
      }),
    [disabled, projection, toggleCollapse, toggleNode],
  );
  const [nodes, setNodes] = useState<ContractModuleFlowNode[]>(automaticLayout.nodes);
  const previousStructure = useRef(structureKey(automaticLayout.nodes));
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ContractModuleFlowNode> | null>(null);

  useEffect(() => {
    const nextStructure = structureKey(automaticLayout.nodes);
    const structureChanged = previousStructure.current !== nextStructure;
    setNodes((current) => {
      if (structureChanged) return automaticLayout.nodes;
      const positions = new Map(current.map((node) => [node.id, node.position]));
      return automaticLayout.nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      }));
    });
    previousStructure.current = nextStructure;
  }, [automaticLayout]);

  useEffect(() => {
    setQuery("");
    setMatchIndex(0);
  }, [contractType]);

  useEffect(() => {
    setMatchIndex(0);
  }, [query]);

  const activeMatchId = projection.matchIds[matchIndex % Math.max(projection.matchIds.length, 1)];
  useEffect(() => {
    if (!flowInstance || !activeMatchId) return;
    const match = nodes.find((node) => node.id === activeMatchId);
    if (!match) return;
    void flowInstance.setCenter(match.position.x + 130, match.position.y + 56, {
      zoom: 1.08,
      duration: 320,
    });
  }, [activeMatchId, flowInstance, nodes]);

  const onNodesChange = useCallback((changes: NodeChange<ContractModuleFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  const fitCanvas = () => {
    void flowInstance?.fitView({ padding: 0.2, duration: 320 });
  };
  const resetLayout = () => {
    if (disabled) return;
    setNodes(automaticLayout.nodes);
    requestAnimationFrame(() => fitCanvas());
  };
  const goToNextMatch = () => {
    if (projection.matchIds.length === 0) return;
    setMatchIndex((current) => (current + 1) % projection.matchIds.length);
  };
  const toggleAllCollapsed = () => {
    if (disabled) return;
    setCollapsedByContract((current) => ({
      ...current,
      [contractType]: collapsed.size > 0 ? [] : [`contract:${contractType}`],
    }));
  };

  return (
    <section className={styles.graphShell} aria-label={`${contractType} 合同模块关系图`}>
      <div className={styles.canvas}>
        <div className={styles.canvasToolbar}>
          <div className={styles.searchControl}>
            <input
              type="search"
              aria-label="搜索模块"
              value={query}
              placeholder="输入名称或代码"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {query ? (
              <span className={styles.searchStatus} aria-live="polite">
                {projection.matchIds.length} 个结果
              </span>
            ) : null}
            {projection.matchIds.length > 1 ? (
              <button type="button" onClick={goToNextMatch}>
                下一个
              </button>
            ) : null}
          </div>
          <div className={styles.toolbarActions}>
            {disabled ? <span className={styles.lockedBadge}>只读</span> : null}
            <button type="button" disabled={disabled} onClick={toggleAllCollapsed}>
              {collapsed.size > 0 ? "全部展开" : "全部收起"}
            </button>
            <button type="button" onClick={fitCanvas}>
              适应画布
            </button>
            <button type="button" disabled={disabled} onClick={resetLayout}>
              自动整理
            </button>
          </div>
        </div>
        <ReactFlow<ContractModuleFlowNode>
          aria-label={`${contractType} 合同模块关系图画布`}
          nodes={nodes}
          edges={automaticLayout.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onInit={setFlowInstance}
          nodesDraggable={!disabled}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          onlyRenderVisibleElements
          minZoom={0.25}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="关系图小地图" />
        </ReactFlow>
      </div>
    </section>
  );
}
