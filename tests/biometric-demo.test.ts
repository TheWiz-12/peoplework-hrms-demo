import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../server/app";
import { ids } from "../server/seed";

test("demo biometric reader uses the signed ingestion path", async () => {
  const secret = "fictional-reader-test-secret-2026-minimum-32";
  process.env.DEMO_PASSWORD = "demo-test-password-2026";
  process.env.PLATFORM_OWNER_PASSWORD = "owner-test-password-2026";
  process.env.DEMO_DEVICE_SECRET = secret;
  const { app, db } = await createApp({ memory: true, demo: true });
  const http = request(app.getHttpAdapter().getInstance());
  const eventId = randomUUID();
  const body = JSON.stringify({
    employeeCode: "EMP001",
    occurredAt: new Date().toISOString(),
    eventId,
    direction: "out",
  });
  async function send(nonce: string, signingSecret = secret) {
    const stamp = String(Date.now());
    const signature = createHmac("sha256", signingSecret)
      .update(`${stamp}.${nonce}.${body}`)
      .digest("hex");
    return http
      .post("/api/biometric/events")
      .set("Content-Type", "application/json")
      .set("x-device-id", ids.device)
      .set("x-timestamp", stamp)
      .set("x-nonce", nonce)
      .set("x-signature", signature)
      .send(body);
  }
  try {
    const bad = await send(randomUUID(), "wrong-secret");
    assert.equal(bad.status, 401);
    const first = await send(randomUUID());
    assert.equal(first.status, 202, JSON.stringify(first.body));
    assert.equal(first.body.accepted, true);
    const stored=await db.owner(q=>q.query("SELECT direction FROM attendance WHERE event_key=$1",[`${ids.device}:${eventId}`]));
    assert.equal(stored.rows[0].direction,"unknown","Reader-supplied direction must be ignored");
    const duplicate = await send(randomUUID());
    assert.equal(duplicate.status, 202, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body.accepted, false);
  } finally {
    await app.close();
    await db.close();
    delete process.env.DEMO_DEVICE_SECRET;
  }
});
