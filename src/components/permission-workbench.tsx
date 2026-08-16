"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ContractEntitlement,
  PermissionMembershipType,
  PermissionStudioModel,
} from "@/src/domain/model";
import { permissionStudioModelSchema } from "@/src/domain/model";
import { buildWorkbenchView } from "@/src/domain/workbench";

interface PermissionWorkbenchProps {
  initialModel?: PermissionStudioModel | null;
  loadModel?: () => Promise<PermissionStudioModel>;
}

const statusLabels = {
  effective: "有效",
  "plan-blocked": "套餐阻止",
  "role-blocked": "角色阻止",
  "contract-blocked": "契约阻止",
} as const;

async function loadRemoteModel(): Promise<PermissionStudioModel> {
  const response = await fetch("/api/model", { cache: "no-store" });
  if (!response.ok) throw new Error("Permission model request failed");
  return permissionStudioModelSchema.parse(await response.json());
}

function defaultSelections(model: PermissionStudioModel) {
  const contractType = model.contractTypes.find((contract) => contract !== "TEST");
  const policy = contractType ? model.contractPlanPolicies[contractType] : undefined;
  return {
    entitlements: contractType
      ? [{ contractType, plan: policy?.plans[0] ?? null } satisfies ContractEntitlement]
      : [],
    roleCodes: model.roles[0]?.code ? [model.roles[0].code] : [],
  };
}

export function PermissionWorkbench({
  initialModel = null,
  loadModel = loadRemoteModel,
}: PermissionWorkbenchProps) {
  const initialSelections = initialModel ? defaultSelections(initialModel) : null;
  const [model, setModel] = useState<PermissionStudioModel | null>(initialModel);
  const modelRef = useRef<PermissionStudioModel | null>(initialModel);
  const [membershipType, setMembershipType] = useState<PermissionMembershipType>("MEMBER");
  const [entitlements, setEntitlements] = useState<ContractEntitlement[]>(
    initialSelections?.entitlements ?? [],
  );
  const [roleCodes, setRoleCodes] = useState<string[]>(initialSelections?.roleCodes ?? []);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!initialModel);
  const [loadError, setLoadError] = useState(false);

  const replaceModel = useCallback((next: PermissionStudioModel) => {
    const hadModel = modelRef.current !== null;
    const defaults = defaultSelections(next);
    const contracts = new Set(next.contractTypes);
    const roles = new Set(next.roles.map((role) => role.code));
    setEntitlements((current) =>
      hadModel
        ? current
            .filter(({ contractType }) => contracts.has(contractType))
            .map((entitlement) => {
              const policy = next.contractPlanPolicies[entitlement.contractType];
              return {
                contractType: entitlement.contractType,
                plan:
                  entitlement.plan && policy?.plans.includes(entitlement.plan)
                    ? entitlement.plan
                    : (policy?.plans[0] ?? null),
              };
            })
        : defaults.entitlements,
    );
    setRoleCodes((current) =>
      hadModel ? current.filter((roleCode) => roles.has(roleCode)) : defaults.roleCodes,
    );
    modelRef.current = next;
    setModel(next);
    setLoadError(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      replaceModel(await loadModel());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [loadModel, replaceModel]);

  useEffect(() => {
    if (!initialModel) void refresh();
  }, [initialModel, refresh]);

  const view = useMemo(
    () => (model ? buildWorkbenchView(model, { membershipType, entitlements, roleCodes }) : null),
    [entitlements, membershipType, model, roleCodes],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const permissions =
    view?.permissions.filter((permission) =>
      [permission.code, permission.label, permission.description].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    ) ?? [];

  if (!model || !view) {
    return (
      <section className="model-state" aria-live="polite">
        <p className="eyebrow">PERMISSION MODEL</p>
        <h2>{loadError ? "无法加载权限模型" : "正在读取 develop 权限…"}</h2>
        {loadError ? (
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            重试加载
          </button>
        ) : null}
      </section>
    );
  }

  const toggleContract = (contractType: string, selected: boolean) => {
    setEntitlements((current) => {
      if (!selected) return current.filter((item) => item.contractType !== contractType);
      if (current.some((item) => item.contractType === contractType)) return current;
      return [
        ...current,
        {
          contractType,
          plan: model.contractPlanPolicies[contractType]?.plans[0] ?? null,
        },
      ];
    });
  };

  return (
    <section className="workbench" aria-labelledby="workbench-heading">
      <header className="workbench-header">
        <div>
          <p className="eyebrow">PERMISSION WORKBENCH</p>
          <h2 id="workbench-heading">权限计算工作台</h2>
          <p className="source-sha">
            来源 SHA：<code>{model.sourceSha}</code>
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "刷新中…" : "刷新 develop"}
        </button>
      </header>

      <div className="workbench-grid">
        <aside className="simulation-panel" aria-label="权限模拟条件">
          <fieldset>
            <legend>成员类型</legend>
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
            {model.contractTypes.map((contractType) => {
              const entitlement = entitlements.find((item) => item.contractType === contractType);
              const plans = model.contractPlanPolicies[contractType]?.plans ?? [];
              return (
                <div className="contract-control" key={contractType}>
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
            <legend>角色</legend>
            {model.roles.map((role) => (
              <label
                key={role.code}
                title={model.translations["zh-CN"][role.remark] ?? role.remark}
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
                {model.translations["zh-CN"][role.roleName] ?? role.code}
                <code>{role.code}</code>
              </label>
            ))}
          </fieldset>
        </aside>

        <section className="permission-panel" aria-labelledby="permissions-heading">
          <div className="panel-heading">
            <h3 id="permissions-heading">最终权限</h3>
            <span>
              {view.permissions.filter((item) => item.status === "effective").length} /{" "}
              {view.permissions.length}
            </span>
          </div>
          <label className="search-control">
            <span>搜索权限</span>
            <input
              type="search"
              aria-label="搜索权限"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="权限名称或 code"
            />
          </label>
          <ul className="permission-list">
            {permissions.map((permission) => (
              <li key={permission.code} data-status={permission.status}>
                <div>
                  <strong>{permission.label}</strong>
                  <code>{permission.code}</code>
                </div>
                <span className={`status status-${permission.status}`}>
                  {statusLabels[permission.status]}
                </span>
                <p>{permission.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <aside className="module-panel" aria-label="契约可见模块">
          <h3>可见菜单</h3>
          <ul role="tree" aria-label="可见菜单">
            {view.visibleMenus.map((menu) => (
              <li role="treeitem" key={menu.menuCode}>
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
            <p className="empty-copy">当前契约没有独立组件。</p>
          )}
        </aside>
      </div>
    </section>
  );
}
