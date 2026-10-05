/**
 * Instagram content publishing operations (official Meta Graph API).
 * Publishing is always two steps: create a media container, then publish it.
 * `image_url` must be a publicly reachable JPEG URL — Meta fetches it server-side.
 */

import { GraphMode, graphRequest } from "./graph";
import { oauthMode } from "../env";

export interface MediaContainerResult {
  id: string;
}

export async function createImageContainer(
  igUserId: string,
  token: string,
  opts: { imageUrl: string; caption?: string },
  mode: GraphMode = oauthMode()
): Promise<string> {
  const res = await graphRequest<MediaContainerResult>(
    {
      path: `/${igUserId}/media`,
      method: "POST",
      params: {
        image_url: opts.imageUrl,
        ...(opts.caption ? { caption: opts.caption } : {}),
        media_type: "IMAGE",
      },
      token,
      mode,
    }
  );
  return res.id;
}

export async function publishContainer(
  igUserId: string,
  containerId: string,
  token: string,
  mode: GraphMode = oauthMode()
): Promise<string> {
  const res = await graphRequest<MediaContainerResult>(
    {
      path: `/${igUserId}/media_publish`,
      method: "POST",
      params: { creation_id: containerId },
      token,
      mode,
    }
  );
  return res.id;
}

export type ContainerStatus =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export async function getContainerStatus(
  containerId: string,
  token: string,
  mode: GraphMode = oauthMode()
): Promise<ContainerStatus | "UNKNOWN"> {
  const res = await graphRequest<{ status_code?: string }>(
    {
      path: `/${containerId}`,
      params: { fields: "status_code" },
      token,
      mode,
    }
  );
  const code = res.status_code as ContainerStatus | undefined;
  return code ?? "UNKNOWN";
}

/** Usage against the 100-posts-per-24h content publishing limit. */
export async function getContentPublishingLimit(
  igUserId: string,
  token: string,
  mode: GraphMode = oauthMode()
): Promise<{ quotaUsage: number; configDurationSeconds: number } | null> {
  try {
    const res = await graphRequest<{
      data?: { quota_usage?: number; config_duration_seconds?: number }[];
    }>(
      {
        path: `/${igUserId}/content_publishing_limit`,
        params: { fields: "quota_usage,config_duration_seconds" },
        token,
        mode,
      }
    );
    const first = res.data?.[0];
    if (!first) return null;
    return {
      quotaUsage: first.quota_usage ?? 0,
      configDurationSeconds: first.config_duration_seconds ?? 86400,
    };
  } catch {
    return null;
  }
}
