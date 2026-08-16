import { ChangeJobError, type ChangeJobService } from "@/src/jobs/change-job-service";
import { changeJobService } from "@/src/server/runtime";
import { isExpectedHost, isExpectedMutation } from "@/src/server/request-boundary";
import { studioConfig } from "@/src/system/config";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createChangeJobHandlers(service: ChangeJobService, expectedOrigin: string) {
  return {
    async get(request: Request, context: RouteContext) {
      if (!isExpectedHost(request, expectedOrigin)) {
        return Response.json(
          { code: "HOST_REJECTED", message: "请求主机不受信任。" },
          { status: 403 },
        );
      }
      const { id } = await context.params;
      const job = service.getChangeJob(id);
      return job
        ? Response.json(job)
        : Response.json({ code: "CHANGE_NOT_FOUND", message: "未找到变更请求。" }, { status: 404 });
    },
    async remove(request: Request, context: RouteContext) {
      if (!isExpectedMutation(request, expectedOrigin)) {
        return Response.json(
          { code: "ORIGIN_REJECTED", message: "请求来源不受信任。" },
          { status: 403 },
        );
      }
      try {
        const { id } = await context.params;
        await service.discardPreparedChange(id);
        return new Response(null, { status: 204 });
      } catch (error) {
        if (error instanceof ChangeJobError) {
          return Response.json(
            { code: error.code, message: error.message },
            { status: error.status },
          );
        }
        return Response.json(
          { code: "DISCARD_FAILED", message: "无法丢弃变更请求。" },
          { status: 500 },
        );
      }
    },
  };
}

const handlers = createChangeJobHandlers(changeJobService, studioConfig.serverOrigin);
export const GET = handlers.get;
export const DELETE = handlers.remove;
