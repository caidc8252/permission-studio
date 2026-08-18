// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("renders model-backed review copy in the selected data locale", () => {
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        locale="en"
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
    expect(screen.getByText("Manage orders")).toBeVisible();
    expect(screen.getByText("View orders")).toBeVisible();
    expect(screen.getByText("Orders")).toBeVisible();
    expect(screen.getByRole("heading", { name: "业务变更检查" })).toBeVisible();
  });

  it("renders model-backed review copy in the selected data locale", () => {
    render(
      <ChangeReview
        model={model}
        draft={draftWithRoleAndContractChanges}
        locale="en"
        onDraftChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
    expect(screen.getByText("Manage orders")).toBeVisible();
    expect(screen.getByText("View orders")).toBeVisible();
    expect(screen.getByText("Orders")).toBeVisible();
    expect(screen.getByRole("heading", { name: "业务变更检查" })).toBeVisible();
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
      roleRenames: {},
      roleNames: {},
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
      roleRenames: {},
      roleNames: {},
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

  it("reviews and restores a deleted existing role", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const draft: PermissionDraft = {
      ...createEmptyDraft(),
      deletedRoleCodes: ["preset_ops"],
    };
    render(<ChangeReview model={model} draft={draft} onDraftChange={onDraftChange} />);

    expect(screen.getByText("删除角色")).toBeVisible();
    expect(screen.getByText("将删除角色定义以及中文、英文、日文资源。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销角色 运营 的全部变更" }));
    expect(onDraftChange).toHaveBeenCalledWith(createEmptyDraft());
  });

  it("highlights localized name and description changes for an existing role", () => {
    const draft: PermissionDraft = {
      ...createEmptyDraft(),
      roleNames: {
        preset_ops: { en: "Operations Admin", "zh-CN": "运营管理员", ja: "運用管理者" },
      },
      roleDescriptions: {
        preset_ops: {
          en: "Manages daily operations.",
          "zh-CN": "管理日常运营。",
          ja: "運用管理者の日常業務を管理します。",
        },
      },
    };

    render(<ChangeReview model={model} draft={draft} onDraftChange={vi.fn()} />);

    const changes = screen.getByRole("region", { name: "运营管理员的字段修改" });
    expect(within(changes).getByRole("heading", { name: /字段修改\s*2 项/u })).toBeVisible();
    expect(within(changes).getByText("角色名称")).toBeVisible();
    expect(within(changes).getByText("角色描述")).toBeVisible();
    expect(within(changes).getByText("运营")).toHaveRole("deletion");
    expect(within(changes).getByText("运营管理员")).toBeVisible();
    expect(within(changes).getByText("运营角色。")).toHaveRole("deletion");
    expect(within(changes).getByText("管理日常运营。")).toBeVisible();
  });
});
