import { describe, expect, it, vi } from "vitest";

import { createConfirmChangeHandler } from "@/app/api/changes/[id]/confirm/route";

const origin = "http://127.0.0.1:3100";

describe("POST /api/changes/:id/confirm", () => {
  it("requires same origin and an opaque nonce", async () => {
    const startFinalizeChange = vi
      .fn()
      .mockResolvedValue({ state: "completed", prUrl: "https://github.com/org/repo/pull/42" });
    const handler = createConfirmChangeHandler({ startFinalizeChange, expectedOrigin: origin });
    const context = { params: Promise.resolve({ id: "01J5ZZZZZZZZZZZZZZZZZZZZZZ" }) };

    const rejected = await handler(
      new Request(`${origin}/api/changes/id/confirm`, {
        method: "POST",
        headers: { origin: "http://evil.test", "content-type": "application/json" },
        body: JSON.stringify({ nonce: "confirm-once" }),
      }),
      context,
    );
    expect(rejected.status).toBe(403);

    const accepted = await handler(
      new Request(`${origin}/api/changes/id/confirm`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ nonce: "confirm-once" }),
      }),
      context,
    );
    expect(accepted.status).toBe(202);
    expect(startFinalizeChange).toHaveBeenCalledWith("01J5ZZZZZZZZZZZZZZZZZZZZZZ", "confirm-once");
  });

  it("rejects missing, extra, and oversized confirmation payloads", async () => {
    const handler = createConfirmChangeHandler({
      startFinalizeChange: vi.fn(),
      expectedOrigin: origin,
    });
    const context = { params: Promise.resolve({ id: "id" }) };
    const send = (body: unknown) =>
      handler(
        new Request(`${origin}/api/changes/id/confirm`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        context,
      );
    expect((await send({})).status).toBe(400);
    expect((await send({ nonce: "ok", extra: true })).status).toBe(400);
    expect((await send({ nonce: "x".repeat(9 * 1024) })).status).toBe(413);
  });
});
