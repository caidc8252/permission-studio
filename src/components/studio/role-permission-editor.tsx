"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DualListEditor,
  type TransferLabels,
  type TransferRequest,
} from "@/src/components/studio/dual-list-editor";
import { EditRoleCodeForm } from "@/src/components/studio/edit-role-code-form";
import { NewRoleForm } from "@/src/components/studio/new-role-form";
import styles from "@/src/components/studio/role-permission-editor.module.css";
import {
  buildImpactDiff,
  applyDraftToModel,
  createEmptyDraft,
  deleteRole,
  originalRoleCode,
  setNewRolePermissionMembership,
  setRolePermissionMembership,
  type PermissionDraft,
} from "@/src/domain/draft";
import { buildRoleEditorView } from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  defaultPermissionStudioLocale,
  translatedModelText,
  type PermissionStudioLocale,
} from "@/src/domain/model-i18n";

export interface RolePermissionEditorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  locale?: PermissionStudioLocale;
  selectedRoleCode?: string;
  onSelectedRoleCodeChange?: (roleCode: string) => void;
  onDraftChange: (draft: PermissionDraft) => void;
}

const transferLabels: TransferLabels = {
  search: "搜索权限",
  groupFilter: "权限分组",
  groupPlaceholder: "选择分组",
  clearGroupFilter: "清空权限分组",
  available: "可添加权限",
  assigned: "已分配权限",
  assignSelected: "添加已选权限",
  unassignSelected: "移除已选权限",
  empty: "没有匹配的权限",
  actions: "权限转移操作",
  noSelection: "请先选择权限",
  moved: (direction, count) =>
    direction === "assign" ? `已添加 ${count} 项权限` : `已移除 ${count} 项权限`,
};

function isEditableRole(roleCode: string): boolean {
  return roleCode.startsWith("preset_");
}

export function RolePermissionEditor({
  model,
  draft,
  locale = defaultPermissionStudioLocale,
  selectedRoleCode: initialRoleCode,
  onSelectedRoleCodeChange,
  onDraftChange,
}: RolePermissionEditorProps) {
  const editableRoles = useMemo(
    () => applyDraftToModel(model, draft).roles.filter((role) => isEditableRole(role.code)),
    [draft, model],
  );
  const projectedModel = useMemo(() => applyDraftToModel(model, draft), [draft, model]);
  const firstRoleCode = editableRoles[0]?.code ?? "";
  const [selectedRoleCode, setSelectedRoleCode] = useState(() =>
    editableRoles.some((role) => role.code === initialRoleCode) ? initialRoleCode! : firstRoleCode,
  );
  const [roleQuery, setRoleQuery] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingRoleCode, setEditingRoleCode] = useState<string | null>(null);
  const [editingExistingRoleCode, setEditingExistingRoleCode] = useState<string | null>(null);
  const [actionMenuRoleCode, setActionMenuRoleCode] = useState<string | null>(null);
  const [pendingRoleCode, setPendingRoleCode] = useState<string | null>(null);
  const activeRoleCode = editableRoles.some((role) => role.code === selectedRoleCode)
    ? selectedRoleCode
    : firstRoleCode;

  useEffect(() => {
    if (editableRoles.some((role) => role.code === initialRoleCode)) {
      setSelectedRoleCode(initialRoleCode!);
    } else if (!editableRoles.some((role) => role.code === selectedRoleCode)) {
      setSelectedRoleCode(firstRoleCode);
      if (firstRoleCode) onSelectedRoleCodeChange?.(firstRoleCode);
    }
  }, [editableRoles, firstRoleCode, initialRoleCode, onSelectedRoleCodeChange, selectedRoleCode]);

  useEffect(() => {
    if (!pendingRoleCode || !editableRoles.some((role) => role.code === pendingRoleCode)) return;
    setSelectedRoleCode(pendingRoleCode);
    onSelectedRoleCodeChange?.(pendingRoleCode);
    setPendingRoleCode(null);
  }, [editableRoles, onSelectedRoleCodeChange, pendingRoleCode]);

  const impact = useMemo(() => buildImpactDiff(model, draft), [draft, model]);
  const roleImpacts = useMemo(() => {
    return new Map(
      editableRoles.map((role) => [
        role.code,
        (() => {
          const sourceCode = originalRoleCode(draft, role.code);
          return (
            impact.addedRoles.filter((item) => item.code === role.code).length +
            impact.renamedRoles.filter((item) => item.oldCode === sourceCode).length +
            impact.updatedRoleNames.filter((item) => item.roleCode === sourceCode).length +
            impact.addedRolePermissions.filter((item) => item.roleCode === sourceCode).length +
            impact.removedRolePermissions.filter((item) => item.roleCode === sourceCode).length
          );
        })(),
      ]),
    );
  }, [draft, editableRoles, impact]);

  const normalizedRoleQuery = roleQuery.trim().toLocaleLowerCase();
  const sidebarRoles = editableRoles.filter((role) => {
    const matchesQuery =
      !normalizedRoleQuery ||
      [
        role.code,
        translatedModelText(projectedModel, locale, role.roleName, role.code),
        translatedModelText(projectedModel, locale, role.remark, role.code),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedRoleQuery));
    return matchesQuery && (!changesOnly || (roleImpacts.get(role.code) ?? 0) > 0);
  });

  const view = activeRoleCode
    ? buildRoleEditorView(projectedModel, createEmptyDraft(), activeRoleCode, locale)
    : null;
  const transfer = (request: TransferRequest) => {
    if (!view) return;
    const assigned = new Set(view.assigned.map((item) => item.id));
    for (const id of request.ids) {
      if (request.direction === "assign") assigned.add(id);
      else assigned.delete(id);
    }
    onDraftChange(
      draft.newRoles.some((role) => role.code === view.roleCode)
        ? setNewRolePermissionMembership(draft, model, view.roleCode, [...assigned])
        : setRolePermissionMembership(draft, model, originalRoleCode(draft, view.roleCode), [
            ...assigned,
          ]),
    );
  };

  return (
    <section className={styles.editor} aria-label="角色权限编辑器">
      <aside className={styles.sidebar} aria-label="可编辑角色">
        <label className={styles.search}>
          <span>搜索角色</span>
          <input
            type="search"
            aria-label="搜索角色"
            value={roleQuery}
            onChange={(event) => setRoleQuery(event.target.value)}
          />
        </label>
        <label className={styles.changesOnly}>
          <input
            type="checkbox"
            aria-label="仅显示有变更的角色"
            checked={changesOnly}
            onChange={(event) => setChangesOnly(event.target.checked)}
          />
          仅显示有变更的角色
        </label>
        <button className={styles.addRole} type="button" onClick={() => setCreatingRole(true)}>
          <span aria-hidden="true">＋</span>
          新增角色
        </button>
        <ul className={styles.roleList}>
          {sidebarRoles.map((role) => {
            const label = translatedModelText(projectedModel, locale, role.roleName, role.code);
            const translatedDescription = translatedModelText(
              projectedModel,
              locale,
              role.remark,
              "",
            );
            const description = translatedDescription === label ? "" : translatedDescription;
            const descriptionId = description ? `role-description-${role.code}` : undefined;
            const changeCount = roleImpacts.get(role.code) ?? 0;
            const isNewRole = draft.newRoles.some((item) => item.code === role.code);
            return (
              <li
                className={`${styles.roleCard} ${isNewRole ? styles.newRoleCard : ""}`}
                key={role.code}
              >
                <button
                  type="button"
                  className={styles.roleSelect}
                  aria-label={`${label}（${role.code}）`}
                  aria-describedby={descriptionId}
                  aria-pressed={role.code === activeRoleCode}
                  onClick={() => {
                    setCreatingRole(false);
                    setEditingRoleCode(null);
                    setEditingExistingRoleCode(null);
                    setActionMenuRoleCode(null);
                    setSelectedRoleCode(role.code);
                    onSelectedRoleCodeChange?.(role.code);
                  }}
                >
                  <span className={styles.roleIdentity}>
                    <span>{label}</span>
                    <code>{role.code}</code>
                  </span>
                  <span className={styles.roleFooter}>
                    {description ? (
                      <span
                        className={styles.roleDescription}
                        id={descriptionId}
                        title={description}
                      >
                        {description}
                      </span>
                    ) : (
                      <span className={styles.roleDescription} aria-hidden="true">
                        —
                      </span>
                    )}
                    <span
                      className={styles.roleCounts}
                      aria-label={`${role.permissionCodes.length} 项权限`}
                    >
                      <span>{role.permissionCodes.length} 项权限</span>
                      {changeCount ? (
                        <small aria-label={`${changeCount} 项变更`}>{changeCount}</small>
                      ) : null}
                    </span>
                  </span>
                </button>
                <div
                  className={styles.roleCardActions}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      setActionMenuRoleCode(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setActionMenuRoleCode(null);
                      event.currentTarget.querySelector("button")?.focus();
                    }
                  }}
                >
                  <button
                    type="button"
                    className={styles.roleCardMore}
                    aria-label={`角色操作：${label}`}
                    aria-haspopup="menu"
                    aria-expanded={actionMenuRoleCode === role.code}
                    onClick={() => {
                      setActionMenuRoleCode((current) =>
                        current === role.code ? null : role.code,
                      );
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                  {actionMenuRoleCode === role.code ? (
                    <div className={styles.roleCardMenu} role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActionMenuRoleCode(null);
                          setCreatingRole(false);
                          setSelectedRoleCode(role.code);
                          onSelectedRoleCodeChange?.(role.code);
                          if (isNewRole) {
                            setEditingRoleCode(role.code);
                            setEditingExistingRoleCode(null);
                          } else {
                            setEditingRoleCode(null);
                            setEditingExistingRoleCode(originalRoleCode(draft, role.code));
                          }
                        }}
                      >
                        编辑角色
                      </button>
                      <button
                        type="button"
                        className={styles.roleCardDelete}
                        role="menuitem"
                        onClick={() => {
                          setActionMenuRoleCode(null);
                          const confirmed = window.confirm(
                            isNewRole
                              ? `确定从草稿中移除新角色“${label}”吗？`
                              : `确定删除角色“${label}”吗？PR 会删除角色定义和三语资源，但不会自动迁移线上已有的角色绑定。`,
                          );
                          if (!confirmed) return;
                          setCreatingRole(false);
                          setEditingRoleCode(null);
                          setEditingExistingRoleCode(null);
                          onDraftChange(
                            deleteRole(
                              draft,
                              model,
                              isNewRole ? role.code : originalRoleCode(draft, role.code),
                            ),
                          );
                        }}
                      >
                        删除角色
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className={styles.content}>
        {view ? (
          <>
            <header className={styles.heading}>
              <div className={styles.headingCopy}>
                <div className={styles.roleTitle}>
                  <h2>{view.roleLabel}</h2>
                  <code>角色代码：{view.roleCode}</code>
                </div>
                <p>{view.roleDescription}</p>
              </div>
            </header>
            <DualListEditor
              ariaLabel={`${view.roleLabel}的权限`}
              available={view.available}
              assigned={view.assigned}
              labels={transferLabels}
              onTransfer={transfer}
              directActions={{ assign: "添加", unassign: "移除" }}
            />
          </>
        ) : (
          <p className={styles.empty}>没有可编辑的预设角色</p>
        )}
      </div>

      {creatingRole || editingRoleCode ? (
        <NewRoleForm
          model={model}
          draft={draft}
          locale={locale}
          initialRole={draft.newRoles.find((role) => role.code === editingRoleCode)}
          onDraftChange={onDraftChange}
          onCancel={() => {
            setCreatingRole(false);
            setEditingRoleCode(null);
          }}
          onCreated={(roleCode) => {
            setCreatingRole(false);
            setEditingRoleCode(null);
            setPendingRoleCode(roleCode);
          }}
        />
      ) : null}

      {editingExistingRoleCode ? (
        <EditRoleCodeForm
          model={model}
          draft={draft}
          roleCode={editingExistingRoleCode}
          roleLabel={translatedModelText(
            projectedModel,
            locale,
            model.roles.find((role) => role.code === editingExistingRoleCode)?.roleName ?? "",
            editingExistingRoleCode,
          )}
          onDraftChange={onDraftChange}
          onCancel={() => setEditingExistingRoleCode(null)}
          onSaved={(roleCode) => {
            setEditingExistingRoleCode(null);
            setPendingRoleCode(roleCode);
          }}
        />
      ) : null}
    </section>
  );
}
