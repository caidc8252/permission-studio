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

function permissionItems(
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
  const assigned = permissionItems(
    model,
    model.permissionCodes.filter((code) => assignedCodes.has(code)),
  );
  const available = permissionItems(
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
