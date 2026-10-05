/**
 * End-to-end smoke test for My Instagram Scheduler.
 *
 * Runs against a live server (default http://localhost:3000) and exercises:
 *   authentication · Instagram connection (mock mode) · image upload ·
 *   caption saving · scheduling · editing · deletion · cron execution & auth ·
 *   publishing pipeline · duplicate protection · failure handling ·
 *   retry logic · timezone handling · API protection.
 *
 * Requirements:
 *   - the dev/production server running with INSTAGRAM_MOCK_MODE=true
 *   - CRON_SECRET set (the test reads it from the CRON_SECRET env var)
 *
 * Usage:  npm run smoke-test   (or: BASE_URL=... CRON_SECRET=... node scripts/smoke-test.mjs)
 */

import sharp from "sharp";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "dev-cron-secret-0123456789abcdef0123456789abcdef";

let passed = 0;
let failed = 0;
const errors = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    errors.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let cookie = "";
async function req(path, opts = {}) {
  const { json, headers = {}, ...init } = opts;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : init.body,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const m = setCookie.match(/mis_session=([^;]+)/);
    if (m) cookie = `mis_session=${m[1]}`;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body };
}

function jpeg(w, h, color = { r: 200, g: 100, b: 50 }) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function main() {
  console.log(`\nSmoke test against ${BASE} (mock mode expected)\n`);

  /* 1. API protection before auth */
  console.log("API protection:");
  let r = await req("/api/posts");
  check("unauthenticated /api/posts is 401", r.status === 401, `got ${r.status}`);
  r = await req("/api/cron/publish");
  check("cron without secret is 401", r.status === 401, `got ${r.status}`);
  r = await req("/api/cron/publish", { headers: { authorization: "Bearer wrong" } });
  check("cron with wrong secret is 401", r.status === 401, `got ${r.status}`);

  /* 2. Registration / setup */
  console.log("Authentication:");
  const email = "owner-smoke@example.com";
  r = await req("/api/auth/register", {
    method: "POST",
    json: { email, password: "password123", name: "Owner" },
  });
  if (r.status === 200) {
    check("first-run register succeeds", r.body?.email === email, JSON.stringify(r.body));
    check("session cookie received", cookie.includes("mis_session="));
  } else {
    // Re-run against an existing database: sign in with the same credentials.
    cookie = "";
    r = await req("/api/auth/login", { method: "POST", json: { email, password: "password123" } });
    check("login with existing owner account", r.status === 200, JSON.stringify(r.body));
    check("session cookie received", cookie.includes("mis_session="));
  }

  r = await req("/api/auth/register", {
    method: "POST",
    json: { email: `other+${Date.now()}@example.com`, password: "password123" },
  });
  check("registration closed after first user", r.status === 403, `got ${r.status}`);

  r = await req("/api/auth/me");
  check("GET /api/auth/me authenticated", r.body?.authenticated === true);

  r = await req("/api/auth/login", {
    method: "POST",
    json: { email, password: "wrong-password" },
  });
  check("login with bad password rejected", r.status === 401);

  /* 3. Instagram connection (mock mode) */
  console.log("Instagram connection:");
  r = await req("/api/instagram/mock-connect", { method: "POST" });
  check("mock connect works in mock mode", r.status === 200 && r.body?.mock === true, JSON.stringify(r.body));
  r = await req("/api/instagram/status");
  check("status shows connected", r.body?.connected === true && r.body?.mock === true);
  check("connected username shown", typeof r.body?.username === "string");

  /* 4. Image upload */
  console.log("Image upload:");
  const good = await jpeg(1080, 1080);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(good)], { type: "image/jpeg" }), "photo.jpg");
  r = await req("/api/upload", { method: "POST", body: form });
  check(
    "square JPEG upload succeeds",
    r.status === 200 && r.body?.url && r.body?.width === 1080,
    JSON.stringify(r.body)
  );
  const imageUrl = r.body?.url;

  const tall = await jpeg(800, 1000, { r: 10, g: 120, b: 200 });
  const form2 = new FormData();
  form2.append("file", new Blob([new Uint8Array(tall)], { type: "image/jpeg" }), "tall.jpg");
  r = await req("/api/upload", { method: "POST", body: form2 });
  check("4:5 JPEG accepted", r.status === 200 && r.body?.width === 800, JSON.stringify(r.body));
  const imageUrl2 = r.body?.url;

  const wide = await jpeg(2000, 500);
  const form3 = new FormData();
  form3.append("file", new Blob([new Uint8Array(wide)], { type: "image/jpeg" }), "wide.jpg");
  r = await req("/api/upload", { method: "POST", body: form3 });
  check("aspect ratio outside 4:5..1.91:1 rejected", r.status === 422, `got ${r.status} ${JSON.stringify(r.body)}`);

  const form4 = new FormData();
  form4.append("file", new Blob([new Uint8Array("not an image")], { type: "text/plain" }), "x.txt");
  r = await req("/api/upload", { method: "POST", body: form4 });
  check("non-image upload rejected", r.status === 422 || r.status === 400, `got ${r.status}`);

  /* 5. Scheduling */
  console.log("Scheduling & editing:");
  const tz = "America/New_York";
  r = await req("/api/posts", {
    method: "POST",
    json: {
      imageUrl,
      caption: "Beautiful sunset today 🌅\n#travel #sunset",
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      timezone: tz,
    },
  });
  check("create scheduled post", r.status === 201 && r.body?.post?.status === "SCHEDULED", JSON.stringify(r.body));
  const post1 = r.body?.post;
  check("caption with emoji/hashtags/newlines stored", post1?.caption.includes("#sunset") && post1?.caption.includes("\n"));
  check("timezone stored", post1?.timezone === tz);

  r = await req("/api/posts", {
    method: "POST",
    json: {
      imageUrl,
      caption: "past",
      scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
      timezone: tz,
    },
  });
  check("past publish time rejected", r.status === 400, `got ${r.status}`);

  // timezone math: 2026-12-10 18:30 America/New_York (EST, UTC-5) => 23:30 UTC
  r = await req("/api/posts", {
    method: "POST",
    json: {
      imageUrl: imageUrl2,
      caption: "timezone check",
      scheduledLocal: "2026-12-10T18:30",
      timezone: tz,
    },
  });
  const tzPost = r.body?.post;
  const utcHours = new Date(tzPost?.scheduledAt || 0).getUTCHours();
  const utcDate = new Date(tzPost?.scheduledAt || 0).getUTCDate();
  check(
    "local wall time converted to correct UTC instant (EST)",
    r.status === 201 && utcDate === 10 && utcHours === 23,
    `scheduledAt=${tzPost?.scheduledAt}`
  );

  // editing
  r = await req(`/api/posts/${post1.id}`, {
    method: "PATCH",
    json: { caption: "Updated caption ✏️" },
  });
  check("edit caption", r.status === 200 && r.body?.post?.caption === "Updated caption ✏️", JSON.stringify(r.body));

  /* 6. Cron publishing */
  console.log("Cron & publishing:");
  await new Promise((s) => setTimeout(s, 300));
  r = await req("/api/cron/publish", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  check("cron with secret runs", r.status === 200, `got ${r.status}`);
  check("due post published", r.body?.published >= 1, JSON.stringify(r.body));

  r = await req(`/api/posts/${post1.id}`);
  const published = r.body?.post;
  check("post status PUBLISHED", published?.status === "PUBLISHED", published?.status);
  check("mock media id recorded", published?.instagramMediaId?.startsWith("mock_"), published?.instagramMediaId);
  check("publishedAt set", Boolean(published?.publishedAt));
  check("attempt ledger has 1 attempt", published?.attempts?.length === 1, `attempts=${published?.attempts?.length}`);
  check("attempt shows PUBLISHED", published?.attempts?.[0]?.status === "PUBLISHED");

  // duplicate protection
  r = await req("/api/cron/publish", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  check("second cron run publishes nothing new", (r.body?.published ?? 0) === 0 && (r.body?.claimed ?? 0) === 0, JSON.stringify(r.body));
  r = await req(`/api/posts/${post1.id}`);
  check("still exactly 1 attempt (no duplicate publish)", r.body?.post?.attempts?.length === 1);

  // concurrent cron runs (claim atomicity)
  const duePost = (
    await req("/api/posts", {
      method: "POST",
      json: {
        imageUrl: imageUrl2,
        caption: "concurrent claim test",
        scheduledAt: new Date(Date.now() - 500).toISOString(),
        timezone: "UTC",
      },
    })
  ).body?.post;
  await new Promise((s) => setTimeout(s, 200));
  const [c1, c2] = await Promise.all([
    req("/api/cron/publish", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }),
    req("/api/cron/publish", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }),
  ]);
  const totalClaimed = (c1.body?.claimed ?? 0) + (c2.body?.claimed ?? 0);
  const totalPublished = (c1.body?.published ?? 0) + (c2.body?.published ?? 0);
  check("concurrent cron runs claim a post exactly once", totalClaimed === 1 && totalPublished === 1, `claimed=${totalClaimed} published=${totalPublished}`);
  r = await req(`/api/posts/${duePost.id}`);
  check("concurrent post has exactly 1 attempt", r.body?.post?.attempts?.length === 1);

  /* 7. Failure handling */
  console.log("Failure handling:");
  const failPost = (
    await req("/api/posts", {
      method: "POST",
      json: {
        imageUrl,
        caption: "this will fail #failmock",
        scheduledAt: new Date(Date.now() - 30_000).toISOString(),
        timezone: "UTC",
      },
    })
  ).body?.post;
  r = await req("/api/cron/publish", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  check("cron cycle completes despite failure", r.status === 200);
  r = await req(`/api/posts/${failPost.id}`);
  const failedPost = r.body?.post;
  check("failed post marked FAILED", failedPost?.status === "FAILED", failedPost?.status);
  check("failure reason stored", Boolean(failedPost?.errorMessage), failedPost?.errorMessage);
  check("attempt logged with error", failedPost?.attempts?.[0]?.status === "FAILED" && Boolean(failedPost?.attempts?.[0]?.errorMessage));

  // manual retry re-arms
  r = await req(`/api/posts/${failPost.id}/retry`, { method: "POST" });
  check("manual retry re-arms the post", r.body?.post?.status === "SCHEDULED", JSON.stringify(r.body));

  // permanent error does not auto-retry endlessly
  r = await req("/api/cron/publish", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON}` },
  });
  r = await req(`/api/posts/${failPost.id}`);
  check(
    "permanent error fails again immediately (no endless retry)",
    r.body?.post?.status === "FAILED" && r.body?.post?.attempts?.length === 2,
    `status=${r.body?.post?.status} attempts=${r.body?.post?.attempts?.length}`
  );

  // retryable error goes back to SCHEDULED with backoff
  const ratePost = (
    await req("/api/posts", {
      method: "POST",
      json: {
        imageUrl,
        caption: "rate limit simulation #ratelimitmock",
        scheduledAt: new Date(Date.now() - 10_000).toISOString(),
        timezone: "UTC",
      },
    })
  ).body?.post;
  await req("/api/cron/publish", { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
  r = await req(`/api/posts/${ratePost.id}`);
  check(
    "transient error re-queues with backoff",
    r.body?.post?.status === "SCHEDULED" && Boolean(r.body?.post?.nextRetryAt),
    JSON.stringify({ status: r.body?.post?.status, nextRetryAt: r.body?.post?.nextRetryAt })
  );

  /* 8. Read-only after publishing, delete rules */
  console.log("Editing & deletion rules:");
  r = await req(`/api/posts/${post1.id}`, { method: "PATCH", json: { caption: "nope" } });
  check("published post is read-only", r.status === 409, `got ${r.status}`);
  r = await req(`/api/posts/${failPost.id}`, { method: "PATCH", json: { caption: "fixed!" } });
  check("failed post editable (re-arms to SCHEDULED)", r.status === 200 && r.body?.post?.status === "SCHEDULED");

  r = await req(`/api/posts/${failPost.id}`, { method: "DELETE" });
  check("delete scheduled post", r.status === 200);
  r = await req(`/api/posts/${failPost.id}`);
  check("deleted post returns 404", r.status === 404);

  /* 9. Disconnect */
  console.log("Disconnect:");
  r = await req("/api/instagram/disconnect", { method: "POST" });
  check("disconnect succeeds", r.status === 200 && r.body?.disconnected === true);
  r = await req("/api/instagram/status");
  check("status shows not connected after disconnect", r.body?.connected === false);

  /* 10. Logout */
  await req("/api/auth/logout", { method: "POST" });
  cookie = "";
  r = await req("/api/auth/me");
  check("logout invalidates session", r.status === 401);

  /* summary */
  console.log(`\n${passed} passed, ${failed} failed`);
  if (errors.length) {
    console.log("\nFailures:");
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
