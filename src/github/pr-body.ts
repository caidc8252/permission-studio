import type { PermissionChange } from "@/src/domain/change";
import type { ValidationStep } from "@/src/jobs/validation";

interface PullRequestBodyInput {
  change: PermissionChange;
  actor: string;
  touchedFiles: readonly string[];
  validationSteps: readonly ValidationStep[];
}

function cell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function values(items: readonly string[]): string {
  return items.length ? items.map((item) => `\`${cell(item)}\``).join("<br>") : "—";
}

export function buildPullRequestBody(input: PullRequestBodyInput): string {
  const roleRows = input.change.roleChanges.length
    ? input.change.roleChanges.map(
        (role) => `| \`${cell(role.roleCode)}\` | ${values(role.add)} | ${values(role.remove)} |`,
      )
    : ["| — | — | — |"];
  const contractRows = input.change.contractChanges.length
    ? input.change.contractChanges.flatMap((contract) => [
        `| \`${cell(contract.contractType)}\` | menu | ${values(contract.menus.add)} | ${values(contract.menus.remove)} |`,
        `| \`${cell(contract.contractType)}\` | widget | ${values(contract.widgets.add)} | ${values(contract.widgets.remove)} |`,
      ])
    : ["| — | — | — | — |"];
  const files = input.touchedFiles.map((path) => `- \`${cell(path)}\``);
  const validations = input.validationSteps.map(
    (step) => `- ✅ ${cell(step.name)} (${step.durationMs} ms)`,
  );

  return [
    "## Permission Studio change",
    "",
    `- Reason: ${cell(input.change.reason.slice(0, 500))}`,
    `- Source SHA: \`${input.change.baseSha}\``,
    `- Actor: @${cell(input.actor)}`,
    `- Request: \`${input.change.requestId}\``,
    "",
    "### Role permissions",
    "",
    "| Role | Add | Remove |",
    "| --- | --- | --- |",
    ...roleRows,
    "",
    "### Contract modules",
    "",
    "| Contract | Kind | Add | Remove |",
    "| --- | --- | --- | --- |",
    ...contractRows,
    "",
    "### Touched files",
    "",
    ...(files.length ? files : ["- None"]),
    "",
    "### Validation",
    "",
    ...(validations.length ? validations : ["- No validation results"]),
    "",
    "_Prepared locally by Permission Studio; review the diff before merging._",
    "",
  ].join("\n");
}
