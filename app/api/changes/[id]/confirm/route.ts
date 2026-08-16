import { z } from "zod";

import { ChangeJobError, type ChangeJobService } from "@/src/jobs/change-job-service";
import { changeJobService } from "@/src/server/runtime";
import { studioConfig } from "@/src/system/config";

const MAX_CONFIRM_BYTES = 8 * 1024;
const confirmationSchema = z.strictObject({ nonce: z.string().min(8).max(512) });

interface ConfirmContext {
  params: Promise<{ id: string }>;
}

interface ConfirmHandlerOptions {
  finalizeChange: ChangeJobService["finalizeChange"];
  expectedOrigin: string;
}

export function createConfirmChangeHandler(options: ConfirmHandlerOptions) {
  return async function confirm(request: Request, context: ConfirmContext): Promise<Response> {
    if (request.headers.get("origin") !== options.expectedOrigin) {
      return Response.json(
        { code: "ORIGIN_REJECTED", message: "请求来源不受信任。" },
        { status: 403 },
      );
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return Response.json(
        { code: "CONTENT_TYPE_REQUIRED", message: "请求必须使用 application/json。" },
        { status: 415 },
      );
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_CONFIRM_BYTES) {
      return Response.json({ code: "BODY_TOO_LARGE", message: "确认请求过大。" }, { status: 413 });
    }
    try {
      const body = confirmationSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      const { id } = await context.params;
      return Response.json(await options.finalizeChange(id, body.nonce));
    } catch (error) {
      if (error instanceof ChangeJobError) {
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.status },
        );
      }
      return Response.json(
        { code: "INVALID_CONFIRMATION", message: "确认内容无效。" },
        { status: 400 },
      );
    }
  };
}

export const POST = createConfirmChangeHandler({
  finalizeChange: (id, nonce) => changeJobService.finalizeChange(id, nonce),
  expectedOrigin: studioConfig.serverOrigin,
});
