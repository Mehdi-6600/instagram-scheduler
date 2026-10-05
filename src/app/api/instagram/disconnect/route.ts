import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { errorResponse, jsonOk } from "@/lib/http";
import { revokeAuthorization } from "@/lib/instagram/oauth";

export const runtime = "nodejs";

/**
 * POST /api/instagram/disconnect
 * Safe disconnect: best-effort revocation of the app's authorization at Meta,
 * then removal of the locally stored (encrypted) credentials.
 */
export async function POST() {
  try {
    const user = await requireApiUser();
    const account = await prisma.instagramAccount.findUnique({
      where: { userId: user.id },
    });
    if (!account) return jsonOk({ disconnected: true });

    if (account.mode !== "MOCK") {
      try {
        await revokeAuthorization(
          decryptSecret(account.accessToken),
          account.mode === "INSTAGRAM" ? "instagram" : "facebook"
        );
      } catch {
        /* revocation is best-effort */
      }
    }

    await prisma.instagramAccount.delete({ where: { id: account.id } });
    return jsonOk({ disconnected: true });
  } catch (err) {
    return errorResponse(err);
  }
}
