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
      <div className={styles.content}>
        {selectedContractType ? (
          <ContractModuleGraph
            model={model}
            draft={draft}
            contractType={selectedContractType}
            disabled={disabled}
            onDraftChange={onDraftChange}
            toolbar={
              <aside className={styles.sidebar} aria-label="可编辑合同">
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
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>
            }
          />
        ) : (
          <p className={styles.empty}>没有可编辑的合同类型</p>
        )}
      </div>
    </section>
  );
}
