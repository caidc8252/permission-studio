export interface ContractEntitlement {
  contractType: string;
  plan: string | null;
}

export interface ContractPlanPolicy {
  plans: readonly string[];
  permissionPlans: Readonly<Record<string, readonly string[]>>;
}

export type ContractPlanPolicies = Readonly<Record<string, ContractPlanPolicy>>;

export interface PermissionRoleInput {
  code: string;
  permissionCodes: readonly string[];
}

export type PermissionMembershipType = "ADMIN" | "MEMBER";

export interface EffectivePermissionInput {
  permissionCodes: readonly string[];
  contractScope: Readonly<Record<string, readonly string[]>>;
  contractPlanPolicies?: ContractPlanPolicies;
  entitlements: readonly ContractEntitlement[];
  roles: readonly PermissionRoleInput[];
  selectedRoleCodes: readonly string[];
  membershipType: PermissionMembershipType;
}

export interface PermissionDecision {
  code: string;
  effective: boolean;
  roleGranted: boolean;
  contractGranted: boolean;
  blockedByPlan: boolean;
  bypassedByAdminMembership: boolean;
  grantingContracts: string[];
  grantingRoles: string[];
}

export interface EffectivePermissionResult {
  effectiveCodes: string[];
  decisions: Record<string, PermissionDecision>;
}
