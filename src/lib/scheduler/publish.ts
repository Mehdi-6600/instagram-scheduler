/**
 * Server-side scheduled publishing pipeline.
 *
 * Idempotency & duplicate-publish safety:
 *  1. A post is claimed with an atomic status transition
 *     (SCHEDULED -> PUBLISHING, conditional updateMany) so two concurrent
 *     cron runs can never process the same post.
 *  2. Every publish runs through a PostAttempt ledger row. The Instagram
 *     media id is written to the attempt BEFORE the post is marked published,
 *     so a crash mid-flight can be reconciled without publishing twice.
 *  3. When a publish call fails with an ambiguous outcome (network timeout),
 *     the media container status is checked with Meta before any retry:
 *     only a container in FINISHED state (published = no) may be re-published.
 *  4. Stale PUBLISHING posts (crashed workers) are recovered via the same
 *     container-status check.
 *
 * The pipeline is entirely server-side (cron endpoint / inline worker) and
 * does not depend on any browser being open.
 */

import type { InstagramAccount, PostAttempt, ScheduledPost } from "@/lib/types";
import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import { isMockInstagram, maxAutoAttempts } from "../env";
import {
  GraphApiError,
  NetworkError,
  sanitizeForStorage,
} from "../instagram/graph";
import {
  createImageContainer,
  getContainerStatus,
  publishContainer,
} from "../instagram/publish";
import {
  refreshLongLivedToken,
  type ResolvedConnection,
} from "../instagram/oauth";
import * as mock from "../instagram/mock";
import { classifyError, type ClassifiedError } from "./classify";
import type { GraphMode } from "../instagram/graph";

/** Map the stored connection mode to a Graph API mode. */
function graphModeOf(account: { mode: string }): GraphMode {
  return account.mode === "INSTAGRAM" ? "instagram" : "facebook";
}

export type AttemptTrigger = "CRON" | "MANUAL_RETRY" | "RECOVERY" | "INLINE_WORKER";

export interface CycleResult {
  claimed: number;
  published: number;
  failed: number;
  scheduledForRetry: number;
  recovered: number;
  stillPublishing: number;
  errors: string[];
}

const STALE_LOCK_MS = 10 * 60 * 1000; // crashed claims older than 10 min are recovered
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];

/** One full scheduler pass: recover stale claims, then publish due posts. */
export async function runPublishCycle(trigger: AttemptTrigger = "CRON"): Promise<CycleResult> {
  const result: CycleResult = {
    claimed: 0,
    published: 0,
    failed: 0,
    scheduledForRetry: 0,
    recovered: 0,
    stillPublishing: 0,
    errors: [],
  };
  const now = new Date();

  // 1) Recover posts stuck in PUBLISHING (crashed mid-publish).
  const stale = await prisma.scheduledPost.findMany({
    where: {
      status: "PUBLISHING",
      lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) },
    },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  for (const post of stale) {
    try {
      const outcome = await recoverStuckPost(post);
      if (outcome === "published") result.recovered += 1;
      else if (outcome === "waiting") result.stillPublishing += 1;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // 2) Claim + publish due posts atomically, one at a time.
  const due = await prisma.scheduledPost.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { scheduledAt: "asc" },
    take: 25,
  });

  for (const candidate of due) {
    const claim = await prisma.scheduledPost.updateMany({
      where: { id: candidate.id, status: "SCHEDULED" },
      data: { status: "PUBLISHING", lockedAt: new Date() },
    });
    if (claim.count !== 1) continue; // someone else claimed it
    result.claimed += 1;
    const post = await prisma.scheduledPost.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    try {
      const outcome = await publishPost(post, trigger);
      if (outcome === "published") result.published += 1;
      else if (outcome === "failed") result.failed += 1;
      else if (outcome === "retry") result.scheduledForRetry += 1;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

type PublishOutcome = "published" | "failed" | "retry";

async function publishPost(
  post: ScheduledPost,
  trigger: AttemptTrigger
): Promise<PublishOutcome> {
  const startedAt = Date.now();
  const attemptNumber = post.attemptCount + 1;
  const account = await prisma.instagramAccount.findUnique({
    where: { userId: post.userId },
  });

  if (!account || account.status === "DISCONNECTED") {
    await failPost(post, attemptNumber, {
      kind: "NOT_CONNECTED",
      retryable: false,
      code: "NOT_CONNECTED",
      message: "No Instagram account is connected. Connect Instagram, then retry this post.",
    });
    return "failed";
  }

  const attempt = await prisma.postAttempt.create({
    data: {
      postId: post.id,
      attemptNumber,
      trigger,
      status: "STARTED",
    },
  });

  try {
    const token = await ensureUsableToken(account);
    const useMock = account.mode === "MOCK" || isMockInstagram();

    // Step 1: create the media container (Meta fetches image_url server-side).
    const containerId = useMock
      ? mock.mockCreateContainer(post.caption)
      : await createImageContainer(
          account.igUserId,
          token,
          {
            imageUrl: post.imageUrl,
            caption: post.caption || undefined,
          },
          graphModeOf(account)
        );

    await prisma.postAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "CONTAINER_CREATED",
        containerId,
      },
    });

    // Step 2: publish the container. Ambiguous failures are resolved via the
    // container status BEFORE any retry can happen (never publish twice).
    let mediaId: string;
    try {
      mediaId = useMock
        ? mock.mockPublishContainer(containerId)
        : await publishContainer(
            account.igUserId,
            containerId,
            token,
            graphModeOf(account)
          );
    } catch (publishErr) {
      const resolved = await resolveAmbiguousOutcome(
        post,
        account,
        containerId,
        publishErr,
        token
      );
      if (resolved === "published") {
        return "published";
      }
      if (resolved === "waiting") {
        return "retry"; // stays PUBLISHING; recovery pass will finish it
      }
      throw publishErr;
    }

    // Ledger first, post second — the attempt row is the idempotency record.
    await prisma.postAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "PUBLISHED",
        instagramMediaId: mediaId,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        apiResponse: sanitizeForStorage({
          mock: useMock,
          container_id: containerId,
          media_id: mediaId,
        }) as object,
      },
    });

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        instagramMediaId: mediaId,
        publishedAt: new Date(),
        errorMessage: null,
        errorCode: null,
        attemptCount: attemptNumber,
        nextRetryAt: null,
        lockedAt: null,
      },
    });
    return "published";
  } catch (err) {
    return handlePublishError(post, attempt, err, attemptNumber, startedAt);
  }
}

/**
 * After a failed media_publish call we may not know whether it actually
 * executed. Ask Meta about the container:
 *   PUBLISHED   -> it DID publish -> mark success (no second publish!)
 *   IN_PROGRESS -> still processing -> keep claimed, check again later
 *   FINISHED    -> safe to retry publish with the same container
 *   EXPIRED/... -> safe to create a fresh container and retry
 */
async function resolveAmbiguousOutcome(
  post: ScheduledPost,
  account: InstagramAccount,
  containerId: string,
  publishErr: unknown,
  token: string
): Promise<"published" | "waiting" | "retryable" | "not_published"> {
  const classified = classifyError(publishErr);
  const ambiguous =
    classified.kind === "NETWORK" ||
    classified.kind === "SERVER" ||
    classified.kind === "UNKNOWN";
  if (!ambiguous) return "not_published";

  if (account.mode === "MOCK" || isMockInstagram()) return "not_published";

  try {
    const status = await getContainerStatus(containerId, token, graphModeOf(account));
    if (status === "PUBLISHED") {
      await prisma.postAttempt.updateMany({
        where: { postId: post.id, containerId },
        data: {
          status: "RECOVERED",
          errorMessage:
            "Publish call failed after Instagram had already published the container. Verified via container status — not published twice.",
          finishedAt: new Date(),
        },
      });
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          errorMessage: null,
          errorCode: null,
          lockedAt: null,
          nextRetryAt: null,
          attemptCount: { increment: 1 },
        },
      });
      return "published";
    }
    if (status === "IN_PROGRESS") {
      return "waiting";
    }
    return "retryable"; // FINISHED (safe to publish) or expired/error
  } catch {
    return "not_published";
  }
}

async function handlePublishError(
  post: ScheduledPost,
  attempt: PostAttempt,
  err: unknown,
  attemptNumber: number,
  startedAt: number
): Promise<PublishOutcome> {
  let classified = classifyError(err);

  // One automatic token refresh attempt on auth failures.
  if (classified.kind === "TOKEN_EXPIRED") {
    const account = await prisma.instagramAccount.findUnique({
      where: { userId: post.userId },
    });
    if (account && account.mode !== "MOCK") {
      try {
        await ensureUsableToken(account, true);
        classified = {
          ...classified,
          retryable: true,
          message:
            "Instagram token was refreshed after an auth error. The post will be retried automatically.",
        };
      } catch {
        await prisma.instagramAccount.update({
          where: { id: account.id },
          data: {
            status: "EXPIRED",
            lastError: "Access token expired and could not be refreshed. Reconnect Instagram.",
          },
        });
      }
    }
  }

  const canAutoRetry = classified.retryable && attemptNumber < maxAutoAttempts();
  const backoffMin =
    BACKOFF_MINUTES[Math.min(attemptNumber - 1, BACKOFF_MINUTES.length - 1)];

  await prisma.postAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "FAILED",
      errorCode: classified.code,
      errorMessage: classified.message,
      retryable: canAutoRetry,
      apiResponse: sanitizeForStorage(
        err instanceof GraphApiError ? err.raw : { error: classified.message }
      ) as object,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
    },
  });

  if (canAutoRetry) {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "SCHEDULED",
        attemptCount: attemptNumber,
        nextRetryAt: new Date(Date.now() + backoffMin * 60_000),
        errorMessage: classified.message,
        errorCode: classified.code,
        lockedAt: null,
      },
    });
    return "retry";
  }

  await failPost(post, attemptNumber, classified);
  return "failed";
}

async function failPost(
  post: ScheduledPost,
  attemptNumber: number,
  classified: ClassifiedError
): Promise<void> {
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: {
      status: "FAILED",
      attemptCount: attemptNumber,
      errorMessage: classified.message,
      errorCode: classified.code,
      lockedAt: null,
      nextRetryAt: null,
    },
  });
}

/** Reconcile a post stuck in PUBLISHING after a crash / timeout. */
async function recoverStuckPost(
  post: ScheduledPost
): Promise<"published" | "waiting" | "rearmed" | "failed"> {
  const attempt = await prisma.postAttempt.findFirst({
    where: { postId: post.id },
    orderBy: { startedAt: "desc" },
  });

  if (!attempt) {
    // Nothing actually started — safe to re-arm.
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: "SCHEDULED", lockedAt: null, nextRetryAt: new Date() },
    });
    return "rearmed";
  }

  // The media id was recorded before the crash -> it was published.
  if (attempt.instagramMediaId) {
    await prisma.postAttempt.update({
      where: { id: attempt.id },
      data: {
        status: attempt.status === "PUBLISHED" ? "PUBLISHED" : "RECOVERED",
        finishedAt: attempt.finishedAt ?? new Date(),
      },
    });
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        instagramMediaId: attempt.instagramMediaId,
        publishedAt: attempt.finishedAt ?? new Date(),
        errorMessage: null,
        lockedAt: null,
        nextRetryAt: null,
      },
    });
    return "published";
  }

  if (!attempt.containerId) {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: "SCHEDULED", lockedAt: null, nextRetryAt: new Date() },
    });
    return "rearmed";
  }

  const account = await prisma.instagramAccount.findUnique({
    where: { userId: post.userId },
  });
  if (!account || account.status === "DISCONNECTED") {
    await failPost(post, post.attemptCount + 1, {
      kind: "NOT_CONNECTED",
      retryable: false,
      code: "NOT_CONNECTED",
      message: "Publishing was interrupted and no Instagram account is connected.",
    });
    return "failed";
  }

  if (account.mode === "MOCK" || isMockInstagram()) {
    // Mock containers never published without us recording it — re-arm.
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { status: "SCHEDULED", lockedAt: null, nextRetryAt: new Date() },
    });
    return "rearmed";
  }

  const token = await ensureUsableToken(account);
  const status = await getContainerStatus(
    attempt.containerId,
    token,
    graphModeOf(account)
  );

  if (status === "PUBLISHED") {
    await prisma.postAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "RECOVERED",
        errorMessage: "Container was already published before the crash. Marked published without a second publish.",
        finishedAt: new Date(),
      },
    });
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        errorMessage: null,
        lockedAt: null,
        nextRetryAt: null,
      },
    });
    return "published";
  }

  if (status === "IN_PROGRESS") {
    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: { lockedAt: new Date() }, // stay PUBLISHING; check again later
    });
    return "waiting";
  }

  // FINISHED: never published — the normal publish flow can safely use it.
  // EXPIRED/ERROR/UNKNOWN: re-arm for a fresh attempt (new container).
  await prisma.postAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "SKIPPED",
      errorMessage: `Container status ${status} after crash — re-armed for a fresh attempt.`,
      finishedAt: new Date(),
    },
  });
  await prisma.scheduledPost.update({
    where: { id: post.id },
    data: { status: "SCHEDULED", lockedAt: null, nextRetryAt: new Date() },
  });
  return "rearmed";
}

/**
 * Return a usable access token, refreshing it when it is expired or about to
 * expire. Throws if the account cannot be authorized.
 */
export async function ensureUsableToken(
  account: InstagramAccount,
  forceRefresh = false
): Promise<string> {
  if (account.mode === "MOCK") return "mock-token";
  const token = decryptSecret(account.accessToken);
  const expiringSoon =
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000;

  if (!forceRefresh && !expiringSoon && account.status === "ACTIVE") {
    return token;
  }

  try {
    const refreshed = await refreshLongLivedToken(token, graphModeOf(account));
    const { encryptSecret } = await import("../crypto");
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: {
        accessToken: encryptSecret(refreshed.access_token),
        tokenExpiresAt: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : account.tokenExpiresAt,
        status: "ACTIVE",
        lastError: null,
      },
    });
    return refreshed.access_token;
  } catch (err) {
    if (forceRefresh) throw err;
    // Refresh failed but the current token may still work — use it.
    return token;
  }
}
