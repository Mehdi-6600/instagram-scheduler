import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AuthForm from "@/components/AuthForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  const userCount = await prisma.user.count();
  if (userCount === 0) redirect("/setup");
  return <AuthForm mode="login" />;
}
