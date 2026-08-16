import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const stringArraySchema = z.array(identifierSchema).max(2_000);

const menuEntrySchema = z.strictObject({
  menuCode: identifierSchema,
  title: identifierSchema,
  parentMenuCode: identifierSchema.nullable(),
  path: z.string().max(500).nullable(),
  icon: z.string().max(100).nullable(),
  order: z.number().finite(),
});

const permissionEntrySchema = z.strictObject({
  code: identifierSchema,
  belongToMenuCode: identifierSchema,
  label: identifierSchema,
  desc: identifierSchema,
});

const stringRecordSchema = z.record(identifierSchema, stringArraySchema);
const planPoliciesSchema = z.record(
  identifierSchema,
  z.strictObject({
    plans: stringArraySchema,
    permissionPlans: stringRecordSchema,
  }),
);

export const permissionStudioModelSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceSha: z
      .string()
      .length(40)
      .regex(/^[0-9a-f]+$/),
    permissionCodes: stringArraySchema,
    menuRegistry: z.record(identifierSchema, menuEntrySchema),
    permissionRegistry: z.record(identifierSchema, permissionEntrySchema),
    permissionAvailability: z.record(
      identifierSchema,
      z
        .array(
          z.strictObject({
            contract: identifierSchema,
          }),
        )
        .max(100),
    ),
    permissionAvailabilityBypassContracts: stringArraySchema,
    contractScope: stringRecordSchema,
    contractTypes: stringArraySchema,
    contractMenus: stringRecordSchema,
    contractWidgets: stringRecordSchema,
    contractPlanPolicies: planPoliciesSchema,
    roles: z
      .array(
        z.strictObject({
          roleId: z.number().int().positive(),
          code: identifierSchema,
          roleName: identifierSchema,
          remark: identifierSchema,
          permissionCodes: stringArraySchema,
        }),
      )
      .max(100),
    translations: z.strictObject({
      en: z.record(identifierSchema, z.string().min(1).max(2_000)),
      "zh-CN": z.record(identifierSchema, z.string().min(1).max(2_000)),
      ja: z.record(identifierSchema, z.string().min(1).max(2_000)),
    }),
  })
  .superRefine((model, context) => {
    const permissions = new Set(model.permissionCodes);
    const registryCodes = Object.keys(model.permissionRegistry);
    const contracts = new Set(model.contractTypes);
    const menuCodes = new Set(Object.keys(model.menuRegistry));
    const permissionOwners = new Set(
      Object.values(model.permissionRegistry).map((entry) => entry.belongToMenuCode),
    );

    for (const [key, entry] of Object.entries(model.permissionRegistry)) {
      if (key !== entry.code) {
        context.addIssue({
          code: "custom",
          path: ["permissionRegistry", key, "code"],
          message: `permission registry key "${key}" does not match embedded code "${entry.code}"`,
        });
      }
    }
    for (const [key, entry] of Object.entries(model.menuRegistry)) {
      if (key !== entry.menuCode) {
        context.addIssue({
          code: "custom",
          path: ["menuRegistry", key, "menuCode"],
          message: `menu registry key "${key}" does not match embedded code "${entry.menuCode}"`,
        });
      }
      if (entry.parentMenuCode && !menuCodes.has(entry.parentMenuCode)) {
        context.addIssue({
          code: "custom",
          path: ["menuRegistry", key, "parentMenuCode"],
          message: `menu references unknown parent "${entry.parentMenuCode}"`,
        });
      }
      const visited = new Set<string>([key]);
      let parent = entry.parentMenuCode;
      while (parent && menuCodes.has(parent)) {
        if (visited.has(parent)) {
          context.addIssue({
            code: "custom",
            path: ["menuRegistry", key, "parentMenuCode"],
            message: `menu parent cycle includes "${parent}"`,
          });
          break;
        }
        visited.add(parent);
        parent = model.menuRegistry[parent]?.parentMenuCode ?? null;
      }
    }
    if (
      registryCodes.length !== permissions.size ||
      registryCodes.some((code) => !permissions.has(code))
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissionCodes"],
        message: "permissionCodes must exactly match permission registry keys",
      });
    }

    const checkContractRecord = (
      name: "contractMenus" | "contractPlanPolicies" | "contractScope" | "contractWidgets",
      record: Readonly<Record<string, unknown>>,
    ) => {
      for (const contract of Object.keys(record)) {
        if (!contracts.has(contract)) {
          context.addIssue({
            code: "custom",
            path: [name, contract],
            message: `${name} references unknown contract "${contract}"`,
          });
        }
      }
    };
    checkContractRecord("contractMenus", model.contractMenus);
    checkContractRecord("contractWidgets", model.contractWidgets);
    checkContractRecord("contractScope", model.contractScope);
    checkContractRecord("contractPlanPolicies", model.contractPlanPolicies);

    for (const [contract, codes] of Object.entries(model.contractScope)) {
      for (const code of codes) {
        if (!permissions.has(code)) {
          context.addIssue({
            code: "custom",
            path: ["contractScope", contract],
            message: `contract scope references unknown permission "${code}"`,
          });
        }
      }
    }
    for (const [contract, menus] of Object.entries(model.contractMenus)) {
      for (const menu of menus) {
        if (!menuCodes.has(menu)) {
          context.addIssue({
            code: "custom",
            path: ["contractMenus", contract],
            message: `contract menu references unknown menu "${menu}"`,
          });
        }
      }
    }
    for (const [contract, widgets] of Object.entries(model.contractWidgets)) {
      for (const widget of widgets) {
        if (!permissionOwners.has(widget) || menuCodes.has(widget)) {
          context.addIssue({
            code: "custom",
            path: ["contractWidgets", contract],
            message: `contract widget references unknown widget "${widget}"`,
          });
        }
      }
    }
    for (const [index, role] of model.roles.entries()) {
      for (const code of role.permissionCodes) {
        if (!permissions.has(code)) {
          context.addIssue({
            code: "custom",
            path: ["roles", index, "permissionCodes"],
            message: `role references unknown permission "${code}"`,
          });
        }
      }
    }
    for (const contract of model.permissionAvailabilityBypassContracts) {
      if (!contracts.has(contract)) {
        context.addIssue({
          code: "custom",
          path: ["permissionAvailabilityBypassContracts"],
          message: `availability bypass references unknown contract "${contract}"`,
        });
      }
    }
    for (const [permission, conditions] of Object.entries(model.permissionAvailability)) {
      if (!permissions.has(permission)) {
        context.addIssue({
          code: "custom",
          path: ["permissionAvailability", permission],
          message: `availability references unknown permission "${permission}"`,
        });
      }
      for (const [index, condition] of conditions.entries()) {
        if (!contracts.has(condition.contract)) {
          context.addIssue({
            code: "custom",
            path: ["permissionAvailability", permission, index, "contract"],
            message: `availability references unknown contract "${condition.contract}"`,
          });
        }
      }
    }
    for (const [contract, policy] of Object.entries(model.contractPlanPolicies)) {
      const plans = new Set(policy.plans);
      for (const [permission, permittedPlans] of Object.entries(policy.permissionPlans)) {
        if (!permissions.has(permission)) {
          context.addIssue({
            code: "custom",
            path: ["contractPlanPolicies", contract, "permissionPlans", permission],
            message: `plan policy references unknown permission "${permission}"`,
          });
        }
        for (const plan of permittedPlans) {
          if (!plans.has(plan)) {
            context.addIssue({
              code: "custom",
              path: ["contractPlanPolicies", contract, "permissionPlans", permission],
              message: `plan policy references unknown plan "${plan}"`,
            });
          }
        }
      }
    }
  });

export type PermissionStudioModel = z.infer<typeof permissionStudioModelSchema>;

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
