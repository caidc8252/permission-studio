import { z } from "zod";

import {
  createEmptyDraft,
  deleteRole,
  renameExistingRole,
  setExistingRoleNames,
  setContractOwnerMembership,
  setRolePermissionMembership,
  type PermissionDraft,
} from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validateNewRole, type NewRoleDraft } from "@/src/domain/new-role";

const identifierSchema = z.string().min(1).max(200);
const identifierArraySchema = z.array(identifierSchema).max(2_000);
const editableRoleCodeSchema = identifierSchema.regex(/^preset_/);
const editableContractTypeSchema = identifierSchema.refine((value) => value !== "TEST", {
  message: "TEST is read-only",
});
const roleNamesSchema = z.strictObject({
  en: z.string().min(1).max(100),
  "zh-CN": z.string().min(1).max(100),
  ja: z.string().min(1).max(100),
});
const roleDescriptionsSchema = z.strictObject({
  en: z.string().min(1).max(500),
  "zh-CN": z.string().min(1).max(500),
  ja: z.string().min(1).max(500),
});
const newRoleSchema = z.union([
  z.strictObject({
    roleId: z.number().int().min(1).max(999),
    code: editableRoleCodeSchema,
    names: roleNamesSchema,
    descriptions: roleDescriptionsSchema.optional(),
    permissionCodes: identifierArraySchema,
  }),
  z
    .strictObject({
      roleId: z.number().int().min(1).max(999),
      code: editableRoleCodeSchema,
      name: z.string().min(1).max(100),
      permissionCodes: identifierArraySchema,
    })
    .transform(({ name, ...role }) => ({
      ...role,
      names: { en: name, "zh-CN": name, ja: name },
    })),
]);
const draftSchema = z.strictObject({
  newRoles: z.array(newRoleSchema).max(50).default([]),
  deletedRoleCodes: z.array(editableRoleCodeSchema).max(50).optional(),
  roleRenames: z.record(editableRoleCodeSchema, editableRoleCodeSchema).default({}),
  roleNames: z.record(editableRoleCodeSchema, roleNamesSchema).default({}),
  rolePermissions: z.record(editableRoleCodeSchema, identifierArraySchema),
  contractMenus: z.record(editableContractTypeSchema, identifierArraySchema),
  contractWidgets: z.record(editableContractTypeSchema, identifierArraySchema),
});
const sourceShaSchema = z
  .string()
  .length(40)
  .regex(/^[0-9a-f]+$/);
const storedDraftSchema = z.strictObject({
  version: z.literal(1),
  sourceSha: sourceShaSchema,
  draft: draftSchema,
});

export interface StoredDraft {
  version: 1;
  sourceSha: string;
  draft: PermissionDraft;
}

export interface DraftConflict {
  kind: "role" | "permission" | "contract" | "menu" | "widget";
  ownerCode: string;
  code: string;
}

export interface DraftRebaseResult {
  draft: PermissionDraft;
  conflicts: DraftConflict[];
}

export function draftStorageKey(sourceSha: string): string {
  return `permission-studio:draft:${sourceShaSchema.parse(sourceSha)}`;
}

export function serializeDraftSession(stored: StoredDraft): string {
  return JSON.stringify(storedDraftSchema.parse(stored));
}

export function restoreDraftSession(raw: string | null, expectedSha: string): StoredDraft | null {
  if (!raw || !sourceShaSchema.safeParse(expectedSha).success) return null;
  try {
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.sourceSha !== expectedSha) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function sortedEntries(record: Record<string, string[]>): Array<[string, string[]]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function membershipDiff(
  baseline: readonly string[],
  membership: readonly string[],
): { add: string[]; remove: string[] } {
  const baselineSet = new Set(baseline);
  const membershipSet = new Set(membership);
  return {
    add: [...membershipSet].filter((code) => !baselineSet.has(code)).sort(),
    remove: [...baselineSet].filter((code) => !membershipSet.has(code)).sort(),
  };
}

function isEditableRole(model: PermissionStudioModel, roleCode: string): boolean {
  return Boolean(model.roles.find((role) => role.code === roleCode)?.code.startsWith("preset_"));
}

function isEditableContract(model: PermissionStudioModel, contractType: string): boolean {
  return contractType !== "TEST" && model.contractTypes.includes(contractType);
}

function hasContractOwner(
  model: PermissionStudioModel,
  kind: "menu" | "widget",
  ownerCode: string,
): boolean {
  if (kind === "menu") return Boolean(model.menuRegistry[ownerCode]);
  return Object.values(model.permissionRegistry).some(
    (permission) => permission.belongToMenuCode === ownerCode && !model.menuRegistry[ownerCode],
  );
}

function replayMembership(
  oldBaseline: readonly string[],
  oldMembership: readonly string[],
  newBaseline: readonly string[],
  isValid: (code: string) => boolean,
  conflict: (code: string) => DraftConflict,
  conflicts: DraftConflict[],
): string[] {
  const next = new Set(newBaseline);
  const diff = membershipDiff(oldBaseline, oldMembership);
  for (const code of diff.remove) {
    if (isValid(code)) next.delete(code);
    else conflicts.push(conflict(code));
  }
  for (const code of diff.add) {
    if (isValid(code)) next.add(code);
    else conflicts.push(conflict(code));
  }
  return [...next].sort();
}

export function rebasePermissionDraft(
  oldModel: PermissionStudioModel,
  newModel: PermissionStudioModel,
  draft: PermissionDraft,
): DraftRebaseResult {
  let rebased = createEmptyDraft();
  const conflicts: DraftConflict[] = [];

  for (const role of draft.newRoles as NewRoleDraft[]) {
    const permissionCodes = role.permissionCodes.filter((code) => {
      if (newModel.permissionRegistry[code]) return true;
      conflicts.push({ kind: "permission", ownerCode: role.code, code });
      return false;
    });
    const errors = validateNewRole(newModel, rebased.newRoles, { ...role, permissionCodes });
    if (
      errors.roleId ||
      errors.code ||
      errors.nameEn ||
      errors.nameZhCn ||
      errors.nameJa ||
      errors.descriptionEn ||
      errors.descriptionZhCn ||
      errors.descriptionJa
    ) {
      conflicts.push({ kind: "role", ownerCode: role.code, code: role.code });
      continue;
    }
    rebased = {
      ...rebased,
      newRoles: [...rebased.newRoles, { ...role, permissionCodes }],
    };
  }

  for (const roleCode of [...(draft.deletedRoleCodes ?? [])].sort()) {
    if (!isEditableRole(oldModel, roleCode)) {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: roleCode });
      continue;
    }
    if (!isEditableRole(newModel, roleCode)) continue;
    rebased = deleteRole(rebased, newModel, roleCode);
  }

  for (const [roleCode, newRoleCode] of Object.entries(draft.roleRenames ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if ((draft.deletedRoleCodes ?? []).includes(roleCode)) continue;
    if (!isEditableRole(oldModel, roleCode) || !isEditableRole(newModel, roleCode)) {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: roleCode });
      continue;
    }
    try {
      rebased = renameExistingRole(rebased, newModel, roleCode, newRoleCode);
    } catch {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: newRoleCode });
    }
  }

  for (const [roleCode, names] of Object.entries(draft.roleNames ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if ((draft.deletedRoleCodes ?? []).includes(roleCode)) continue;
    if (!isEditableRole(oldModel, roleCode) || !isEditableRole(newModel, roleCode)) {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: roleCode });
      continue;
    }
    try {
      rebased = setExistingRoleNames(rebased, newModel, roleCode, names);
    } catch {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: roleCode });
    }
  }

  for (const [roleCode, oldMembership] of sortedEntries(draft.rolePermissions)) {
    if ((draft.deletedRoleCodes ?? []).includes(roleCode)) continue;
    const oldRole = oldModel.roles.find((role) => role.code === roleCode);
    if (!oldRole || !isEditableRole(newModel, roleCode)) {
      conflicts.push({ kind: "role", ownerCode: roleCode, code: roleCode });
      continue;
    }
    const newRole = newModel.roles.find((role) => role.code === roleCode)!;
    const membership = replayMembership(
      oldRole.permissionCodes,
      oldMembership,
      newRole.permissionCodes,
      (code) => Boolean(newModel.permissionRegistry[code]),
      (code) => ({ kind: "permission", ownerCode: roleCode, code }),
      conflicts,
    );
    rebased = setRolePermissionMembership(rebased, newModel, roleCode, membership);
  }

  for (const kind of ["menu", "widget"] as const) {
    const draftField = kind === "menu" ? "contractMenus" : "contractWidgets";
    const oldField = kind === "menu" ? oldModel.contractMenus : oldModel.contractWidgets;
    const newField = kind === "menu" ? newModel.contractMenus : newModel.contractWidgets;
    for (const [contractType, oldMembership] of sortedEntries(draft[draftField])) {
      if (
        !oldModel.contractTypes.includes(contractType) ||
        !isEditableContract(newModel, contractType)
      ) {
        conflicts.push({ kind: "contract", ownerCode: contractType, code: contractType });
        continue;
      }
      const membership = replayMembership(
        oldField[contractType] ?? [],
        oldMembership,
        newField[contractType] ?? [],
        (code) => hasContractOwner(newModel, kind, code),
        (code) => ({ kind, ownerCode: contractType, code }),
        conflicts,
      );
      rebased = setContractOwnerMembership(rebased, newModel, contractType, kind, membership);
    }
  }

  return {
    draft: rebased,
    conflicts: conflicts.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.ownerCode.localeCompare(right.ownerCode) ||
        left.code.localeCompare(right.code),
    ),
  };
}
