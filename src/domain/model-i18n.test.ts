import { describe, expect, it } from "vitest";

import type { PermissionStudioModel } from "@/src/domain/model";
import { translatedModelText } from "@/src/domain/model-i18n";
import { validModel } from "@/tests/fixtures/model";

const model = validModel as unknown as PermissionStudioModel;

describe("translatedModelText", () => {
  it("reads the selected pep-webapp locale", () => {
    expect(translatedModelText(model, "en", "role.ops", "preset_ops")).toBe("Operations");
    expect(translatedModelText(model, "ja", "role.ops", "preset_ops")).toBe("運用");
  });

  it("falls back to Chinese and then to the supplied code", () => {
    const missing = structuredClone(model);
    delete missing.translations.en["role.ops"];
    expect(translatedModelText(missing, "en", "role.ops", "preset_ops")).toBe("运营");

    delete missing.translations["zh-CN"]["role.ops"];
    expect(translatedModelText(missing, "en", "role.ops", "preset_ops")).toBe("preset_ops");
  });
});
