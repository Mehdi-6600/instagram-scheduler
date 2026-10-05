import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { signupSecret } from "@/lib/env";
import AuthForm from "@/components/AuthForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  const userCount = await prisma.user.count();
  // Setup is open only for the very first (owner) account; afterwards creating
  // accounts requires the SIGNUP_SECRET env var.
  const needsSecret = userCount > 0 && Boolean(signupSecret());
  if (userCount > 0 && !signupSecret()) redirect("/login");
  return <AuthForm mode="setup" needsSecret={needsSecret} />;
}
