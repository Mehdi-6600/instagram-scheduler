/** Client-side helpers: API calls, image prep, formatting. */

export interface AttemptDto {
  id: string;
  attemptNumber: number;
  status: string;
  trigger: string;
  containerId: string | null;
  instagramMediaId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface PostDto {
  id: string;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  caption: string;
  scheduledAt: string;
  timezone: string;
  status: "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";
  instagramMediaId: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  mock: boolean;
  attempts?: AttemptDto[];
}

export interface AccountStatusDto {
  connected: boolean;
  mock?: boolean;
  mockMode: boolean;
  oauthMode: "facebook" | "instagram";
  username?: string | null;
  fullName?: string | null;
  profilePictureUrl?: string | null;
  accountType?: string | null;
  fbPageName?: string | null;
  status?: string | null;
  lastError?: string | null;
  connectedAt?: string | null;
  tokenExpiresAt?: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...init } = opts;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : init.body,
    credentials: "same-origin",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Downscale + re-encode an image in the browser (fast mobile uploads, and it
 * keeps request bodies under serverless body-size limits). Falls back to the
 * original file if canvas processing fails.
 */
export async function prepareImageFile(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
  aspect: number;
  original: boolean;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const max = 1440;
    let { width, height } = img;
    const scale = Math.min(1, max / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) throw new Error("toBlob failed");
    return { blob, width, height, aspect: width / height, original: false };
  } catch {
    return {
      blob: file,
      width: 0,
      height: 0,
      aspect: 0,
      original: true,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}

export const IG_MIN_ASPECT = 0.795; // 4:5 with tolerance
export const IG_MAX_ASPECT = 1.915;

export function aspectError(width: number, height: number): string | null {
  if (!width || !height) return null;
  const aspect = width / height;
  if (aspect < IG_MIN_ASPECT || aspect > IG_MAX_ASPECT) {
    return "Instagram accepts aspect ratios from 4:5 to 1.91:1. Please crop your photo a little.";
  }
  return null;
}

export function localDateTimeToDate(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
