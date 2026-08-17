// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/components/studio/contract-module-graph", () => ({
  ContractModuleGraph: ({
    contractType,
    model,
    draft,
    disabled,
    onDraftChange,
  }: {
    contractType: string;
    model: PermissionStudioModel;
    draft: { contractMenus: Record<string, string[]> };
    disabled: boolean;
    onDraftChange: (draft: unknown) => void;
  }) => {
    const current = draft.contractMenus[contractType] ?? model.contractMenus[contractType] ?? [];
    const checked = current.includes("orders");
    return (
      <section aria-label={`${contractType} 合同模块关系图`}>
        <label>
          启用订单
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() =>
              onDraftChange({
                ...draft,
                contractMenus: {
                  ...draft.contractMenus,
                  [contractType]: checked ? [] : ["orders"],
                },
              })
            }
          />
        </label>
        <label>
          搜索模块
          <input type="search" />
        </label>
      </section>
    );
  },
}));

import { StudioShell } from "@/src/components/studio/studio-shell";
import { ACTIVE_CHANGE_JOB_KEY } from "@/src/components/studio/use-change-job";
import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import { draftStorageKey, serializeDraftSession } from "@/src/domain/draft-session";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

function expectStableTabPanels() {
  for (const tab of screen.getAllByRole("tab")) {
    const controls = tab.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  }
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("StudioShell", () => {
  it("loads the API model envelope at the real client boundary", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: model, refreshedAt: "2026-08-16T10:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<StudioShell />);

    expect(await screen.findByRole("region", { name: "权限变更工作台" })).toBeVisible();
    expect(screen.queryByText("PERMISSION STUDIO")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "权限变更工作台" })).not.toBeInTheDocument();
    expect(screen.queryByText("来源 SHA：", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(model.sourceSha)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/model", { cache: "no-store" });
  });

  it("switches pep-webapp data copy without translating the workbench UI", async () => {
    const user = userEvent.setup();
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "数据语言" }), "en");

    expect(screen.getByRole("heading", { name: "Operations" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Manage orders" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "角色权限" })).toBeVisible();
    expect(screen.getByRole("button", { name: "刷新 develop" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "新增角色" }));
    const dialog = screen.getByRole("dialog", { name: "新增角色" });
    expect(within(dialog).getByRole("checkbox", { name: "Manage orders" })).toBeVisible();
  });

  it("keeps one shared draft while switching task areas", async () => {
    const user = userEvent.setup();
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("tab", { name: "合同模块" }));
    await user.click(screen.getByRole("checkbox", { name: "启用订单" }));
    await user.click(screen.getByRole("tab", { name: "角色权限" }));

    expect(screen.getByText("草稿中有 2 项变更")).toBeVisible();
    expect(screen.getByText("当前运营：1 项变更")).toBeVisible();
  });

  it("restores a same-SHA draft before persistence can overwrite it", async () => {
    const storedDraft = setRolePermissionMembership(createEmptyDraft(), model, "preset_ops", [
      "orders.manage",
      "orders.view",
    ]);
    window.localStorage.setItem(
      draftStorageKey(model.sourceSha),
      serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft: storedDraft }),
    );

    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    expect(await screen.findByText("草稿中有 1 项变更")).toBeVisible();
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(draftStorageKey(model.sourceSha)) ?? "{}"),
      ).toMatchObject({ draft: storedDraft }),
    );
  });

  it("migrates a legacy session draft into local storage", async () => {
    const storedDraft = setRolePermissionMembership(createEmptyDraft(), model, "preset_ops", [
      "orders.manage",
      "orders.view",
    ]);
    const storageKey = draftStorageKey(model.sourceSha);
    window.sessionStorage.setItem(
      storageKey,
      serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft: storedDraft }),
    );

    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    expect(await screen.findByText("草稿中有 1 项变更")).toBeVisible();
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toContain(model.sourceSha));
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("rebases compatible changes and shows every conflict after develop refresh", async () => {
    const user = userEvent.setup();
    const nextModel = structuredClone(model);
    nextModel.sourceSha = "f".repeat(40);
    delete nextModel.permissionRegistry["orders.manage"];
    nextModel.permissionCodes = nextModel.permissionCodes.filter(
      (code) => code !== "orders.manage",
    );
    nextModel.contractScope.ISO = ["orders.view"];
    nextModel.contractScope.TEST = ["orders.view"];
    delete nextModel.contractPlanPolicies.ISO!.permissionPlans["orders.manage"];
    const loadModel = vi.fn().mockResolvedValue(nextModel);
    render(<StudioShell initialModel={model} loadModel={loadModel} />);

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("tab", { name: "合同模块" }));
    await user.click(screen.getByRole("checkbox", { name: "启用订单" }));
    await user.click(screen.getByRole("button", { name: "刷新 develop" }));

    expect(await screen.findByText("1 项草稿冲突需要处理")).toBeVisible();
    expect(screen.getByText("orders.manage")).toBeVisible();
    expect(screen.getByText("草稿中有 1 项变更")).toBeVisible();
    expect(loadModel).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(window.localStorage.getItem(draftStorageKey(nextModel.sourceSha))).toContain(
        '"contractMenus":{"ISO":[]}',
      ),
    );
  });

  it("uses WAI-ARIA tabs and routes review and PR entry points to the shared draft", async () => {
    const user = userEvent.setup();
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    const rolesTab = screen.getByRole("tab", { name: "角色权限" });
    const contractsTab = screen.getByRole("tab", { name: "合同模块" });
    const simulationTab = screen.getByRole("tab", { name: "权限模拟" });
    expect(rolesTab).toHaveAttribute("aria-selected", "true");
    expect(contractsTab).toHaveAttribute("aria-selected", "false");
    expect(simulationTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel", { name: "角色权限" })).toBeVisible();
    expectStableTabPanels();
    expect(document.getElementById("studio-panel-contracts")).not.toBeVisible();
    expect(document.getElementById("studio-panel-simulation")).not.toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("button", { name: "查看变更" }));
    const review = screen.getByRole("region", { name: "变更审查" });
    expect(within(review).getByRole("heading", { name: "业务变更检查" })).toBeVisible();
    expect(within(review).getByText("orders.manage")).toBeVisible();
    expectStableTabPanels();

    await user.click(screen.getByRole("button", { name: "生成 Draft PR" }));
    const flow = screen.getByRole("region", { name: "Draft PR 创建流程" });
    expect(flow).toBeVisible();
    expect(within(flow).getByRole("heading", { name: "第 1 步：检查业务变更" })).toBeVisible();
    expect(within(flow).getByText("orders.manage")).toBeVisible();
    expectStableTabPanels();
  });

  it("fails closed across every draft mutation surface while develop refreshes", async () => {
    const user = userEvent.setup();
    const nextModel = structuredClone(model);
    nextModel.sourceSha = "e".repeat(40);
    let resolveLoad!: (value: PermissionStudioModel) => void;
    const loadModel = vi.fn(
      () =>
        new Promise<PermissionStudioModel>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(<StudioShell initialModel={model} loadModel={loadModel} />);

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("button", { name: "生成 Draft PR" }));
    await user.type(screen.getByRole("textbox", { name: "PR 标题" }), "更新订单管理权限配置");
    await user.type(
      screen.getByRole("textbox", { name: "变更原因" }),
      "为运营团队开放订单管理权限",
    );
    await user.click(screen.getByRole("button", { name: "刷新 develop" }));

    expect(screen.getByRole("button", { name: "正在校验…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "丢弃全部" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看变更" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成 Draft PR" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "角色权限" }));
    expect(screen.getByRole("searchbox", { name: "搜索角色" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "合同模块" }));
    expect(screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "权限模拟" }));
    expect(screen.getByRole("radio", { name: "普通成员" })).toBeEnabled();

    resolveLoad(nextModel);

    expect(await screen.findByRole("button", { name: "刷新 develop" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "角色权限" }));
    expect(screen.getByRole("searchbox", { name: "搜索角色" })).toBeEnabled();
    expect(screen.getByText("草稿中有 1 项变更")).toBeVisible();
    expect(screen.getByRole("button", { name: "生成 Draft PR" })).toBeEnabled();
  });

  it("supports keyboard navigation between task tabs", async () => {
    const user = userEvent.setup();
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    const rolesTab = screen.getByRole("tab", { name: "角色权限" });
    rolesTab.focus();
    await user.keyboard("{ArrowRight}");

    const contractsTab = screen.getByRole("tab", { name: "合同模块" });
    expect(contractsTab).toHaveFocus();
    expect(contractsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "合同模块" })).toBeVisible();
  });

  it("keeps the focused model retry state", async () => {
    const user = userEvent.setup();
    const loadModel = vi
      .fn<() => Promise<PermissionStudioModel>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(model);
    render(<StudioShell loadModel={loadModel} />);

    expect(await screen.findByText("无法加载权限模型")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    expect(await screen.findByRole("region", { name: "权限变更工作台" })).toBeVisible();
    expect(loadModel).toHaveBeenCalledTimes(2);
  });

  it("locks both editors for a restored job while simulation and job status remain readable", async () => {
    const user = userEvent.setup();
    const requestId = "01JPERMISSIONSTUDIOJOB0001";
    window.sessionStorage.setItem(
      ACTIVE_CHANGE_JOB_KEY,
      JSON.stringify({ requestId, baseSha: model.sourceSha }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          requestId,
          baseSha: model.sourceSha,
          state: "awaiting-confirmation",
          confirmationNonce: "nonce",
          diff: "diff --git a/roles.ts b/roles.ts",
          validationSteps: [],
        }),
      ),
    );
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    expect(await screen.findByText(requestId)).toBeVisible();
    expect(screen.getByRole("button", { name: "添加已选权限" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "合同模块" }));
    expect(screen.getByRole("checkbox", { name: "启用订单" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索菜单、代码或路径" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "权限模拟" }));
    expect(screen.getByRole("radio", { name: "普通成员" })).toBeEnabled();
    expect(screen.getByText(requestId)).toBeVisible();
    expect(screen.getByText("存在进行中的变更任务，角色与合同编辑已锁定。")).toBeVisible();
  });

  it("keeps preparation mounted and locks editors while the prepare request is pending", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined)),
    );
    render(<StudioShell initialModel={model} loadModel={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: "管理订单" }));
    await user.click(screen.getByRole("button", { name: "添加已选权限" }));
    await user.click(screen.getByRole("button", { name: "生成 Draft PR" }));
    await user.type(screen.getByRole("textbox", { name: "PR 标题" }), "更新订单管理权限配置");
    await user.type(
      screen.getByRole("textbox", { name: "变更原因" }),
      "为运营团队开放订单管理权限",
    );
    await user.click(screen.getByRole("button", { name: "下一步：校验与 diff" }));
    expect(screen.getByRole("heading", { name: "第 2 步：校验与完整 diff" })).toBeVisible();
    expect(screen.getByRole("button", { name: "下一步：最终确认" })).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: "角色权限" }));

    expect(screen.getByRole("button", { name: "添加已选权限" })).toBeDisabled();
    expect(screen.getByRole("searchbox", { name: "搜索角色" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Draft PR 创建流程" })).toBeVisible();
  });
});
