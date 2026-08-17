import { describe, expect, it } from "vitest";

import { buildPullRequestBody } from "@/src/github/pr-body";
import type { PermissionChange } from "@/src/domain/change";

const change: PermissionChange = {
  version: 1,
  requestId: "01J5ZZZZZZZZZZZZZZZZZZZZZZ",
  baseSha: "0123456789abcdef0123456789abcdef01234567",
  title: "chore(permissions): grant report export",
  reason: "为 <运营&支持> 增加订单 | 查看能力",
  newRoles: [],
  roleChanges: [{ roleCode: "preset_ops", add: ["orders.view"], remove: [] }],
  contractChanges: [
    {
      contractType: "US-ISO",
      menus: { add: ["orders"], remove: [] },
      widgets: { add: [], remove: ["widget.old"] },
    },
  ],
};

describe("buildPullRequestBody", () => {
  it("creates deterministic bounded Markdown without local paths or command output", () => {
    const body = buildPullRequestBody({
      change,
      actor: "caidc8252",
      touchedFiles: [
        "apps/web/manifest/catalog/roles.ts",
        "apps/web/manifest/catalog/contract-types.ts",
      ],
      validationSteps: [{ name: "typecheck", status: "passed", durationMs: 123 }],
    });

    expect(body).toContain("为 &lt;运营&amp;支持&gt; 增加订单 \\| 查看能力");
    expect(body).toContain(change.baseSha);
    expect(body).toContain("@caidc8252");
    expect(body).toContain("preset_ops");
    expect(body).toContain("US-ISO");
    expect(body).toContain("widget.old");
    expect(body).toContain("apps/web/manifest/catalog/roles.ts");
    expect(body).toContain("typecheck");
    expect(body).not.toMatch(/[A-Z]:\\|\/Users\//u);
    expect(body).not.toContain("stdout");
    expect(
      buildPullRequestBody({
        change,
        actor: "caidc8252",
        touchedFiles: [
          "apps/web/manifest/catalog/roles.ts",
          "apps/web/manifest/catalog/contract-types.ts",
        ],
        validationSteps: [{ name: "typecheck", status: "passed", durationMs: 123 }],
      }),
    ).toBe(body);
  });

  it("includes new role identity and initial permissions", () => {
    const body = buildPullRequestBody({
      change: {
        ...change,
        newRoles: [
          {
            roleId: 99,
            code: "preset_auditor",
            names: { en: "Auditor", "zh-CN": "审计员", ja: "監査担当者" },
            descriptions: {
              en: "Reviews audit records",
              "zh-CN": "查看审计记录",
              ja: "監査記録を確認します",
            },
            permissionCodes: ["orders.view"],
          },
        ],
      },
      actor: "operator",
      touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
      validationSteps: [],
    });

    expect(body).toContain(
      "| 99 | `preset_auditor` | 审计员 | Auditor | 監査担当者 | 查看审计记录<br>Reviews audit records<br>監査記録を確認します | `orders.view` |",
    );
  });

  it("lists deleted roles separately", () => {
    const body = buildPullRequestBody({
      change: { ...change, deletedRoleCodes: ["preset_support"] },
      actor: "operator",
      touchedFiles: ["apps/web/manifest/catalog/roles.ts"],
      validationSteps: [],
    });

    expect(body).toContain("### Deleted roles");
    expect(body).toContain("| `preset_support` |");
  });
});
