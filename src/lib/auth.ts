import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "le_session";
const SESSION_DAYS = 7;

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET env var must be set (16+ chars)");
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(adminId: string, email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;

    // A valid signature is not enough: the admin may have logged out or had
    // their sessions revoked since this token was issued.
    const admin = await db.adminUser.findUnique({
      where: { id: String(payload.sub) },
      select: { sessionsFrom: true, email: true },
    });
    if (!admin) return null;
    const issuedAt = typeof payload.iat === "number" ? payload.iat * 1000 : 0;
    if (issuedAt < admin.sessionsFrom.getTime()) return null;

    return { adminId: String(payload.sub), email: admin.email };
  } catch {
    return null;
  }
}

// Login throttling. A single-instance admin tool does not need a shared store;
// what matters is that bcrypt cannot be hammered indefinitely.
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; first: number }>();

async function throttleKey(email: string) {
  const store = await headers();
  const ip =
    store.get("x-forwarded-for")?.split(",")[0].trim() || store.get("x-real-ip") || "local";
  return `${ip}|${email.toLowerCase().trim()}`;
}

function attemptsExceeded(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count++;
}

export class TooManyAttemptsError extends Error {
  constructor() {
    super("Too many sign-in attempts. Wait 15 minutes and try again.");
  }
}

/** Returns the logged-in admin session or null. Safe to call anywhere server-side. */
export async function getSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throws if there is no valid admin session. Server actions call this first. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function loginWithCredentials(email: string, password: string) {
  const key = await throttleKey(email);
  if (attemptsExceeded(key)) throw new TooManyAttemptsError();

  const admin = await db.adminUser.findUnique({ where: { email: email.toLowerCase().trim() } });
  const ok = admin ? await verifyPassword(password, admin.passwordHash) : false;
  if (!admin || !ok) {
    recordFailure(key);
    return null;
  }
  loginAttempts.delete(key);

  const token = await createSessionToken(admin.id, admin.email);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return { adminId: admin.id, email: admin.email };
}

export async function logout() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);

  // Invalidate the token itself, not just the browser's copy of it.
  if (token) {
    const session = await verifySessionToken(token);
    if (session) {
      await db.adminUser.update({
        where: { id: session.adminId },
        data: { sessionsFrom: new Date() },
      }).catch(() => undefined);
    }
  }
}
