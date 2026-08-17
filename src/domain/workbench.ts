import { explainEffectivePermissions } from "@/src/domain/effective-permissions";
import type {
  ContractEntitlement,
  PermissionDecision,
  PermissionMembershipType,
  PermissionStudioModel,
} from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  translatedModelText,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";

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
  ownerLabel: string;
  status: WorkbenchPermissionStatus;
  decision: PermissionDecision;
}

export interface WorkbenchMenu {
  menuCode: string;
  title: string;
  parentMenuCode: string | null;
  path: string | null;
  order: number;
  depth: number;
}

export interface WorkbenchView {
  permissions: WorkbenchPermission[];
  visibleMenus: WorkbenchMenu[];
  visibleWidgets: string[];
}

function statusFor(decision: PermissionDecision): WorkbenchPermissionStatus {
  if (decision.effective) return "effective";
  if (decision.blockedByPlan) return "plan-blocked";
  if (decision.contractGranted) return "role-blocked";
  return "contract-blocked";
}

function menuDepth(model: PermissionStudioModel, menuCode: string): number {
  const visited = new Set<string>([menuCode]);
  let depth = 0;
  let parent = model.menuRegistry[menuCode]?.parentMenuCode ?? null;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = model.menuRegistry[parent]?.parentMenuCode ?? null;
  }
  return depth;
}

function sortMenusInTreeOrder(menus: readonly WorkbenchMenu[]): WorkbenchMenu[] {
  const menuCodes = new Set(menus.map((menu) => menu.menuCode));
  const children = new Map<string | null, WorkbenchMenu[]>();
  const compareMenus = (left: WorkbenchMenu, right: WorkbenchMenu) =>
    left.order - right.order || left.menuCode.localeCompare(right.menuCode);

  for (const menu of menus) {
    const parent = menu.parentMenuCode && menuCodes.has(menu.parentMenuCode)
      ? menu.parentMenuCode
      : null;
    children.set(parent, [...(children.get(parent) ?? []), menu]);
  }
  for (const siblings of children.values()) siblings.sort(compareMenus);

  const ordered: WorkbenchMenu[] = [];
  const visited = new Set<string>();
  const appendMenu = (menu: WorkbenchMenu) => {
    if (visited.has(menu.menuCode)) return;
    visited.add(menu.menuCode);
    ordered.push(menu);
    for (const child of children.get(menu.menuCode) ?? []) appendMenu(child);
  };

  for (const root of children.get(null) ?? []) appendMenu(root);
  for (const menu of [...menus].sort(compareMenus)) appendMenu(menu);
  return ordered;
}

export function buildWorkbenchView(
  model: PermissionStudioModel,
  scenario: WorkbenchScenario,
  locale: PermissionStudioLocale = defaultPermissionStudioLocale,
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
        const owner = model.menuRegistry[entry.belongToMenuCode];
        return {
          code,
          label: translatedModelText(model, locale, entry.label, code),
          description: translatedModelText(model, locale, entry.desc, entry.desc || code),
          ownerCode: entry.belongToMenuCode,
          ownerLabel: owner
            ? translatedModelText(model, locale, owner.title, owner.menuCode)
            : entry.belongToMenuCode,
          status: statusFor(decision),
          decision,
        } satisfies WorkbenchPermission;
      })
      .filter((item): item is WorkbenchPermission => item !== null)
      .sort((left, right) => left.code.localeCompare(right.code)),
    visibleMenus: sortMenusInTreeOrder(
      Object.values(model.menuRegistry)
        .filter((menu) => visibleMenuCodes.has(menu.menuCode))
        .map((menu) => ({
          menuCode: menu.menuCode,
          title: translatedModelText(model, locale, menu.title, menu.menuCode),
          parentMenuCode: menu.parentMenuCode,
          path: menu.path,
          order: menu.order,
          depth: menuDepth(model, menu.menuCode),
        })),
    ),
    visibleWidgets,
  };
}
