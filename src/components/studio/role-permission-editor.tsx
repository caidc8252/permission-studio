"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DualListEditor,
  type TransferLabels,
  type TransferRequest,
} from "@/src/components/studio/dual-list-editor";
import { NewRoleForm } from "@/src/components/studio/new-role-form";
import styles from "@/src/components/studio/role-permission-editor.module.css";
import {
  buildImpactDiff,
  applyDraftToModel,
  createEmptyDraft,
  setNewRolePermissionMembership,
  setRolePermissionMembership,
  type PermissionDraft,
} from "@/src/domain/draft";
import { buildRoleEditorView } from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface RolePermissionEditorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
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
  dragHandle: (item) => `拖动${item.label}`,
  dragPreview: (count) => `已选择 ${count} 项`,
  noSelection: "请先选择权限",
  moved: (direction, count) =>
    direction === "assign" ? `已添加 ${count} 项权限` : `已移除 ${count} 项权限`,
  sameSideDrop: "该权限已在此列表中",
};

function isEditableRole(roleCode: string): boolean {
  return roleCode.startsWith("preset_");
}

function translated(model: PermissionStudioModel, key: string, fallback: string): string {
  return model.translations["zh-CN"][key] ?? fallback;
}

export function RolePermissionEditor({
  model,
  draft,
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
  const [pendingRoleCode, setPendingRoleCode] = useState<string | null>(null);

  useEffect(() => {
    if (editableRoles.some((role) => role.code === initialRoleCode)) {
      setSelectedRoleCode(initialRoleCode!);
    } else if (!editableRoles.some((role) => role.code === selectedRoleCode)) {
      setSelectedRoleCode(firstRoleCode);
    }
  }, [editableRoles, firstRoleCode, initialRoleCode, selectedRoleCode]);

  useEffect(() => {
    if (!pendingRoleCode || !editableRoles.some((role) => role.code === pendingRoleCode)) return;
    setSelectedRoleCode(pendingRoleCode);
    onSelectedRoleCodeChange?.(pendingRoleCode);
    setPendingRoleCode(null);
  }, [editableRoles, onSelectedRoleCodeChange, pendingRoleCode]);

  const roleImpacts = useMemo(() => {
    const impact = buildImpactDiff(model, draft);
    return new Map(
      editableRoles.map((role) => [
        role.code,
        impact.addedRoles.filter((item) => item.code === role.code).length +
          impact.addedRolePermissions.filter((item) => item.roleCode === role.code).length +
          impact.removedRolePermissions.filter((item) => item.roleCode === role.code).length,
      ]),
    );
  }, [draft, editableRoles, model]);

  const normalizedRoleQuery = roleQuery.trim().toLocaleLowerCase();
  const sidebarRoles = editableRoles.filter((role) => {
    const matchesQuery =
      !normalizedRoleQuery ||
      [
        role.code,
        translated(projectedModel, role.roleName, role.code),
        translated(projectedModel, role.remark, role.code),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedRoleQuery));
    return matchesQuery && (!changesOnly || (roleImpacts.get(role.code) ?? 0) > 0);
  });

  const view = selectedRoleCode
    ? buildRoleEditorView(projectedModel, createEmptyDraft(), selectedRoleCode)
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
        : setRolePermissionMembership(draft, model, view.roleCode, [...assigned]),
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
            const label = translated(projectedModel, role.roleName, role.code);
            const count = roleImpacts.get(role.code) ?? 0;
            return (
              <li key={role.code}>
                <button
                  type="button"
                  aria-label={`${label}（${role.code}）`}
                  aria-pressed={role.code === selectedRoleCode}
                  onClick={() => {
                    setCreatingRole(false);
                    setSelectedRoleCode(role.code);
                    onSelectedRoleCodeChange?.(role.code);
                  }}
                >
                  <span className={styles.roleIdentity}>
                    <span>{label}</span>
                    <code>{role.code}</code>
                  </span>
                  {count ? <small>{count}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className={styles.content}>
        {view ? (
          <>
            <header className={styles.heading}>
              <div>
                <h2>{view.roleLabel}</h2>
                <p>{view.roleDescription}</p>
              </div>
            </header>
            <DualListEditor
              ariaLabel={`${view.roleLabel}的权限`}
              available={view.available}
              assigned={view.assigned}
              labels={transferLabels}
              onTransfer={transfer}
            />
          </>
        ) : (
          <p className={styles.empty}>没有可编辑的预设角色</p>
        )}
      </div>

      {creatingRole ? (
        <NewRoleForm
          model={model}
          draft={draft}
          onDraftChange={onDraftChange}
          onCancel={() => setCreatingRole(false)}
          onCreated={(roleCode) => {
            setCreatingRole(false);
            setPendingRoleCode(roleCode);
          }}
        />
      ) : null}
    </section>
  );
}
