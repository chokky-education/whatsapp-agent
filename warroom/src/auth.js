import { createRemoteJWKSet, jwtVerify } from "jose";
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function hash(v) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function cookie(request, name) {
  const pair = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  return pair ? pair.slice(name.length + 1) : null;
}
export function sessionCookie(value, maxAge = 28800) {
  return `__Host-warroom=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function challengeCookie(value, maxAge = 300) {
  return `__Host-warroom_login=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
export async function session(request, db, now = Date.now()) {
  const raw = cookie(request, "__Host-warroom");
  if (!raw || raw.length !== 64) return null;
  return db
    .prepare(
      `SELECT s.hash,s.csrf,s.expires_at,m.email,m.role,w.google_sub AS verified_sub
       FROM sessions s JOIN members m ON m.email=s.email
       LEFT JOIN work_session_subjects w ON w.session_hash=s.hash AND w.google_sub=m.sub
       WHERE s.hash=? AND s.expires_at>?`,
    )
    .bind(await hash(raw), now)
    .first();
}
export async function verifyGoogle(
  credential,
  audience,
  nonce,
  keys = googleKeys,
) {
  const { payload } = await jwtVerify(credential, keys, {
    audience,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    algorithms: ["RS256"],
    maxTokenAge: "10m",
  });
  if (
    payload.nonce !== nonce ||
    payload.email_verified !== true ||
    !payload.sub ||
    !payload.email
  )
    throw new Error("identity");
  // For Google accounts whose external mailbox ownership is not authoritative,
  // do not grant an email allowlist entry without a separate ownership flow.
  if (!payload.email.toLowerCase().endsWith("@gmail.com") && !payload.hd)
    throw new Error("email_authority");
  return { email: payload.email.toLowerCase(), sub: payload.sub };
}
