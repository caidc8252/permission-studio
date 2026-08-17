"use client";

import { useEffect, useMemo, useState } from "react";

import { ChangeReview } from "@/src/components/studio/change-review";
import styles from "@/src/components/studio/pull-request-flow.module.css";
import {
  redactClientSecrets,
  useChangeJob,
  type ClientChangeJob,
  type PrepareIntent,
} from "@/src/components/studio/use-change-job";
import {
  buildImpactDiff,
  buildPermissionChange,
  createEmptyDraft,
  type ImpactDiff,
  type PermissionDraft,
} from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface PullRequestFlowProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  onDraftChange: (draft: PermissionDraft) => void;
  impact?: ImpactDiff;
  title?: string;
  reason?: string;
  onTitleChange?: (title: string) => void;
  onReasonChange?: (reason: string) => void;
  stale?: boolean;
  pending?: boolean;
  onJobChange?: (job: ClientChangeJob | null) => void;
  onPendingChange?: (pending: boolean) => void;
}

const INTENT_REQUEST_ID = "00000000000000000000000000";
type FlowStep = 1 | 2 | 3;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function isMetadataValueValid(value: string, maximum: number): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= maximum && !hasControlCharacter(trimmed);
}

function sanitizeRecoveryText(value: string): string {
  const redacted = redactClientSecrets(value).replace(
    /[A-Za-z]:\\+(?:[^\\\s"'{}]+\\+)*[^\\\s"'{}]*/g,
    "[REDACTED]",
  );
  return [...redacted]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0x7e) ||
        codePoint >= 0xa0
      );
    })
    .join("")
    .slice(0, 4_000);
}

function safeRecoveryCommand(command?: string): string | null {
  if (!command) return null;
  const sanitized = sanitizeRecoveryText(command).trim();
  return /^gh pr create(?: [A-Za-z0-9_./:-]+)+$/.test(sanitized) ? sanitized : null;
}

function safePrUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function failedAfterConfirmation(job: ClientChangeJob | null): boolean {
  if (job?.state !== "failed") return false;
  if (typeof job.confirmationNonce === "string") return job.confirmationNonce.trim() === "";
  return Boolean(job.recoveryCommand || job.prUrl);
}

function toIntent(
  model: PermissionStudioModel,
  draft: PermissionDraft,
  title: string,
  reason: string,
): PrepareIntent {
  const change = buildPermissionChange(model, draft, {
    requestId: INTENT_REQUEST_ID,
    title: title.trim(),
    reason: reason.trim(),
  });
  return {
    baseSha: change.baseSha,
    title: change.title,
    reason: change.reason,
    newRoles: change.newRoles,
    deletedRoleCodes: change.deletedRoleCodes,
    roleChanges: change.roleChanges,
    contractChanges: change.contractChanges,
  };
}

export function PullRequestFlow({
  model,
  draft,
  onDraftChange,
  impact: suppliedImpact,
  title: suppliedTitle,
  reason: suppliedReason,
  onTitleChange,
  onReasonChange,
  stale = false,
  pending: externalPending = false,
  onJobChange,
  onPendingChange,
}: PullRequestFlowProps) {
  const [localTitle, setLocalTitle] = useState("");
  const [localReason, setLocalReason] = useState("");
  const [diffInspected, setDiffInspected] = useState(false);
  const [activeStep, setActiveStep] = useState<FlowStep>(1);
  const controller = useChangeJob(model.sourceSha);
  const { job } = controller;
  const impact = useMemo(
    () => suppliedImpact ?? buildImpactDiff(model, draft),
    [draft, model, suppliedImpact],
  );
  const title = suppliedTitle ?? localTitle;
  const reason = suppliedReason ?? localReason;
  const titleValid = isMetadataValueValid(title, 120);
  const reasonValid = isMetadataValueValid(reason, 500);
  const hasChanges =
    impact.addedRoles.length +
      (impact.deletedRoleCodes?.length ?? 0) +
      impact.renamedRoles.length +
      impact.updatedRoleNames.length +
      impact.addedRolePermissions.length +
      impact.removedRolePermissions.length +
      impact.addedContractOwners.length +
      impact.removedContractOwners.length >
    0;
  const busy = externalPending || controller.pending;
  const locked = busy || job !== null;
  const canPrepare = hasChanges && titleValid && reasonValid && !stale && !locked;
  const recoveryCommand = safeRecoveryCommand(job?.recoveryCommand);
  const failureSummary = job?.failureSummary ? sanitizeRecoveryText(job.failureSummary) : null;
  const prUrl = safePrUrl(job?.prUrl);
  const hasVisibleDiff = Boolean(job?.diff?.trim());
  const isFinalizationFailure = failedAfterConfirmation(job);
  const isValidationFailure = job?.state === "failed" && !isFinalizationFailure;
  useEffect(() => {
    setDiffInspected(false);
    if (!job) setActiveStep(1);
    else setActiveStep(failedAfterConfirmation(job) || job.state === "completed" ? 3 : 2);
  }, [job?.confirmationNonce, job?.requestId, job?.state]);

  useEffect(() => {
    onJobChange?.(job);
  }, [job, onJobChange]);

  useEffect(() => {
    onPendingChange?.(controller.pending);
  }, [controller.pending, onPendingChange]);

  const changeTitle = (value: string) => {
    if (suppliedTitle === undefined) setLocalTitle(value);
    onTitleChange?.(value);
  };
  const changeReason = (value: string) => {
    if (suppliedReason === undefined) setLocalReason(value);
    onReasonChange?.(value);
  };
  const prepare = async () => {
    if (!canPrepare) return;
    setDiffInspected(false);
    setActiveStep(2);
    await controller.prepare(toIntent(model, draft, title, reason));
  };
  const discard = async () => {
    await controller.discard();
    setDiffInspected(false);
    setActiveStep(1);
  };
  const startNewChange = () => {
    controller.clearCompleted();
    onDraftChange(createEmptyDraft());
    changeTitle("");
    changeReason("");
    setDiffInspected(false);
    setActiveStep(1);
  };
  const recoveryPanel = (validationFailure: boolean) => (
    <div className={styles.recovery} role="alert">
      <p>
        {validationFailure
          ? "变更校验失败，未进入最终确认"
          : job?.errorCode === "PR_CREATE_FAILED"
            ? "远端分支已保留，请手动创建 Draft PR"
            : job?.errorCode === "FINALIZE_FAILED"
              ? "推送失败，未创建 Draft PR"
              : "最终处理失败，未创建 Draft PR"}
      </p>
      {recoveryCommand ? (
        <code>{recoveryCommand}</code>
      ) : job?.recoveryCommand ? (
        <p>恢复命令未通过安全检查，已隐藏。</p>
      ) : null}
      {failureSummary ? <pre aria-label="脱敏失败日志">{failureSummary}</pre> : null}
      <button type="button" disabled={busy} onClick={() => void discard()}>
        丢弃并清理失败现场
      </button>
    </div>
  );

  return (
    <section className={styles.flow} aria-label="Draft PR 创建流程">
      <ol className={styles.steps} aria-label="Draft PR 三步流程">
        <li
          aria-current={activeStep === 1 ? "step" : undefined}
          data-completed={activeStep > 1 || undefined}
        >
          1. 业务检查
        </li>
        <li
          aria-current={activeStep === 2 ? "step" : undefined}
          data-completed={activeStep > 2 || undefined}
        >
          2. 校验与 diff
        </li>
        <li aria-current={activeStep === 3 ? "step" : undefined}>3. 最终确认</li>
      </ol>

      {activeStep === 1 ? (
        <section className={styles.stage} aria-labelledby="pr-stage-one">
          <h2 id="pr-stage-one">第 1 步：检查业务变更</h2>
          <div className={styles.review}>
            <ChangeReview
              model={model}
              draft={draft}
              onDraftChange={onDraftChange}
              disabled={locked}
            />
          </div>
          <div className={styles.metadata}>
            <label>
              <span>PR 标题</span>
              <input
                type="text"
                aria-label="PR 标题"
                aria-invalid={title.length > 0 && !titleValid}
                aria-describedby="pr-title-help"
                value={title}
                maxLength={120}
                disabled={locked}
                onChange={(event) => changeTitle(event.target.value)}
              />
            </label>
            <p id="pr-title-help">
              {title.length > 0 && !titleValid
                ? "PR 标题必须为 8–120 个字符，且不能包含控制字符"
                : "使用 8–120 个字符概括权限变更"}
            </p>
            <label>
              <span>变更原因</span>
              <textarea
                aria-label="变更原因"
                aria-invalid={reason.length > 0 && !reasonValid}
                aria-describedby="pr-reason-help"
                value={reason}
                maxLength={500}
                rows={4}
                disabled={locked}
                onChange={(event) => changeReason(event.target.value)}
              />
            </label>
            <p id="pr-reason-help">
              {reason.length > 0 && !reasonValid
                ? "变更原因必须为 8–500 个字符，且不能包含控制字符"
                : "说明业务目的和受影响的使用场景"}
            </p>
          </div>
          {stale ? <p className={styles.warning}>模型已过期，请先刷新 develop</p> : null}
          <div className={styles.stageNavigation}>
            <button
              className={styles.next}
              type="button"
              disabled={job ? busy : !canPrepare}
              onClick={() => {
                if (job) setActiveStep(2);
                else void prepare();
              }}
            >
              {busy && !job ? "正在校验…" : "下一步：校验与 diff"}
            </button>
          </div>
        </section>
      ) : null}

      {controller.error ? (
        <p className={styles.warning} role="alert">
          {controller.error}
        </p>
      ) : null}
      {controller.message ? (
        <p className={styles.message} role="status">
          {controller.message}
        </p>
      ) : null}

      {activeStep === 2 ? (
        <section className={styles.stage} aria-labelledby="pr-stage-two">
          <h2 id="pr-stage-two">第 2 步：校验与完整 diff</h2>
          {job ? (
            <p>
              请求 ID：<code>{job.requestId}</code>
            </p>
          ) : (
            <p role="status">正在准备校验…</p>
          )}
          {job?.validationSteps?.length ? (
            <ul className={styles.validation} aria-label="校验结果">
              {job.validationSteps.map((step) => (
                <li key={step.name}>
                  <strong>{step.name}</strong>
                  <span>
                    <span aria-hidden="true">✓ </span>通过 · {step.durationMs} ms
                  </span>
                </li>
              ))}
            </ul>
          ) : job && !isValidationFailure ? (
            <p role="status">正在等待校验结果…</p>
          ) : null}
          {hasVisibleDiff ? (
            <pre className={styles.diff} aria-label="服务器生成的完整 Git diff">
              {job?.diff}
            </pre>
          ) : null}
          {job?.state === "awaiting-confirmation" && !hasVisibleDiff ? (
            <p className={styles.warning} role="alert">
              未收到完整 diff，无法进入最终确认。
            </p>
          ) : null}
          {job?.state === "awaiting-confirmation" && hasVisibleDiff ? (
            <label className={styles.inspection}>
              <input
                type="checkbox"
                aria-label="已检查完整 diff"
                checked={diffInspected}
                onChange={(event) => setDiffInspected(event.target.checked)}
              />
              已检查完整 diff
            </label>
          ) : null}
          {isValidationFailure ? recoveryPanel(true) : null}
          <div className={styles.stageNavigation}>
            <button type="button" disabled={busy} onClick={() => void discard()}>
              上一步
            </button>
            {job?.state === "awaiting-confirmation" ? (
              <button type="button" disabled={busy} onClick={() => void discard()}>
                丢弃准备结果
              </button>
            ) : null}
            <button
              className={styles.next}
              type="button"
              disabled={
                job?.state !== "awaiting-confirmation" || !diffInspected || !hasVisibleDiff || busy
              }
              onClick={() => setActiveStep(3)}
            >
              下一步：最终确认
            </button>
          </div>
        </section>
      ) : null}

      {activeStep === 3 && job && !isValidationFailure ? (
        <section className={styles.stage} aria-labelledby="pr-stage-three">
          <h2 id="pr-stage-three">第 3 步：最终确认</h2>
          {job.state === "validating" ? <p role="status">正在校验变更，请稍候。</p> : null}
          {job.state === "awaiting-confirmation" ? (
            <div className={styles.actions}>
              <p>最终确认后将推送远端分支并创建 Draft PR。</p>
              <button type="button" disabled={busy} onClick={() => setActiveStep(2)}>
                上一步
              </button>
              <button
                type="button"
                disabled={!diffInspected || !hasVisibleDiff || busy}
                onClick={() => {
                  if (diffInspected && hasVisibleDiff) void controller.confirm();
                }}
              >
                确认推送并创建 Draft PR
              </button>
              <button type="button" disabled={busy} onClick={() => void discard()}>
                丢弃准备结果
              </button>
            </div>
          ) : null}
          {job.state === "finalizing" ? (
            <p className={styles.message} role="status">
              正在推送并创建 Draft PR…
            </p>
          ) : null}
          {job.state === "completed" ? (
            <div className={styles.actions}>
              <p className={styles.success} role="status">
                Draft PR 已创建
              </p>
              {prUrl ? (
                <a className={styles.prLink} href={prUrl} target="_blank" rel="noreferrer">
                  打开 Draft PR
                </a>
              ) : (
                <p className={styles.warning}>服务器未返回可安全打开的 PR 地址</p>
              )}
              <button type="button" onClick={startNewChange}>
                开始新变更
              </button>
            </div>
          ) : null}
          {job.state === "failed" ? recoveryPanel(false) : null}
        </section>
      ) : null}
    </section>
  );
}
