import { explainEffectivePermissions } from "@/src/domain/effective-permissions";
import type {
  ContractEntitlement,
  PermissionDecision,
  PermissionMembershipType,
  PermissionStudioModel,
} from "@/src/domain/model";

export interface WorkbenchScenario {
  membershipType: PermissionMembershipType;
  entitlements: readonly ContractEntitlement[];
  roleCodes: readonly string[];
}

export type WorkbenchPermissionStatus =
  | "effective"
  | "plan-blocked"
  | "role-blocked"
  | "contract-blocked";

export interface WorkbenchPermission {
  code: string;
  label: string;
  description: string;
  ownerCode: string;
  status: WorkbenchPermissionStatus;
  decision: PermissionDecision;
}

export interface WorkbenchMenu {
  menuCode: string;
  title: string;
  parentMenuCode: string | null;
  path: string | null;
  order: number;
}

export interface WorkbenchView {
  permissions: WorkbenchPermission[];
  visibleMenus: WorkbenchMenu[];
  visibleWidgets: string[];
}

function translated(model: PermissionStudioModel, key: string, fallback: string): string {
  return model.translations["zh-CN"][key] ?? fallback;
}

function statusFor(decision: PermissionDecision): WorkbenchPermissionStatus {
  if (decision.effective) return "effective";
  if (decision.blockedByPlan) return "plan-blocked";
  if (decision.contractGranted) return "role-blocked";
  return "contract-blocked";
}

export function buildWorkbenchView(
  model: PermissionStudioModel,
  scenario: WorkbenchScenario,
): WorkbenchView {
  const result = explainEffectivePermissions({
    permissionCodes: model.permissionCodes,
    contractScope: model.contractScope,
    contractPlanPolicies: model.contractPlanPolicies,
    entitlements: scenario.entitlements,
    roles: model.roles,
    selectedRoleCodes: scenario.roleCodes,
    membershipType: scenario.membershipType,
  });
  const entitledContracts = new Set(scenario.entitlements.map(({ contractType }) => contractType));
  const contractMenuCodes = new Set(
    [...entitledContracts].flatMap((contract) => model.contractMenus[contract] ?? []),
  );
  const contractWidgetCodes = new Set(
    [...entitledContracts].flatMap((contract) => model.contractWidgets[contract] ?? []),
  );
  const effectiveOwners = new Set(
    result.effectiveCodes
      .map((code) => model.permissionRegistry[code]?.belongToMenuCode)
      .filter((owner): owner is string => Boolean(owner)),
  );
  const visibleMenuCodes = new Set(
    [...effectiveOwners].filter((owner) => contractMenuCodes.has(owner)),
  );
  for (const menuCode of [...visibleMenuCodes]) {
    const visited = new Set<string>([menuCode]);
    let parent = model.menuRegistry[menuCode]?.parentMenuCode ?? null;
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      visibleMenuCodes.add(parent);
      parent = model.menuRegistry[parent]?.parentMenuCode ?? null;
    }
  }
  const visibleWidgets = [
    ...new Set([...entitledContracts].flatMap((contract) => model.contractWidgets[contract] ?? [])),
  ]
    .filter((widget) => contractWidgetCodes.has(widget) && effectiveOwners.has(widget))
    .sort();

  return {
    permissions: model.permissionCodes
      .map((code) => {
        const entry = model.permissionRegistry[code];
        const decision = result.decisions[code];
        if (!entry || !decision) return null;
        return {
          code,
          label: translated(model, entry.label, code),
          description: translated(model, entry.desc, entry.desc || code),
          ownerCode: entry.belongToMenuCode,
          status: statusFor(decision),
          decision,
        } satisfies WorkbenchPermission;
      })
      .filter((item): item is WorkbenchPermission => item !== null)
      .sort((left, right) => left.code.localeCompare(right.code)),
    visibleMenus: Object.values(model.menuRegistry)
      .filter((menu) => visibleMenuCodes.has(menu.menuCode))
      .map((menu) => ({
        menuCode: menu.menuCode,
        title: translated(model, menu.title, menu.menuCode),
        parentMenuCode: menu.parentMenuCode,
        path: menu.path,
        order: menu.order,
      }))
      .sort(
        (left, right) => left.order - right.order || left.menuCode.localeCompare(right.menuCode),
      ),
    visibleWidgets,
  };
}
