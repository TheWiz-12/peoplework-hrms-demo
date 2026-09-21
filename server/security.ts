import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export function hashPassword(p: string) {
  const salt = randomBytes(16).toString("hex");
  return (
    salt +
    ":" +
    scryptSync(p, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")
  );
}
export function checkPassword(p: string, hash: string) {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const got = scryptSync(p, salt, 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(key, "hex");
  return want.length === got.length && timingSafeEqual(got, want);
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
