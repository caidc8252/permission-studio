import type { EffectivePermissionInput, EffectivePermissionResult } from "@/src/domain/model";

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function entitledContractCodes(
  input: EffectivePermissionInput,
  contractType: string,
  plan: string | null,
): Set<string> {
  const policy = input.contractPlanPolicies?.[contractType];
  const planKnown = policy !== undefined && plan !== null && policy.plans.includes(plan);
  const entitled = new Set<string>();

  for (const code of input.contractScope[contractType] ?? []) {
    const allowedPlans = policy?.permissionPlans[code];
    if (!allowedPlans || (planKnown && allowedPlans.includes(plan))) {
      entitled.add(code);
    }
  }
  return entitled;
}

export function explainEffectivePermissions(
  input: EffectivePermissionInput,
): EffectivePermissionResult {
  const permissionCodes = sortedUnique(input.permissionCodes);
  const selectedRoleCodes = new Set(input.selectedRoleCodes);
  const selectedRoles = input.roles.filter((role) => selectedRoleCodes.has(role.code));
  const entitledByContract = input.entitlements.map((entitlement) => ({
    contractType: entitlement.contractType,
    maximum: new Set(input.contractScope[entitlement.contractType] ?? []),
    entitled: entitledContractCodes(input, entitlement.contractType, entitlement.plan),
  }));
  const bypassedByAdminMembership = input.membershipType === "ADMIN";
  const decisions: EffectivePermissionResult["decisions"] = {};

  for (const code of permissionCodes) {
    const grantingContracts = sortedUnique(
      entitledByContract
        .filter((contract) => contract.entitled.has(code))
        .map((contract) => contract.contractType),
    );
    const grantingRoles = sortedUnique(
      selectedRoles.filter((role) => role.permissionCodes.includes(code)).map((role) => role.code),
    );
    const contractGranted = grantingContracts.length > 0;
    const roleGranted = grantingRoles.length > 0;
    const blockedByPlan =
      !contractGranted && entitledByContract.some((contract) => contract.maximum.has(code));

    decisions[code] = {
      code,
      effective: contractGranted && (bypassedByAdminMembership || roleGranted),
      roleGranted,
      contractGranted,
      blockedByPlan,
      bypassedByAdminMembership,
      grantingContracts,
      grantingRoles,
    };
  }

  return {
    effectiveCodes: permissionCodes.filter((code) => decisions[code]?.effective),
    decisions,
  };
}
