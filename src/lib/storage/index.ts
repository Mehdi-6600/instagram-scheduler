/**
 * Image storage abstraction.
 *
 * Production driver: Cloudinary (free tier) — required because the official
 * Instagram publishing API fetches images from a *public* URL at publish time.
 *   STORAGE_DRIVER=cloudinary (default) + CLOUDINARY_* env vars.
 *
 * Dev/local driver: filesystem under ./data/uploads, served publicly at
 * /api/files/* (only reachable by Meta if the app itself is publicly deployed
 * with a persistent volume — fine for local dev and mock mode).
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { appUrl, storageDriver } from "../env";

export interface StoredImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  provider: "cloudinary" | "local";
}

export async function uploadImage(
  buffer: Buffer,
  meta: { width: number; height: number; format?: string }
): Promise<StoredImage> {
  return storageDriver() === "local"
    ? uploadLocal(buffer, meta)
    : uploadCloudinary(buffer, meta);
}

export async function deleteImage(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  if (storageDriver() === "local") {
    const safe = path.basename(publicId);
    await fs.unlink(path.join(localDir(), safe)).catch(() => {});
    return;
  }
  await deleteCloudinary(publicId).catch(() => {});
}

function localDir(): string {
  return path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || "data/uploads");
}

async function uploadLocal(
  buffer: Buffer,
  meta: { width: number; height: number; format?: string }
): Promise<StoredImage> {
  const name = `${crypto.randomBytes(12).toString("hex")}.jpg`;
  const dir = localDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return {
    url: `${appUrl()}/api/files/${name}`,
    publicId: name,
    width: meta.width,
    height: meta.height,
    bytes: buffer.length,
    format: meta.format || "jpeg",
    provider: "local",
  };
}

/* ----------------------------- Cloudinary ----------------------------- */

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

function cloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
  const apiKey = process.env.CLOUDINARY_API_KEY || "";
  const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)"
    );
  }
  return { cloudName, apiKey, apiSecret };
}

/** Cloudinary signature: SHA-1 over sorted params + api_secret. */
function cloudinarySignature(
  params: Record<string, string | number>,
  apiSecret: string
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

async function uploadCloudinary(
  buffer: Buffer,
  meta: { width: number; height: number; format?: string }
): Promise<StoredImage> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || "my-instagram-scheduler";
  const publicId = `mis_${crypto.randomBytes(10).toString("hex")}`;
  const params = { folder, public_id: publicId, timestamp };
  const signature = cloudinarySignature(params, apiSecret);

  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }), `${publicId}.jpg`);
  form.set("api_key", apiKey);
  form.set("timestamp", String(timestamp));
  form.set("folder", folder);
  form.set("public_id", publicId);
  form.set("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as {
    secure_url?: string;
    public_id?: string;
    width?: number;
    height?: number;
    bytes?: number;
    format?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.secure_url) {
    throw new Error(`Cloudinary upload failed: ${json.error?.message ?? res.status}`);
  }
  return {
    url: json.secure_url,
    publicId: json.public_id ?? publicId,
    width: json.width ?? meta.width,
    height: json.height ?? meta.height,
    bytes: json.bytes ?? buffer.length,
    format: json.format ?? "jpeg",
    provider: "cloudinary",
  };
}

async function deleteCloudinary(publicId: string): Promise<void> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const signature = cloudinarySignature(params, apiSecret);
  const form = new FormData();
  form.set("public_id", publicId);
  form.set("timestamp", String(timestamp));
  form.set("api_key", apiKey);
  form.set("signature", signature);
  await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
}
