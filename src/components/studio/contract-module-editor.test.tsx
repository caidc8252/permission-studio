// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/components/studio/contract-module-graph", () => ({
  ContractModuleGraph: ({
    contractType,
    toolbar,
  }: {
    contractType: string;
    toolbar?: ReactNode;
  }) => (
    <section aria-label={`${contractType} 合同模块关系图`}>
      <label>
        搜索模块
        <input type="search" />
      </label>
      {toolbar}
    </section>
  ),
}));

vi.mock("@/src/components/studio/contract-module-tree-list", () => ({
  ContractModuleTreeList: ({
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
    <section aria-label={`${contractType} 合同模块列表`}>
      <label>
        列表中订单
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
        搜索菜单、代码或路径
        <input type="search" />
      </label>
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
  it("uses the tree list as the default maintenance view", () => {
    render(
      <ContractModuleEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("ISO 合同模块列表")).toBeVisible();
    expect(screen.getByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("ISO 合同模块关系图")).not.toBeInTheDocument();
    expect(screen.queryByText("RELATIONSHIP MAP")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ISO 模块关系" })).not.toBeInTheDocument();
    expect(screen.queryByText(/直接勾选节点修改权限/)).not.toBeInTheDocument();
    expect(screen.queryByText("可启用模块")).not.toBeInTheDocument();
    expect(screen.queryByText("已启用模块")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启用已选模块" })).not.toBeInTheDocument();
  });

  it("passes list changes through the existing draft boundary", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "列表中订单" }));
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ contractMenus: { ISO: ["orders"] } }),
    );
  });

  it("switches contract roots and reports the selected contract", async () => {
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
    expect(screen.getByLabelText("PRO 合同模块列表")).toBeVisible();
    expect(onSelectedContractTypeChange).toHaveBeenCalledWith("PRO");
    expect(screen.queryByRole("button", { name: "TEST" })).not.toBeInTheDocument();
  });

  it("switches between list and graph views without changing the selected contract", async () => {
    const user = userEvent.setup();
    render(
      <ContractModuleEditor model={model} draft={createEmptyDraft()} onDraftChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "画布" }));
    expect(screen.getByLabelText("ISO 合同模块关系图")).toBeVisible();
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "列表" }));
    expect(screen.getByLabelText("ISO 合同模块列表")).toBeVisible();
  });

  it("locks list mutations while leaving navigation available", () => {
    render(
      <ContractModuleEditor
        model={model}
        draft={createEmptyDraft()}
        disabled
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "列表中订单" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "适应画布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "自动整理" })).not.toBeInTheDocument();
  });
});
