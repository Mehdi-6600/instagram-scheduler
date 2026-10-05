import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import type { User } from "@/lib/types";
import { prisma } from "./db";
import { randomToken, sha256Hex } from "./crypto";
import { sessionCookieName } from "./env";

const SESSION_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash, userId, expiresAt } });
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
    store.delete(sessionCookieName());
  }
}

/** Returns the authenticated user or null. Slides the session expiry. */
export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { tokenHash } });
    return null;
  }
  // Sliding renewal (throttled to once per hour to avoid write amplification).
  if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    await prisma.session.update({
      where: { tokenHash },
      data: { lastUsedAt: new Date() },
    });
  }
  return session.user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** For API routes: returns the user or throws AuthError(401). */
export async function requireApiUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Not authenticated");
  return user;
}
