import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { errorResponse, jsonError } from "@/lib/http";
import { randomToken } from "@/lib/crypto";
import { appUrl, isMockInstagram, oauthMode } from "@/lib/env";
import { buildAuthorizeUrl } from "@/lib/instagram/oauth";

export const runtime = "nodejs";

/**
 * GET /api/instagram/connect
 * Starts the official Meta OAuth flow. Redirects the browser to
 * Facebook/Instagram authorization (never handles any password).
 */
export async function GET(request: Request) {
  try {
    await requireApiUser();

    if (isMockInstagram()) {
      return NextResponse.redirect(new URL("/?ig_error=mock_mode_use_mock_connect", appUrl()));
    }

    const state = randomToken(24);
    const res = NextResponse.redirect(buildAuthorizeUrl(state));
    res.cookies.set("ig_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    res.cookies.set("ig_oauth_mode", oauthMode(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
