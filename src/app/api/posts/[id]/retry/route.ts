import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import { serializePost } from "@/lib/posts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/posts/:id/retry — manually retry a FAILED post.
 * Re-arms it as SCHEDULED due immediately; the next cron pass publishes it.
 * If the scheduled time is still in the future, it simply returns to the queue.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const post = await prisma.scheduledPost.findFirst({
      where: { id, userId: user.id },
    });
    if (!post) return jsonError("Post not found.", 404);
    if (post.status !== "FAILED") {
      return jsonError("Only failed posts can be retried.", 409);
    }

    const updated = await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "SCHEDULED",
        errorMessage: null,
        errorCode: null,
        attemptCount: 0, // fresh auto-retry budget
        nextRetryAt: new Date(),
        lockedAt: null,
      },
    });
    return jsonOk({ post: serializePost(updated) });
  } catch (err) {
    return errorResponse(err);
  }
}
