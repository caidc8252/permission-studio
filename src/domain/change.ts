import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const leafArraySchema = z.array(identifierSchema).max(2_000);
const addRemoveSchema = z.strictObject({
  add: leafArraySchema,
  remove: leafArraySchema,
});
const roleChangeSchema = z.strictObject({
  roleCode: identifierSchema.regex(/^preset_/i, "role code must use the preset_ prefix"),
  add: leafArraySchema,
  remove: leafArraySchema,
});
const contractChangeSchema = z.strictObject({
  contractType: identifierSchema.refine((value) => value !== "TEST", {
    message: "TEST is read-only",
  }),
  menus: addRemoveSchema,
  widgets: addRemoveSchema,
});

function findOverlap(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
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
    reason: z
      .string()
      .trim()
      .min(8)
      .max(500)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), {
        message: "reason must not contain control characters",
      }),
    roleChanges: z.array(roleChangeSchema).max(50),
    contractChanges: z.array(contractChangeSchema).max(20),
  })
  .superRefine((change, context) => {
    const roleCodes = new Set<string>();
    for (const [index, role] of change.roleChanges.entries()) {
      if (roleCodes.has(role.roleCode)) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index, "roleCode"],
          message: `duplicate role change for "${role.roleCode}"`,
        });
      }
      roleCodes.add(role.roleCode);
      const overlap = findOverlap(role.add, role.remove);
      if (overlap.length) {
        context.addIssue({
          code: "custom",
          path: ["roleChanges", index],
          message: `permissions cannot appear in both add and remove: ${overlap.join(", ")}`,
        });
      }
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
      change.roleChanges.some((role) => role.add.length || role.remove.length) ||
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
    reason: parsed.reason.trim(),
    roleChanges: parsed.roleChanges
      .map((role) => ({
        ...role,
        add: sortedUnique(role.add),
        remove: sortedUnique(role.remove),
      }))
      .filter((role) => role.add.length || role.remove.length)
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
