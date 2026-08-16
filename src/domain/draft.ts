import { normalizePermissionChange, type PermissionChange } from "@/src/domain/change";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface PermissionDraft {
  rolePermissions: Record<string, string[]>;
  contractMenus: Record<string, string[]>;
  contractWidgets: Record<string, string[]>;
}

export interface ImpactDiff {
  addedRolePermissions: Array<{ roleCode: string; code: string }>;
  removedRolePermissions: Array<{ roleCode: string; code: string }>;
  addedContractOwners: Array<{
    contractType: string;
    owner: string;
    kind: "menu" | "widget";
  }>;
  removedContractOwners: Array<{
    contractType: string;
    owner: string;
    kind: "menu" | "widget";
  }>;
  scenarios: string[];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function toggle(values: readonly string[], value: string): string[] {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next].sort();
}

function differences(
  current: readonly string[],
  baseline: readonly string[],
): { add: string[]; remove: string[] } {
  const currentSet = new Set(current);
  const baselineSet = new Set(baseline);
  return {
    add: sortedUnique(current.filter((value) => !baselineSet.has(value))),
    remove: sortedUnique(baseline.filter((value) => !currentSet.has(value))),
  };
}

export function createEmptyDraft(): PermissionDraft {
  return {
    rolePermissions: {},
    contractMenus: {},
    contractWidgets: {},
  };
}

export function toggleRolePermission(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  permissionCode: string,
): PermissionDraft {
  const role = model.roles.find((candidate) => candidate.code === roleCode);
  if (!role) throw new Error(`Unknown role "${roleCode}"`);
  if (!role.code.startsWith("preset_")) {
    throw new Error(`Role "${roleCode}" is not a preset role`);
  }
  if (!model.permissionRegistry[permissionCode]) {
    throw new Error(`Unknown permission "${permissionCode}"`);
  }
  const current = draft.rolePermissions[roleCode] ?? role.permissionCodes;
  return {
    ...draft,
    rolePermissions: {
      ...draft.rolePermissions,
      [roleCode]: toggle(current, permissionCode),
    },
  };
}

export function toggleContractOwner(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  contractType: string,
  owner: string,
  kind: "menu" | "widget",
): PermissionDraft {
  if (!model.contractTypes.includes(contractType)) {
    throw new Error(`Unknown contract "${contractType}"`);
  }
  if (contractType === "TEST") throw new Error("TEST is read-only");

  if (kind === "menu" && !model.menuRegistry[owner]) {
    throw new Error(`Unknown menu "${owner}"`);
  }
  const widgetOwners = new Set(
    Object.values(model.permissionRegistry)
      .map((permission) => permission.belongToMenuCode)
      .filter((candidate) => !model.menuRegistry[candidate]),
  );
  if (kind === "widget" && !widgetOwners.has(owner)) {
    throw new Error(`Unknown widget "${owner}"`);
  }

  const draftField = kind === "menu" ? "contractMenus" : "contractWidgets";
  const modelField = kind === "menu" ? model.contractMenus : model.contractWidgets;
  const current = draft[draftField][contractType] ?? modelField[contractType] ?? [];
  return {
    ...draft,
    [draftField]: {
      ...draft[draftField],
      [contractType]: toggle(current, owner),
    },
  };
}

export function applyDraftToModel(
  model: PermissionStudioModel,
  draft: PermissionDraft,
): PermissionStudioModel {
  return {
    ...model,
    roles: model.roles.map((role) => ({
      ...role,
      permissionCodes: draft.rolePermissions[role.code] ?? role.permissionCodes,
    })),
    contractMenus: {
      ...model.contractMenus,
      ...draft.contractMenus,
    },
    contractWidgets: {
      ...model.contractWidgets,
      ...draft.contractWidgets,
    },
  };
}

export function buildImpactDiff(model: PermissionStudioModel, draft: PermissionDraft): ImpactDiff {
  const impact: ImpactDiff = {
    addedRolePermissions: [],
    removedRolePermissions: [],
    addedContractOwners: [],
    removedContractOwners: [],
    scenarios: [],
  };

  for (const [roleCode, codes] of Object.entries(draft.rolePermissions)) {
    const role = model.roles.find((candidate) => candidate.code === roleCode);
    if (!role) continue;
    const diff = differences(codes, role.permissionCodes);
    impact.addedRolePermissions.push(...diff.add.map((code) => ({ roleCode, code })));
    impact.removedRolePermissions.push(...diff.remove.map((code) => ({ roleCode, code })));
  }

  for (const kind of ["menu", "widget"] as const) {
    const field = kind === "menu" ? "contractMenus" : "contractWidgets";
    for (const [contractType, owners] of Object.entries(draft[field])) {
      const diff = differences(owners, model[field][contractType] ?? []);
      impact.addedContractOwners.push(...diff.add.map((owner) => ({ contractType, owner, kind })));
      impact.removedContractOwners.push(
        ...diff.remove.map((owner) => ({ contractType, owner, kind })),
      );
    }
  }

  const scenarios = new Set<string>();
  for (const item of [...impact.addedRolePermissions, ...impact.removedRolePermissions]) {
    scenarios.add(`role:${item.roleCode}`);
  }
  for (const item of [...impact.addedContractOwners, ...impact.removedContractOwners]) {
    scenarios.add(`contract:${item.contractType}`);
  }
  impact.scenarios = [...scenarios].sort();
  return impact;
}

export function buildPermissionChange(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  metadata: { requestId: string; reason: string },
): PermissionChange {
  const roleChanges = Object.entries(draft.rolePermissions).map(([roleCode, codes]) => {
    const role = model.roles.find((candidate) => candidate.code === roleCode);
    if (!role) throw new Error(`Unknown role "${roleCode}"`);
    return {
      roleCode,
      ...differences(codes, role.permissionCodes),
    };
  });
  const contractTypes = new Set([
    ...Object.keys(draft.contractMenus),
    ...Object.keys(draft.contractWidgets),
  ]);
  const contractChanges = [...contractTypes].map((contractType) => ({
    contractType,
    menus: differences(
      draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [],
      model.contractMenus[contractType] ?? [],
    ),
    widgets: differences(
      draft.contractWidgets[contractType] ?? model.contractWidgets[contractType] ?? [],
      model.contractWidgets[contractType] ?? [],
    ),
  }));

  return normalizePermissionChange({
    version: 1,
    requestId: metadata.requestId,
    baseSha: model.sourceSha,
    reason: metadata.reason,
    roleChanges,
    contractChanges,
  });
}
