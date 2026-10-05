/**
 * Classification of publishing failures:
 * which errors deserve an automatic retry, and which are permanent.
 */

import { GraphApiError, NetworkError } from "../instagram/graph";

export type FailureKind =
  | "TOKEN_EXPIRED"
  | "RATE_LIMIT"
  | "NETWORK"
  | "SERVER"
  | "INVALID_MEDIA"
  | "INVALID_CAPTION"
  | "PERMISSION"
  | "NOT_CONNECTED"
  | "CONFIG"
  | "UNKNOWN";

export interface ClassifiedError {
  kind: FailureKind;
  retryable: boolean;
  code: string;
  message: string;
}

const PERMANENT_MEDIA_RE =
  /media.{0,30}(fetch|download|available|format|unsupported)|image.{0,20}(invalid|unsupported|too (big|large)|format|size)|photo.{0,20}(invalid|unsupported|too)|jpeg|aspect ratio|could not be fetched|invalid.{0,15}(image|photo|media)/i;

const PERMANENT_CAPTION_RE = /caption/i;

const RATE_LIMIT_CODES = new Set([4, 32, 613, 80001, 80003, 80004, 80005, 17]);
const PERMISSION_CODES = new Set([10, 200, 204, 294, 2500]);
const TOKEN_CODES = new Set([102, 190, 463, 467, 458]);

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof NetworkError) {
    return {
      kind: "NETWORK",
      retryable: true,
      code: "NETWORK",
      message: `Temporary network error: ${err.message}`,
    };
  }

  if (err instanceof GraphApiError) {
    const code = err.code;
    const sub = err.subcode;
    const type = err.type ?? "";
    const message = err.message;

    // Expired / invalid access tokens.
    if (
      type === "OAuthException" &&
      (code === 190 || code === 102 || (sub !== undefined && TOKEN_CODES.has(sub)))
    ) {
      return {
        kind: "TOKEN_EXPIRED",
        retryable: false,
        code: String(code ?? 190),
        message:
          "Instagram authorization expired or was revoked. Reconnect your Instagram account, then retry this post.",
      };
    }
    if (code === 190 || code === 102) {
      return {
        kind: "TOKEN_EXPIRED",
        retryable: false,
        code: String(code),
        message: "Instagram authorization expired. Reconnect your Instagram account.",
      };
    }

    // Rate limits (including the content publishing limit) — retry later.
    if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
      return {
        kind: "RATE_LIMIT",
        retryable: true,
        code: String(code),
        message:
          "Instagram rate limit reached. The post will be retried automatically after the cool-down.",
      };
    }

    // Permission problems are permanent until the app/account setup changes.
    if (code !== undefined && PERMISSION_CODES.has(code)) {
      return {
        kind: "PERMISSION",
        retryable: false,
        code: String(code),
        message:
          "Permission denied by Instagram. Make sure the app has instagram_content_publish and the account is a professional (Business/Creator) account linked to a Facebook Page.",
      };
    }

    // Invalid media / caption — permanent for this content.
    if (PERMANENT_MEDIA_RE.test(message) || code === 36003 || code === 2207002 || code === 2207026) {
      return {
        kind: "INVALID_MEDIA",
        retryable: false,
        code: String(code ?? "INVALID_MEDIA"),
        message: `Instagram rejected the image: ${message}`,
      };
    }
    if (PERMANENT_CAPTION_RE.test(message)) {
      return {
        kind: "INVALID_CAPTION",
        retryable: false,
        code: String(code ?? "INVALID_CAPTION"),
        message: `Instagram rejected the caption: ${message}`,
      };
    }

    // Meta 5xx — temporary.
    if (err.httpStatus >= 500) {
      return {
        kind: "SERVER",
        retryable: true,
        code: String(code ?? err.httpStatus),
        message: `Instagram API temporary error: ${message}`,
      };
    }

    // Unknown 4xx: allow bounded retries (capped by MAX_AUTO_ATTEMPTS),
    // then fail for manual retry — never an endless loop.
    return {
      kind: "UNKNOWN",
      retryable: true,
      code: String(code ?? err.httpStatus),
      message: `Instagram API error: ${message}`,
    };
  }

  if (err instanceof Error) {
    return {
      kind: "UNKNOWN",
      retryable: true,
      code: "UNKNOWN",
      message: err.message,
    };
  }
  return { kind: "UNKNOWN", retryable: true, code: "UNKNOWN", message: "Unknown error" };
}
