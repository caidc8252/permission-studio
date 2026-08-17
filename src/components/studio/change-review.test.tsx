// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeReview } from "@/src/components/studio/change-review";
import { createEmptyDraft, type PermissionDraft } from "@/src/domain/draft";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;
const draftWithRoleAndContractChanges: PermissionDraft = {
  newRoles: [],
  rolePermissions: { preset_ops: ["orders.manage"] },
  contractMenus: { ISO: [] },
  contractWidgets: {},
};

afterEach(cleanup);

describe("ChangeReview", () => {
  it("groups translated business changes by role and contract", () => {
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "运营" })).toBeVisible();
    expect(screen.getByText("新增权限 1 项")).toBeVisible();
    expect(screen.getByText("移除权限 1 项")).toBeVisible();
    expect(screen.getByText("管理订单")).toBeVisible();
    expect(screen.getByText("查看订单")).toBeVisible();
    expect(screen.getByRole("heading", { name: "ISO" })).toBeVisible();
    expect(screen.getByText("移除菜单 1 项")).toBeVisible();
    expect(screen.getByText("订单")).toBeVisible();
  });

  it("can undo one item without discarding the object", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销 管理订单" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [],
      rolePermissions: { preset_ops: [] },
      contractMenus: { ISO: [] },
      contractWidgets: {},
    });
  });

  it("can undo one object while preserving unrelated draft changes", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销角色 运营 的全部变更" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [],
      rolePermissions: {},
      contractMenus: { ISO: [] },
      contractWidgets: {},
    });
  });

  it("can undo the entire draft", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销全部变更" }));

    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [],
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: {},
    });
  });

  it("can undo contract menu and widget items independently", async () => {
    const user = userEvent.setup();
    const widgetModel = structuredClone(model);
    widgetModel.permissionCodes.push("quick.view");
    widgetModel.permissionRegistry["quick.view"] = {
      code: "quick.view",
      belongToMenuCode: "quick-widget",
      label: "quick.label",
      desc: "quick.desc",
    };
    widgetModel.translations["zh-CN"]["quick.label"] = "快捷入口";
    widgetModel.translations["zh-CN"]["quick.desc"] = "查看快捷入口。";
    const contractDraft: PermissionDraft = {
      newRoles: [],
      rolePermissions: {},
      contractMenus: { ISO: [] },
      contractWidgets: { ISO: ["quick-widget"] },
    };
    const onDraftChange = vi.fn();
    render(
      <ChangeReview model={widgetModel} draft={contractDraft} onDraftChange={onDraftChange} />,
    );

    await user.click(screen.getByRole("button", { name: "撤销 订单" }));
    expect(onDraftChange).toHaveBeenLastCalledWith({
      newRoles: [],
      rolePermissions: {},
      contractMenus: {},
      contractWidgets: { ISO: ["quick-widget"] },
    });

    await user.click(screen.getByRole("button", { name: "撤销 快捷入口" }));
    expect(onDraftChange).toHaveBeenLastCalledWith({
      newRoles: [],
      rolePermissions: {},
      contractMenus: { ISO: [] },
      contractWidgets: {},
    });
  });

  it("can undo all contract changes while preserving role changes", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        onDraftChange={onDraftChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "撤销合同 ISO 的全部变更" }));
    expect(onDraftChange).toHaveBeenCalledWith({
      newRoles: [],
      rolePermissions: { preset_ops: ["orders.manage"] },
      contractMenus: {},
      contractWidgets: {},
    });
  });

  it("reviews and discards a newly created role", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const draft: PermissionDraft = {
      ...createEmptyDraft(),
      newRoles: [
        {
          roleId: 99,
          code: "preset_auditor",
          names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
          permissionCodes: ["orders.view"],
        },
      ],
    };
    render(<ChangeReview model={model} draft={draft} onDraftChange={onDraftChange} />);

    expect(screen.getByText("新增角色")).toBeVisible();
    expect(screen.getByRole("heading", { name: "审计员" })).toBeVisible();
    expect(screen.getByText("preset_auditor · ID 99")).toBeVisible();
    expect(screen.getByText("EN: Auditor · 日本語: 監査担当者")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销角色 审计员 的全部变更" }));
    expect(onDraftChange).toHaveBeenCalledWith(createEmptyDraft());
  });
});
