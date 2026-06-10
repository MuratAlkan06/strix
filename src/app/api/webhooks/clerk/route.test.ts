/**
 * Clerk webhook integration test — the Phase 0 verification item:
 * unsigned/invalid payloads → 400 before any DB write; a validly Svix-signed
 * payload → 200 + users-row insert + one `signup` analytics event.
 *
 * The DB escape hatch and analytics wrappers are mocked: this test pins the
 * signature gate and handler wiring headlessly (CI-safe). Live row insertion
 * against Neon is covered by the manual signup gate and smoke tooling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Webhook } from "svix";

// Toggled per-test: when true, the insert mock simulates a PK conflict
// (replayed webhook) by returning no rows from .returning().
let simulateConflict = false;

const insertedValues: Array<Record<string, unknown>> = [];
const updateSetCalls: Array<Record<string, unknown>> = [];

vi.mock("@/db/unscoped", () => ({
  unscopedDb: {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (simulateConflict) return [];
            insertedValues.push(v);
            return [{ id: v.id }];
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updateSetCalls.push(v);
        return { where: vi.fn(async () => []) };
      }),
    })),
  },
}));

const capturedEvents: Array<{ event: string; props: Record<string, unknown> }> = [];
const identifyCalls: Array<{ distinctId: string }> = [];

vi.mock("@/lib/analytics/server", () => ({
  capture: vi.fn(
    async (_distinctId: string, event: string, props: Record<string, unknown> = {}) => {
      capturedEvents.push({ event, props });
    },
  ),
  identify: vi.fn(async (distinctId: string) => {
    identifyCalls.push({ distinctId });
  }),
}));

const SECRET = "whsec_" + Buffer.from("integration-test-secret-32bytes!").toString("base64");

const CREATED_PAYLOAD = JSON.stringify({
  type: "user.created",
  data: {
    id: "user_int_test_1",
    email_addresses: [{ id: "em_1", email_address: "int@test.invalid" }],
    primary_email_address_id: "em_1",
    first_name: "Int",
    last_name: "Test",
  },
});

const CREATED_OAUTH_PAYLOAD = JSON.stringify({
  type: "user.created",
  data: {
    id: "user_int_test_2",
    email_addresses: [{ id: "em_2", email_address: "oauth@test.invalid" }],
    primary_email_address_id: "em_2",
    external_accounts: [{ provider: "oauth_google" }],
  },
});

function signedHeaders(payload: string): Record<string, string> {
  const msgId = "msg_int_test";
  const timestamp = new Date();
  const signature = new Webhook(SECRET).sign(msgId, timestamp, payload);
  return {
    "svix-id": msgId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": signature,
  };
}

async function post(body: string, headers: Record<string, string>) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/webhooks/clerk", {
      method: "POST",
      headers,
      body,
    }),
  );
}

describe("Clerk webhook — signature gate + wiring", () => {
  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SECRET = SECRET;
    simulateConflict = false;
    insertedValues.length = 0;
    updateSetCalls.length = 0;
    capturedEvents.length = 0;
    identifyCalls.length = 0;
  });

  it("returns 400 when svix headers are missing (no DB write)", async () => {
    const res = await post(CREATED_PAYLOAD, {});
    expect(res.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("returns 400 on an invalid signature (no DB write)", async () => {
    const headers = signedHeaders(CREATED_PAYLOAD);
    headers["svix-signature"] = "v1,dGFtcGVyZWQtc2lnbmF0dXJlLW5vdC12YWxpZA==";
    const res = await post(CREATED_PAYLOAD, headers);
    expect(res.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("returns 400 when the payload was tampered after signing", async () => {
    const headers = signedHeaders(CREATED_PAYLOAD);
    const tampered = CREATED_PAYLOAD.replace("int@test.invalid", "evil@test.invalid");
    const res = await post(tampered, headers);
    expect(res.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("valid signed user.created → 200, users row inserted, signup fired once", async () => {
    const res = await post(CREATED_PAYLOAD, signedHeaders(CREATED_PAYLOAD));
    expect(res.status).toBe(200);
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      id: "user_int_test_1",
      email: "int@test.invalid",
      display_name: "Int Test",
      tier: "free",
    });
    expect(identifyCalls).toEqual([{ distinctId: "user_int_test_1" }]);
    expect(capturedEvents).toEqual([
      { event: "signup", props: { method: "email" } },
    ]);
  });

  it("derives signup method from the OAuth provider", async () => {
    const res = await post(CREATED_OAUTH_PAYLOAD, signedHeaders(CREATED_OAUTH_PAYLOAD));
    expect(res.status).toBe(200);
    expect(capturedEvents).toEqual([
      { event: "signup", props: { method: "google" } },
    ]);
  });

  it("replayed user.created (PK conflict) does not re-fire signup", async () => {
    simulateConflict = true;
    const res = await post(CREATED_PAYLOAD, signedHeaders(CREATED_PAYLOAD));
    expect(res.status).toBe(200);
    expect(capturedEvents).toHaveLength(0);
    expect(identifyCalls).toHaveLength(0);
  });

  it("unhandled event types are acknowledged with 200 and no writes", async () => {
    const payload = JSON.stringify({ type: "session.created", data: {} });
    const res = await post(payload, signedHeaders(payload));
    expect(res.status).toBe(200);
    expect(insertedValues).toHaveLength(0);
    expect(updateSetCalls).toHaveLength(0);
  });
});
