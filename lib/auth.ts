import "server-only";

import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { env } from "./env";

// Session cookie name + params. httpOnly + Secure + SameSite=Lax per plan.
export const SESSION_COOKIE = "vantra_session";
const SESSION_ISSUER = "vantra";
const SESSION_AUDIENCE = "vantra";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const encoder = new TextEncoder();
const secretKey = () => encoder.encode(env.sessionSecret);

export interface SessionPayload {
  sub: string; // user id
  email: string;
  emailVerified: boolean;
  role?: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    emailVerified: payload.emailVerified,
    ...(payload.role ? { role: payload.role } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .sign(secretKey());
}

/** Decodes + validates a JWT. Returns null if invalid/expired. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      emailVerified: Boolean(payload.emailVerified),
      ...(payload.role ? { role: String(payload.role) } : {}),
    };
  } catch {
    return null;
  }
}

/** Sets the session cookie on the current request/response context. */
export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Clears the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Confirmed live (2026-09-19) — the session cookie above is a stateless JWT:
// there's no server-side session table, so admin unbinding a device has no
// way to reach into an already-open browser tab and revoke it directly.
// This SEPARATE, long-lived cookie remembers "this webview is running inside
// the Vantra EXE on device X" (set once by workspace-handoff.tsx right after
// exe-gate.tsx's redirect, which is the only moment the hosted app ever
// learns the local device id). getCurrentUser() re-checks it on every
// authenticated read: if device X's ExeLicense binding is gone or moved to a
// different device, the web session is force-cleared right there, so an
// unbound machine can't keep browsing on a stale login. A normal (non-EXE)
// browser session never sets this cookie and is completely unaffected.
export const EXE_DEVICE_COOKIE = "vantra_exe_device";
const EXE_DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year — outlives the session cookie itself

export async function setExeDeviceCookie(deviceId: string): Promise<void> {
  const store = await cookies();
  store.set(EXE_DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: EXE_DEVICE_COOKIE_MAX_AGE,
  });
}

export async function getExeDeviceCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(EXE_DEVICE_COOKIE)?.value ?? null;
}

export async function clearExeDeviceCookie(): Promise<void> {
  const store = await cookies();
  store.set(EXE_DEVICE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Reads and validates the current session from cookies. Returns null if none. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}