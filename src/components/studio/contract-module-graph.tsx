"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ControlButton,
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
import {
  defaultPermissionStudioLocale,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";

export interface ContractModuleGraphProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  contractType: string;
  disabled?: boolean;
  toolbar?: ReactNode;
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
  locale = defaultPermissionStudioLocale,
  contractType,
  disabled = false,
  toolbar,
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
    () => buildContractModuleGraph(model, draft, contractType, { collapsed, query, locale }),
    [collapsed, contractType, draft, locale, model, query],
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPageFullscreen, setIsPageFullscreen] = useState(false);
  const fullscreenActive = isFullscreen || isPageFullscreen;

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

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreen = document.fullscreenElement === canvasRef.current;
      setIsFullscreen(fullscreen);
      requestAnimationFrame(() => {
        void flowInstance?.fitView({ padding: 0.2, duration: 200 });
      });
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [flowInstance]);

  useEffect(() => {
    if (!isPageFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPageFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", exitOnEscape);
    requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.2, duration: 200 });
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", exitOnEscape);
    };
  }, [flowInstance, isPageFullscreen]);

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
  const goToNextMatch = () => {
    if (projection.matchIds.length === 0) return;
    setMatchIndex((current) => (current + 1) % projection.matchIds.length);
  };
  const toggleFullscreen = async () => {
    if (isPageFullscreen) {
      setIsPageFullscreen(false);
      return;
    }
    if (document.fullscreenElement === canvasRef.current) {
      await document.exitFullscreen();
      return;
    }
    try {
      await canvasRef.current?.requestFullscreen();
    } catch {
      setIsPageFullscreen(true);
    }
  };

  return (
    <section className={styles.graphShell} aria-label={`${contractType} 合同模块关系图`}>
      <div
        ref={canvasRef}
        className={styles.canvas}
        data-testid="contract-module-canvas"
        data-page-fullscreen={isPageFullscreen || undefined}
      >
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
          {toolbar}
        </div>
        <ReactFlow<ContractModuleFlowNode>
          aria-label={`${contractType} 合同模块关系图画布`}
          nodes={nodes}
          edges={automaticLayout.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onInit={setFlowInstance}
          nodesDraggable={false}
          panOnDrag
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          zoomOnScroll
          zoomOnPinch
          onlyRenderVisibleElements
          minZoom={0.25}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
          <Controls showInteractive={false} showFitView={false}>
            <ControlButton
              aria-label={fullscreenActive ? "退出画布全屏" : "全屏显示画布"}
              title={fullscreenActive ? "退出全屏" : "全屏"}
              onClick={() => void toggleFullscreen()}
            >
              {fullscreenActive ? (
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
                </svg>
              )}
            </ControlButton>
          </Controls>
          <MiniMap pannable zoomable ariaLabel="关系图小地图" />
        </ReactFlow>
      </div>
    </section>
  );
}
