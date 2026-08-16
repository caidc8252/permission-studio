import { describe, expect, it, vi } from "vitest";

import { createPrepareChangeHandler } from "@/app/api/changes/prepare/route";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

const origin = "http://127.0.0.1:3100";
const intent = {
  baseSha: validModel.sourceSha,
  reason: "为运营角色增加订单查看能力",
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
});
