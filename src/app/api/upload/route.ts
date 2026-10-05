import { requireApiUser } from "@/lib/auth";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import {
  ImageValidationError,
  MAX_UPLOAD_BYTES,
  processUploadedImage,
} from "@/lib/image";
import { uploadImage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * POST /api/upload — image upload for a post.
 * Accepts multipart/form-data with a `file` field. The image is normalized to
 * Instagram-safe JPEG (≤1440px, aspect 4:5..1.91:1) and stored in object
 * storage with a public URL (required by the Instagram publishing API).
 */
export async function POST(request: Request) {
  try {
    await requireApiUser();

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError("Expected multipart/form-data with a `file` field.");
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return jsonError("No image file received.");
    }

    const raw = Buffer.from(await (file as File).arrayBuffer());
    if (raw.length > MAX_UPLOAD_BYTES) {
      return jsonError("Image is too large (max 15 MB).");
    }

    const processed = await processUploadedImage(raw);
    const stored = await uploadImage(processed.buffer, {
      width: processed.width,
      height: processed.height,
    });

    return jsonOk({
      url: stored.url,
      publicId: stored.publicId,
      width: stored.width,
      height: stored.height,
      bytes: stored.bytes,
      provider: stored.provider,
    });
  } catch (err) {
    if (err instanceof ImageValidationError) {
      return jsonError(err.message, 422);
    }
    return errorResponse(err);
  }
}
