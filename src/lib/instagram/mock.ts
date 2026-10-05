/**
 * MOCK MODE — isolated development/test integration.
 *
 * When INSTAGRAM_MOCK_MODE=true, this module replaces the real Meta Graph API
 * at the very edge of the publisher. Nothing here talks to Instagram; every
 * media id it returns is prefixed "mock_" and the UI labels results as mock.
 * This exists so the full scheduling pipeline can be exercised without real
 * credentials. It is NEVER enabled implicitly.
 */

import { GraphApiError } from "./graph";
import { randomToken } from "../crypto";

export function assertMockMode(): void {
  if (process.env.INSTAGRAM_MOCK_MODE !== "true") {
    throw new Error("Mock Instagram mode is not enabled");
  }
}

export function mockConnectProfile() {
  return {
    igUserId: "mock_" + randomToken(6),
    username: process.env.MOCK_INSTAGRAM_USERNAME || "mock_instagram_user",
    name: "Mock Instagram User (dev mode)",
    account_type: "BUSINESS",
    profile_picture_url: null as string | null,
  };
}

function failWith(
  status: number,
  code: number,
  type: string,
  message: string
): never {
  throw new GraphApiError({ message, type, code }, status, {
    mock: true,
    error: { message, type, code },
  });
}

export function mockCreateContainer(caption: string): string {
  assertMockMode();
  // Special hashtags let tests force specific failure paths.
  if (/#failmock\b/.test(caption)) {
    failWith(
      400,
      100,
      "OAuthException",
      "(mock) Instagram rejected the image: invalid media format — simulated permanent error."
    );
  }
  if (/#ratelimitmock\b/.test(caption)) {
    failWith(
      429,
      4,
      "OAuthException",
      "(mock) Application request limit reached — simulated rate limit."
    );
  }
  return `mock_container_${randomToken(8)}`;
}

export function mockPublishContainer(containerId: string): string {
  assertMockMode();
  return `mock_media_${randomToken(8)}`;
}
