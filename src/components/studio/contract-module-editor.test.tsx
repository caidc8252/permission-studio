// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/components/studio/contract-module-graph", () => ({
  ContractModuleGraph: ({
    contractType,
    draft,
    disabled,
    onDraftChange,
  }: {
    contractType: string;
    draft: { contractMenus: Record<string, string[]> };
    disabled: boolean;
    onDraftChange: (draft: unknown) => void;
  }) => (
    <section aria-label={`${contractType} 合同模块关系图`}>
      <label>
        图中订单
        <input
          type="checkbox"
          disabled={disabled}
          onChange={() =>
            onDraftChange({
              ...draft,
              contractMenus: { ...draft.contractMenus, [contractType]: ["orders"] },
            })
          }
        />
      </label>
      <label>
        搜索模块
        <input type="search" />
      </label>
      <button type="button">适应画布</button>
      <button type="button" disabled={disabled}>
        自动整理
      </button>
    </section>
  ),
}));

import { ContractModuleEditor } from "@/src/components/studio/contract-module-editor";
import { createEmptyDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const baseModel = validModel as unknown as PermissionStudioModel;
const model: PermissionStudioModel = {
  ...baseModel,
  contractTypes: ["ISO", "PRO", "TEST"],
};

afterEach(cleanup);

describe("ContractModuleEditor", () => {
  it("renders the relationship graph instead of a transfer list", () => {
    render(
      <ContractModuleEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("ISO 合同模块关系图")).toBeVisible();
    expect(screen.queryByText("可启用模块")).not.toBeInTheDocument();
    expect(screen.queryByText("已启用模块")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启用已选模块" })).not.toBeInTheDocument();
  });

  it("passes graph changes through the existing draft boundary", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "图中订单" }));
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ contractMenus: { ISO: ["orders"] } }),
    );
  });

  it("switches graph roots and reports the selected contract", async () => {
    const user = userEvent.setup();
    const onSelectedContractTypeChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onSelectedContractTypeChange={onSelectedContractTypeChange}
        onDraftChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "PRO" }));
    expect(screen.getByLabelText("PRO 合同模块关系图")).toBeVisible();
    expect(onSelectedContractTypeChange).toHaveBeenCalledWith("PRO");
    expect(screen.queryByRole("button", { name: "TEST" })).not.toBeInTheDocument();
  });

  it("locks graph mutations while leaving its view controls available", () => {
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        disabled
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "图中订单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "自动整理" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索模块" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "适应画布" })).toBeEnabled();
  });
});
