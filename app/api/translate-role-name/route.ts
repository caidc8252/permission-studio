import { z } from "zod";

import { isExpectedMutation } from "@/src/server/request-boundary";
import { translateRoleName, type RoleNameTranslations } from "@/src/server/google-translate";
import { studioConfig } from "@/src/system/config";

const MAX_BODY_BYTES = 4096;
const requestSchema = z.strictObject({ text: z.string().trim().min(1).max(500) });

interface TranslateRoleNameHandlerOptions {
  expectedOrigin: string;
  translate(text: string): Promise<RoleNameTranslations>;
}

export class TranslationNotConfiguredError extends Error {}

function error(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

export function createTranslateRoleNameHandler(options: TranslateRoleNameHandlerOptions) {
  return async function POST(request: Request): Promise<Response> {
    if (!isExpectedMutation(request, options.expectedOrigin)) {
      return error("ORIGIN_REJECTED", "请求来源不受信任。", 403);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return error("CONTENT_TYPE_REQUIRED", "请求必须使用 application/json。", 415);
    }

    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return error("BODY_TOO_LARGE", "翻译内容过长。", 413);
    }

    let text: string;
    try {
      text = requestSchema.parse(JSON.parse(new TextDecoder().decode(bytes))).text;
    } catch {
      return error("INVALID_TRANSLATION", "请填写不超过 500 个字符的中文内容。", 400);
    }

    try {
      return Response.json({ data: await options.translate(text) });
    } catch (caught) {
      if (caught instanceof TranslationNotConfiguredError) {
        return error(
          "TRANSLATION_NOT_CONFIGURED",
          "尚未配置 Google 翻译 API Key，请先设置 GOOGLE_TRANSLATE_API_KEY。",
          503,
        );
      }
      return error("TRANSLATION_FAILED", "Google 翻译暂时不可用，请稍后重试。", 502);
    }
  };
}

export const POST = createTranslateRoleNameHandler({
  expectedOrigin: studioConfig.serverOrigin,
  async translate(text) {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
    if (!apiKey) throw new TranslationNotConfiguredError();
    return translateRoleName(text, apiKey);
  },
});
