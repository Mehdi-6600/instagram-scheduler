import { z } from "zod";

/**
 * Central access to environment configuration. All secrets come from
 * environment variables — nothing sensitive is ever hardcoded.
 */

export function isMockInstagram(): boolean {
  return process.env.INSTAGRAM_MOCK_MODE === "true";
}

export function oauthMode(): "facebook" | "instagram" {
  return process.env.INSTAGRAM_OAUTH_MODE === "instagram" ? "instagram" : "facebook";
}

export function metaGraphVersion(): string {
  return process.env.META_GRAPH_API_VERSION || "v26.0";
}

export function cronSecret(): string | null {
  return process.env.CRON_SECRET || null;
}

export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** Allowed OAuth redirect origins (comma separated). Falls back to APP_URL. */
export function allowedRedirectOrigins(): string[] {
  const raw =
    process.env.OAUTH_REDIRECT_ORIGINS ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function storageDriver(): "cloudinary" | "local" {
  return process.env.STORAGE_DRIVER === "local" ? "local" : "cloudinary";
}

export function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME || "mis_session";
}

export function signupSecret(): string | null {
  return process.env.SIGNUP_SECRET || null;
}

export function maxAutoAttempts(): number {
  const n = Number(process.env.MAX_AUTO_ATTEMPTS || 3);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

/** Validate the environment early; returns a list of human-readable problems. */
export function validateEnv(): string[] {
  const problems: string[] = [];
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(issue.message);
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length < 16) {
    problems.push("TOKEN_ENCRYPTION_KEY must be set (at least 16 characters)");
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 16) {
    problems.push("AUTH_SECRET must be set (at least 16 characters)");
  }
  if (!isMockInstagram()) {
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      problems.push(
        "META_APP_ID and META_APP_SECRET are required unless INSTAGRAM_MOCK_MODE=true"
      );
    }
    if (storageDriver() === "cloudinary") {
      const missing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].filter(
        (k) => !process.env[k]
      );
      if (missing.length) {
        problems.push(
          `${missing.join(", ")} required for Cloudinary storage (or set STORAGE_DRIVER=local)`
        );
      }
    }
  }
  return problems;
}
