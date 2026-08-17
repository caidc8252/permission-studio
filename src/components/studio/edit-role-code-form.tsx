"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/src/components/studio/new-role-form.module.css";
import { renameExistingRole, type PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validateRoleCode } from "@/src/domain/new-role";

interface EditRoleCodeFormProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  roleCode: string;
  roleLabel: string;
  onDraftChange: (draft: PermissionDraft) => void;
  onCancel: () => void;
  onSaved: (roleCode: string) => void;
}

export function EditRoleCodeForm({
  model,
  draft,
  roleCode,
  roleLabel,
  onDraftChange,
  onCancel,
  onSaved,
}: EditRoleCodeFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState(draft.roleRenames?.[roleCode] ?? roleCode);
  const [attempted, setAttempted] = useState(false);
  const occupiedCodes = [
    ...draft.newRoles.map((role) => role.code),
    ...Object.entries(draft.roleRenames ?? {})
      .filter(([sourceCode]) => sourceCode !== roleCode)
      .map(([, renamedCode]) => renamedCode),
  ];
  const error = validateRoleCode(model, code, {
    excludeModelCode: roleCode,
    occupiedCodes,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (error) return;
    const nextCode = code.trim();
    onDraftChange(renameExistingRole(draft, model, roleCode, nextCode));
    onSaved(nextCode);
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="edit-role-code-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form className={`${styles.form} ${styles.compactForm}`} onSubmit={submit} noValidate>
        <header className={styles.header}>
          <div>
            <h2 id="edit-role-code-dialog-title">修改角色编码</h2>
            <p className={styles.dialogSubtitle}>{roleLabel}</p>
          </div>
          <button
            className={styles.close}
            type="button"
            aria-label="关闭修改角色编码弹窗"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className={`${styles.body} ${styles.compactBody}`}>
          <p className={styles.roleCodeWarning}>
            修改后旧编码将不再匹配。合并前请确认现有用户和邀请记录中的角色编码已完成兼容或迁移。
          </p>
          <label className={styles.compactField}>
            <span>角色编码</span>
            <input
              type="text"
              aria-label="修改后的角色编码"
              aria-invalid={Boolean(attempted && error)}
              aria-describedby={attempted && error ? "edit-role-code-error" : "edit-role-code-help"}
              value={code}
              maxLength={200}
              autoFocus
              onChange={(event) => setCode(event.target.value)}
            />
            {attempted && error ? (
              <small id="edit-role-code-error" role="alert">
                {error}
              </small>
            ) : (
              <small id="edit-role-code-help">
                必须以 preset_ 开头，仅支持小写字母、数字和下划线
              </small>
            )}
          </label>
        </div>

        <footer className={styles.actions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={styles.primary} type="submit">
            保存角色编码
          </button>
        </footer>
      </form>
    </dialog>
  );
}
