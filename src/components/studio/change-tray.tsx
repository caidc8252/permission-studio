"use client";

import type { ImpactDiff } from "@/src/domain/draft";
import styles from "@/src/components/studio/studio-shell.module.css";

export interface ChangeTrayProps {
  impact: ImpactDiff;
  currentObject?: { scenario: string; label: string };
  onDiscardAll?: () => void;
  onReview: () => void;
  onGeneratePr?: () => void;
  disabled?: boolean;
  reviewDisabled?: boolean;
  generatePrDisabled?: boolean;
}

function countScenario(impact: ImpactDiff, scenario: string): number {
  const [kind, ownerCode] = scenario.split(":", 2);
  if (kind === "role") {
    return [...impact.addedRolePermissions, ...impact.removedRolePermissions].filter(
      (item) => item.roleCode === ownerCode,
    ).length;
  }
  if (kind === "contract") {
    return [...impact.addedContractOwners, ...impact.removedContractOwners].filter(
      (item) => item.contractType === ownerCode,
    ).length;
  }
  return 0;
}

export function ChangeTray({
  impact,
  currentObject,
  onDiscardAll,
  onReview,
  onGeneratePr,
  disabled = false,
  reviewDisabled = false,
  generatePrDisabled = false,
}: ChangeTrayProps) {
  const additions = impact.addedRolePermissions.length + impact.addedContractOwners.length;
  const removals = impact.removedRolePermissions.length + impact.removedContractOwners.length;
  const total = additions + removals;
  if (!total) return null;

  const discardAll = () => {
    if (window.confirm("确定丢弃草稿中的全部变更吗？")) onDiscardAll?.();
  };

  return (
    <aside className={styles.tray} aria-label="变更草稿">
      <div className={styles.traySummary}>
        <strong>草稿中有 {total} 项变更</strong>
        <span>
          新增 {additions} 项 · 移除 {removals} 项
        </span>
        {currentObject ? (
          <span>
            当前{currentObject.label}：{countScenario(impact, currentObject.scenario)} 项变更
          </span>
        ) : null}
      </div>
      <div className={styles.trayActions}>
        <button
          className={styles.dangerAction}
          type="button"
          disabled={disabled || !onDiscardAll}
          onClick={discardAll}
        >
          丢弃全部
        </button>
        <button type="button" disabled={reviewDisabled} onClick={onReview}>
          查看变更
        </button>
        <button
          className={styles.primaryAction}
          type="button"
          disabled={disabled || generatePrDisabled || !onGeneratePr}
          onClick={onGeneratePr}
        >
          生成 Draft PR
        </button>
      </div>
    </aside>
  );
}
