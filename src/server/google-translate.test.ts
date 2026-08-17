import { describe, expect, it, vi } from "vitest";

import { translateRoleName } from "@/src/server/google-translate";

describe("translateRoleName", () => {
  it("translates Chinese into English and Japanese without putting the API key in the URL", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const target = JSON.parse(String(init?.body)).target as "en" | "ja";
      return Response.json({
        data: { translations: [{ translatedText: target === "en" ? "Auditor" : "監査担当者" }] },
      });
    });

    await expect(translateRoleName("审计员", "secret-key", fetcher)).resolves.toEqual({
      en: "Auditor",
      ja: "監査担当者",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain("secret-key");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("secret-key");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        q: "审计员",
        source: "zh-CN",
        format: "text",
      });
    }
  });

  it("rejects failed and malformed Google responses", async () => {
    await expect(
      translateRoleName(
        "审计员",
        "key",
        vi.fn(async () => new Response(null, { status: 403 })),
      ),
    ).rejects.toThrow("request failed");
    await expect(
      translateRoleName(
        "审计员",
        "key",
        vi.fn(async () => Response.json({ data: {} })),
      ),
    ).rejects.toThrow("response was invalid");
  });
});
