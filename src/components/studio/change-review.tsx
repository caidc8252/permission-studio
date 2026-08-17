"use client";

import {
  buildImpactDiff,
  createEmptyDraft,
  discardContractDraft,
  discardDraftItem,
  discardRoleDraft,
  type DraftItemRef,
  type PermissionDraft,
} from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  translatedModelText,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";
import styles from "@/src/components/studio/change-review.module.css";

export interface ChangeReviewProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  onDraftChange: (draft: PermissionDraft) => void;
  disabled?: boolean;
}

interface ReviewItem {
  id: string;
  label: string;
  code: string;
  change: "新增" | "移除";
  kindLabel: "权限" | "菜单" | "组件";
  ref: DraftItemRef;
}

function permissionLabel(
  model: PermissionStudioModel,
  locale: PermissionStudioLocale,
  code: string,
): string {
  const permission = model.permissionRegistry[code];
  return permission ? translatedModelText(model, locale, permission.label, code) : code;
}

function ownerLabel(
  model: PermissionStudioModel,
  locale: PermissionStudioLocale,
  owner: string,
  kind: "menu" | "widget",
): string {
  if (kind === "menu") {
    const menu = model.menuRegistry[owner];
    return menu ? translatedModelText(model, locale, menu.title, owner) : owner;
  }
  const permission = Object.values(model.permissionRegistry)
    .filter((candidate) => candidate.belongToMenuCode === owner)
    .sort((left, right) => left.code.localeCompare(right.code))[0];
  return permission ? translatedModelText(model, locale, permission.label, owner) : owner;
}

function ChangeList({
  title,
  items,
  onUndo,
  disabled,
}: {
  title: string;
  items: ReviewItem[];
  onUndo: (item: ReviewItem) => void;
  disabled: boolean;
}) {
  if (!items.length) return null;
  const tone = items[0]!.change === "新增" ? "added" : "removed";
  return (
    <section className={styles.changeList} aria-label={title} data-tone={tone}>
      <h4>{title}</h4>
      <ul className={styles.items}>
        {items.map((item) => (
          <li className={styles.changeItem} key={item.id}>
            <span className={styles.marker} aria-hidden="true">
              {item.change === "新增" ? "+" : "−"}
            </span>
            <span className={styles.itemCopy}>
              <strong>{item.label}</strong>
              <code>{item.code}</code>
            </span>
            <button
              className={styles.undoItem}
              type="button"
              disabled={disabled}
              aria-label={`撤销 ${item.label}`}
              onClick={() => onUndo(item)}
            >
              撤销
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChangeReview({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
  onDraftChange,
  disabled = false,
}: ChangeReviewProps) {
  const impact = buildImpactDiff(model, draft);
  const roleCodes = [
    ...new Set(
      [
        ...impact.addedRoles.map((role) => ({ roleCode: role.code })),
        ...(impact.deletedRoleCodes ?? []).map((roleCode) => ({ roleCode })),
        ...impact.renamedRoles.map((role) => ({ roleCode: role.oldCode })),
        ...impact.updatedRoleNames,
        ...impact.addedRolePermissions,
        ...impact.removedRolePermissions,
      ].map((item) => item.roleCode),
    ),
  ].sort();
  const contractTypes = [
    ...new Set(
      [...impact.addedContractOwners, ...impact.removedContractOwners].map(
        (item) => item.contractType,
      ),
    ),
  ].sort();
  const total =
    impact.addedRoles.length +
    (impact.deletedRoleCodes?.length ?? 0) +
    impact.renamedRoles.length +
    impact.updatedRoleNames.length +
    impact.addedRolePermissions.length +
    impact.removedRolePermissions.length +
    impact.addedContractOwners.length +
    impact.removedContractOwners.length;
  const undoItem = (item: ReviewItem) => onDraftChange(discardDraftItem(draft, model, item.ref));

  return (
    <section className={styles.review} aria-labelledby="change-review-heading">
      <header className={styles.summary}>
        <div className={styles.summaryCopy}>
          <span className={styles.eyebrow}>提交前确认</span>
          <h2 id="change-review-heading">业务变更检查</h2>
          <p className={styles.summaryText}>
            {total ? (
              <>
                共 <strong>{total}</strong> 项待提交变更
              </>
            ) : (
              "当前没有待提交变更"
            )}
          </p>
        </div>
        <button
          className={styles.resetAll}
          type="button"
          disabled={!total || disabled}
          onClick={() => onDraftChange(createEmptyDraft())}
        >
          撤销全部变更
        </button>
      </header>

      {total ? (
        <div className={styles.cards}>
          {roleCodes.map((roleCode) => {
            const role = model.roles.find((candidate) => candidate.code === roleCode);
            const newRole = impact.addedRoles.find((candidate) => candidate.code === roleCode);
            const renamedRole = impact.renamedRoles.find(
              (candidate) => candidate.oldCode === roleCode,
            );
            const deletedRole = (impact.deletedRoleCodes ?? []).includes(roleCode);
            const updatedNames = impact.updatedRoleNames.find(
              (candidate) => candidate.roleCode === roleCode,
            );
            const roleLabel = updatedNames
              ? updatedNames.newNames[locale]
              : role
                ? translatedModelText(model, locale, role.roleName, roleCode)
                : (newRole?.names[locale] ?? roleCode);
            const additions: ReviewItem[] = impact.addedRolePermissions
              .filter((item) => item.roleCode === roleCode)
              .map((item) => ({
                id: `role:add:${roleCode}:${item.code}`,
                label: permissionLabel(model, locale, item.code),
                code: item.code,
                change: "新增",
                kindLabel: "权限",
                ref: { kind: "permission", ownerCode: roleCode, code: item.code },
              }));
            const removals: ReviewItem[] = impact.removedRolePermissions
              .filter((item) => item.roleCode === roleCode)
              .map((item) => ({
                id: `role:remove:${roleCode}:${item.code}`,
                label: permissionLabel(model, locale, item.code),
                code: item.code,
                change: "移除",
                kindLabel: "权限",
                ref: { kind: "permission", ownerCode: roleCode, code: item.code },
              }));
            return (
              <article className={styles.card} key={roleCode}>
                <header className={styles.cardHeader}>
                  <div className={styles.entity}>
                    <span className={styles.entityKind}>
                      {newRole ? "新增角色" : deletedRole ? "删除角色" : "角色"}
                    </span>
                    <span className={styles.entityIdentity}>
                      <h3>{roleLabel}</h3>
                      <code>
                        {renamedRole ? `${renamedRole.oldCode} → ${renamedRole.newCode}` : roleCode}
                        {newRole ? ` · ID ${newRole.roleId}` : ""}
                      </code>
                      {newRole ? (
                        <small className={styles.roleTranslations}>
                          EN: {newRole.names.en} · 日本語: {newRole.names.ja}
                        </small>
                      ) : null}
                      {updatedNames ? (
                        <small className={styles.roleTranslations}>
                          名称：{updatedNames.oldNames[locale]} → {updatedNames.newNames[locale]} ·
                          EN: {updatedNames.newNames.en} · 日本語: {updatedNames.newNames.ja}
                        </small>
                      ) : null}
                    </span>
                  </div>
                  <button
                    className={styles.undoGroup}
                    type="button"
                    disabled={disabled}
                    aria-label={`撤销角色 ${roleLabel} 的全部变更`}
                    onClick={() => onDraftChange(discardRoleDraft(draft, roleCode))}
                  >
                    撤销此角色
                  </button>
                </header>
                {deletedRole ? (
                  <p className={styles.deletionNote}>将删除角色定义以及中文、英文、日文资源。</p>
                ) : (
                  <div className={styles.changeLists}>
                    <ChangeList
                      title={`新增权限 ${additions.length} 项`}
                      items={additions}
                      onUndo={undoItem}
                      disabled={disabled}
                    />
                    <ChangeList
                      title={`移除权限 ${removals.length} 项`}
                      items={removals}
                      onUndo={undoItem}
                      disabled={disabled}
                    />
                  </div>
                )}
              </article>
            );
          })}

          {contractTypes.map((contractType) => {
            const contractItems = (
              change: "新增" | "移除",
              kind: "menu" | "widget",
            ): ReviewItem[] => {
              const source =
                change === "新增" ? impact.addedContractOwners : impact.removedContractOwners;
              return source
                .filter((item) => item.contractType === contractType && item.kind === kind)
                .map((item) => ({
                  id: `contract:${change}:${contractType}:${kind}:${item.owner}`,
                  label: ownerLabel(model, locale, item.owner, kind),
                  code: item.owner,
                  change,
                  kindLabel: kind === "menu" ? "菜单" : "组件",
                  ref: { kind, ownerCode: contractType, code: item.owner },
                }));
            };
            const lists = [
              contractItems("新增", "menu"),
              contractItems("移除", "menu"),
              contractItems("新增", "widget"),
              contractItems("移除", "widget"),
            ];
            return (
              <article className={styles.card} key={contractType}>
                <header className={styles.cardHeader}>
                  <div className={styles.entity}>
                    <span className={styles.entityKind}>合同</span>
                    <span className={styles.entityIdentity}>
                      <h3>{contractType}</h3>
                    </span>
                  </div>
                  <button
                    className={styles.undoGroup}
                    type="button"
                    disabled={disabled}
                    aria-label={`撤销合同 ${contractType} 的全部变更`}
                    onClick={() => onDraftChange(discardContractDraft(draft, contractType))}
                  >
                    撤销此合同
                  </button>
                </header>
                <div className={styles.changeLists}>
                  {lists.map((items, index) => {
                    const sample = items[0];
                    const kindLabel = index < 2 ? "菜单" : "组件";
                    const change = index % 2 === 0 ? "新增" : "移除";
                    return (
                      <ChangeList
                        key={`${change}:${kindLabel}`}
                        title={`${change}${sample?.kindLabel ?? kindLabel} ${items.length} 项`}
                        items={items}
                        onUndo={undoItem}
                        disabled={disabled}
                      />
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>没有需要审阅的内容</strong>
          <span>返回编辑后添加或移除权限，变更会汇总显示在这里。</span>
        </div>
      )}
    </section>
  );
}
