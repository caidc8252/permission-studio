import { describe, expect, it } from "vitest";

import { createModelHandler } from "@/app/api/model/route";
import type { PermissionStudioModel } from "@/src/domain/model";
import { validModel } from "@/tests/fixtures/model";

describe("GET /api/model", () => {
  it("returns a validated remote model and refresh timestamp", async () => {
    const handler = createModelHandler({
      load: async () => validModel as unknown as PermissionStudioModel,
      now: () => new Date("2026-08-16T09:00:00.000Z"),
      expectedOrigin: "http://127.0.0.1:3100",
    });

    const response = await handler(new Request("http://127.0.0.1:3100/api/model"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: validModel,
      refreshedAt: "2026-08-16T09:00:00.000Z",
    });
  });

  it("maps loader failures without exposing local paths", async () => {
    const handler = createModelHandler({
      load: async () => {
        throw new Error("failed in C:\\Users\\secret\\target");
      },
      now: () => new Date(),
      expectedOrigin: "http://127.0.0.1:3100",
    });

    const response = await handler(new Request("http://127.0.0.1:3100/api/model"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      code: "MODEL_LOAD_FAILED",
      message: "无法从 pep-webapp/develop 生成权限模型。",
    });
    expect(JSON.stringify(body)).not.toContain("Users");
  });
});
