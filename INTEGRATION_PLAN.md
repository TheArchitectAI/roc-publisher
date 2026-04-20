# roc-publisher — Postiz Integration Plan

> **Fork origin:** [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) @ forked 2026-04-19
> **License:** AGPL-3.0 (inherited — cannot be re-licensed proprietary; internal/partner use is compliant)
> **Owner:** Ivan Duarte / The ROC Group
> **Customization target:** The ROC Group at CrossCountry Mortgage + co-brand partners
> **Supersedes:**
>   - `~/Workspace/_archive/roc-publisher-v1-express/` (Express-based service, shipped 2026-04-19 morning, never deployed — carousel/collab work is reference only)
>   - Most of `mortgagearchitect-ai/docs/superpowers/specs/2026-04-19-mortgagearchitect-publisher-meta-mvp.md` (greenfield plan made obsolete by fork)
>   - **Blotato (DEPRECATED 2026-04-20)** — all 4 active Blotato n8n workflows deactivated; see `architect-os/vault/memory/project_blotato_deprecated.md`. Subscription cancel-after-Postiz-proven pending Ivan action.

---

## Why we forked (vs. build from scratch)

A 14-hour greenfield MVP was scoped to build our own "in-house Blotato" on top of an Express fan-out service + Drizzle tables + MA-App UI. After evaluating [Postiz](https://github.com/gitroomhq/postiz-app) and [OpenPost](https://github.com/rodrgds/openpost):

- **Postiz already ships:** Facebook (658 LOC) + Instagram (930 LOC) + Instagram Standalone + LinkedIn page + LinkedIn personal + TikTok + Threads + X + Bluesky + Mastodon + YouTube + Pinterest + Reddit + Slack + Discord + Telegram + 15 more. Total ~30 platform providers.
- **Postiz stack matches MA-AI:** NestJS + Next.js + Prisma + PostgreSQL + Redis. Same TypeScript ecosystem.
- **Postiz has an n8n custom node** (`n8n-nodes-postiz`) + **NodeJS SDK** (`@postiz/node`) + AI agent CLI.
- **Multi-tenant from day one:** `Organization` / `UserOrganization` / workspace-scoped `Integration` model — native fit for one workspace per partner agent (Rey, Luisita, Mike, Chris, Zunaira, etc.).
- **Built-in calendar, scheduler, approval workflow, analytics, AI caption gen** — everything we were about to write.

**OpenPost was ruled out immediately**: no Facebook, no Instagram (our entire v2 MVP). Go stack didn't match.

**Build cost estimate:** ~5–7 hours of integration work vs. ~14 hours of greenfield, with a production-tested codebase and commercial cloud SaaS (platform.postiz.com) as the reference implementation.

---

## What we inherit upstream

Everything under this fork at creation time is stock Postiz. We keep it mostly as-is and pull upstream changes via `git remote add upstream git@github.com:gitroomhq/postiz-app.git && git fetch upstream && git merge upstream/main` on a weekly cadence. Avoid heavy modifications to `libraries/nestjs-libraries/src/integrations/social/*` — those are the expensive-to-re-port bits we want upstream's ongoing maintenance on.

### Hard rule: do not modify stock provider code

If we need to tweak how Facebook/Instagram providers behave for ROC (e.g. auto-append NMLS compliance footer), we do it in a **middleware layer we own**, not in `facebook.provider.ts` directly. Upstream provider changes should merge cleanly.

---

## ROC customizations — what we add in this fork

All ROC-specific code lives under `apps/roc/` or `libraries/nestjs-libraries/src/roc/` so we have a clean merge boundary with upstream.

### 1. MA-AI SSO bridge (1 hr)

Replace Postiz's default Better-Auth flow with MA-AI OAuth bridge so Ivan's team signs in once and is auto-provisioned into Postiz orgs.

- **New:** `apps/backend/src/services/auth/auth.ma-ai.bridge.ts`
- **New:** `libraries/nestjs-libraries/src/roc/auth/ma-ai-bridge.service.ts`
- **Flow:** Postiz receives auth redirect from MA-AI → validates JWT via MA-AI public key → maps `ivan@mortgagearchitect.net` → `Organization(name: "The ROC Group")` → auto-creates if not present.
- **Secret:** `MA_AI_JWT_PUBLIC_KEY` sourced from GCP Secret Manager.

### 2. Partner workspace auto-provisioner (1 hr)

One Postiz `Organization` per `revival_partners` row in MA-AI. Partners get their own IG/FB integrations without contaminating ROC's main workspace.

- **New:** `libraries/nestjs-libraries/src/roc/partners/partner-sync.service.ts` — listens for MA-AI `partner.created` webhook, creates Postiz Organization, invites the partner's email as admin.
- **New:** Nightly sync job reconciles `revival_partners` ↔ Postiz Organizations — creates / archives as needed.
- **Naming:** Postiz Organization name = `partner.name + " × ROC"` (e.g. "Buy With Rey × ROC", "Luisita Pumphrey × ROC").

### 3. Compliance middleware (30 min)

Append NMLS footer + disclosure language automatically to every post based on originating org.

- **New:** `libraries/nestjs-libraries/src/roc/compliance/compliance.interceptor.ts`
- **Behavior:** Intercepts post create/update. If org is ROC or a partner co-brand, inject `"\n—\nIvan Duarte · NMLS #32559 · CrossCountry Mortgage · NMLS #3029 · Equal Housing Lender"` unless post payload has `compliance.skip: true` (for cases where footer is baked into the image).
- **Config:** Footer text lives in Postiz `Organization.settings.complianceFooter` (new field, added via Prisma migration in `roc/compliance/prisma/`).

### 4. HITL bridge to MA-AI (1 hr)

Don't fight Postiz's native approval flow — Postiz already has approval workflows for team posts. Instead, mirror state changes to MA-AI `/api/hitl/*` for observability, Trinity summaries, and cross-system audit.

- **New:** `libraries/nestjs-libraries/src/roc/hitl/hitl-mirror.service.ts`
- **Hooks:** On Post state change (`DRAFT` → `APPROVED` → `PUBLISHED` → `FAILED`) emit `POST /api/hitl/mirror` to MA-AI with full event metadata.
- **One-way mirror only** — MA-AI has read-only visibility; Postiz owns approval truth. Keeps the team in one tool (Postiz) without Ivan losing the system-level dashboard in MA-AI.

### 5. Slack adapter upgrade (already partially exists upstream)

Postiz has `slack.provider.ts`. For team chatter we add interactive approval cards:

- Hook into the HITL mirror (item 4) — post Slack card to `#ai-ops` with approve/reject buttons.
- Button click → Postiz internal API (`/posts/:id/approve`), which also triggers MA-AI mirror.
- Signature verification + timestamp replay protection (upstream already has this for cmd handler — reuse).

### 6. ROC branding layer (30 min)

- Replace Postiz logo/copy in `apps/frontend/src/components/layout/` with ROC branding.
- Custom domain: `publisher.rochomeloans.com` → Cloud Run service.
- Light/dark themes tuned to ROC navy/gold.

---

## Deployment

### Target: Google Cloud Run + Cloud SQL + Memorystore Redis

| Component | Host | Notes |
|---|---|---|
| Postiz backend (NestJS) | Cloud Run | Scale-to-zero disabled (Temporal worker needs warm) |
| Postiz frontend (Next.js) | Cloud Run | Scale-to-zero OK |
| Postiz orchestrator (Temporal worker) | Cloud Run — min instances 1 | Scheduler survives restarts |
| Postgres | Cloud SQL | Shared with MA-AI instance? TBD — probably separate DB for isolation |
| Redis | Memorystore | New instance, small tier |
| Temporal | Self-hosted on the same Cloud Run cluster OR Temporal Cloud | Evaluate cost |

**Domain:** `publisher.rochomeloans.com` (primary) — mirrors rochomeloans.com branding for partner trust.

**Secrets in GCP Secret Manager (`silver-pad-459411-e7`):**
- `POSTIZ_DATABASE_URL`
- `POSTIZ_REDIS_URL`
- `MA_AI_JWT_PUBLIC_KEY`
- `ROC_PUBLISHER_SESSION_SECRET`
- Per-platform OAuth client IDs + secrets (FB/IG/LinkedIn/TikTok/YouTube/X/Threads)
- `SENDGRID_API_KEY` (reuse existing) — for team invite emails
- Drop `STRIPE_*` unless we ever commercialize to external lenders (out of scope)

---

## Integration with existing systems

### n8n

- Replace `POST-02-social-media-publisher.json` (Meta Graph direct) with n8n calls to **Postiz NodeJS SDK** via HTTP node or `n8n-nodes-postiz` custom node.
- BRAIN-01 (content generator) output → Postiz `POST /api/v1/posts` (draft). Team approves in Postiz UI or Slack card.
- On approval, Postiz fires webhook → MA-AI mirror → optional downstream triggers.

### MA-AI

- New router: `server/routers/postiz.ts` — thin wrapper for MA-App admin to view drafts in context of a partner/campaign.
- **Drop** the planned `content_drafts` + `content_posts` tables from the now-obsolete `2026-04-19-mortgagearchitect-publisher-meta-mvp.md` spec. Postiz's `Post` + `Media` models own this.
- Keep the HITL mirror table: new `content_hitl_mirror` (id, postiz_post_id, org_id, state, at) — minimal, just for observability.

### Surface cron

- Archive `social-poster.mjs` to `roc-scripts/archive/migrated/` — replaced by Postiz's own Temporal-based scheduler.
- `2026-04-17-roc-scripts-migration-plan.md` Phase 2 social-poster migration is **moot** — Postiz replaces the entire category.

### Blotato / POST-03

- Cancel Blotato subscription once Postiz is live + proven for 30 days.
- Archive `POST-03-blotato-multiplatform.json`.

---

## Phase order (auto mode)

| # | Task | Owner | Est |
|---|---|---|---|
| 1 | Fork created, INTEGRATION_PLAN.md committed, upstream tracked | ✅ Done 2026-04-19 | — |
| 2 | Local boot test + deploy artifacts written (`deploy/`) | ✅ Done 2026-04-20 | 30 min |
| 3 | Gemini audit of integration plan + carousel-system + deprecation memos | ✅ GO 2026-04-20 | — |
| 4a | **Option A (cheap):** roclaw-new co-located deploy via `deploy/roclaw-gce-bootstrap.sh` | Awaits Ivan | 30 min |
| 4b | **Option B (managed):** Full Cloud Run deploy — `deploy/gcp-provision.sh` → `deploy/push-image.sh` → `deploy/cloud-run-deploy.sh` | Awaits Ivan | 90 min |
| 5 | Fill OAuth secrets (Meta/LI/TikTok/YT via Developer Portals) | Ivan | 30 min per platform |
| 6 | Map `publisher.rochomeloans.com` → service URL (Cloudflare or Cloud Run domain mapping) | Session | 10 min |
| 7 | Connect Ivan's IG (@the_mortgage_architect) + FB page → test post | Session | 30 min |
| 8 | MA-AI SSO bridge | Session | 1 hr |
| 9 | Compliance middleware (NMLS footer auto-append) | Session | 30 min |
| 10 | HITL mirror bridge to MA-AI `/api/hitl/mirror` | Session | 1 hr |
| 11 | Partner workspace auto-provisioner (Rey first) | Session | 1 hr |
| 12 | n8n CONTENT-POST-01 rewired to use Postiz SDK | Session | 1 hr |
| 13 | Archive Surface `social-poster.mjs` | Session | 15 min |
| 14 | 30-day parallel run: Postiz + existing POST-02 | — | 30 days |
| 15 | Cancel Blotato (already functionally dead — payments failing), archive POST-02/POST-03 | — | — |

**Total integration effort: ~7–8 hours across 2–3 sessions.**

---

## Phase 3 (FUTURE) — Fold Postiz into the roc-ai dashboard

Ivan's direction (2026-04-20): don't ship `publisher.rochomeloans.com` as a separate tool. Postiz should look and feel **inside** the `roc-ai` dashboard at `/home/dwizy/Workspace/roc-ai/`, not as a stand-alone app.

**Goal:** A single admin shell (roc-ai) with a "Publisher" module/tab that gives Ivan + team the Postiz functionality (calendar, drafts, approve, publish) without ever leaving roc-ai.

### Three implementation options (decision pending)

| Option | Effort | Tradeoff |
|---|---|---|
| **A. Iframe embed** | ~2 hrs | Fastest. Add a `/publisher` route in roc-ai that iframes Postiz at a private URL. Session cookie shared via same origin. Visual drift — Postiz's UI still peeks through the iframe chrome. |
| **B. Reverse-proxy unified domain** | ~4 hrs | Cleaner. Mount Postiz at `app.rochomeloans.com/publisher/*` via an nginx / Cloud Run path rewrite. Single session cookie. Login/logout share state. ROC rebrand layer already matches dark-navy + gold, so visual fit is OK. |
| **C. Headless Postiz — roc-ai owns the UI** | ~20+ hrs | Best long-term. Strip Postiz frontend entirely. roc-ai implements the draft/calendar/approve/publish UX against Postiz's REST/GraphQL API. Full ROC design system. Upstream Postiz frontend merges become irrelevant. |

### Current state

- `roc-ai` is a React/Vite dashboard (`/home/dwizy/Workspace/roc-ai/src/`), already wired to the MortgageArchitect backend, ROC noir-gold visual style established.
- Postiz fork is source-rebranded (gold #FFB703 primary, "ROC · PUBLISHER" wordmark) — option B or A would look cohesive; option C would wholly supplant.
- `publisher.rochomeloans.com` as a public domain is **postponed** — everything lives behind `app.rochomeloans.com/publisher/*` when Phase 3 ships.

### Next actions when Phase 3 starts

1. Decide option A / B / C with Ivan
2. If A or B: sketch the iframe / reverse-proxy route in roc-ai + a session-bridge mechanism (roc-ai JWT → Postiz session)
3. If C: generate the Postiz OpenAPI / GraphQL schema, scaffold the React module in roc-ai
4. Keep Phase 2 deploy artifacts (`deploy/*.sh`) usable — Postiz still needs to run somewhere; Phase 3 just changes WHO renders its UI.
5. Blotato subscription cleanup + BRAIN-01 → Postiz draft API wiring happen independent of option A/B/C.

### Phase 2 status at pause

- ✅ Fork + INTEGRATION_PLAN + upstream remote
- ✅ Deploy scripts shipped (`deploy/`) — Cloud Run + GCE colocate both ready
- ✅ Frontend rebrand committed (`f6215197`)
- ⏸️ **Deploy paused** — `publisher.rochomeloans.com` won't exist as a standalone surface. Next deploy attempt happens only when Phase 3 option is picked.
- ✅ Local dev container is still up (`docker compose ps` → healthy) for ad-hoc exploration.

## Phase 2 deliverables (2026-04-20)

- `deploy/README.md` — two deploy paths documented with cost breakdowns
- `deploy/gcp-provision.sh` — one-shot Cloud SQL + Memorystore + Secret Manager setup (idempotent)
- `deploy/push-image.sh` — Cloud Build → Artifact Registry
- `deploy/cloud-run-deploy.sh` — `gcloud run deploy` with all secrets wired via `--set-secrets`
- `deploy/roclaw-gce-bootstrap.sh` — cheaper path: run on roclaw-new, co-locate with OpenClaw
- Local `docker compose up -d` pulled Postiz image + started Postgres + Redis + Temporal siblings; initial boot triggered (pull-in-progress at commit time — image ~500MB; expect ready within 5–10 min)

---

## Upstream sync strategy

- **Remote config:**
  ```
  git remote add upstream https://github.com/gitroomhq/postiz-app.git
  ```
- **Weekly cadence:** `git fetch upstream && git merge upstream/main` every Monday. Conflict zones are limited to the files under `apps/roc/` and `libraries/nestjs-libraries/src/roc/` — these are ours and never touched by upstream.
- **Risky merges:** auth, `libraries/nestjs-libraries/src/integrations/social/*`. Our SSO bridge and compliance interceptor layer wrap these via NestJS DI, so upstream provider changes should land clean. Audit the diff before every merge.
- **Blocked upstream:** if upstream makes a breaking change that conflicts with our customizations (e.g. removes the `Organization.settings` jsonb field), pin to the last-known-good commit in `package.json` / lockfile and open an upstream PR for the change we need.

---

## AGPLv3 obligations

- **Keep LICENSE intact** — we cannot re-license.
- **If we deploy publicly** (SaaS for external lenders), source must be offered to users of the service. We are NOT doing that — this is internal + partner co-brand use. Partners get source access on request (easy: share the GH repo).
- **Modifications must be source-available** to anyone we serve the modified software to — fine for partners since they're already inside our GH org-equivalent as collaborators.
- **Contributions back to upstream:** any non-ROC-specific bug fixes go upstream as PRs. Keeps our fork lean.

---

## Open questions

1. **Temporal**: self-host on our Cloud Run cluster, or subscribe to Temporal Cloud? Postiz requires it for scheduling. Self-host adds ops burden; Cloud adds ~$200/mo minimum.
2. **Shared Postgres vs. new instance?** Postiz's Prisma migrations are invasive. Probably want a separate DB to keep MA-AI's Drizzle schema unpolluted.
3. **Billing / Stripe**: Postiz has built-in Stripe subscription management. For internal tool we delete those features, but they're deeply wired. Option: disable via feature flag and leave the code dormant.
4. **Postiz Pro features**: some Postiz features (advanced analytics, AI credits) are behind a commercial flag. We need to verify AGPL build has parity with our needs.
5. **Authentication token storage**: Postiz stores OAuth tokens for each connected platform per Integration. Security review needed — are tokens encrypted at rest? (Postiz commit history says yes, but we should confirm with Gemini audit.)
6. **Trinity skill wiring**: once live, add a `/publish` skill so Ivan can queue a post via Claude Code that lands in Postiz as a draft for approval.
