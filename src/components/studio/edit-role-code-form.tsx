"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/src/components/studio/new-role-form.module.css";
import { updateExistingRole, type PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import {
  validateRoleCode,
  validateRoleNames,
  type NewRoleNames,
  type RoleNameField,
} from "@/src/domain/new-role";

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
  const role = model.roles.find((candidate) => candidate.code === roleCode)!;
  const [code, setCode] = useState(draft.roleRenames?.[roleCode] ?? roleCode);
  const [names, setNames] = useState<NewRoleNames>(
    draft.roleNames?.[roleCode] ?? {
      en: model.translations.en[role.roleName] ?? roleCode,
      "zh-CN": model.translations["zh-CN"][role.roleName] ?? roleCode,
      ja: model.translations.ja[role.roleName] ?? roleCode,
    },
  );
  const [attempted, setAttempted] = useState(false);
  const occupiedCodes = [
    ...draft.newRoles.map((role) => role.code),
    ...Object.entries(draft.roleRenames ?? {})
      .filter(([sourceCode]) => sourceCode !== roleCode)
      .map(([, renamedCode]) => renamedCode),
  ];
  const codeError = validateRoleCode(model, code, {
    excludeModelCode: roleCode,
    occupiedCodes,
  });
  const occupiedNames = [
    ...draft.newRoles.map((candidate) => candidate.names),
    ...Object.entries(draft.roleNames ?? {})
      .filter(([candidateCode]) => candidateCode !== roleCode)
      .map(([, candidateNames]) => candidateNames),
  ];
  const nameErrors = validateRoleNames(model, occupiedNames, names, roleCode);
  const nameFields = [
    { locale: "zh-CN", field: "nameZhCn", label: "中文名称" },
    { locale: "en", field: "nameEn", label: "英文名称" },
    { locale: "ja", field: "nameJa", label: "日文名称" },
  ] as const satisfies ReadonlyArray<{
    locale: keyof NewRoleNames;
    field: RoleNameField;
    label: string;
  }>;

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
    if (codeError || Object.keys(nameErrors).length) return;
    const nextCode = code.trim();
    onDraftChange(updateExistingRole(draft, model, roleCode, nextCode, names));
    onSaved(nextCode);
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="edit-existing-role-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form className={`${styles.form} ${styles.compactForm}`} onSubmit={submit} noValidate>
        <header className={styles.header}>
          <div>
            <h2 id="edit-existing-role-dialog-title">编辑角色</h2>
            <p className={styles.dialogSubtitle}>{roleLabel}</p>
          </div>
          <button
            className={styles.close}
            type="button"
            aria-label="关闭编辑角色弹窗"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div className={`${styles.body} ${styles.compactBody} ${styles.existingRoleFields}`}>
          <p className={styles.roleCodeWarning}>
            修改后旧编码将不再匹配。合并前请确认现有用户和邀请记录中的角色编码已完成兼容或迁移。
          </p>
          <label className={styles.compactField}>
            <span>角色编码</span>
            <input
              type="text"
              aria-label="修改后的角色编码"
              aria-invalid={Boolean(attempted && codeError)}
              aria-describedby={
                attempted && codeError ? "edit-role-code-error" : "edit-role-code-help"
              }
              value={code}
              maxLength={200}
              autoFocus
              onChange={(event) => setCode(event.target.value)}
            />
            {attempted && codeError ? (
              <small id="edit-role-code-error" role="alert">
                {codeError}
              </small>
            ) : (
              <small id="edit-role-code-help">
                必须以 preset_ 开头，仅支持小写字母、数字和下划线
              </small>
            )}
          </label>
          {nameFields.map(({ locale, field, label }) => {
            const error = attempted ? nameErrors[field] : undefined;
            const errorId = `edit-role-${locale}-name-error`;
            return (
              <label className={styles.compactField} key={locale}>
                <span>{label}</span>
                <input
                  type="text"
                  aria-label={`角色${label}`}
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
        </div>

        <footer className={styles.actions}>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className={styles.primary} type="submit">
            保存角色修改
          </button>
        </footer>
      </form>
    </dialog>
  );
}
