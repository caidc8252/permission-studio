import { describe, expect, it } from "vitest";

import { isExpectedHost, isExpectedMutation } from "@/src/server/request-boundary";

const origin = "http://127.0.0.1:3100";

describe("localhost request boundary", () => {
  it("rejects DNS-rebinding hosts on reads", () => {
    expect(isExpectedHost(new Request(`${origin}/api/model`), origin)).toBe(true);
    expect(isExpectedHost(new Request("http://attacker.test/api/model"), origin)).toBe(false);
    expect(
      isExpectedHost(
        new Request(`${origin}/api/model`, { headers: { host: "attacker.test" } }),
        origin,
      ),
    ).toBe(false);
  });

  it("trusts the actual Host header when Next.js normalizes the request URL host", () => {
    const request = new Request("http://localhost:3100/api/health", {
      headers: { host: "127.0.0.1:3100" },
    });

    expect(isExpectedHost(request, origin)).toBe(true);
  });

  it("also requires exact Origin on mutations", () => {
    expect(
      isExpectedMutation(new Request(`${origin}/api/change`, { headers: { origin } }), origin),
    ).toBe(true);
    expect(
      isExpectedMutation(
        new Request(`${origin}/api/change`, { headers: { origin: "http://evil.test" } }),
        origin,
      ),
    ).toBe(false);
  });
});
