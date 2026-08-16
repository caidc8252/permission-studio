"use client";

import { useMemo, useState } from "react";

import {
  buildImpactDiff,
  buildPermissionChange,
  createEmptyDraft,
  toggleContractOwner,
  toggleRolePermission,
  type PermissionDraft,
} from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface PrepareIntent {
  baseSha: string;
  reason: string;
  roleChanges: Array<{ roleCode: string; add: string[]; remove: string[] }>;
  contractChanges: Array<{
    contractType: string;
    menus: { add: string[]; remove: string[] };
    widgets: { add: string[]; remove: string[] };
  }>;
}

interface ChangeDraftProps {
  model: PermissionStudioModel;
  stale?: boolean;
  pending?: boolean;
  onPrepare: (intent: PrepareIntent) => void | Promise<void>;
}

const INTENT_REQUEST_ID = "00000000000000000000000000";

function ownerCodes(model: PermissionStudioModel, kind: "menu" | "widget"): string[] {
  if (kind === "menu") return Object.keys(model.menuRegistry).sort();
  const menuCodes = new Set(Object.keys(model.menuRegistry));
  return [
    ...new Set(
      Object.values(model.permissionRegistry)
        .map((permission) => permission.belongToMenuCode)
        .filter((owner) => !menuCodes.has(owner)),
    ),
  ].sort();
}

function isReasonReady(reason: string): boolean {
  const trimmed = reason.trim();
  if (trimmed.length < 8 || trimmed.length > 500) return false;
  return ![...trimmed].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function toIntent(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  reason: string,
): PrepareIntent {
  const { baseSha, roleChanges, contractChanges } = buildPermissionChange(model, draft, {
    requestId: INTENT_REQUEST_ID,
    reason,
  });
  return { baseSha, reason: reason.trim(), roleChanges, contractChanges };
}

export function ChangeDraft({
  model,
  stale = false,
  pending = false,
  onPrepare,
}: ChangeDraftProps) {
  const [draft, setDraft] = useState<PermissionDraft>(() => createEmptyDraft());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const impact = useMemo(() => buildImpactDiff(model, draft), [draft, model]);
  const roleChangeCount = impact.addedRolePermissions.length + impact.removedRolePermissions.length;
  const contractChangeCount =
    impact.addedContractOwners.length + impact.removedContractOwners.length;
  const hasChanges = roleChangeCount + contractChangeCount > 0;
  const canPrepare = hasChanges && isReasonReady(reason) && !stale && !pending;
  const menus = ownerCodes(model, "menu");
  const widgets = ownerCodes(model, "widget");

  const prepare = async () => {
    if (!canPrepare) return;
    setError(null);
    try {
      await onPrepare(toIntent(model, draft, reason));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法验证变更");
    }
  };

  return (
    <section className="change-draft" aria-labelledby="change-draft-heading">
      <header className="change-draft-header">
        <div>
          <p className="eyebrow">CHANGE DRAFT</p>
          <h2 id="change-draft-heading">编辑权限来源</h2>
          <p className="health-detail">仅支持预设角色，以及非 TEST 契约的菜单和组件。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(createEmptyDraft());
            setError(null);
          }}
          disabled={!hasChanges || pending}
        >
          撤销全部
        </button>
      </header>

      <div className="draft-editors">
        <div>
          <h3>角色权限</h3>
          {model.roles
            .filter((role) => role.code.startsWith("preset_"))
            .map((role) => (
              <fieldset key={role.code}>
                <legend>
                  <code>{role.code}</code>
                </legend>
                {model.permissionCodes.map((permissionCode) => (
                  <label key={permissionCode}>
                    <input
                      type="checkbox"
                      aria-label={`角色 ${role.code} 的 ${permissionCode}`}
                      checked={(draft.rolePermissions[role.code] ?? role.permissionCodes).includes(
                        permissionCode,
                      )}
                      onChange={() =>
                        setDraft((current) =>
                          toggleRolePermission(current, model, role.code, permissionCode),
                        )
                      }
                    />
                    <code>{permissionCode}</code>
                  </label>
                ))}
              </fieldset>
            ))}
        </div>

        <div>
          <h3>契约模块</h3>
          {model.contractTypes
            .filter((contractType) => contractType !== "TEST")
            .map((contractType) => (
              <fieldset key={contractType} aria-label={`契约 ${contractType} 模块`}>
                <legend>
                  <code>{contractType}</code>
                </legend>
                {menus.map((menuCode) => (
                  <label key={`menu:${menuCode}`}>
                    <input
                      type="checkbox"
                      aria-label={`契约 ${contractType} 的菜单 ${menuCode}`}
                      checked={(
                        draft.contractMenus[contractType] ??
                        model.contractMenus[contractType] ??
                        []
                      ).includes(menuCode)}
                      onChange={() =>
                        setDraft((current) =>
                          toggleContractOwner(current, model, contractType, menuCode, "menu"),
                        )
                      }
                    />
                    菜单 <code>{menuCode}</code>
                  </label>
                ))}
                {widgets.map((widgetCode) => (
                  <label key={`widget:${widgetCode}`}>
                    <input
                      type="checkbox"
                      aria-label={`契约 ${contractType} 的组件 ${widgetCode}`}
                      checked={(
                        draft.contractWidgets[contractType] ??
                        model.contractWidgets[contractType] ??
                        []
                      ).includes(widgetCode)}
                      onChange={() =>
                        setDraft((current) =>
                          toggleContractOwner(current, model, contractType, widgetCode, "widget"),
                        )
                      }
                    />
                    组件 <code>{widgetCode}</code>
                  </label>
                ))}
              </fieldset>
            ))}
        </div>
      </div>

      <div className="impact-summary" aria-live="polite">
        <strong>影响预览</strong>
        <span>
          角色授权 +{impact.addedRolePermissions.length} / -{impact.removedRolePermissions.length}
        </span>
        <span>
          契约模块 +{impact.addedContractOwners.length} / -{impact.removedContractOwners.length}
        </span>
        <span>影响场景 {impact.scenarios.length}</span>
      </div>

      <label className="reason-control">
        <span>变更原因</span>
        <textarea
          aria-label="变更原因"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder="至少 8 个字符，将写入提交和 Draft PR"
        />
      </label>
      {stale ? <p className="draft-warning">模型已过期，请先刷新 develop</p> : null}
      {error ? (
        <p className="draft-warning" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={() => void prepare()} disabled={!canPrepare}>
        {pending ? "验证中…" : "验证变更"}
      </button>
    </section>
  );
}
