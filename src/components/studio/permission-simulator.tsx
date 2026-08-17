"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import styles from "@/src/components/studio/permission-simulator.module.css";
import { applyDraftToModel, type PermissionDraft } from "@/src/domain/draft";
import type {
  ContractEntitlement,
  PermissionMembershipType,
  PermissionStudioModel,
} from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  translatedModelText,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";
import {
  buildWorkbenchView,
  type WorkbenchPermission,
  type WorkbenchPermissionStatus,
} from "@/src/domain/workbench";

export interface PermissionSimulatorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
}

type ResultTab = "effective" | "menus" | "blocked";

const statusLabels: Record<WorkbenchPermissionStatus, string> = {
  effective: "有效",
  "plan-blocked": "套餐未包含",
  "role-blocked": "角色未授权",
  "contract-blocked": "契约未包含",
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

function matchesPermission(permission: WorkbenchPermission, query: string): boolean {
  return [permission.code, permission.label, permission.description, permission.ownerLabel].some(
    (value) => value.toLocaleLowerCase().includes(query),
  );
}

function signedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function PermissionSimulator({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
}: PermissionSimulatorProps) {
  const initialSelections = useMemo(() => defaultSelections(model), [model]);
  const [membershipType, setMembershipType] = useState<PermissionMembershipType>("MEMBER");
  const [entitlements, setEntitlements] = useState<ContractEntitlement[]>(
    initialSelections.entitlements,
  );
  const [roleCodes, setRoleCodes] = useState<string[]>(initialSelections.roleCodes);
  const [query, setQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("effective");
  const [expandedOwnerCodes, setExpandedOwnerCodes] = useState<string[]>([]);
  const previewModel = useMemo(() => applyDraftToModel(model, draft), [model, draft]);

  useEffect(() => {
    const availableRoles = new Set(model.roles.map((role) => role.code));
    setEntitlements((current) => normalizeEntitlements(model, current));
    setRoleCodes((current) => current.filter((roleCode) => availableRoles.has(roleCode)));
  }, [model]);

  const view = useMemo(
    () => buildWorkbenchView(previewModel, { membershipType, entitlements, roleCodes }, locale),
    [previewModel, membershipType, entitlements, roleCodes, locale],
  );
  const baselineView = useMemo(
    () =>
      buildWorkbenchView(
        previewModel,
        {
          membershipType: "MEMBER",
          entitlements: initialSelections.entitlements,
          roleCodes: initialSelections.roleCodes,
        },
        locale,
      ),
    [initialSelections, locale, previewModel],
  );
  const effectivePermissions = view.permissions.filter(
    (permission) => permission.status === "effective",
  );
  const blockedPermissions = view.permissions.filter(
    (permission) => permission.status !== "effective",
  );
  const baselineEffectiveCount = baselineView.permissions.filter(
    (permission) => permission.status === "effective",
  ).length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePermissions = (
    activeTab === "blocked" ? blockedPermissions : effectivePermissions
  ).filter((permission) => matchesPermission(permission, normalizedQuery));
  const alternativeMatches = (
    activeTab === "blocked" ? effectivePermissions : blockedPermissions
  ).filter((permission) => matchesPermission(permission, normalizedQuery));
  const permissionGroups = useMemo(() => {
    const groups = new Map<
      string,
      { ownerCode: string; ownerLabel: string; permissions: WorkbenchPermission[] }
    >();
    for (const permission of visiblePermissions) {
      const ownerCode = permission.ownerCode.startsWith("widget.")
        ? "widget"
        : permission.ownerCode;
      const ownerLabel = ownerCode === "widget" ? "Widget" : permission.ownerLabel;
      const existing = groups.get(ownerCode);
      if (existing) existing.permissions.push(permission);
      else groups.set(ownerCode, { ownerCode, ownerLabel, permissions: [permission] });
    }
    return [...groups.values()].sort((left, right) =>
      left.ownerLabel.localeCompare(right.ownerLabel, locale),
    );
  }, [locale, visiblePermissions]);
  const selectedRoles = previewModel.roles.filter((role) => roleCodes.includes(role.code));
  const normalizedRoleQuery = roleQuery.trim().toLocaleLowerCase();
  const filteredRoles = previewModel.roles.filter((role) =>
    [
      role.code,
      translatedModelText(previewModel, locale, role.roleName, role.code),
      translatedModelText(previewModel, locale, role.remark, role.remark),
    ].some((value) => value.toLocaleLowerCase().includes(normalizedRoleQuery)),
  );
  const permissionDelta = effectivePermissions.length - baselineEffectiveCount;
  const menuDelta = view.visibleMenus.length - baselineView.visibleMenus.length;

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

  const toggleRole = (roleCode: string, selected: boolean) => {
    setRoleCodes((current) =>
      selected ? [...new Set([...current, roleCode])] : current.filter((code) => code !== roleCode),
    );
  };

  const resetScenario = () => {
    setMembershipType("MEMBER");
    setEntitlements(initialSelections.entitlements);
    setRoleCodes(initialSelections.roleCodes);
    setQuery("");
    setRoleQuery("");
    setActiveTab("effective");
  };

  const tabs: { id: ResultTab; label: string; count: number }[] = [
    { id: "effective", label: "有效权限", count: effectivePermissions.length },
    { id: "menus", label: "可见菜单", count: view.visibleMenus.length },
    { id: "blocked", label: "被阻止", count: blockedPermissions.length },
  ];

  return (
    <section className={styles.simulator} aria-label="权限模拟">
      <div className={styles.grid}>
        <aside className={styles.conditions} aria-label="权限模拟条件">
          <div className={styles.conditionsHeading}>
            <div>
              <span className={styles.sectionIndex}>01</span>
              <h3>模拟条件</h3>
            </div>
            <button type="button" className={styles.resetButton} onClick={resetScenario}>
              重置
            </button>
          </div>

          <fieldset>
            <legend>成员身份</legend>
            <div className={styles.segmentedControl}>
              {(["MEMBER", "ADMIN"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="membership-type"
                    checked={membershipType === value}
                    onChange={() => setMembershipType(value)}
                  />
                  <span>{value === "MEMBER" ? "普通成员" : "平台管理员"}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>契约与套餐</legend>
            <div className={styles.controlList}>
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
                      <strong>{contractType}</strong>
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
            </div>
          </fieldset>

          <fieldset>
            <legend>
              权限角色 <span>{roleCodes.length} 已选</span>
            </legend>
            {selectedRoles.length ? (
              <div className={styles.selectedRoles} aria-label="已选择角色">
                {selectedRoles.map((role) => (
                  <button
                    type="button"
                    key={role.code}
                    onClick={() => toggleRole(role.code, false)}
                    aria-label={`移除角色 ${translatedModelText(previewModel, locale, role.roleName, role.code)}`}
                  >
                    {translatedModelText(previewModel, locale, role.roleName, role.code)}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : null}
            <label className={styles.searchControl}>
              <span className={styles.visuallyHidden}>搜索角色</span>
              <input
                type="search"
                aria-label="搜索角色"
                value={roleQuery}
                onChange={(event) => setRoleQuery(event.target.value)}
                placeholder="搜索角色名称或代码"
              />
            </label>
            <div className={styles.roleList}>
              {filteredRoles.map((role) => {
                const label = translatedModelText(previewModel, locale, role.roleName, role.code);
                return (
                  <label
                    key={role.code}
                    title={`${label} · ${role.code}\n${translatedModelText(
                      previewModel,
                      locale,
                      role.remark,
                      role.remark,
                    )}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`角色 ${role.code}`}
                      checked={roleCodes.includes(role.code)}
                      onChange={(event) => toggleRole(role.code, event.target.checked)}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{role.permissionCodes.length} 项权限</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </aside>

        <section
          className={styles.results}
          aria-labelledby="simulator-results-heading"
          aria-label="权限结果"
        >
          <div className={styles.resultsHeading}>
            <div>
              <span className={styles.sectionIndex}>02</span>
              <h3 id="simulator-results-heading">模拟结果</h3>
            </div>
            <p>
              {membershipType === "MEMBER" ? "普通成员" : "平台管理员"} · {roleCodes.length} 个角色
              · {entitlements.length} 个契约
            </p>
          </div>

          <div
            className={`${styles.summary} ${permissionDelta || menuDelta ? styles.summaryWithDelta : ""}`}
            aria-label="模拟结果摘要"
          >
            <div>
              <strong>{effectivePermissions.length}</strong>
              <span>有效权限</span>
              <small>/ {view.permissions.length}</small>
            </div>
            <div>
              <strong>{view.visibleMenus.length}</strong>
              <span>可见菜单</span>
              <small>/ {Object.keys(previewModel.menuRegistry).length}</small>
            </div>
            <div>
              <strong>{roleCodes.length}</strong>
              <span>角色</span>
            </div>
            <div>
              <strong>{entitlements.length}</strong>
              <span>契约</span>
            </div>
            {permissionDelta || menuDelta ? (
              <div className={styles.delta}>
                <span>相对初始组合</span>
                <strong>{signedCount(permissionDelta)} 权限</strong>
                <strong>{signedCount(menuDelta)} 菜单</strong>
              </div>
            ) : null}
          </div>

          <div className={styles.resultTabs} role="tablist" aria-label="模拟结果类型">
            {tabs.map((tab) => (
              <button
                type="button"
                role="tab"
                key={tab.id}
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <strong>{tab.count}</strong>
              </button>
            ))}
          </div>

          <label className={styles.resultSearch}>
            <span className={styles.searchMark} aria-hidden="true" />
            <span className={styles.visuallyHidden}>检查权限或菜单</span>
            <input
              type="search"
              aria-label="检查权限或菜单"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                activeTab === "menus"
                  ? "搜索菜单名称或代码"
                  : "检查权限名称、permission code 或模块"
              }
            />
          </label>

          <div className={styles.resultBody} role="tabpanel">
            {activeTab === "menus" ? (
              <div className={styles.menuResults}>
                <div className={styles.menuTreeHeading}>
                  <strong>当前成员可见的菜单路径</strong>
                  <span>{view.visibleWidgets.length} 个独立组件</span>
                </div>
                <ul role="tree" aria-label="可见菜单">
                  {view.visibleMenus
                    .filter((menu) =>
                      [menu.title, menu.menuCode].some((value) =>
                        value.toLocaleLowerCase().includes(normalizedQuery),
                      ),
                    )
                    .map((menu) => (
                      <li
                        role="treeitem"
                        key={menu.menuCode}
                        aria-level={menu.depth + 1}
                        style={{ "--menu-depth": menu.depth } as CSSProperties}
                      >
                        <span className={styles.treeLine} aria-hidden="true" />
                        <span>
                          <strong>{menu.title}</strong>
                          <code>{menu.menuCode}</code>
                        </span>
                      </li>
                    ))}
                </ul>
                {view.visibleWidgets.length ? (
                  <div className={styles.widgets}>
                    <strong>可见组件</strong>
                    <div>
                      {view.visibleWidgets.map((widget) => (
                        <code key={widget}>{widget}</code>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.permissionGroups} aria-label="按模块分组的权限结果">
                {permissionGroups.map((group) => {
                  const expanded =
                    Boolean(normalizedQuery) || expandedOwnerCodes.includes(group.ownerCode);
                  return (
                    <section className={styles.permissionGroup} key={group.ownerCode}>
                      <button
                        type="button"
                        className={styles.permissionGroupToggle}
                        aria-expanded={expanded}
                        onClick={() =>
                          setExpandedOwnerCodes((current) =>
                            current.includes(group.ownerCode)
                              ? current.filter((ownerCode) => ownerCode !== group.ownerCode)
                              : [...current, group.ownerCode],
                          )
                        }
                      >
                        <span>
                          <strong>{group.ownerLabel}</strong>
                          <small>{group.ownerCode}</small>
                        </span>
                        <span>{group.permissions.length} 项</span>
                      </button>
                      {expanded ? (
                        <ul className={styles.permissionList}>
                          {group.permissions.map((permission) => {
                            const suggestedRoles = previewModel.roles.filter((role) =>
                              role.permissionCodes.includes(permission.code),
                            );
                            return (
                              <li key={permission.code} data-status={permission.status}>
                                <details>
                                  <summary>
                                    <span className={styles.permissionIdentity}>
                                      <strong>{permission.label}</strong>
                                      <code>{permission.code}</code>
                                    </span>
                                    {permission.status !== "effective" ? (
                                      <span className={styles.status}>
                                        {statusLabels[permission.status]}
                                      </span>
                                    ) : (
                                      <span className={styles.disclosure}>为什么拥有？</span>
                                    )}
                                  </summary>
                                  <div className={styles.permissionDetails}>
                                    <p>{permission.description}</p>
                                    <div className={styles.explanation}>
                                      <strong>
                                        {permission.status === "effective"
                                          ? "权限来源"
                                          : "为什么没有？"}
                                      </strong>
                                      <div className={styles.permissionPath}>
                                        <div>
                                          <small>契约</small>
                                          <span>
                                            {permission.decision.grantingContracts.join("、") ||
                                              "未授予"}
                                          </span>
                                        </div>
                                        <i aria-hidden="true">→</i>
                                        <div>
                                          <small>角色</small>
                                          <span>
                                            {permission.decision.grantingRoles.join("、") ||
                                              (permission.decision.bypassedByAdminMembership
                                                ? "管理员身份"
                                                : "未授权")}
                                          </span>
                                        </div>
                                        <i aria-hidden="true">→</i>
                                        <div data-outcome={permission.status}>
                                          <small>判定</small>
                                          <span>{statusLabels[permission.status]}</span>
                                        </div>
                                      </div>
                                      {permission.status !== "effective" ? (
                                        <p className={styles.blockReason}>
                                          {permission.status === "plan-blocked"
                                            ? "当前套餐未包含此权限，请切换到支持该权限的套餐。"
                                            : permission.status === "contract-blocked"
                                              ? "当前契约范围未包含此权限，请先选择对应契约。"
                                              : "已选角色均未授予此权限。"}
                                        </p>
                                      ) : null}
                                      {permission.status === "role-blocked" &&
                                      suggestedRoles.length ? (
                                        <div className={styles.suggestions}>
                                          <span>可通过以下角色获得：</span>
                                          {suggestedRoles.slice(0, 3).map((role) => (
                                            <button
                                              type="button"
                                              key={role.code}
                                              disabled={roleCodes.includes(role.code)}
                                              onClick={() => toggleRole(role.code, true)}
                                            >
                                              + 添加{" "}
                                              {translatedModelText(
                                                previewModel,
                                                locale,
                                                role.roleName,
                                                role.code,
                                              )}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                      <p
                                        className={styles.evidence}
                                        aria-label={`${permission.code} evidence`}
                                      >
                                        授予契约：
                                        {permission.decision.grantingContracts.join(", ") || "无"} ·
                                        授予角色：
                                        {permission.decision.grantingRoles.join(", ") || "无"} ·
                                        套餐拦截：
                                        {permission.decision.blockedByPlan ? "是" : "否"} ·
                                        管理员绕过：
                                        {permission.decision.bypassedByAdminMembership
                                          ? "是"
                                          : "否"}
                                      </p>
                                    </div>
                                  </div>
                                </details>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </section>
                  );
                })}
                {!visiblePermissions.length ? (
                  <div className={styles.noResults}>
                    <strong>
                      {normalizedQuery ? "当前结果中没有匹配项" : "当前没有可显示的权限"}
                    </strong>
                    {normalizedQuery && alternativeMatches.length ? (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveTab(activeTab === "blocked" ? "effective" : "blocked")
                        }
                      >
                        在{activeTab === "blocked" ? "有效权限" : "被阻止"}中查看{" "}
                        {alternativeMatches.length} 项
                      </button>
                    ) : (
                      <span>调整搜索词，或在左侧修改模拟条件。</span>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className={styles.scenarioBar}>
        <div>
          <span>当前模拟</span>
          <strong>{membershipType === "MEMBER" ? "普通成员" : "平台管理员"}</strong>
          {entitlements.map((item) => (
            <span key={item.contractType}>
              {item.contractType}
              {item.plan ? ` / ${item.plan}` : ""}
            </span>
          ))}
          {selectedRoles.map((role) => (
            <span key={role.code}>
              {translatedModelText(previewModel, locale, role.roleName, role.code)}
            </span>
          ))}
        </div>
        {permissionDelta || menuDelta ? (
          <p>
            本次组合 <strong>{signedCount(permissionDelta)} 权限</strong>
            <strong>{signedCount(menuDelta)} 菜单</strong>
          </p>
        ) : (
          <p>初始组合</p>
        )}
      </footer>
    </section>
  );
}
