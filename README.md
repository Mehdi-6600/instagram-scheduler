# My Instagram Scheduler

A **personal, private** web app for scheduling Instagram photo posts with captions and
publishing them automatically at the exact time you choose — through the **official
Instagram Platform (Meta Graph API)** and OAuth. No passwords, no scraping, no browser
automation.

Mobile-first dashboard · PostgreSQL · Next.js · Cloudinary · cron-based publisher.

---

## 1. What was built

- **Auth** — email + password (bcrypt, DB-backed sessions, httpOnly cookies). First run
  creates the owner account; registration is closed afterwards (optional `SIGNUP_SECRET`).
- **Instagram connection** — official Meta OAuth (Facebook Login *or* Instagram Login),
  token exchange → long-lived token (auto-refreshed), encrypted at rest (AES-256-GCM).
  Real connection status only; safe disconnect with authorization revocation.
- **Posts** — image upload (camera/library, preview, replace/remove), caption with
  emoji/hashtags/mentions/line-breaks + 2,200-char counter, native date & time pickers in
  your local timezone, edit/delete before publishing, read-only after publishing.
- **Scheduler** — server-side publish pipeline at the scheduled instant (works with the
  browser closed): atomic post claiming, PostAttempt ledger, container-status
  reconciliation, crash recovery — a post can never be published twice.
- **Statuses** — 🕒 Scheduled · ⏳ Publishing · ✅ Published · ❌ Failed (with reason,
  attempt history, manual Retry). Summary tiles on top.
- **Reliability** — classification of Meta errors: bounded automatic retries with backoff
  for rate limits / network / 5xx; immediate failure for invalid images, captions,
  permissions; expired tokens trigger refresh + reconnect guidance. Max 100 posts/24 h
  (Instagram's API limit).
- **Storage** — images in Cloudinary (free tier) as public JPEGs ≤1440px, aspect
  4:5–1.91:1 (exactly what the Instagram API accepts). Local-disk driver for development.
- **Cron** — protected `/api/cron/publish` endpoint + GitHub Actions schedule (every 5
  min, free) + Vercel Cron config + optional inline worker for always-on hosts.
- **Mock mode** — `INSTAGRAM_MOCK_MODE=true` runs the entire pipeline against a simulated
  Instagram (clearly labelled; media ids look like `mock_…`). Nothing fake is ever shown
  as a real publish.

**Known platform limitations (implemented as Meta requires):**

- Publishing requires an Instagram **professional** account (Business or Creator).
  Personal accounts are not supported by Meta's API at all.
- Facebook Login mode additionally requires the IG account to be **linked to a Facebook
  Page** (Instagram Login mode does not).
- The API publishes **JPEG photos only** (4:5–1.91:1, ≤8 MB), captions ≤ 2,200 chars,
  max **100 API-published posts / 24 h**. There is no native "schedule" API — this app
  holds the schedule and publishes at the right moment (container → `media_publish`).
- Meta requires app roles/app review: as a personal app you only need your Meta account to
  have a role on your own app (no App Review). Publishing for accounts you don't own would
  require Advanced Access + App Review.

---

## 2. External accounts / API credentials to configure

| Service | Purpose | Free tier | What you need |
| --- | --- | --- | --- |
| **Meta for Developers** | Instagram OAuth + publishing | Yes (your own app) | App ID, App Secret, app with Instagram product |
| **PostgreSQL** (Neon / Supabase / Vercel Postgres) | Database | Yes | `DATABASE_URL` |
| **Cloudinary** | Public image hosting | Yes (25 credits/mo) | Cloud name, API key, API secret |
| **Vercel** (or similar) | Hosting | Yes (Hobby) | project + env vars |
| **GitHub** | repo + free scheduled Actions | Yes | repo secrets `CRON_SECRET`, variable `APP_URL` |

---

## 3. Exact environment variables

Copy `.env.example` → `.env.local` (dev) / Vercel → Project Settings → Environment
Variables (prod):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32` — encrypts IG tokens at rest |
| `CRON_SECRET` | ✅ | `openssl rand -hex 32` — protects `/api/cron/publish` |
| `NEXT_PUBLIC_APP_URL` | ✅ | public URL, e.g. `https://my-app.vercel.app` (no slash) |
| `APP_URL` | ✅ | same value as above |
| `META_APP_ID` | ✅ | from developers.facebook.com |
| `META_APP_SECRET` | ✅ | from developers.facebook.com |
| `INSTAGRAM_OAUTH_MODE` | optional | `facebook` (default) or `instagram` |
| `META_GRAPH_API_VERSION` | optional | default `v26.0` |
| `STORAGE_DRIVER` | optional | `cloudinary` (default) or `local` (dev) |
| `CLOUDINARY_CLOUD_NAME` | ✅* | *unless `STORAGE_DRIVER=local` |
| `CLOUDINARY_API_KEY` | ✅* | |
| `CLOUDINARY_API_SECRET` | ✅* | |
| `CLOUDINARY_FOLDER` | optional | default `my-instagram-scheduler` |
| `SIGNUP_SECRET` | optional | to add more users after the owner account |
| `RUN_SCHEDULER_INLINE` | optional | `true` on always-on hosts (not Vercel) |
| `SCHEDULER_INTERVAL_MS` | optional | inline worker interval (default 60000) |
| `MAX_AUTO_ATTEMPTS` | optional | auto retries for transient errors (default 3) |
| `INSTAGRAM_MOCK_MODE` | dev only | `true` simulates Instagram (never in production) |
| `MOCK_INSTAGRAM_USERNAME` | dev only | username shown in mock mode |

---

## 4. Exact deployment steps

1. **Database** — create a free PostgreSQL database (Neon/Supabase) → copy `DATABASE_URL`.
2. **Cloudinary** — create a free account → copy cloud name / API key / API secret.
3. **Meta app** — see section 5.
4. **Vercel**
   - Push this repo to GitHub → *Import Project* in Vercel (framework: Next.js).
   - Add every variable from section 3 (prod values; `INSTAGRAM_MOCK_MODE=false`).
   - Deploy. (Build runs `prisma generate && next build`; migrations run in step 6.)
5. **Cron trigger** (pick one; the endpoint is idempotent):
   - **Recommended on Hobby:** GitHub → repo *Settings → Secrets and variables →
     Actions*: secret `CRON_SECRET` = same value as the env var; variable `APP_URL` =
     `https://your-app.vercel.app`. The workflow `.github/workflows/scheduled-publish.yml`
     then runs every 5 minutes.
   - Or any external cron (cron-job.org, …) doing `POST https://your-app.vercel.app/api/cron/publish`
     with header `Authorization: Bearer <CRON_SECRET>` every 5 minutes.
   - Or Vercel Cron on **Pro** (minute-level): change `vercel.json` schedule to
     `*/5 * * * *` and drop the GitHub Action. (Hobby's built-in cron is daily-only.)
   - Or an always-on host: set `RUN_SCHEDULER_INLINE=true`.
6. **Initialize the database** — run once from your machine:
   ```bash
   DATABASE_URL="postgres://..." npx prisma migrate deploy
   ```
   (Local development instead: `npm install && npx prisma migrate dev`.)
7. **Finish setup** — open the app → `/setup` → create the owner account →
   **Connect Instagram** → authorize → schedule a post.

Local development:

```bash
cp .env.example .env.local     # set DATABASE_URL; INSTAGRAM_MOCK_MODE=true is fine
npm install
npx prisma migrate dev         # creates tables
npm run dev                    # http://localhost:3000
npm run smoke-test             # optional end-to-end API test (server must run)
```

---

## 5. Instagram / Meta prerequisites

1. An **Instagram Professional account** (Business or Creator — free switch:
   Instagram → Settings → Account → Account type).
2. **Facebook Login mode (default):** the Instagram account must be **linked to a Facebook
   Page** you manage (Meta Business Suite → Instagram account). Publishing permissions
   flow through that Page.
3. **Instagram Login mode:** no Page needed; the IG account must be Business/Creator.
4. A **Meta app** at [developers.facebook.com](https://developers.facebook.com/apps):
   - Create app → type **Business** → add product **Instagram** (Instagram Graph API).
   - *App settings → Basic* → App ID + App Secret.
   - *Roles* → add yourself (Admin/Developer/Tester). While the app is in **Development
     mode** it works fully for accounts that have a role on the app — no App Review needed
     for personal use. (App Review + Advanced Access is only required to publish for
     accounts you don't own.)
   - *Facebook Login → Settings* → add the OAuth redirect URI:
     `https://your-app.vercel.app/api/instagram/callback` (plus `http://localhost:3000/api/instagram/callback`
     for development).
   - Requested permissions: `instagram_basic`, `instagram_content_publish`,
     `pages_show_list`, `pages_read_engagement` (or, with Instagram Login:
     `instagram_business_basic`, `instagram_business_content_publish`).
5. Publishing rules enforced by this app (Meta requirements): JPEG only, aspect 4:5–1.91:1,
   ≤8 MB, caption ≤ 2,200 chars, ≤ 100 API-published posts per rolling 24 h.

---

## Testing checklist (verified in development)

auth (register/login/session/logout) · Instagram connection architecture (OAuth state,
code exchange, mock path) · image upload & JPEG normalization · caption saving ·
scheduling with timezone conversion · editing · deletion · cron execution & auth ·
publishing pipeline (container → publish → media id) · duplicate protection (claim +
container-status reconciliation) · failure handling (permanent vs retryable, manual
retry) · mobile UI · timezone display.
