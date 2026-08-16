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

export interface ChangeReviewProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
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

function translated(model: PermissionStudioModel, key: string, fallback: string): string {
  return model.translations["zh-CN"][key] ?? fallback;
}

function permissionLabel(model: PermissionStudioModel, code: string): string {
  const permission = model.permissionRegistry[code];
  return permission ? translated(model, permission.label, code) : code;
}

function ownerLabel(model: PermissionStudioModel, owner: string, kind: "menu" | "widget"): string {
  if (kind === "menu") {
    const menu = model.menuRegistry[owner];
    return menu ? translated(model, menu.title, owner) : owner;
  }
  const permission = Object.values(model.permissionRegistry)
    .filter((candidate) => candidate.belongToMenuCode === owner)
    .sort((left, right) => left.code.localeCompare(right.code))[0];
  return permission ? translated(model, permission.label, owner) : owner;
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
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span aria-hidden="true">{item.change === "新增" ? "+" : "−"}</span>
            <span>{item.label}</span>
            <code>{item.code}</code>
            <button
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

export function ChangeReview({ model, draft, onDraftChange, disabled = false }: ChangeReviewProps) {
  const impact = buildImpactDiff(model, draft);
  const roleCodes = [
    ...new Set(
      [...impact.addedRolePermissions, ...impact.removedRolePermissions].map(
        (item) => item.roleCode,
      ),
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
    impact.addedRolePermissions.length +
    impact.removedRolePermissions.length +
    impact.addedContractOwners.length +
    impact.removedContractOwners.length;
  const undoItem = (item: ReviewItem) => onDraftChange(discardDraftItem(draft, model, item.ref));

  return (
    <section aria-labelledby="change-review-heading">
      <header>
        <div>
          <h2 id="change-review-heading">业务变更检查</h2>
          <p>{total ? `共 ${total} 项待提交变更` : "当前没有待提交变更"}</p>
        </div>
        <button
          type="button"
          disabled={!total || disabled}
          onClick={() => onDraftChange(createEmptyDraft())}
        >
          撤销全部变更
        </button>
      </header>

      {roleCodes.map((roleCode) => {
        const role = model.roles.find((candidate) => candidate.code === roleCode);
        const roleLabel = role ? translated(model, role.roleName, roleCode) : roleCode;
        const additions: ReviewItem[] = impact.addedRolePermissions
          .filter((item) => item.roleCode === roleCode)
          .map((item) => ({
            id: `role:add:${roleCode}:${item.code}`,
            label: permissionLabel(model, item.code),
            code: item.code,
            change: "新增",
            kindLabel: "权限",
            ref: { kind: "permission", ownerCode: roleCode, code: item.code },
          }));
        const removals: ReviewItem[] = impact.removedRolePermissions
          .filter((item) => item.roleCode === roleCode)
          .map((item) => ({
            id: `role:remove:${roleCode}:${item.code}`,
            label: permissionLabel(model, item.code),
            code: item.code,
            change: "移除",
            kindLabel: "权限",
            ref: { kind: "permission", ownerCode: roleCode, code: item.code },
          }));
        return (
          <article key={roleCode}>
            <header>
              <div>
                <span>角色</span>
                <h3>{roleLabel}</h3>
                <code>{roleCode}</code>
              </div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`撤销角色 ${roleLabel} 的全部变更`}
                onClick={() => onDraftChange(discardRoleDraft(draft, roleCode))}
              >
                撤销此角色
              </button>
            </header>
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
          </article>
        );
      })}

      {contractTypes.map((contractType) => {
        const contractItems = (change: "新增" | "移除", kind: "menu" | "widget"): ReviewItem[] => {
          const source =
            change === "新增" ? impact.addedContractOwners : impact.removedContractOwners;
          return source
            .filter((item) => item.contractType === contractType && item.kind === kind)
            .map((item) => ({
              id: `contract:${change}:${contractType}:${kind}:${item.owner}`,
              label: ownerLabel(model, item.owner, kind),
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
          <article key={contractType}>
            <header>
              <div>
                <span>合同</span>
                <h3>{contractType}</h3>
              </div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`撤销合同 ${contractType} 的全部变更`}
                onClick={() => onDraftChange(discardContractDraft(draft, contractType))}
              >
                撤销此合同
              </button>
            </header>
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
          </article>
        );
      })}
    </section>
  );
}
