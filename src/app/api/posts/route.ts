import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import { postCreateSchema } from "@/lib/validation";
import { serializePost } from "@/lib/posts";
import { isMockInstagram } from "@/lib/env";

export const runtime = "nodejs";

/** GET /api/posts — all of the current user's scheduled posts (newest scheduled first). */
export async function GET() {
  try {
    const user = await requireApiUser();
    const posts = await prisma.scheduledPost.findMany({
      where: { userId: user.id },
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    });
    return jsonOk({ posts: posts.map((p) => serializePost(p)), mockMode: isMockInstagram() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/posts — create a scheduled post. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = await request.json().catch(() => ({}));
    const parsed = postCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const data = parsed.data;

    if (data.scheduledAt.getTime() < Date.now() - 60_000) {
      return jsonError("Publish time must be in the future.");
    }

    const post = await prisma.scheduledPost.create({
      data: {
        userId: user.id,
        imageUrl: data.imageUrl,
        imagePublicId: data.imagePublicId ?? null,
        imageWidth: data.imageWidth ?? null,
        imageHeight: data.imageHeight ?? null,
        caption: data.caption,
        scheduledAt: data.scheduledAt,
        timezone: data.timezone,
        status: "SCHEDULED",
      },
    });
    return jsonOk({ post: serializePost(post) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
