import { permissionStudioModelSchema, type PermissionStudioModel } from "../domain/model.ts";

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sortRecord<T>(
  record: Readonly<Record<string, T>>,
  mapValue: (value: T) => T = (value) => value,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, mapValue(value)]),
  );
}

export function buildPermissionStudioModel(input: unknown): PermissionStudioModel {
  const parsed = permissionStudioModelSchema.parse(input);
  return permissionStudioModelSchema.parse({
    ...parsed,
    permissionCodes: sortedUnique(parsed.permissionCodes),
    menuRegistry: sortRecord(parsed.menuRegistry),
    permissionRegistry: sortRecord(parsed.permissionRegistry),
    permissionAvailability: sortRecord(parsed.permissionAvailability, (conditions) =>
      [...conditions].sort((left, right) => left.contract.localeCompare(right.contract)),
    ),
    permissionAvailabilityBypassContracts: sortedUnique(
      parsed.permissionAvailabilityBypassContracts,
    ),
    contractScope: sortRecord(parsed.contractScope, sortedUnique),
    contractTypes: sortedUnique(parsed.contractTypes),
    contractMenus: sortRecord(parsed.contractMenus, sortedUnique),
    contractWidgets: sortRecord(parsed.contractWidgets, sortedUnique),
    contractPlanPolicies: sortRecord(parsed.contractPlanPolicies, (policy) => ({
      plans: [...new Set(policy.plans)],
      permissionPlans: sortRecord(policy.permissionPlans, sortedUnique),
    })),
    roles: parsed.roles
      .map((role) => ({
        ...role,
        permissionCodes: sortedUnique(role.permissionCodes),
      }))
      .sort((left, right) => left.code.localeCompare(right.code)),
    translations: {
      en: sortRecord(parsed.translations.en),
      "zh-CN": sortRecord(parsed.translations["zh-CN"]),
      ja: sortRecord(parsed.translations.ja),
    },
  });
}
