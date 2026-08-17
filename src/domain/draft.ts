import { normalizePermissionChange, type PermissionChange } from "@/src/domain/change";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  normalizeNewRole,
  roleI18nStem,
  validateRoleCode,
  type NewRoleDraft,
  type NewRoleInput,
} from "@/src/domain/new-role";

export interface PermissionDraft {
  newRoles: NewRoleDraft[];
  deletedRoleCodes?: string[];
  roleRenames?: Record<string, string>;
  rolePermissions: Record<string, string[]>;
  contractMenus: Record<string, string[]>;
  contractWidgets: Record<string, string[]>;
}

export interface ImpactDiff {
  addedRoles: NewRoleDraft[];
  deletedRoleCodes?: string[];
  renamedRoles: Array<{ oldCode: string; newCode: string }>;
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

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function editableRole(model: PermissionStudioModel, roleCode: string) {
  const role = model.roles.find((candidate) => candidate.code === roleCode);
  if (!role) throw new Error(`Unknown role "${roleCode}"`);
  if (!role.code.startsWith("preset_")) {
    throw new Error(`Role "${roleCode}" is not a preset role`);
  }
  return role;
}

function editableContract(model: PermissionStudioModel, contractType: string): void {
  if (!model.contractTypes.includes(contractType)) {
    throw new Error(`Unknown contract "${contractType}"`);
  }
  if (contractType === "TEST") throw new Error("TEST is read-only");
}

function validateContractOwner(
  model: PermissionStudioModel,
  kind: "menu" | "widget",
  ownerCode: string,
): void {
  if (kind === "menu" && !model.menuRegistry[ownerCode]) {
    throw new Error(`Unknown menu "${ownerCode}"`);
  }
  const widgetOwners = new Set(
    Object.values(model.permissionRegistry)
      .map((permission) => permission.belongToMenuCode)
      .filter((candidate) => !model.menuRegistry[candidate]),
  );
  if (kind === "widget" && !widgetOwners.has(ownerCode)) {
    throw new Error(`Unknown widget "${ownerCode}"`);
  }
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
    newRoles: [],
    roleRenames: {},
    rolePermissions: {},
    contractMenus: {},
    contractWidgets: {},
  };
}

export function originalRoleCode(draft: PermissionDraft, roleCode: string): string {
  return (
    Object.entries(draft.roleRenames ?? {}).find(
      ([, renamedCode]) => renamedCode === roleCode,
    )?.[0] ?? roleCode
  );
}

export function renameExistingRole(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  nextCode: string,
): PermissionDraft {
  editableRole(model, roleCode);
  const roleRenames = { ...(draft.roleRenames ?? {}) };
  const occupiedCodes = [
    ...draft.newRoles.map((role) => role.code),
    ...Object.entries(roleRenames)
      .filter(([sourceCode]) => sourceCode !== roleCode)
      .map(([, renamedCode]) => renamedCode),
  ];
  const error = validateRoleCode(model, nextCode, {
    excludeModelCode: roleCode,
    occupiedCodes,
  });
  if (error) throw new Error(error);
  const normalized = nextCode.trim();
  if (normalized === roleCode) delete roleRenames[roleCode];
  else roleRenames[roleCode] = normalized;
  return { ...draft, roleRenames };
}

export function addNewRole(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  input: NewRoleInput,
): PermissionDraft {
  const role = normalizeNewRole(model, draft.newRoles, input);
  return {
    ...draft,
    newRoles: [...draft.newRoles, role].sort((left, right) => left.roleId - right.roleId),
  };
}

export function updateNewRole(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  input: NewRoleInput,
): PermissionDraft {
  if (!draft.newRoles.some((role) => role.code === roleCode)) {
    throw new Error(`Unknown new role "${roleCode}"`);
  }
  const otherNewRoles = draft.newRoles.filter((role) => role.code !== roleCode);
  const role = normalizeNewRole(model, otherNewRoles, input);
  return {
    ...draft,
    newRoles: [...otherNewRoles, role].sort((left, right) => left.roleId - right.roleId),
  };
}

export function setNewRolePermissionMembership(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  permissionCodes: readonly string[],
): PermissionDraft {
  const role = draft.newRoles.find((candidate) => candidate.code === roleCode);
  if (!role) throw new Error(`Unknown new role "${roleCode}"`);
  const permissions = new Set(model.permissionCodes);
  const next = sortedUnique(permissionCodes);
  if (next.some((code) => !permissions.has(code))) throw new Error("Unknown permission");
  return {
    ...draft,
    newRoles: draft.newRoles.map((candidate) =>
      candidate.code === roleCode ? { ...candidate, permissionCodes: next } : candidate,
    ),
  };
}

export function setRolePermissionMembership(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  permissionCodes: readonly string[],
): PermissionDraft {
  const role = editableRole(model, roleCode);
  const next = sortedUnique(permissionCodes);
  for (const code of next) {
    if (!model.permissionRegistry[code]) throw new Error(`Unknown permission "${code}"`);
  }
  const rolePermissions = { ...draft.rolePermissions };
  if (sameValues(next, role.permissionCodes)) delete rolePermissions[roleCode];
  else rolePermissions[roleCode] = next;
  return { ...draft, rolePermissions };
}

export function setContractOwnerMembership(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  contractType: string,
  kind: "menu" | "widget",
  ownerCodes: readonly string[],
): PermissionDraft {
  editableContract(model, contractType);
  const next = sortedUnique(ownerCodes);
  for (const ownerCode of next) validateContractOwner(model, kind, ownerCode);

  const draftField = kind === "menu" ? "contractMenus" : "contractWidgets";
  const modelField = kind === "menu" ? model.contractMenus : model.contractWidgets;
  const overrides = { ...draft[draftField] };
  if (sameValues(next, modelField[contractType] ?? [])) delete overrides[contractType];
  else overrides[contractType] = next;
  return { ...draft, [draftField]: overrides };
}

export function discardRoleDraft(draft: PermissionDraft, roleCode: string): PermissionDraft {
  const rolePermissions = { ...draft.rolePermissions };
  const roleRenames = { ...(draft.roleRenames ?? {}) };
  delete rolePermissions[roleCode];
  delete roleRenames[roleCode];
  const next: PermissionDraft = {
    ...draft,
    newRoles: draft.newRoles.filter((role) => role.code !== roleCode),
    deletedRoleCodes: (draft.deletedRoleCodes ?? []).filter((code) => code !== roleCode),
    roleRenames,
    rolePermissions,
  };
  if (!next.deletedRoleCodes?.length) delete next.deletedRoleCodes;
  return next;
}

export function deleteRole(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
): PermissionDraft {
  if (draft.newRoles.some((role) => role.code === roleCode)) {
    return discardRoleDraft(draft, roleCode);
  }
  editableRole(model, roleCode);
  const next = discardRoleDraft(draft, roleCode);
  return {
    ...next,
    deletedRoleCodes: sortedUnique([...(next.deletedRoleCodes ?? []), roleCode]),
  };
}

export function discardContractDraft(
  draft: PermissionDraft,
  contractType: string,
): PermissionDraft {
  const contractMenus = { ...draft.contractMenus };
  const contractWidgets = { ...draft.contractWidgets };
  delete contractMenus[contractType];
  delete contractWidgets[contractType];
  return { ...draft, contractMenus, contractWidgets };
}

export type DraftItemRef =
  | { kind: "permission"; ownerCode: string; code: string }
  | { kind: "menu" | "widget"; ownerCode: string; code: string };

export function discardDraftItem(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  item: DraftItemRef,
): PermissionDraft {
  if (item.kind === "permission") {
    const newRole = draft.newRoles.find((role) => role.code === item.ownerCode);
    if (newRole) {
      if (!model.permissionRegistry[item.code]) {
        throw new Error(`Unknown permission "${item.code}"`);
      }
      return setNewRolePermissionMembership(
        draft,
        model,
        item.ownerCode,
        newRole.permissionCodes.filter((code) => code !== item.code),
      );
    }
    const role = editableRole(model, item.ownerCode);
    if (!model.permissionRegistry[item.code]) {
      throw new Error(`Unknown permission "${item.code}"`);
    }
    const current = draft.rolePermissions[item.ownerCode] ?? role.permissionCodes;
    const next = role.permissionCodes.includes(item.code)
      ? [...current, item.code]
      : current.filter((code) => code !== item.code);
    return setRolePermissionMembership(draft, model, item.ownerCode, next);
  }

  editableContract(model, item.ownerCode);
  validateContractOwner(model, item.kind, item.code);
  const baseline =
    item.kind === "menu"
      ? (model.contractMenus[item.ownerCode] ?? [])
      : (model.contractWidgets[item.ownerCode] ?? []);
  const current =
    item.kind === "menu"
      ? (draft.contractMenus[item.ownerCode] ?? baseline)
      : (draft.contractWidgets[item.ownerCode] ?? baseline);
  const next = baseline.includes(item.code)
    ? [...current, item.code]
    : current.filter((code) => code !== item.code);
  return setContractOwnerMembership(draft, model, item.ownerCode, item.kind, next);
}

export function toggleRolePermission(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  roleCode: string,
  permissionCode: string,
): PermissionDraft {
  const role = editableRole(model, roleCode);
  const current = draft.rolePermissions[roleCode] ?? role.permissionCodes;
  return setRolePermissionMembership(draft, model, roleCode, toggle(current, permissionCode));
}

export function toggleContractOwner(
  draft: PermissionDraft,
  model: PermissionStudioModel,
  contractType: string,
  owner: string,
  kind: "menu" | "widget",
): PermissionDraft {
  const draftField = kind === "menu" ? "contractMenus" : "contractWidgets";
  const modelField = kind === "menu" ? model.contractMenus : model.contractWidgets;
  const current = draft[draftField][contractType] ?? modelField[contractType] ?? [];
  return setContractOwnerMembership(draft, model, contractType, kind, toggle(current, owner));
}

export function applyDraftToModel(
  model: PermissionStudioModel,
  draft: PermissionDraft,
): PermissionStudioModel {
  const newRoles = draft.newRoles.map((role) => {
    const stem = roleI18nStem(role.code);
    return {
      roleId: role.roleId,
      code: role.code,
      roleName: `role.${stem}`,
      remark: `role.${stem}Desc`,
      permissionCodes: role.permissionCodes,
    };
  });
  const translationEntries = (locale: "en" | "zh-CN" | "ja") =>
    Object.fromEntries(
      draft.newRoles.flatMap((role) => {
        const stem = roleI18nStem(role.code);
        return [
          [`role.${stem}`, role.names[locale]],
          [`role.${stem}Desc`, role.descriptions?.[locale] ?? role.names[locale]],
        ];
      }),
    );
  return {
    ...model,
    roles: [
      ...model.roles
        .filter((role) => !(draft.deletedRoleCodes ?? []).includes(role.code))
        .map((role) => ({
          ...role,
          code: draft.roleRenames?.[role.code] ?? role.code,
          permissionCodes: draft.rolePermissions[role.code] ?? role.permissionCodes,
        })),
      ...newRoles,
    ].sort((left, right) => left.code.localeCompare(right.code)),
    translations: {
      en: { ...model.translations.en, ...translationEntries("en") },
      "zh-CN": { ...model.translations["zh-CN"], ...translationEntries("zh-CN") },
      ja: { ...model.translations.ja, ...translationEntries("ja") },
    },
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
    addedRoles: [...draft.newRoles],
    deletedRoleCodes: sortedUnique(draft.deletedRoleCodes ?? []),
    renamedRoles: Object.entries(draft.roleRenames ?? {})
      .filter(([oldCode, newCode]) => oldCode !== newCode)
      .map(([oldCode, newCode]) => ({ oldCode, newCode }))
      .sort((left, right) => left.oldCode.localeCompare(right.oldCode)),
    addedRolePermissions: [],
    removedRolePermissions: [],
    addedContractOwners: [],
    removedContractOwners: [],
    scenarios: [],
  };

  for (const role of draft.newRoles) {
    impact.addedRolePermissions.push(
      ...role.permissionCodes.map((code) => ({ roleCode: role.code, code })),
    );
  }

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
  for (const role of impact.addedRoles) scenarios.add(`role:${role.code}`);
  for (const roleCode of impact.deletedRoleCodes ?? []) scenarios.add(`role:${roleCode}`);
  for (const role of impact.renamedRoles) scenarios.add(`role:${role.newCode}`);
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
  metadata: { requestId: string; title: string; reason: string },
): PermissionChange {
  const changedRoleCodes = new Set([
    ...Object.keys(draft.rolePermissions),
    ...Object.keys(draft.roleRenames ?? {}),
  ]);
  const deletedRoleCodes = new Set(draft.deletedRoleCodes ?? []);
  const roleChanges = [...changedRoleCodes]
    .filter((roleCode) => !deletedRoleCodes.has(roleCode))
    .map((roleCode) => {
      const role = model.roles.find((candidate) => candidate.code === roleCode);
      if (!role) throw new Error(`Unknown role "${roleCode}"`);
      const codes = draft.rolePermissions[roleCode] ?? role.permissionCodes;
      return {
        roleCode,
        newRoleCode: draft.roleRenames?.[roleCode],
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
    title: metadata.title,
    reason: metadata.reason,
    newRoles: draft.newRoles,
    ...(deletedRoleCodes.size ? { deletedRoleCodes: [...deletedRoleCodes].sort() } : {}),
    roleChanges,
    contractChanges,
  });
}
