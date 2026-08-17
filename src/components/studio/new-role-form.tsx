"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  DualListEditor,
  type TransferLabels,
  type TransferRequest,
} from "@/src/components/studio/dual-list-editor";
import styles from "@/src/components/studio/new-role-form.module.css";
import { addNewRole, type PermissionDraft } from "@/src/domain/draft";
import { buildPermissionTransferItems } from "@/src/domain/editor-view";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validateNewRole, type NewRoleField, type NewRoleNames } from "@/src/domain/new-role";

export interface NewRoleFormProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  onDraftChange: (draft: PermissionDraft) => void;
  onCancel: () => void;
  onCreated: (roleCode: string) => void;
}

const labels: TransferLabels = {
  search: "搜索权限",
  available: "可添加权限",
  assigned: "初始权限",
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

const nameFields = [
  { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
  { locale: "en", field: "nameEn", label: "英文名称" },
  { locale: "ja", field: "nameJa", label: "日文名称" },
] as const;

export function NewRoleForm({
  model,
  draft,
  onDraftChange,
  onCancel,
  onCreated,
}: NewRoleFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [roleId, setRoleId] = useState("");
  const [code, setCode] = useState("preset_");
  const [names, setNames] = useState<NewRoleNames>({ en: "", "zh-CN": "", ja: "" });
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const input = { roleId: Number(roleId), code, names, permissionCodes };
  const errors = validateNewRole(model, draft.newRoles, input);
  const assignedSet = useMemo(() => new Set(permissionCodes), [permissionCodes]);
  const available = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((permission) => !assignedSet.has(permission)),
  );
  const assigned = buildPermissionTransferItems(
    model,
    model.permissionCodes.filter((permission) => assignedSet.has(permission)),
  );
  const visibleError = (field: NewRoleField, value: string) =>
    attempted || value.trim().length > 0 ? errors[field] : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  const transfer = (request: TransferRequest) => {
    const next = new Set(permissionCodes);
    for (const id of request.ids) {
      if (request.direction === "assign") next.add(id);
      else next.delete(id);
    }
    setPermissionCodes([...next].sort());
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length) return;
    const next = addNewRole(draft, model, input);
    onDraftChange(next);
    onCreated(input.code.trim());
  };

  const idError = visibleError("roleId", roleId);
  const codeError = visibleError("code", code === "preset_" ? "" : code);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="new-role-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <header className={styles.header}>
          <div>
            <h2 id="new-role-dialog-title">新增角色</h2>
          </div>
          <button
            className={styles.close}
            type="button"
            aria-label="关闭新增角色弹窗"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          <fieldset className={styles.identity}>
            <legend>角色信息</legend>
            <label className={styles.codeField}>
              <span>角色编码</span>
              <input
                type="text"
                aria-label="新角色编码"
                aria-invalid={Boolean(codeError)}
                aria-describedby={codeError ? "new-role-code-error" : undefined}
                value={code}
                maxLength={200}
                onChange={(event) => setCode(event.target.value)}
              />
              {codeError ? (
                <small id="new-role-code-error" role="alert">
                  {codeError}
                </small>
              ) : null}
            </label>
            <label className={styles.idField}>
              <span>角色 ID</span>
              <input
                type="number"
                aria-label="新角色 ID"
                aria-invalid={Boolean(idError)}
                aria-describedby={idError ? "new-role-id-error" : "new-role-id-help"}
                value={roleId}
                min="1"
                max="999"
                step="1"
                onChange={(event) => setRoleId(event.target.value)}
              />
              {idError ? (
                <small id="new-role-id-error" role="alert">
                  {idError}
                </small>
              ) : (
                <small id="new-role-id-help">只能填写 1–999 的整数</small>
              )}
            </label>
            {nameFields.map(({ locale, field, label }) => {
              const error = visibleError(field, names[locale]);
              const errorId = `new-role-${locale}-name-error`;
              return (
                <label className={styles.nameField} key={locale}>
                  <span>{label}</span>
                  <input
                    type="text"
                    aria-label={`新角色${label}`}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                    value={names[locale]}
                    maxLength={100}
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [locale]: event.target.value }))
                    }
                  />
                  {error ? (
                    <small id={errorId} role="alert">
                      {error}
                    </small>
                  ) : null}
                </label>
              );
            })}
          </fieldset>

          <section className={styles.permissions} aria-labelledby="new-role-permissions-heading">
            <div className={styles.permissionsHeading}>
              <div>
                <h3 id="new-role-permissions-heading">初始权限</h3>
                <p>可先创建空角色，也可以在这里一次性完成权限分配。</p>
              </div>
              <strong>{permissionCodes.length} 项</strong>
            </div>
            <DualListEditor
              ariaLabel="新角色的初始权限"
              available={available}
              assigned={assigned}
              labels={labels}
              onTransfer={transfer}
            />
          </section>
        </div>

        <footer className={styles.actions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={styles.primary} type="submit">
            添加到变更草稿
          </button>
        </footer>
      </form>
    </dialog>
  );
}
