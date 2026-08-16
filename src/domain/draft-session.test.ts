import { describe, expect, it } from "vitest";

import { createEmptyDraft, setRolePermissionMembership } from "@/src/domain/draft";
import {
  draftStorageKey,
  rebasePermissionDraft,
  restoreDraftSession,
  serializeDraftSession,
} from "@/src/domain/draft-session";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

describe("draft sessions", () => {
  it("restores only a draft stored for the expected source SHA", () => {
    const draft = setRolePermissionMembership(createEmptyDraft(), model, "preset_ops", [
      "orders.manage",
      "orders.view",
    ]);
    const raw = serializeDraftSession({ version: 1, sourceSha: model.sourceSha, draft });

    expect(draftStorageKey(model.sourceSha)).toBe(`permission-studio:draft:${model.sourceSha}`);
    expect(restoreDraftSession(raw, model.sourceSha)?.draft).toEqual(draft);
    expect(restoreDraftSession(raw, "f".repeat(40))).toBeNull();
  });

  it("rejects malformed or non-strict stored drafts", () => {
    expect(restoreDraftSession("not json", model.sourceSha)).toBeNull();
    expect(
      restoreDraftSession(
        JSON.stringify({
          version: 1,
          sourceSha: model.sourceSha,
          draft: createEmptyDraft(),
          ignored: true,
        }),
        model.sourceSha,
      ),
    ).toBeNull();
  });

  it("rejects a stored override for a non-preset role", () => {
    expect(
      restoreDraftSession(
        JSON.stringify({
          version: 1,
          sourceSha: model.sourceSha,
          draft: {
            ...createEmptyDraft(),
            rolePermissions: { custom_admin: ["orders.view"] },
          },
        }),
        model.sourceSha,
      ),
    ).toBeNull();
  });

  it("rejects stored menu or widget overrides for TEST", () => {
    for (const field of ["contractMenus", "contractWidgets"] as const) {
      expect(
        restoreDraftSession(
          JSON.stringify({
            version: 1,
            sourceSha: model.sourceSha,
            draft: { ...createEmptyDraft(), [field]: { TEST: [] } },
          }),
          model.sourceSha,
        ),
      ).toBeNull();
    }
  });

  it("replays valid codes and reports removed references", () => {
    const draftWithOrdersManage = setRolePermissionMembership(
      createEmptyDraft(),
      model,
      "preset_ops",
      ["orders.manage", "orders.view"],
    );
    const next = structuredClone(model);
    next.sourceSha = "f".repeat(40);
    delete next.permissionRegistry["orders.manage"];
    next.permissionCodes = next.permissionCodes.filter((code) => code !== "orders.manage");

    const result = rebasePermissionDraft(model, next, draftWithOrdersManage);

    expect(result.draft).toEqual(createEmptyDraft());
    expect(result.conflicts).toEqual([
      { kind: "permission", ownerCode: "preset_ops", code: "orders.manage" },
    ]);
  });

  it("replays semantic removals against a changed baseline", () => {
    const oldModel = structuredClone(model);
    oldModel.roles[0]!.permissionCodes = ["orders.manage", "orders.view"];
    const draft = setRolePermissionMembership(createEmptyDraft(), oldModel, "preset_ops", [
      "orders.view",
    ]);
    const nextModel = structuredClone(oldModel);
    nextModel.sourceSha = "f".repeat(40);
    nextModel.roles[0]!.permissionCodes = ["orders.manage"];

    expect(rebasePermissionDraft(oldModel, nextModel, draft)).toEqual({
      draft: { rolePermissions: { preset_ops: [] }, contractMenus: {}, contractWidgets: {} },
      conflicts: [],
    });
  });
});
