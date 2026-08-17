import { setContractOwnerMembership, type PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export type ContractModuleGraphNodeKind = "contract" | "group" | "menu" | "widget" | "empty";

export type ContractModuleGraphChange = "added" | "removed" | null;

export interface ContractModuleGraphNode {
  id: string;
  kind: ContractModuleGraphNodeKind;
  label: string;
  code: string | null;
  description: string | null;
  parentId: string | null;
  checked: boolean;
  indeterminate: boolean;
  change: ContractModuleGraphChange;
  hasChildren: boolean;
  collapsed: boolean;
  searchMatch: boolean;
}

export interface ContractModuleGraphEdge {
  id: string;
  source: string;
  target: string;
  active: boolean;
  mixed: boolean;
}

export interface ContractModuleGraphProjection {
  nodes: ContractModuleGraphNode[];
  edges: ContractModuleGraphEdge[];
  matchIds: string[];
}

export interface ContractModuleGraphViewOptions {
  collapsed: ReadonlySet<string>;
  query: string;
}

export interface ContractModuleGraphToggle {
  kind: "menu" | "widget";
  code: string;
  checked: boolean;
}

interface MenuTree {
  roots: string[];
  children: Map<string, string[]>;
}

function translated(model: PermissionStudioModel, key: string, fallback: string): string {
  return model.translations["zh-CN"][key] ?? fallback;
}

function assertEditableContract(model: PermissionStudioModel, contractType: string): void {
  if (!model.contractTypes.includes(contractType)) {
    throw new Error(`Unknown contract "${contractType}"`);
  }
  if (contractType === "TEST") throw new Error("TEST is read-only");
}

function menuTree(model: PermissionStudioModel): MenuTree {
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const compare = (left: string, right: string) => {
    const leftMenu = model.menuRegistry[left]!;
    const rightMenu = model.menuRegistry[right]!;
    return leftMenu.order - rightMenu.order || left.localeCompare(right);
  };

  for (const [code, menu] of Object.entries(model.menuRegistry)) {
    if (menu.parentMenuCode && model.menuRegistry[menu.parentMenuCode]) {
      children.set(menu.parentMenuCode, [...(children.get(menu.parentMenuCode) ?? []), code]);
    } else {
      roots.push(code);
    }
  }
  roots.sort(compare);
  for (const entries of children.values()) entries.sort(compare);
  return { roots, children };
}

function descendants(children: ReadonlyMap<string, readonly string[]>, code: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>([code]);
  const visit = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      result.push(child);
      visit(child);
    }
  };
  visit(code);
  return result;
}

function ancestors(model: PermissionStudioModel, code: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>([code]);
  let parent = model.menuRegistry[code]?.parentMenuCode;
  while (parent && model.menuRegistry[parent] && !visited.has(parent)) {
    visited.add(parent);
    result.push(parent);
    parent = model.menuRegistry[parent].parentMenuCode;
  }
  return result;
}

function widgetOwners(model: PermissionStudioModel): string[] {
  return [
    ...new Set(
      Object.values(model.permissionRegistry)
        .map((permission) => permission.belongToMenuCode)
        .filter((owner) => !model.menuRegistry[owner]),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function widgetCopy(
  model: PermissionStudioModel,
  owner: string,
): { label: string; description: string | null } {
  const permission = Object.values(model.permissionRegistry)
    .filter((candidate) => candidate.belongToMenuCode === owner)
    .sort((left, right) => left.code.localeCompare(right.code))[0];
  return {
    label: permission ? translated(model, permission.label, owner) : owner,
    description: permission ? translated(model, permission.desc, owner) : null,
  };
}

function changeFor(
  code: string,
  current: ReadonlySet<string>,
  baseline: ReadonlySet<string>,
): ContractModuleGraphChange {
  if (current.has(code) && !baseline.has(code)) return "added";
  if (!current.has(code) && baseline.has(code)) return "removed";
  return null;
}

function matches(query: string, ...values: Array<string | null>): boolean {
  if (!query) return false;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

function edge(source: string, target: string, targetNode: ContractModuleGraphNode) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    active: targetNode.checked || targetNode.indeterminate,
    mixed: targetNode.indeterminate,
  } satisfies ContractModuleGraphEdge;
}

export function buildContractModuleGraph(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  contractType: string,
  options: ContractModuleGraphViewOptions,
): ContractModuleGraphProjection {
  assertEditableContract(model, contractType);
  const tree = menuTree(model);
  const menuCurrent = new Set(
    draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [],
  );
  const widgetCurrent = new Set(
    draft.contractWidgets[contractType] ?? model.contractWidgets[contractType] ?? [],
  );
  const menuBaseline = new Set(model.contractMenus[contractType] ?? []);
  const widgetBaseline = new Set(model.contractWidgets[contractType] ?? []);
  const widgets = widgetOwners(model);
  const query = options.query.trim().toLocaleLowerCase();
  const isCollapsed = (id: string, legacyCode?: string) =>
    options.collapsed.has(id) || (legacyCode ? options.collapsed.has(legacyCode) : false);
  const matchingMenuCodes = new Set<string>();
  const matchingWidgetCodes = new Set<string>();

  for (const [code, menu] of Object.entries(model.menuRegistry)) {
    const label = translated(model, menu.title, code);
    if (matches(query, code, label)) matchingMenuCodes.add(code);
  }
  for (const owner of widgets) {
    const copy = widgetCopy(model, owner);
    if (matches(query, owner, copy.label)) matchingWidgetCodes.add(owner);
  }

  const forcedMenus = new Set<string>();
  for (const code of matchingMenuCodes) {
    forcedMenus.add(code);
    for (const ancestor of ancestors(model, code)) forcedMenus.add(ancestor);
  }

  const nodes: ContractModuleGraphNode[] = [];
  const edges: ContractModuleGraphEdge[] = [];
  const matchIds: string[] = [];
  const contractId = `contract:${contractType}`;
  const menuGroupId = `group:${contractType}:menus`;
  const widgetGroupId = `group:${contractType}:widgets`;
  const allMenus = Object.keys(model.menuRegistry);
  const allMenuChecked = allMenus.length > 0 && allMenus.every((code) => menuCurrent.has(code));
  const anyMenuChecked = allMenus.some((code) => menuCurrent.has(code));
  const allWidgetChecked = widgets.length > 0 && widgets.every((code) => widgetCurrent.has(code));
  const anyWidgetChecked = widgets.some((code) => widgetCurrent.has(code));
  const menuSearchActive = matchingMenuCodes.size > 0 || matches(query, "菜单");
  const widgetSearchActive = matchingWidgetCodes.size > 0 || matches(query, "组件");
  const contractCollapsed = isCollapsed(contractId);

  const contractNode: ContractModuleGraphNode = {
    id: contractId,
    kind: "contract",
    label: contractType,
    code: contractType,
    description: "当前合同",
    parentId: null,
    checked: true,
    indeterminate: false,
    change: null,
    hasChildren: true,
    collapsed: contractCollapsed,
    searchMatch: matches(query, contractType),
  };
  nodes.push(contractNode);
  if (contractNode.searchMatch) matchIds.push(contractId);

  const menuGroup: ContractModuleGraphNode = {
    id: menuGroupId,
    kind: "group",
    label: "菜单",
    code: null,
    description: `${menuCurrent.size} / ${allMenus.length} 已启用`,
    parentId: contractId,
    checked: allMenuChecked,
    indeterminate: anyMenuChecked && !allMenuChecked,
    change: null,
    hasChildren: tree.roots.length > 0,
    collapsed: isCollapsed(menuGroupId),
    searchMatch: matches(query, "菜单"),
  };
  const showMenuGroup = !contractCollapsed || menuSearchActive;
  if (showMenuGroup) {
    nodes.push(menuGroup);
    edges.push(edge(contractId, menuGroupId, menuGroup));
    if (menuGroup.searchMatch) matchIds.push(menuGroupId);
  }

  const visitMenu = (code: string, parentId: string, hiddenByCollapse: boolean) => {
    const menu = model.menuRegistry[code];
    if (!menu) return;
    const forced = forcedMenus.has(code);
    if (hiddenByCollapse && !forced) return;
    const childCodes = tree.children.get(code) ?? [];
    const subtree = [code, ...descendants(tree.children, code)];
    const checked = subtree.every((candidate) => menuCurrent.has(candidate));
    const anyChecked = subtree.some((candidate) => menuCurrent.has(candidate));
    const id = `menu:${code}`;
    const label = translated(model, menu.title, code);
    const menuNode: ContractModuleGraphNode = {
      id,
      kind: "menu",
      label,
      code,
      description: menu.path,
      parentId,
      checked,
      indeterminate: anyChecked && !checked,
      change: changeFor(code, menuCurrent, menuBaseline),
      hasChildren: childCodes.length > 0,
      collapsed: isCollapsed(id, code),
      searchMatch: matchingMenuCodes.has(code),
    };
    nodes.push(menuNode);
    edges.push(edge(parentId, id, menuNode));
    if (menuNode.searchMatch) matchIds.push(id);
    const descendantsHidden = hiddenByCollapse || isCollapsed(id, code);
    for (const child of childCodes) visitMenu(child, id, descendantsHidden);
  };

  if (showMenuGroup && tree.roots.length === 0 && !menuGroup.collapsed) {
    const emptyNode: ContractModuleGraphNode = {
      id: `empty:${contractType}:menus`,
      kind: "empty",
      label: "暂无菜单",
      code: null,
      description: null,
      parentId: menuGroupId,
      checked: false,
      indeterminate: false,
      change: null,
      hasChildren: false,
      collapsed: false,
      searchMatch: false,
    };
    nodes.push(emptyNode);
    edges.push(edge(menuGroupId, emptyNode.id, emptyNode));
  } else if (showMenuGroup) {
    for (const root of tree.roots) {
      visitMenu(root, menuGroupId, contractCollapsed || menuGroup.collapsed);
    }
  }

  const widgetGroup: ContractModuleGraphNode = {
    id: widgetGroupId,
    kind: "group",
    label: "组件",
    code: null,
    description: `${widgetCurrent.size} / ${widgets.length} 已启用`,
    parentId: contractId,
    checked: allWidgetChecked,
    indeterminate: anyWidgetChecked && !allWidgetChecked,
    change: null,
    hasChildren: widgets.length > 0,
    collapsed: isCollapsed(widgetGroupId),
    searchMatch: matches(query, "组件"),
  };
  const showWidgetGroup = !contractCollapsed || widgetSearchActive;
  if (showWidgetGroup) {
    nodes.push(widgetGroup);
    edges.push(edge(contractId, widgetGroupId, widgetGroup));
    if (widgetGroup.searchMatch) matchIds.push(widgetGroupId);
  }

  if (showWidgetGroup && widgets.length === 0 && !widgetGroup.collapsed) {
    const emptyNode: ContractModuleGraphNode = {
      id: `empty:${contractType}:widgets`,
      kind: "empty",
      label: "暂无组件",
      code: null,
      description: null,
      parentId: widgetGroupId,
      checked: false,
      indeterminate: false,
      change: null,
      hasChildren: false,
      collapsed: false,
      searchMatch: false,
    };
    nodes.push(emptyNode);
    edges.push(edge(widgetGroupId, emptyNode.id, emptyNode));
  } else if (showWidgetGroup) {
    for (const owner of widgets) {
      if ((contractCollapsed || widgetGroup.collapsed) && !matchingWidgetCodes.has(owner)) continue;
      const copy = widgetCopy(model, owner);
      const id = `widget:${owner}`;
      const widgetNode: ContractModuleGraphNode = {
        id,
        kind: "widget",
        label: copy.label,
        code: owner,
        description: copy.description,
        parentId: widgetGroupId,
        checked: widgetCurrent.has(owner),
        indeterminate: false,
        change: changeFor(owner, widgetCurrent, widgetBaseline),
        hasChildren: false,
        collapsed: false,
        searchMatch: matchingWidgetCodes.has(owner),
      };
      nodes.push(widgetNode);
      edges.push(edge(widgetGroupId, id, widgetNode));
      if (widgetNode.searchMatch) matchIds.push(id);
    }
  }

  return { nodes, edges, matchIds };
}

export function toggleContractModuleGraphNode(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  contractType: string,
  toggle: ContractModuleGraphToggle,
): PermissionDraft {
  assertEditableContract(model, contractType);
  if (toggle.kind === "widget") {
    if (!widgetOwners(model).includes(toggle.code)) {
      throw new Error(`Unknown widget "${toggle.code}"`);
    }
    const current = new Set(
      draft.contractWidgets[contractType] ?? model.contractWidgets[contractType] ?? [],
    );
    if (toggle.checked) current.add(toggle.code);
    else current.delete(toggle.code);
    return setContractOwnerMembership(draft, model, contractType, "widget", [...current]);
  }

  if (!model.menuRegistry[toggle.code]) throw new Error(`Unknown menu "${toggle.code}"`);
  const tree = menuTree(model);
  const current = new Set(
    draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [],
  );
  for (const code of [toggle.code, ...descendants(tree.children, toggle.code)]) {
    if (toggle.checked) current.add(code);
    else current.delete(code);
  }
  for (const ancestor of ancestors(model, toggle.code)) {
    const ancestorDescendants = descendants(tree.children, ancestor);
    if (ancestorDescendants.length > 0 && ancestorDescendants.every((code) => current.has(code))) {
      current.add(ancestor);
    } else {
      current.delete(ancestor);
    }
  }
  return setContractOwnerMembership(draft, model, contractType, "menu", [...current]);
}
