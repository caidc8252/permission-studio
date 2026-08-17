import { describe, expect, it, vi } from "vitest";

import {
  createTranslateRoleNameHandler,
  TranslationNotConfiguredError,
} from "@/app/api/translate-role-name/route";

const origin = "http://127.0.0.1:3100";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/translate-role-name`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/translate-role-name", () => {
  it("returns English and Japanese role names", async () => {
    const translate = vi.fn(async () => ({ en: "Auditor", ja: "監査担当者" }));
    const handler = createTranslateRoleNameHandler({ expectedOrigin: origin, translate });

    const response = await handler(request({ text: " 审计员 " }));

    expect(response.status).toBe(200);
    expect(translate).toHaveBeenCalledWith("审计员");
    expect(await response.json()).toEqual({ data: { en: "Auditor", ja: "監査担当者" } });
  });

  it("rejects untrusted, malformed, and oversized requests", async () => {
    const handler = createTranslateRoleNameHandler({
      expectedOrigin: origin,
      translate: vi.fn(),
    });

    expect(
      (await handler(request({ text: "审计员" }, { origin: "http://evil.test" }))).status,
    ).toBe(403);
    expect(
      (await handler(request({ text: "审计员" }, { "content-type": "text/plain" }))).status,
    ).toBe(415);
    expect((await handler(request({ text: "" }))).status).toBe(400);
    expect((await handler(request({ text: "审计员", extra: true }))).status).toBe(400);
    expect((await handler(request("x".repeat(4097)))).status).toBe(413);
  });

  it("does not expose upstream error details", async () => {
    const handler = createTranslateRoleNameHandler({
      expectedOrigin: origin,
      translate: async () => {
        throw new Error("secret-key in C:\\private\\file");
      },
    });

    const response = await handler(request({ text: "审计员" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: "TRANSLATION_FAILED",
      message: "Google 翻译暂时不可用，请稍后重试。",
    });
    expect(JSON.stringify(body)).not.toContain("secret-key");
  });

  it("explains when Google Translation has not been configured", async () => {
    const handler = createTranslateRoleNameHandler({
      expectedOrigin: origin,
      translate: async () => {
        throw new TranslationNotConfiguredError();
      },
    });

    const response = await handler(request({ text: "审计员" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "TRANSLATION_NOT_CONFIGURED",
      message: "尚未配置 Google 翻译 API Key，请先设置 GOOGLE_TRANSLATE_API_KEY。",
    });
  });
});
