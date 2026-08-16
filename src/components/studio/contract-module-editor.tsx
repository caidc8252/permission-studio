"use client";

import { useEffect, useMemo, useState } from "react";

import { ContractModuleGraph } from "@/src/components/studio/contract-module-graph";
import styles from "@/src/components/studio/contract-module-editor.module.css";
import type { PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";

export interface ContractModuleEditorProps {
  model: PermissionStudioModel;
  draft: PermissionDraft;
  selectedContractType?: string;
  onSelectedContractTypeChange?: (contractType: string) => void;
  disabled?: boolean;
  onDraftChange: (draft: PermissionDraft) => void;
}

export function ContractModuleEditor({
  model,
  draft,
  selectedContractType: initialContractType,
  onSelectedContractTypeChange,
  disabled = false,
  onDraftChange,
}: ContractModuleEditorProps) {
  const editableContracts = useMemo(
    () => model.contractTypes.filter((contractType) => contractType !== "TEST"),
    [model.contractTypes],
  );
  const firstContractType = editableContracts[0] ?? "";
  const [selectedContractType, setSelectedContractType] = useState(() =>
    editableContracts.includes(initialContractType ?? "")
      ? initialContractType!
      : firstContractType,
  );

  useEffect(() => {
    if (editableContracts.includes(initialContractType ?? "")) {
      setSelectedContractType(initialContractType!);
    } else if (!editableContracts.includes(selectedContractType)) {
      setSelectedContractType(firstContractType);
    }
  }, [editableContracts, firstContractType, initialContractType, selectedContractType]);

  return (
    <section className={styles.editor} aria-label="合同模块编辑器">
      <aside className={styles.sidebar} aria-label="可编辑合同">
        <div>
          <p className={styles.eyebrow}>CONTRACT ROOT</p>
          <h2>合同类型</h2>
          <p className={styles.sidebarHint}>选择一个合同，在右侧关系图中查看和调整模块。</p>
        </div>
        <ul className={styles.contractList}>
          {editableContracts.map((contractType) => (
            <li key={contractType}>
              <button
                type="button"
                aria-label={contractType}
                aria-pressed={contractType === selectedContractType}
                onClick={() => {
                  setSelectedContractType(contractType);
                  onSelectedContractTypeChange?.(contractType);
                }}
              >
                <span>{contractType}</span>
                <small>{contractType === selectedContractType ? "正在编辑" : "查看关系"}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className={styles.content}>
        {selectedContractType ? (
          <>
            <header className={styles.heading}>
              <div>
                <p className={styles.eyebrow}>RELATIONSHIP MAP</p>
                <h2>{selectedContractType} 模块关系</h2>
                <p>直接勾选节点修改权限；父菜单会联动全部子菜单。</p>
              </div>
              {disabled ? <span className={styles.lockedBadge}>当前只读</span> : null}
            </header>
            <ContractModuleGraph
              key={selectedContractType}
              model={model}
              draft={draft}
              contractType={selectedContractType}
              disabled={disabled}
              onDraftChange={onDraftChange}
            />
          </>
        ) : (
          <p className={styles.empty}>没有可编辑的合同类型</p>
        )}
      </div>
    </section>
  );
}
