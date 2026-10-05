import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { errorResponse, jsonOk } from "@/lib/http";
import { isMockInstagram, oauthMode } from "@/lib/env";
import { getContentPublishingLimit } from "@/lib/instagram/publish";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireApiUser();
    const account = await prisma.instagramAccount.findUnique({
      where: { userId: user.id },
    });

    if (!account) {
      return jsonOk({
        connected: false,
        mockMode: isMockInstagram(),
        oauthMode: oauthMode(),
      });
    }

    // Live usage against Instagram's 100-posts-per-24h publishing limit.
    let publishingLimit: { quotaUsage: number; configDurationSeconds: number } | null = null;
    if (account.mode !== "MOCK" && account.status === "ACTIVE") {
      publishingLimit = await getContentPublishingLimit(
        account.igUserId,
        decryptSecret(account.accessToken),
        account.mode === "INSTAGRAM" ? "instagram" : "facebook"
      );
    }

    return jsonOk({
      connected: account.status !== "DISCONNECTED",
      mock: account.mode === "MOCK",
      mockMode: isMockInstagram(),
      oauthMode: oauthMode(),
      username: account.username,
      fullName: account.fullName,
      profilePictureUrl: account.profilePictureUrl,
      accountType: account.accountType,
      fbPageName: account.fbPageName,
      status: account.status,
      lastError: account.lastError,
      connectedAt: account.connectedAt,
      tokenExpiresAt: account.tokenExpiresAt,
      publishingLimit,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
