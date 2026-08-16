import { remoteModelLoader } from "@/src/server/runtime";

const model = await remoteModelLoader.load();
process.stdout.write(
  `${JSON.stringify({
    sourceSha: model.sourceSha,
    permissions: model.permissionCodes.length,
    contracts: model.contractTypes.length,
    roles: model.roles.length,
  })}\n`,
);
