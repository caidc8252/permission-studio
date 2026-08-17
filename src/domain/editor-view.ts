import type { TransferItem } from "@/src/components/studio/dual-list-editor";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface RoleEditorView {
  roleCode: string;
  roleLabel: string;
  roleDescription: string;
  available: TransferItem[];
  assigned: TransferItem[];
}

export interface ContractEditorView {
  contractType: string;
  available: TransferItem[];
  assigned: TransferItem[];
}

interface SortableTransferItem {
  id: string;
  label: string;
  description: string;
  group: string;
  kind: "permission";
  menuOrder: number;
}

function translated(model: PermissionStudioModel, key: string, fallback: string): string {
  return model.translations["zh-CN"][key] ?? fallback;
}

function editableRole(model: PermissionStudioModel, roleCode: string) {
  const role = model.roles.find((candidate) => candidate.code === roleCode);
  if (!role || !role.code.startsWith("preset_")) {
    throw new Error(`Role "${roleCode}" is not editable`);
  }
  return role;
}

function editableContract(model: PermissionStudioModel, contractType: string): void {
  if (!model.contractTypes.includes(contractType)) {
    throw new Error(`Unknown contract "${contractType}"`);
  }
  if (contractType === "TEST") throw new Error("TEST is read-only");
}

export function buildPermissionTransferItems(
  model: PermissionStudioModel,
  permissionCodes: readonly string[],
): TransferItem[] {
  const items: SortableTransferItem[] = [];
  for (const code of permissionCodes) {
    const permission = model.permissionRegistry[code];
    if (!permission) continue;
    const menu = model.menuRegistry[permission.belongToMenuCode];
    items.push({
      id: code,
      label: translated(model, permission.label, code),
      description: translated(model, permission.desc, code),
      group: translated(
        model,
        menu?.title ?? permission.belongToMenuCode,
        permission.belongToMenuCode,
      ),
      kind: "permission",
      menuOrder: menu?.order ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return items
    .sort((left, right) => left.menuOrder - right.menuOrder || left.id.localeCompare(right.id))
    .map(({ id, label, description, group, kind }) => ({ id, label, description, group, kind }));
}

export function buildRoleEditorView(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  roleCode: string,
): RoleEditorView {
  const role = editableRole(model, roleCode);
  const assignedCodes = new Set(draft.rolePermissions[roleCode] ?? role.permissionCodes);
  const assigned = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((code) => assignedCodes.has(code)),
  );
  const available = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((code) => !assignedCodes.has(code)),
  );

  return {
    roleCode: role.code,
    roleLabel: translated(model, role.roleName, role.code),
    roleDescription: translated(model, role.remark, role.code),
    assigned,
    available,
  };
}

function orderedMenuCodes(model: PermissionStudioModel): string[] {
  const children = new Map<string | null, string[]>();
  for (const [code, menu] of Object.entries(model.menuRegistry)) {
    const parent =
      menu.parentMenuCode && model.menuRegistry[menu.parentMenuCode] ? menu.parentMenuCode : null;
    children.set(parent, [...(children.get(parent) ?? []), code]);
  }
  const compare = (left: string, right: string) => {
    const leftMenu = model.menuRegistry[left]!;
    const rightMenu = model.menuRegistry[right]!;
    return leftMenu.order - rightMenu.order || left.localeCompare(right);
  };
  for (const entries of children.values()) entries.sort(compare);

  const result: string[] = [];
  const visited = new Set<string>();
  const visit = (code: string) => {
    if (visited.has(code)) return;
    visited.add(code);
    result.push(code);
    for (const child of children.get(code) ?? []) visit(child);
  };

  for (const code of children.get(null) ?? []) visit(code);
  for (const code of Object.keys(model.menuRegistry).sort(compare)) visit(code);
  return result;
}

function menuDepth(model: PermissionStudioModel, code: string): number {
  let depth = 0;
  let parent = model.menuRegistry[code]?.parentMenuCode;
  const visited = new Set<string>([code]);
  while (parent && model.menuRegistry[parent] && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = model.menuRegistry[parent].parentMenuCode;
  }
  return depth;
}

function contractItems(model: PermissionStudioModel): TransferItem[] {
  const menus = orderedMenuCodes(model).map((code) => {
    const menu = model.menuRegistry[code]!;
    return {
      id: code,
      label: translated(model, menu.title, code),
      description: menu.path ?? undefined,
      group: "Menus",
      kind: "menu" as const,
      depth: menuDepth(model, code),
    };
  });
  const widgets = [
    ...new Set(
      Object.values(model.permissionRegistry)
        .map((permission) => permission.belongToMenuCode)
        .filter((owner) => !model.menuRegistry[owner]),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((owner) => {
      const permission = Object.values(model.permissionRegistry)
        .filter((candidate) => candidate.belongToMenuCode === owner)
        .sort((left, right) => left.code.localeCompare(right.code))[0];
      return {
        id: owner,
        label: permission ? translated(model, permission.label, owner) : owner,
        description: permission ? translated(model, permission.desc, owner) : undefined,
        group: "Widgets",
        kind: "widget" as const,
        depth: 0,
      };
    });
  return [...menus, ...widgets];
}

export function buildContractEditorView(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  contractType: string,
): ContractEditorView {
  editableContract(model, contractType);
  const menuOwners = new Set(
    draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [],
  );
  const widgetOwners = new Set(
    draft.contractWidgets[contractType] ?? model.contractWidgets[contractType] ?? [],
  );
  const assigned: TransferItem[] = [];
  const available: TransferItem[] = [];
  for (const item of contractItems(model)) {
    const owners = item.kind === "menu" ? menuOwners : widgetOwners;
    if (owners.has(item.id)) assigned.push(item);
    else available.push(item);
  }
  return { contractType, available, assigned };
}
