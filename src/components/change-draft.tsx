"use client";

import { useEffect, useMemo, useState } from "react";

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
  onPrepare?: (intent: PrepareIntent) => void | Promise<void>;
}

interface ClientChangeJob {
  requestId: string;
  state: "validating" | "awaiting-confirmation" | "finalizing" | "completed" | "failed";
  confirmationNonce?: string;
  validationSteps?: Array<{ name: string; status: "passed"; durationMs: number }>;
  diff?: string;
  errorCode?: string;
  prUrl?: string;
  recoveryCommand?: string;
}

class HttpFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok) {
    throw new HttpFlowError(body.code ?? "REQUEST_FAILED", body.message ?? "请求失败");
  }
  return body;
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
  const [job, setJob] = useState<ClientChangeJob | null>(null);
  const [diffInspected, setDiffInspected] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);
  const impact = useMemo(() => buildImpactDiff(model, draft), [draft, model]);
  const roleChangeCount = impact.addedRolePermissions.length + impact.removedRolePermissions.length;
  const contractChangeCount =
    impact.addedContractOwners.length + impact.removedContractOwners.length;
  const hasChanges = roleChangeCount + contractChangeCount > 0;
  const busy = pending || internalPending;
  const editingLocked = busy || job !== null;
  const canPrepare = hasChanges && isReasonReady(reason) && !stale && !editingLocked;
  const storageKey = `permission-studio:change:${model.sourceSha}`;
  const menus = ownerCodes(model, "menu");
  const widgets = ownerCodes(model, "widget");

  const refreshJob = async (requestId: string) => {
    const response = await fetch(`/api/changes/${requestId}`, { cache: "no-store" });
    if (response.status === 404) {
      window.sessionStorage.removeItem(storageKey);
      setJob(null);
      setFlowMessage("准备结果已过期或被丢弃");
      return null;
    }
    const current = await responseJson<ClientChangeJob>(response);
    setJob(current);
    return current;
  };

  useEffect(() => {
    const requestId = window.sessionStorage.getItem(storageKey);
    if (requestId)
      void refreshJob(requestId).catch(() => window.sessionStorage.removeItem(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (job) window.sessionStorage.setItem(storageKey, job.requestId);
  }, [job, storageKey]);

  useEffect(() => {
    if (job?.state !== "validating" && job?.state !== "finalizing") return;
    const timer = window.setTimeout(() => {
      void refreshJob(job.requestId).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "无法刷新变更状态");
      });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [job]);

  const prepare = async () => {
    if (!canPrepare) return;
    setError(null);
    setFlowMessage(null);
    setInternalPending(true);
    try {
      const intent = toIntent(model, draft, reason);
      if (onPrepare) {
        await onPrepare(intent);
      } else {
        const prepared = await responseJson<ClientChangeJob>(
          await fetch("/api/changes/prepare", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(intent),
          }),
        );
        setDiffInspected(false);
        setJob(prepared);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法验证变更");
    } finally {
      setInternalPending(false);
    }
  };

  const confirm = async () => {
    if (!job?.confirmationNonce || !diffInspected || job.state !== "awaiting-confirmation") return;
    setInternalPending(true);
    setError(null);
    try {
      const completed = await responseJson<ClientChangeJob>(
        await fetch(`/api/changes/${job.requestId}/confirm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce: job.confirmationNonce }),
        }),
      );
      setJob(completed);
    } catch (cause) {
      await refreshJob(job.requestId).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "无法完成远端写入");
    } finally {
      setInternalPending(false);
    }
  };

  const discard = async () => {
    if (!job) return;
    setInternalPending(true);
    try {
      const response = await fetch(`/api/changes/${job.requestId}`, { method: "DELETE" });
      if (!response.ok) await responseJson(response);
      setJob(null);
      window.sessionStorage.removeItem(storageKey);
      setFlowMessage("变更草稿已丢弃");
      setDiffInspected(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法丢弃变更草稿");
    } finally {
      setInternalPending(false);
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
          disabled={!hasChanges || editingLocked}
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
                      disabled={editingLocked}
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
                      disabled={editingLocked}
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
                      disabled={editingLocked}
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
          disabled={editingLocked}
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
        {busy && !job ? "验证中…" : "验证变更"}
      </button>

      {flowMessage ? (
        <p className="flow-message" role="status">
          {flowMessage}
        </p>
      ) : null}
      {job ? (
        <section className="prepared-change" aria-labelledby="prepared-change-heading">
          <h3 id="prepared-change-heading">
            {job.state === "validating"
              ? "正在验证变更"
              : job.state === "awaiting-confirmation"
                ? "等待最终确认"
                : job.state === "finalizing"
                  ? "正在推送并创建 Draft PR"
                  : job.state === "completed"
                    ? "Draft PR 已创建"
                    : "变更未完成"}
          </h3>
          {job.validationSteps?.length ? (
            <ul className="validation-results">
              {job.validationSteps.map((step) => (
                <li key={step.name}>
                  <strong>{step.name}</strong>
                  <span>通过 · {step.durationMs} ms</span>
                </li>
              ))}
            </ul>
          ) : null}
          {job.diff ? (
            <pre className="prepared-diff" aria-label="准备好的变更 diff">
              {job.diff}
            </pre>
          ) : null}
          {job.state === "awaiting-confirmation" ? (
            <div className="confirmation-actions">
              <label>
                <input
                  type="checkbox"
                  aria-label="我已检查 diff"
                  checked={diffInspected}
                  onChange={(event) => setDiffInspected(event.target.checked)}
                />
                我已检查上方完整 diff
              </label>
              <button
                type="button"
                disabled={!diffInspected || busy}
                onClick={() => void confirm()}
              >
                确认推送并创建 Draft PR
              </button>
              <button type="button" disabled={busy} onClick={() => void discard()}>
                丢弃准备结果
              </button>
            </div>
          ) : null}
          {job.state === "completed" && job.prUrl ? (
            <a href={job.prUrl} target="_blank" rel="noreferrer">
              打开 Draft PR
            </a>
          ) : null}
          {job.state === "failed" ? (
            <div className="recovery-panel" role="alert">
              <p>
                {job.errorCode === "PR_CREATE_FAILED"
                  ? "远端分支已保留，请手动创建 Draft PR"
                  : job.errorCode === "FINALIZE_FAILED"
                    ? "推送失败，未创建 Draft PR"
                    : "变更校验或远端写入失败"}
              </p>
              {job.recoveryCommand ? <code>{job.recoveryCommand}</code> : null}
              <button type="button" disabled={busy} onClick={() => void discard()}>
                丢弃并清理失败现场
              </button>
            </div>
          ) : null}
          {job.state === "completed" ? (
            <button
              type="button"
              onClick={() => {
                window.sessionStorage.removeItem(storageKey);
                setJob(null);
                setDraft(createEmptyDraft());
                setReason("");
              }}
            >
              开始新变更
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
