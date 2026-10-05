import { runPublishCycle } from "./publish";

/**
 * Optional inline scheduler for always-on hosts (Railway, Render, Fly.io, a
 * VPS). Disabled by default — serverless platforms must use the /api/cron/publish
 * endpoint triggered by Vercel Cron / GitHub Actions / an external cron service.
 */
let started = false;

export function startInlineWorker(): void {
  if (started) return;
  if (process.env.RUN_SCHEDULER_INLINE !== "true") return;
  started = true;

  const intervalMs = Math.max(
    15_000,
    Number(process.env.SCHEDULER_INTERVAL_MS || 60_000)
  );

  const tick = () => {
    runPublishCycle("INLINE_WORKER").catch((err) => {
      console.error("[inline-worker] publish cycle failed:", err);
    });
  };

  tick();
  setInterval(tick, intervalMs);
  console.log(`[inline-worker] started (every ${intervalMs / 1000}s)`);
}
