import { z } from "zod";

const endpoint = "https://translation.googleapis.com/language/translate/v2";
const responseSchema = z.object({
  data: z.object({
    translations: z.array(z.object({ translatedText: z.string() })).min(1),
  }),
});

export interface RoleNameTranslations {
  en: string;
  ja: string;
}

async function translateOne(
  text: string,
  target: keyof RoleNameTranslations,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({ q: text, source: "zh-CN", target, format: "text" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Google translation request failed");

  const parsed = responseSchema.safeParse(await response.json());
  const translated = parsed.success ? parsed.data.data.translations[0]?.translatedText.trim() : "";
  if (!translated) throw new Error("Google translation response was invalid");
  return translated;
}

export async function translateRoleName(
  text: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<RoleNameTranslations> {
  const [en, ja] = await Promise.all([
    translateOne(text, "en", apiKey, fetcher),
    translateOne(text, "ja", apiKey, fetcher),
  ]);
  return { en, ja };
}
