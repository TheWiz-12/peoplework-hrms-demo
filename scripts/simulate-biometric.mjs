// Fictional reader simulator for the private demo. Run inside the app container.
// It signs a real request to the biometric ingestion API; it does not bypass it.
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.DEMO_DEVICE_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Set a unique DEMO_DEVICE_SECRET of at least 32 characters");

const employeeCode = process.argv[2] || "EMP001";
const direction = process.argv[3] || "in";
if (!/^EMP\d{3}$/.test(employeeCode))
  throw new Error("Use a fictional seeded employee code such as EMP001");
if (!["in", "out", "unknown"].includes(direction))
  throw new Error("Direction must be in, out, or unknown");

const deviceId = "60000000-0000-4000-8000-000000000001";
const timestamp = String(Date.now());
const nonce = randomUUID();
const body = JSON.stringify({
  employeeCode,
  occurredAt: new Date().toISOString(),
  eventId: randomUUID(),
  direction,
});
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${nonce}.${body}`)
  .digest("hex");
const response = await fetch("http://127.0.0.1:3001/api/biometric/events", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-device-id": deviceId,
    "x-timestamp": timestamp,
    "x-nonce": nonce,
    "x-signature": signature,
  },
  body,
});
const result = await response.text();
if (!response.ok)
  throw new Error(`Biometric API returned ${response.status}: ${result}`);
process.stdout.write(`${result}\n`);
