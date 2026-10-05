/**
 * Official Meta OAuth connection flows.
 *
 * Two official modes are supported (INSTAGRAM_OAUTH_MODE):
 *  - "facebook"  (default): Instagram API with Facebook Login —
 *    Instagram professional account (Business/Creator) linked to a Facebook Page.
 *    Permissions: instagram_basic, instagram_content_publish,
 *    pages_show_list, pages_read_engagement.
 *  - "instagram": Instagram API with Instagram Login (Business Login for
 *    Instagram) — no Facebook Page required.
 *    Permissions: instagram_business_basic, instagram_business_content_publish.
 *
 * No passwords are ever handled by this app — only official OAuth codes and
 * access tokens, encrypted at rest.
 */

import { appUrl, metaGraphVersion, oauthMode } from "../env";
import {
  GraphMode,
  GraphRequestOptions,
  LongLivedToken,
  graphRequest,
} from "./graph";

export const SCOPES: Record<GraphMode, string> = {
  facebook:
    "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
  instagram: "instagram_business_basic,instagram_business_content_publish",
};

export function redirectUri(): string {
  return `${appUrl()}/api/instagram/callback`;
}

export function buildAuthorizeUrl(state: string, mode: GraphMode = oauthMode()): string {
  const common = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
    scope: SCOPES[mode],
  });
  if (mode === "instagram") {
    return `https://www.instagram.com/oauth/authorize?${common}`;
  }
  return `https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${common}`;
}

function req(
  path: string,
  params: Record<string, string | number | undefined>,
  token?: string,
  mode?: GraphMode
): GraphRequestOptions {
  return { path, params, token: token ?? "", mode };
}

/** Facebook Login: exchange code -> short token -> long-lived user token. */
async function facebookExchange(code: string): Promise<LongLivedToken> {
  const short = await graphRequest<LongLivedToken & { user_id?: string }>(
    req("/oauth/access_token", {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri(),
      code,
      grant_type: "authorization_code",
    })
  );
  return graphRequest<LongLivedToken>(
    req(
      "/oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: short.access_token,
      },
      "",
      "facebook"
    )
  );
}

/** Instagram Login: exchange code -> short token -> long-lived IG user token. */
async function instagramExchange(code: string): Promise<LongLivedToken> {
  const short = await graphRequest<LongLivedToken & { user_id?: string }>(
    req(
      "/oauth/access_token",
      {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri(),
        code,
        grant_type: "authorization_code",
      },
      "",
      "instagram"
    )
  );
  return graphRequest<LongLivedToken>(
    req(
      "/access_token",
      {
        grant_type: "ig_exchange_token",
        access_token: short.access_token,
      },
      "",
      "instagram"
    )
  );
}

export async function exchangeCodeForToken(
  code: string,
  mode: GraphMode = oauthMode()
): Promise<LongLivedToken> {
  return mode === "instagram" ? instagramExchange(code) : facebookExchange(code);
}

export interface IgProfile {
  id: string;
  username: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
}

export async function fetchIgProfile(
  igUserId: string,
  token: string,
  mode: GraphMode = oauthMode()
): Promise<IgProfile> {
  return graphRequest<IgProfile>(
    req(
      `/${igUserId}`,
      { fields: "id,username,name,account_type,profile_picture_url" },
      token,
      mode
    )
  );
}

export interface FbPageWithIg {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: IgProfile | null;
}

/** Facebook Login: find the Facebook Page(s) with a linked IG professional account. */
export async function fetchPagesWithInstagram(
  userToken: string
): Promise<FbPageWithIg[]> {
  const res = await graphRequest<{ data: FbPageWithIg[] }>(
    req(
      "/me/accounts",
      {
        fields:
          "name,access_token,instagram_business_account{id,username,name,profile_picture_url,account_type}",
      },
      userToken,
      "facebook"
    )
  );
  return (res.data ?? []).filter((p) => p.instagram_business_account?.id);
}

export interface ResolvedConnection {
  igUserId: string;
  profile: IgProfile;
  fbPageId?: string;
  fbPageName?: string;
  accessToken: string;
  scopes: string;
  expiresAt: Date | null;
}

/**
 * Resolve the publishable Instagram identity after OAuth.
 * Facebook mode discovers the IG professional account through the user's Pages.
 */
export async function resolveConnection(
  token: LongLivedToken,
  mode: GraphMode = oauthMode()
): Promise<ResolvedConnection> {
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;

  if (mode === "instagram") {
    const me = await fetchIgProfile("me", token.access_token, mode);
    return {
      igUserId: me.id,
      profile: me,
      accessToken: token.access_token,
      scopes: SCOPES[mode],
      expiresAt,
    };
  }

  const pages = await fetchPagesWithInstagram(token.access_token);
  if (pages.length === 0) {
    throw new NoInstagramAccountError(
      "No Instagram professional account linked to a Facebook Page was found on this Facebook profile."
    );
  }
  // Personal app: use the first Page that has a linked IG professional account.
  const page = pages[0];
  const ig = page.instagram_business_account!;
  const profile = await fetchIgProfile(ig.id, token.access_token, "facebook").catch(
    () => ig
  );
  return {
    igUserId: ig.id,
    profile: { ...ig, ...profile },
    fbPageId: page.id,
    fbPageName: page.name,
    accessToken: token.access_token,
    scopes: SCOPES[mode],
    expiresAt,
  };
}

export class NoInstagramAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoInstagramAccountError";
  }
}

/** Refresh a long-lived token (both modes support refresh). */
export async function refreshLongLivedToken(
  accessToken: string,
  mode: GraphMode
): Promise<LongLivedToken> {
  if (mode === "instagram") {
    return graphRequest<LongLivedToken>(
      req(
        "/refresh_access_token",
        { grant_type: "ig_refresh_token", access_token: accessToken },
        "",
        "instagram"
      )
    );
  }
  return graphRequest<LongLivedToken>(
    req(
      "/oauth/access_token",
      {
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: accessToken,
      },
      "",
      "facebook"
    )
  );
}

/** Best-effort revocation of app authorization at Meta (used on disconnect). */
export async function revokeAuthorization(
  accessToken: string,
  mode: GraphMode
): Promise<void> {
  await graphRequest({
    path: "/me/permissions",
    method: "DELETE",
    token: accessToken,
    mode,
  }).catch(() => {
    /* revocation is best-effort — local data is removed regardless */
  });
}
