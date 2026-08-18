import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const leafArraySchema = z.array(identifierSchema).max(2_000);
const addRemoveSchema = z.strictObject({
  add: leafArraySchema,
  remove: leafArraySchema,
});
const roleNamesSchema = z.strictObject({
  en: z.string().trim().min(1).max(100),
  "zh-CN": z.string().trim().min(1).max(100),
  ja: z.string().trim().min(1).max(100),
});
const roleDescriptionsSchema = z.strictObject({
  en: z.string().trim().min(1).max(500),
  "zh-CN": z.string().trim().min(1).max(500),
  ja: z.string().trim().min(1).max(500),
});
const roleChangeSchema = z.strictObject({
  roleCode: identifierSchema.regex(/^preset_/i, "role code must use the preset_ prefix"),
  newRoleCode: identifierSchema
    .regex(
      /^preset_[a-z0-9_]+$/,
      "new role code must use the preset_ prefix and lowercase identifiers",
    )
    .optional(),
  roleNameKey: identifierSchema.regex(/^role\.[A-Za-z_$][A-Za-z0-9_$]*$/).optional(),
  names: roleNamesSchema.optional(),
  roleDescriptionKey: identifierSchema.regex(/^role\.[A-Za-z_$][A-Za-z0-9_$]*Desc$/).optional(),
  descriptions: roleDescriptionsSchema.optional(),
  add: leafArraySchema,
  remove: leafArraySchema,
});
const newRoleSchema = z.strictObject({
  roleId: z.number().int().min(1).max(999),
  code: identifierSchema.regex(
    /^preset_[a-z0-9_]+$/,
    "role code must use the preset_ prefix and lowercase identifiers",
  ),
  names: roleNamesSchema,
  descriptions: roleDescriptionsSchema.optional(),
  permissionCodes: leafArraySchema,
});
const contractChangeSchema = z.strictObject({
  contractType: identifierSchema.refine((value) => value !== "TEST", {
    message: "TEST is read-only",
  }),
  menus: addRemoveSchema,
  widgets: addRemoveSchema,
});
const deletedRoleCodeSchema = identifierSchema.regex(
  /^preset_[a-z0-9_]+$/,
  "deleted role code must use the preset_ prefix and lowercase identifiers",
);

function findOverlap(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export const permissionChangeSchema = z
  .strictObject({
    version: z.literal(1),
    requestId: z
      .string()
      .length(26)
      .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    baseSha: z
      .string()
      .length(40)
      .regex(/^[0-9a-f]+$/),
    title: z
      .string()
      .trim()
      .min(8)
      .max(120)
      .refine((value) => !hasControlCharacter(value), {
        message: "title must not contain control characters",
      }),
    reason: z
      .string()
      .trim()
      .min(8)
      .max(500)
      .refine((value) => !hasControlCharacter(value), {
        message: "reason must not contain control characters",
      }),
    newRoles: z.array(newRoleSchema).max(50),
    deletedRoleCodes: z.array(deletedRoleCodeSchema).max(50).optional(),
    roleChanges: z.array(roleChangeSchema).max(50),
    contractChanges: z.array(contractChangeSchema).max(20),
  })
  .superRefine((change, context) => {
    const newRoleCodes = new Set<string>();
    const newRoleIds = new Set<number>();
    const newRoleNames = {
      en: new Set<string>(),
      "zh-CN": new Set<string>(),
      ja: new Set<string>(),
    };
    for (const [index, role] of change.newRoles.entries()) {
      const code = role.code.toLocaleLowerCase();
      if (newRoleCodes.has(code)) {
        context.addIssue({
          code: "custom",
          path: ["newRoles", index, "code"],
          message: `duplicate new role code "${role.code}"`,
        });
      }
      if (newRoleIds.has(role.roleId)) {
        context.addIssue({
          code: "custom",
          path: ["newRoles", index, "roleId"],
          message: `duplicate new role id "${role.roleId}"`,
        });
      }
      for (const locale of ["en", "zh-CN", "ja"] as const) {
        const name = role.names[locale].trim().toLocaleLowerCase();
        if (newRoleNames[locale].has(name)) {
          context.addIssue({
            code: "custom",
            path: ["newRoles", index, "names", locale],
            message: `duplicate new role ${locale} name "${role.names[locale]}"`,
          });
        }
        newRoleNames[locale].add(name);
      }
      newRoleCodes.add(code);
      newRoleIds.add(role.roleId);
    }

    const roleCodes = new Set<string>();
    const renamedRoleCodes = new Set<string>();
    for (const [index, role] of change.roleChanges.entries()) {
      if (roleCodes.has(role.roleCode)) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index, "roleCode"],
          message: `duplicate role change for "${role.roleCode}"`,
        });
      }
      roleCodes.add(role.roleCode);
      if (Boolean(role.names) !== Boolean(role.roleNameKey)) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index],
          message: "role names and role name key must be provided together",
        });
      }
      if (Boolean(role.descriptions) !== Boolean(role.roleDescriptionKey)) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index],
          message: "role descriptions and role description key must be provided together",
        });
      }
      if (role.newRoleCode) {
        const normalized = role.newRoleCode.toLocaleLowerCase();
        if (normalized === role.roleCode.toLocaleLowerCase()) {
          context.addIssue({
            code: "custom",
            path: ["roleChanges", index, "newRoleCode"],
            message: "new role code must differ from the current role code",
          });
        }
        if (renamedRoleCodes.has(normalized) || newRoleCodes.has(normalized)) {
          context.addIssue({
            code: "custom",
            path: ["roleChanges", index, "newRoleCode"],
            message: `duplicate renamed role code "${role.newRoleCode}"`,
          });
        }
        renamedRoleCodes.add(normalized);
      }
      const overlap = findOverlap(role.add, role.remove);
      if (overlap.length) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index],
          message: `permissions cannot appear in both add and remove: ${overlap.join(", ")}`,
        });
      }
    }

    const deletedRoleCodes = new Set<string>();
    for (const [index, roleCode] of (change.deletedRoleCodes ?? []).entries()) {
      if (deletedRoleCodes.has(roleCode)) {
        context.addIssue({
          code: "custom",
          path: ["deletedRoleCodes", index],
          message: `duplicate deleted role code "${roleCode}"`,
        });
      }
      if (newRoleCodes.has(roleCode.toLocaleLowerCase()) || roleCodes.has(roleCode)) {
        context.addIssue({
          code: "custom",
          path: ["deletedRoleCodes", index],
          message: `deleted role "${roleCode}" cannot also be added or modified`,
        });
      }
      deletedRoleCodes.add(roleCode);
    }

    const contractTypes = new Set<string>();
    for (const [index, contract] of change.contractChanges.entries()) {
      if (contractTypes.has(contract.contractType)) {
        context.addIssue({
          code: "custom",
          path: ["contractChanges", index, "contractType"],
          message: `duplicate contract change for "${contract.contractType}"`,
        });
      }
      contractTypes.add(contract.contractType);
      for (const field of ["menus", "widgets"] as const) {
        const overlap = findOverlap(contract[field].add, contract[field].remove);
        if (overlap.length) {
          context.addIssue({
            code: "custom",
            path: ["contractChanges", index, field],
            message: `${field} cannot appear in both add and remove: ${overlap.join(", ")}`,
          });
        }
      }
    }

    const hasChange =
      change.newRoles.length > 0 ||
      Boolean(change.deletedRoleCodes?.length) ||
      change.roleChanges.some(
        (role) =>
          role.newRoleCode ||
          role.names ||
          role.descriptions ||
          role.add.length ||
          role.remove.length,
      ) ||
      change.contractChanges.some(
        (contract) =>
          contract.menus.add.length ||
          contract.menus.remove.length ||
          contract.widgets.add.length ||
          contract.widgets.remove.length,
      );
    if (!hasChange) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "empty change is not allowed",
      });
    }
  });

export type PermissionChange = z.infer<typeof permissionChangeSchema>;

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function normalizePermissionChange(input: unknown): PermissionChange {
  const parsed = permissionChangeSchema.parse(input);
  return permissionChangeSchema.parse({
    ...parsed,
    title: parsed.title.trim(),
    reason: parsed.reason.trim(),
    newRoles: parsed.newRoles
      .map((role) => ({
        ...role,
        names: {
          en: role.names.en.trim(),
          "zh-CN": role.names["zh-CN"].trim(),
          ja: role.names.ja.trim(),
        },
        ...(role.descriptions
          ? {
              descriptions: {
                en: role.descriptions.en.trim(),
                "zh-CN": role.descriptions["zh-CN"].trim(),
                ja: role.descriptions.ja.trim(),
              },
            }
          : {}),
        permissionCodes: sortedUnique(role.permissionCodes),
      }))
      .sort((left, right) => left.roleId - right.roleId),
    ...(parsed.deletedRoleCodes?.length
      ? { deletedRoleCodes: sortedUnique(parsed.deletedRoleCodes) }
      : {}),
    roleChanges: parsed.roleChanges
      .map((role) => ({
        ...role,
        ...(role.names
          ? {
              names: {
                en: role.names.en.trim(),
                "zh-CN": role.names["zh-CN"].trim(),
                ja: role.names.ja.trim(),
              },
            }
          : {}),
        ...(role.descriptions
          ? {
              descriptions: {
                en: role.descriptions.en.trim(),
                "zh-CN": role.descriptions["zh-CN"].trim(),
                ja: role.descriptions.ja.trim(),
              },
            }
          : {}),
        add: sortedUnique(role.add),
        remove: sortedUnique(role.remove),
      }))
      .filter(
        (role) =>
          role.newRoleCode ||
          role.names ||
          role.descriptions ||
          role.add.length ||
          role.remove.length,
      )
      .sort((left, right) => left.roleCode.localeCompare(right.roleCode)),
    contractChanges: parsed.contractChanges
      .map((contract) => ({
        ...contract,
        menus: {
          add: sortedUnique(contract.menus.add),
          remove: sortedUnique(contract.menus.remove),
        },
        widgets: {
          add: sortedUnique(contract.widgets.add),
          remove: sortedUnique(contract.widgets.remove),
        },
      }))
      .filter(
        (contract) =>
          contract.menus.add.length ||
          contract.menus.remove.length ||
          contract.widgets.add.length ||
          contract.widgets.remove.length,
      )
      .sort((left, right) => left.contractType.localeCompare(right.contractType)),
  });
}
