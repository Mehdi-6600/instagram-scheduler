import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isMockInstagram, storageDriver } from "@/lib/env";
import { serializePost } from "@/lib/posts";
import Dashboard from "@/components/Dashboard";
import type { AccountStatusDto, PostDto } from "@/lib/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [posts, account] = await Promise.all([
    prisma.scheduledPost.findMany({
      where: { userId: user.id },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.instagramAccount.findUnique({ where: { userId: user.id } }),
  ]);

  const accountDto: AccountStatusDto | null = account
    ? {
        connected: account.status !== "DISCONNECTED",
        mock: account.mode === "MOCK",
        mockMode: isMockInstagram(),
        oauthMode: account.mode === "INSTAGRAM" ? "instagram" : "facebook",
        username: account.username,
        fullName: account.fullName,
        profilePictureUrl: account.profilePictureUrl,
        accountType: account.accountType,
        fbPageName: account.fbPageName,
        status: account.status,
        lastError: account.lastError,
        connectedAt: account.connectedAt.toISOString(),
        tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
      }
    : {
        connected: false,
        mockMode: isMockInstagram(),
        oauthMode: "facebook",
      };

  return (
    <Dashboard
      initialPosts={posts.map((p) => serializePost(p)) as PostDto[]}
      initialAccount={accountDto}
      userEmail={user.email}
      mockMode={isMockInstagram()}
    />
  );
}
