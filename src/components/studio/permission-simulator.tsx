"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/src/components/studio/permission-simulator.module.css";
import { applyDraftToModel, buildImpactDiff, type PermissionDraft } from "@/src/domain/draft";
import type {
  ContractEntitlement,
  PermissionMembershipType,
  PermissionStudioModel,
} from "@/src/domain/model";
import { buildWorkbenchView, type WorkbenchPermissionStatus } from "@/src/domain/workbench";

export interface PermissionSimulatorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
}

const statusLabels: Record<WorkbenchPermissionStatus, string> = {
  effective: "有效",
  "plan-blocked": "套餐阻塞",
  "role-blocked": "角色阻塞",
  "contract-blocked": "契约阻塞",
};

function defaultSelections(model: PermissionStudioModel): {
  entitlements: ContractEntitlement[];
  roleCodes: string[];
} {
  const contractType = model.contractTypes.find((contract) => contract !== "TEST");
  const policy = contractType ? model.contractPlanPolicies[contractType] : undefined;
  return {
    entitlements: contractType ? [{ contractType, plan: policy?.plans[0] ?? null }] : [],
    roleCodes: model.roles[0]?.code ? [model.roles[0].code] : [],
  };
}

function normalizeEntitlements(
  model: PermissionStudioModel,
  entitlements: readonly ContractEntitlement[],
): ContractEntitlement[] {
  const contracts = new Set(model.contractTypes);
  return entitlements
    .filter(({ contractType }) => contracts.has(contractType))
    .map((entitlement) => {
      const policy = model.contractPlanPolicies[entitlement.contractType];
      return {
        contractType: entitlement.contractType,
        plan:
          entitlement.plan && policy?.plans.includes(entitlement.plan)
            ? entitlement.plan
            : (policy?.plans[0] ?? null),
      };
    });
}

export function PermissionSimulator({ model, draft }: PermissionSimulatorProps) {
  const initialSelections = useMemo(() => defaultSelections(model), [model]);
  const [membershipType, setMembershipType] = useState<PermissionMembershipType>("MEMBER");
  const [entitlements, setEntitlements] = useState<ContractEntitlement[]>(
    initialSelections.entitlements,
  );
  const [roleCodes, setRoleCodes] = useState<string[]>(initialSelections.roleCodes);
  const [query, setQuery] = useState("");
  const previewModel = useMemo(() => applyDraftToModel(model, draft), [model, draft]);
  const impact = useMemo(() => buildImpactDiff(model, draft), [model, draft]);

  useEffect(() => {
    const availableRoles = new Set(model.roles.map((role) => role.code));
    setEntitlements((current) => normalizeEntitlements(model, current));
    setRoleCodes((current) => current.filter((roleCode) => availableRoles.has(roleCode)));
  }, [model]);

  const view = useMemo(
    () => buildWorkbenchView(previewModel, { membershipType, entitlements, roleCodes }),
    [previewModel, membershipType, entitlements, roleCodes],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const permissions = view.permissions.filter((permission) =>
    [permission.code, permission.label, permission.description, permission.ownerLabel].some(
      (value) => value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
  const previewingDraft = impact.scenarios.length > 0;

  const toggleContract = (contractType: string, selected: boolean) => {
    setEntitlements((current) => {
      if (!selected) return current.filter((item) => item.contractType !== contractType);
      if (current.some((item) => item.contractType === contractType)) return current;
      return [
        ...current,
        {
          contractType,
          plan: previewModel.contractPlanPolicies[contractType]?.plans[0] ?? null,
        },
      ];
    });
  };

  return (
    <section className={styles.simulator} aria-labelledby="permission-simulator-heading">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">PERMISSION SIMULATOR</p>
          <h2 id="permission-simulator-heading">权限模拟</h2>
        </div>
        {previewingDraft ? (
          <p className={styles.previewing} role="status">
            正在预览草稿
          </p>
        ) : null}
      </header>

      <div className={styles.grid}>
        <aside className={styles.conditions} aria-label="权限模拟条件">
          <fieldset>
            <legend>成员类型（仅用于模拟）</legend>
            {(["MEMBER", "ADMIN"] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="membership-type"
                  checked={membershipType === value}
                  onChange={() => setMembershipType(value)}
                />
                {value === "MEMBER" ? "普通成员" : "管理员"}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend>契约与套餐</legend>
            {previewModel.contractTypes.map((contractType) => {
              const entitlement = entitlements.find((item) => item.contractType === contractType);
              const plans = previewModel.contractPlanPolicies[contractType]?.plans ?? [];
              return (
                <div className={styles.contractControl} key={contractType}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${contractType} 契约`}
                      checked={Boolean(entitlement)}
                      onChange={(event) => toggleContract(contractType, event.target.checked)}
                    />
                    {contractType}
                  </label>
                  {entitlement && plans.length ? (
                    <select
                      aria-label={`${contractType} 套餐`}
                      value={entitlement.plan ?? ""}
                      onChange={(event) =>
                        setEntitlements((current) =>
                          current.map((item) =>
                            item.contractType === contractType
                              ? { ...item, plan: event.target.value }
                              : item,
                          ),
                        )
                      }
                    >
                      {plans.map((plan) => (
                        <option key={plan}>{plan}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          <fieldset>
            <legend>角色组合</legend>
            {previewModel.roles.map((role) => (
              <label
                key={role.code}
                title={previewModel.translations["zh-CN"][role.remark] ?? role.remark}
              >
                <input
                  type="checkbox"
                  aria-label={`角色 ${role.code}`}
                  checked={roleCodes.includes(role.code)}
                  onChange={(event) =>
                    setRoleCodes((current) =>
                      event.target.checked
                        ? [...new Set([...current, role.code])]
                        : current.filter((code) => code !== role.code),
                    )
                  }
                />
                {previewModel.translations["zh-CN"][role.roleName] ?? role.code}
                <code>{role.code}</code>
              </label>
            ))}
          </fieldset>
        </aside>

        <section className={styles.permissions} aria-labelledby="simulator-permissions-heading">
          <div className={styles.panelHeading}>
            <h3 id="simulator-permissions-heading">最终权限</h3>
            <span>
              {view.permissions.filter((item) => item.status === "effective").length} /{" "}
              {view.permissions.length}
            </span>
          </div>
          <label className={styles.searchControl}>
            <span>搜索权限</span>
            <input
              type="search"
              aria-label="搜索权限"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="权限名称或代码"
            />
          </label>
          <ul className={styles.permissionList}>
            {permissions.map((permission) => (
              <li key={permission.code} data-status={permission.status}>
                <div>
                  <strong>{permission.label}</strong>
                  <code>{permission.code}</code>
                </div>
                <span className={styles.status}>{statusLabels[permission.status]}</span>
                <p>{permission.description}</p>
                <p className={styles.owner}>所属模块：{permission.ownerLabel}</p>
                <p className={styles.evidence} aria-label={`${permission.code} evidence`}>
                  Contracts: {permission.decision.grantingContracts.join(", ") || "none"} · Roles:{" "}
                  {permission.decision.grantingRoles.join(", ") || "none"} · Plan blocked:{" "}
                  {permission.decision.blockedByPlan ? "yes" : "no"} · Admin bypass:{" "}
                  {permission.decision.bypassedByAdminMembership ? "yes" : "no"}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <aside className={styles.modules} aria-label="契约可见模块">
          <h3>可见菜单</h3>
          <ul role="tree" aria-label="可见菜单">
            {view.visibleMenus.map((menu) => (
              <li
                role="treeitem"
                key={menu.menuCode}
                aria-level={menu.depth + 1}
                style={{ paddingInlineStart: `${menu.depth * 16}px` }}
              >
                <strong>{menu.title}</strong>
                <code>{menu.menuCode}</code>
              </li>
            ))}
          </ul>
          <h3>可见组件</h3>
          {view.visibleWidgets.length ? (
            <ul>
              {view.visibleWidgets.map((widget) => (
                <li key={widget}>
                  <code>{widget}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>当前契约没有独立组件。</p>
          )}
        </aside>
      </div>
    </section>
  );
}
