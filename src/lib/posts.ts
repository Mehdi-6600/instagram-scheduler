import type { PostAttempt, ScheduledPost } from "@/lib/types";

export interface PostDto {
  id: string;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  caption: string;
  scheduledAt: string;
  timezone: string;
  status: string;
  instagramMediaId: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  mock: boolean;
  attempts?: AttemptDto[];
}

export interface AttemptDto {
  id: string;
  attemptNumber: number;
  status: string;
  trigger: string;
  containerId: string | null;
  instagramMediaId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export function isMockMediaId(id: string | null): boolean {
  return Boolean(id && id.startsWith("mock_"));
}

export function serializePost(
  post: ScheduledPost & { attempts?: PostAttempt[] }
): PostDto {
  return {
    id: post.id,
    imageUrl: post.imageUrl,
    imageWidth: post.imageWidth,
    imageHeight: post.imageHeight,
    caption: post.caption,
    scheduledAt: post.scheduledAt.toISOString(),
    timezone: post.timezone,
    status: post.status,
    instagramMediaId: post.instagramMediaId,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    errorMessage: post.errorMessage,
    errorCode: post.errorCode,
    attemptCount: post.attemptCount,
    nextRetryAt: post.nextRetryAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    mock: isMockMediaId(post.instagramMediaId),
    ...(post.attempts
      ? { attempts: post.attempts.map(serializeAttempt) }
      : {}),
  };
}

export function serializeAttempt(a: PostAttempt): AttemptDto {
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    status: a.status,
    trigger: a.trigger,
    containerId: a.containerId,
    instagramMediaId: a.instagramMediaId,
    errorCode: a.errorCode,
    errorMessage: a.errorMessage,
    retryable: a.retryable,
    startedAt: a.startedAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
    durationMs: a.durationMs,
  };
}
