import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteImage } from "@/lib/storage";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import { postUpdateSchema } from "@/lib/validation";
import { serializePost } from "@/lib/posts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** GET /api/posts/:id — single post with its publish attempts (history). */
export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId: user.id },
      include: { attempts: { orderBy: { startedAt: "desc" } } },
    });
    if (!post) return jsonError("Post not found.", 404);
    return jsonOk({ post: serializePost(post) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/posts/:id — edit a post.
 * Allowed while SCHEDULED or FAILED. PUBLISHING is locked; PUBLISHED is read-only.
 * Editing a FAILED post re-arms it (back to SCHEDULED, due immediately).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = postUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId: user.id },
    });
    if (!post) return jsonError("Post not found.", 404);
    if (post.status === "PUBLISHED") {
      return jsonError("Published posts can't be edited.", 409);
    }
    if (post.status === "PUBLISHING") {
      return jsonError("This post is being published right now and can't be edited.", 409);
    }

    const data = parsed.data;
    if (
      data.scheduledAt &&
      data.scheduledAt.getTime() < Date.now() - 60_000 &&
      post.status !== "FAILED"
    ) {
      return jsonError("Publish time must be in the future.");
    }

    // Replacing the image? Clean up the old stored file (best-effort).
    if (data.imageUrl && data.imageUrl !== post.imageUrl && post.imagePublicId) {
      deleteImage(post.imagePublicId);
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
        ...(data.imagePublicId !== undefined ? { imagePublicId: data.imagePublicId } : {}),
        ...(data.imageWidth !== undefined ? { imageWidth: data.imageWidth } : {}),
        ...(data.imageHeight !== undefined ? { imageHeight: data.imageHeight } : {}),
        ...(data.caption !== undefined ? { caption: data.caption } : {}),
        ...(data.scheduledAt !== undefined ? { scheduledAt: data.scheduledAt } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        // Editing a failed post re-arms it with a fresh retry budget.
        ...(post.status === "FAILED"
          ? {
              status: "SCHEDULED" as const,
              errorMessage: null,
              errorCode: null,
              attemptCount: 0,
              nextRetryAt: new Date(),
            }
          : {}),
      },
    });
    return jsonOk({ post: serializePost(updated) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/posts/:id — remove a scheduled post (published history stays in attempts of other posts). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId: user.id },
    });
    if (!post) return jsonError("Post not found.", 404);
    if (post.status === "PUBLISHING") {
      return jsonError("This post is being published right now and can't be deleted.", 409);
    }

    await prisma.scheduledPost.delete({ where: { id: post.id } });
    if (post.imagePublicId) deleteImage(post.imagePublicId); // best-effort cleanup
    return jsonOk({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
