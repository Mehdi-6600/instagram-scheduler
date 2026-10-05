/**
 * Server-side image normalization for Instagram publishing.
 * Instagram feed photos: JPEG only, max 8 MB, aspect ratio 4:5 .. 1.91:1.
 * Everything is re-encoded to JPEG ≤1440px so publishing always gets valid media.
 */

import sharp from "sharp";

export const IG_MIN_ASPECT = 4 / 5; // 0.8
export const IG_MAX_ASPECT = 1.91;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // raw upload cap before resize

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  format: "jpeg";
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageValidationError("Empty file");
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new ImageValidationError("Image is too large (max 15 MB)");
  }

  let pipeline: sharp.Sharp;
  let meta: sharp.Metadata;
  try {
    pipeline = sharp(input, { failOn: "error" }).rotate(); // honor EXIF orientation
    meta = await pipeline.metadata();
  } catch {
    throw new ImageValidationError(
      "Could not read this file as an image. Use a JPEG or PNG photo."
    );
  }

  if (!meta.width || !meta.height) {
    throw new ImageValidationError("Could not determine image dimensions");
  }

  const aspect = meta.width / meta.height;
  if (aspect < IG_MIN_ASPECT - 0.005 || aspect > IG_MAX_ASPECT + 0.005) {
    throw new ImageValidationError(
      `Instagram accepts aspect ratios from 4:5 to 1.91:1 — this image is ${meta.width}×${meta.height}. Please crop it a little.`
    );
  }

  try {
    const buffer = await pipeline
      .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true, progressive: true })
      .toBuffer();
    const out = await sharp(buffer).metadata();
    return {
      buffer,
      width: out.width ?? meta.width,
      height: out.height ?? meta.height,
      bytes: buffer.length,
      format: "jpeg",
    };
  } catch {
    throw new ImageValidationError("Failed to process the image. Try a different photo.");
  }
}
