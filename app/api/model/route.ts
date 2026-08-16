import { NextResponse } from "next/server";

import type { PermissionStudioModel } from "@/src/domain/model";
import { remoteModelLoader } from "@/src/server/runtime";

interface ModelHandlerDependencies {
  load(): Promise<PermissionStudioModel>;
  now(): Date;
}

export function createModelHandler(dependencies: ModelHandlerDependencies) {
  return async function GET() {
    try {
      const model = await dependencies.load();
      return NextResponse.json({
        data: model,
        refreshedAt: dependencies.now().toISOString(),
      });
    } catch {
      return NextResponse.json(
        {
          code: "MODEL_LOAD_FAILED",
          message: "无法从 pep-webapp/develop 生成权限模型。",
        },
        { status: 503 },
      );
    }
  };
}

export const dynamic = "force-dynamic";
export const GET = createModelHandler({
  load: () => remoteModelLoader.load(),
  now: () => new Date(),
});
