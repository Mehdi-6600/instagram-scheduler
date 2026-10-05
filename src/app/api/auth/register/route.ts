import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import { signupSecret } from "@/lib/env";
import { credentialsSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * POST /api/auth/register
 * - If no user exists yet: creates the first (owner) account — one-time setup.
 * - Otherwise: only allowed when SIGNUP_SECRET is set and matches (personal app).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { email, password, name } = parsed.data;

    const userCount = await prisma.user.count();
    const secret = signupSecret();

    if (userCount > 0) {
      if (!secret) {
        return jsonError(
          "Registration is closed. This is a private app — sign in instead.",
          403
        );
      }
      if (body.signupSecret !== secret) {
        return jsonError("Invalid signup secret.", 403);
      }
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) return jsonError("An account with this email already exists.", 409);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await hashPassword(password),
        name: name || null,
      },
    });
    await createSession(user.id);
    return jsonOk({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return errorResponse(err);
  }
}
