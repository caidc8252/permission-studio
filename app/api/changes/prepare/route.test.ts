import { describe, expect, it, vi } from "vitest";

import { createPrepareChangeHandler } from "@/app/api/changes/prepare/route";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const origin = "http://127.0.0.1:3100";
const intent = {
  baseSha: validModel.sourceSha,
  title: "chore(permissions): grant report export",
  reason: "为运营角色增加订单查看能力",
  newRoles: [],
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.manage"], remove: [] }],
  contractChanges: [],
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/changes/prepare`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup() {
  const startPrepareChange = vi.fn().mockResolvedValue({
    requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
    state: "awaiting-confirmation",
  });
  return {
    prepareChange: startPrepareChange,
    handler: createPrepareChangeHandler({
      loadModel: async () => validModel as unknown as PermissionStudioModel,
      startPrepareChange,
      generateId: () => "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
      expectedOrigin: origin,
    }),
  };
}

describe("POST /api/changes/prepare", () => {
  it("generates server metadata and accepts only validated references", async () => {
    const { handler, prepareChange } = setup();
    const response = await handler(request(intent));

    expect(response.status).toBe(202);
    expect(prepareChange).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
        baseSha: validModel.sourceSha,
        title: "chore(permissions): grant report export",
      }),
    );
    expect(await response.json()).toMatchObject({ state: "awaiting-confirmation" });
  });

  it("rejects cross-origin, wrong content type, oversized, and strict-schema payloads", async () => {
    const { handler } = setup();
    expect((await handler(request(intent, { origin: "http://evil.test" }))).status).toBe(403);
    expect((await handler(request(intent, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await handler(request("x".repeat(65 * 1024)))).status).toBe(413);
    const extra = await handler(request({ ...intent, requestId: "browser-chosen" }));
    expect(extra.status).toBe(400);
    expect((await extra.json()).code).toBe("INVALID_CHANGE");
  });

  it("rejects missing and control-character PR titles", async () => {
    const { handler } = setup();
    expect((await handler(request({ ...intent, title: undefined }))).status).toBe(400);
    expect((await handler(request({ ...intent, title: "bad\ntitle" }))).status).toBe(400);
    expect((await handler(request({ ...intent, title: "safe title\u0085suffix" }))).status).toBe(
      400,
    );
  });

  it("rejects stale models and unknown role, permission, and contract references", async () => {
    const { handler } = setup();
    expect((await handler(request({ ...intent, baseSha: "f".repeat(40) }))).status).toBe(409);
    expect(
      (
        await handler(
          request({
            ...intent,
            roleChanges: [{ roleCode: "preset_missing", add: ["orders.manage"], remove: [] }],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request({
            ...intent,
            roleChanges: [{ roleCode: "preset_ops", add: ["missing.code"], remove: [] }],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          request({
            ...intent,
            roleChanges: [],
            contractChanges: [
              {
                contractType: "MISSING",
                menus: { add: ["orders"], remove: [] },
                widgets: { add: [], remove: [] },
              },
            ],
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("accepts a unique new role and rejects duplicate code, id, name, and unknown permissions", async () => {
    const { handler, prepareChange } = setup();
    const newRole = {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: ["orders.view"],
    };
    expect(
      (await handler(request({ ...intent, newRoles: [newRole], roleChanges: [] }))).status,
    ).toBe(202);
    expect(prepareChange).toHaveBeenCalledWith(expect.objectContaining({ newRoles: [newRole] }));

    const existingName = validModel.translations["zh-CN"][validModel.roles[0].roleName];
    for (const duplicate of [
      { ...newRole, code: validModel.roles[0].code },
      { ...newRole, roleId: validModel.roles[0].roleId },
      { ...newRole, names: { ...newRole.names, "zh-CN": existingName } },
      { ...newRole, permissionCodes: ["missing.permission"] },
      { ...newRole, roleId: 1000 },
    ]) {
      expect(
        (await handler(request({ ...intent, newRoles: [duplicate], roleChanges: [] }))).status,
      ).toBe(400);
    }
  });

  it("accepts a unique existing-role code rename and rejects a new-role collision", async () => {
    const { handler } = setup();
    const renamedRole = {
      roleCode: "preset_ops",
      newRoleCode: "preset_operations",
      add: [],
      remove: [],
    };
    expect((await handler(request({ ...intent, roleChanges: [renamedRole] }))).status).toBe(202);

    const newRole = {
      roleId: 99,
      code: "preset_operations",
      names: { en: "Operations", "zh-CN": "运营管理", ja: "運用管理" },
      permissionCodes: [],
    };
    expect(
      (await handler(request({ ...intent, newRoles: [newRole], roleChanges: [renamedRole] })))
        .status,
    ).toBe(400);
  });

  it("accepts unique existing-role names and rejects duplicate names", async () => {
    const { handler, prepareChange } = setup();
    const namedRole = {
      roleCode: "preset_ops",
      roleNameKey: "role.ops",
      names: { en: "Operations Admin", "zh-CN": "运营管理员", ja: "運用管理者" },
      add: [],
      remove: [],
    };

    expect((await handler(request({ ...intent, roleChanges: [namedRole] }))).status).toBe(202);
    expect(prepareChange).toHaveBeenCalledWith(
      expect.objectContaining({ roleChanges: [namedRole] }),
    );
    expect(
      (
        await handler(
          request({
            ...intent,
            roleChanges: [{ ...namedRole, roleNameKey: "role.wrong" }],
          }),
        )
      ).status,
    ).toBe(400);

    const duplicate = {
      ...namedRole,
      names: { ...namedRole.names, "zh-CN": "审计员" },
    };
    const newRole = {
      roleId: 99,
      code: "preset_auditor",
      names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
      permissionCodes: [],
    };
    expect(
      (await handler(request({ ...intent, newRoles: [newRole], roleChanges: [duplicate] }))).status,
    ).toBe(400);
  });

  it("accepts deletion of an existing preset role and rejects unknown roles", async () => {
    const { handler, prepareChange } = setup();

    expect(
      (await handler(request({ ...intent, deletedRoleCodes: ["preset_ops"], roleChanges: [] })))
        .status,
    ).toBe(202);
    expect(prepareChange).toHaveBeenCalledWith(
      expect.objectContaining({ deletedRoleCodes: ["preset_ops"] }),
    );
    expect(
      (await handler(request({ ...intent, deletedRoleCodes: ["preset_missing"], roleChanges: [] })))
        .status,
    ).toBe(400);
  });
});
