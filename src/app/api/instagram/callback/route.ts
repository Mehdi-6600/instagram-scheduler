import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { ConnectionMode } from "@/lib/types";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { appUrl, oauthMode } from "@/lib/env";
import type { GraphMode } from "@/lib/instagram/graph";
import {
  NoInstagramAccountError,
  exchangeCodeForToken,
  resolveConnection,
} from "@/lib/instagram/oauth";

export const runtime = "nodejs";

/**
 * GET /api/instagram/callback
 * Meta OAuth redirect target. Exchanges the code, resolves the Instagram
 * professional account, encrypts the access token at rest, and returns to the
 * dashboard. "Connected" is only ever shown after this succeeds against the
 * real API (or in explicitly enabled mock mode).
 */
export async function GET(request: Request) {
  const store = await cookies();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDesc =
    url.searchParams.get("error_description") || url.searchParams.get("error_reason") || "";

  const expectedState = store.get("ig_oauth_state")?.value;
  const mode = (store.get("ig_oauth_mode")?.value as GraphMode) || oauthMode();
  store.delete("ig_oauth_state");
  store.delete("ig_oauth_mode");

  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/?ig_error=${encodeURIComponent(message)}`, appUrl())
    );

  const user = await getSessionUser();
  if (!user) return fail("Your session expired. Sign in and try connecting again.");

  if (oauthError) {
    return fail(`Instagram authorization was not completed: ${oauthError} ${oauthErrorDesc}`.trim());
  }
  if (!code) return fail("Instagram did not return an authorization code.");
  if (!state || state !== expectedState) {
    return fail("Invalid OAuth state. Please start the connection again.");
  }

  try {
    const token = await exchangeCodeForToken(code, mode);
    const resolved = await resolveConnection(token, mode);

    const data = {
      mode: (mode === "instagram" ? "INSTAGRAM" : "FACEBOOK") as ConnectionMode,
      igUserId: resolved.igUserId,
      username: resolved.profile.username || resolved.igUserId,
      fullName: resolved.profile.name ?? null,
      profilePictureUrl: resolved.profile.profile_picture_url ?? null,
      accountType: resolved.profile.account_type ?? null,
      fbPageId: resolved.fbPageId ?? null,
      fbPageName: resolved.fbPageName ?? null,
      accessToken: encryptSecret(resolved.accessToken),
      tokenExpiresAt: resolved.expiresAt,
      scopes: resolved.scopes,
      status: "ACTIVE" as const,
      lastError: null,
    };

    await prisma.instagramAccount.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: { ...data, connectedAt: new Date() },
    });

    return NextResponse.redirect(new URL("/?ig_connected=1", appUrl()));
  } catch (err) {
    if (err instanceof NoInstagramAccountError) {
      return fail(`${err.message} Open Instagram → Settings → Account type → switch to Professional, then link it to a Facebook Page in Meta Business Suite.`);
    }
    console.error("[instagram/callback]", err);
    return fail(
      err instanceof Error
        ? `Instagram connection failed: ${err.message}`
        : "Instagram connection failed."
    );
  }
}
