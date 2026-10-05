import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    if (!email || !password) return jsonError("Email and password are required.");

    const user = await prisma.user.findUnique({ where: { email } });
    // Constant-ish response for unknown emails to avoid user enumeration.
    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    if (!user || !ok) return jsonError("Invalid email or password.", 401);

    await createSession(user.id);
    return jsonOk({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    return errorResponse(err);
  }
}
