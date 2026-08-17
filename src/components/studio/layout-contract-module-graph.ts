import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";

import type { ContractModuleGraphNodeData } from "@/src/components/studio/contract-module-graph-node";
import type { ContractModuleGraphProjection } from "@/src/domain/contract-module-graph";

export interface ContractModuleLayoutOptions {
  disabled?: boolean;
  onToggle?: ContractModuleGraphNodeData["onToggle"];
  onCollapse?: ContractModuleGraphNodeData["onCollapse"];
}

export interface ContractModuleGraphLayout {
  nodes: Array<Node<ContractModuleGraphNodeData, "contractModule">>;
  edges: Edge[];
}

const NODE_HEIGHT = 112;
const BRANCH_GAP = 32;
const LAYOUT_MARGIN = 28;

function nodeWidth(kind: ContractModuleGraphNodeData["node"]["kind"]): number {
  if (kind === "contract") return 190;
  if (kind === "group") return 190;
  if (kind === "empty") return 180;
  return 260;
}

export function layoutContractModuleGraph(
  projection: ContractModuleGraphProjection,
  options: ContractModuleLayoutOptions = {},
): ContractModuleGraphLayout {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "LR",
    align: "UL",
    nodesep: 32,
    ranksep: 92,
    marginx: 28,
    marginy: 28,
  });

  for (const node of projection.nodes) {
    graph.setNode(node.id, { width: nodeWidth(node.kind), height: NODE_HEIGHT });
  }
  for (const relation of projection.edges) graph.setEdge(relation.source, relation.target);
  dagre.layout(graph);

  const childrenByParent = new Map<string, string[]>();
  for (const node of projection.nodes) {
    if (!node.parentId) continue;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node.id]);
  }
  const descendantsOf = (rootId: string) => {
    const result: string[] = [];
    const visit = (id: string) => {
      result.push(id);
      for (const child of childrenByParent.get(id) ?? []) visit(child);
    };
    visit(rootId);
    return result;
  };
  const branchOffsets = new Map<string, number>();
  const contractNode = projection.nodes.find(({ kind }) => kind === "contract");
  let nextBranchTop = LAYOUT_MARGIN;
  for (const branchRoot of projection.nodes.filter(
    ({ parentId }) => parentId === contractNode?.id,
  )) {
    const branchIds = descendantsOf(branchRoot.id);
    const topPositions = branchIds.map((id) => {
      const position = graph.node(id) as { y: number };
      return position.y - NODE_HEIGHT / 2;
    });
    const branchTop = Math.min(...topPositions);
    const branchBottom = Math.max(...topPositions) + NODE_HEIGHT;
    const offset = nextBranchTop - branchTop;
    for (const id of branchIds) branchOffsets.set(id, offset);
    nextBranchTop += branchBottom - branchTop + BRANCH_GAP;
  }

  const nodes = projection.nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    const width = nodeWidth(node.kind);
    return {
      id: node.id,
      type: "contractModule" as const,
      position: {
        x: position.x - width / 2,
        y:
          node.kind === "contract"
            ? LAYOUT_MARGIN
            : position.y - NODE_HEIGHT / 2 + (branchOffsets.get(node.id) ?? 0),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      selectable: true,
      deletable: false,
      connectable: false,
      data: {
        node,
        disabled: options.disabled ?? false,
        onToggle: options.onToggle ?? (() => undefined),
        onCollapse: options.onCollapse ?? (() => undefined),
      },
    } satisfies Node<ContractModuleGraphNodeData, "contractModule">;
  });

  const edges = projection.edges.map((relation) => {
    const state = relation.mixed ? "mixed" : relation.active ? "active" : "inactive";
    return {
      id: relation.id,
      source: relation.source,
      target: relation.target,
      type: "smoothstep",
      deletable: false,
      reconnectable: false,
      selectable: false,
      label: relation.mixed ? "部分启用" : undefined,
      ariaLabel:
        state === "active" ? "已启用关系" : state === "mixed" ? "部分启用关系" : "未启用关系",
      className: `contract-graph-edge contract-graph-edge--${state}`,
      markerEnd: relation.active ? { type: MarkerType.ArrowClosed } : undefined,
      style: relation.active ? undefined : { strokeDasharray: "6 5" },
    } satisfies Edge;
  });

  return { nodes, edges };
}
