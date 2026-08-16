import { z } from "zod";

import { normalizePermissionChange, type PermissionChange } from "@/src/domain/change";
import type { PermissionStudioModel } from "@/src/domain/model";
import { ChangeJobError, type ChangeJobService } from "@/src/jobs/change-job-service";
import { changeJobService, remoteModelLoader } from "@/src/server/runtime";
import { studioConfig } from "@/src/system/config";
import { generateUlid } from "@/src/system/ulid";

const MAX_BODY_BYTES = 64 * 1024;
const listChangeSchema = z.strictObject({
  add: z.array(z.string().min(1).max(200)).max(2_000),
  remove: z.array(z.string().min(1).max(200)).max(2_000),
});
const prepareIntentSchema = z.strictObject({
  baseSha: z
    .string()
    .length(40)
    .regex(/^[0-9a-f]+$/),
  reason: z.string().max(500),
  roleChanges: z
    .array(z.strictObject({ roleCode: z.string().min(1).max(200), ...listChangeSchema.shape }))
    .max(50),
  contractChanges: z
    .array(
      z.strictObject({
        contractType: z.string().min(1).max(200),
        menus: listChangeSchema,
        widgets: listChangeSchema,
      }),
    )
    .max(20),
});

interface PrepareHandlerOptions {
  loadModel: () => Promise<PermissionStudioModel>;
  prepareChange: ChangeJobService["prepareChange"];
  generateId: () => string;
  expectedOrigin: string;
}

function json(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

function validateReferences(model: PermissionStudioModel, change: PermissionChange): void {
  const permissions = new Set(model.permissionCodes);
  const roles = new Set(
    model.roles.filter((role) => role.code.startsWith("preset_")).map((role) => role.code),
  );
  const contracts = new Set(model.contractTypes);
  const menus = new Set(Object.keys(model.menuRegistry));
  const widgets = new Set(
    Object.values(model.permissionRegistry)
      .map((permission) => permission.belongToMenuCode)
      .filter((owner) => !menus.has(owner)),
  );
  for (const role of change.roleChanges) {
    if (!roles.has(role.roleCode)) throw new Error("unknown role");
    if ([...role.add, ...role.remove].some((code) => !permissions.has(code))) {
      throw new Error("unknown permission");
    }
  }
  for (const contract of change.contractChanges) {
    if (!contracts.has(contract.contractType) || contract.contractType === "TEST") {
      throw new Error("unknown contract");
    }
    if ([...contract.menus.add, ...contract.menus.remove].some((menu) => !menus.has(menu))) {
      throw new Error("unknown menu");
    }
    if (
      [...contract.widgets.add, ...contract.widgets.remove].some((widget) => !widgets.has(widget))
    ) {
      throw new Error("unknown widget");
    }
  }
}

export function createPrepareChangeHandler(options: PrepareHandlerOptions) {
  return async function prepare(request: Request): Promise<Response> {
    if (request.headers.get("origin") !== options.expectedOrigin) {
      return json("ORIGIN_REJECTED", "请求来源不受信任。", 403);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json("CONTENT_TYPE_REQUIRED", "请求必须使用 application/json。", 415);
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return json("BODY_TOO_LARGE", "变更请求超过 64 KiB。", 413);
    }

    try {
      const input = prepareIntentSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      const model = await options.loadModel();
      if (input.baseSha !== model.sourceSha) {
        return json("STALE_MODEL", "develop 已变化，请刷新后重试。", 409);
      }
      const change = normalizePermissionChange({
        version: 1,
        requestId: options.generateId(),
        ...input,
      });
      validateReferences(model, change);
      return Response.json(await options.prepareChange(change), { status: 202 });
    } catch (error) {
      if (error instanceof ChangeJobError) return json(error.code, error.message, error.status);
      return json("INVALID_CHANGE", "变更内容无效或引用了未知权限。", 400);
    }
  };
}

const handler = createPrepareChangeHandler({
  loadModel: () => remoteModelLoader.load(),
  prepareChange: (change) => changeJobService.prepareChange(change),
  generateId: generateUlid,
  expectedOrigin: studioConfig.serverOrigin,
});

export const POST = handler;
