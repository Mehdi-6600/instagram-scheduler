import { NextResponse } from "next/server";
import { cronSecret, validateEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runPublishCycle } from "@/lib/scheduler/publish";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET/POST /api/cron/publish — the scheduled publishing entry point.
 *
 * Protected with CRON_SECRET. Designed to be triggered by:
 *  - Vercel Cron (see vercel.json), and/or
 *  - GitHub Actions schedule (see .github/workflows/scheduled-publish.yml) —
 *    recommended on the Vercel Hobby plan, whose built-in cron is daily-only,
 *  - any external cron service (cron-job.org, etc.), and/or
 *  - the optional inline worker (RUN_SCHEDULER_INLINE=true).
 *
 * The pipeline is idempotent: overlapping invocations can never double-publish.
 */
async function handle(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  const provided = bearer || headerSecret;
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPublishCycle("CRON");
  const envProblems = validateEnv();
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    ...(envProblems.length ? { envProblems } : {}),
    ...result,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
