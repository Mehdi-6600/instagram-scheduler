import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, jsonError, jsonOk } from "@/lib/http";
import { encryptSecret } from "@/lib/crypto";
import { isMockInstagram } from "@/lib/env";
import { mockConnectProfile } from "@/lib/instagram/mock";

export const runtime = "nodejs";

/**
 * POST /api/instagram/mock-connect
 * Explicitly connects a FAKE Instagram account for development/testing.
 * Only available when INSTAGRAM_MOCK_MODE=true. The UI labels this clearly as
 * a mock connection — it is never presented as a real Instagram connection.
 */
export async function POST() {
  try {
    const user = await requireApiUser();
    if (!isMockInstagram()) {
      return jsonError("Mock mode is disabled (INSTAGRAM_MOCK_MODE is not true).", 403);
    }
    const profile = mockConnectProfile();
    const account = await prisma.instagramAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        mode: "MOCK",
        igUserId: profile.igUserId,
        username: profile.username,
        fullName: profile.name,
        profilePictureUrl: null,
        accountType: profile.account_type,
        accessToken: encryptSecret("mock-token"),
        tokenExpiresAt: null,
        scopes: "mock",
        status: "ACTIVE",
      },
      update: {
        mode: "MOCK",
        igUserId: profile.igUserId,
        username: profile.username,
        fullName: profile.name,
        accountType: profile.account_type,
        accessToken: encryptSecret("mock-token"),
        status: "ACTIVE",
        lastError: null,
        connectedAt: new Date(),
      },
    });
    return jsonOk({
      connected: true,
      mock: true,
      username: account.username,
      message: "Mock Instagram account connected. Publishing will be simulated.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
