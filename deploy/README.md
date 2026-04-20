# roc-publisher deploy

Two paths. Pick one. Both bring up the Postiz fork with ROC branding.

## Option A — Co-locate on `roclaw-new` GCE (recommended to start)

**Cost:** $0 incremental (roclaw-new e2-medium already pays ~$27/mo)
**Setup time:** ~30 min
**Tradeoffs:** shares CPU/RAM with OpenClaw/ROClaw; Postiz uses Postgres + Redis + Temporal as sibling containers. If the box runs hot, both services slow down.

```bash
# 1. SSH to roclaw-new
gcloud compute ssh roclaw-new --zone=us-east4-a --project=silver-pad-459411-e7

# 2. Clone fork + start stack (on roclaw-new)
cd ~ && git clone https://github.com/TheArchitectAI/roc-publisher.git
cd roc-publisher
# Set a real JWT secret
sed -i "s|JWT_SECRET: .*|JWT_SECRET: '$(openssl rand -hex 32)'|" docker-compose.yaml
docker compose up -d

# 3. Verify
curl -I http://localhost:4007   # expect 200
```

To expose publicly at `publisher.rochomeloans.com` via Cloudflare Tunnel or direct nginx proxy — see `nginx.conf.example`.

## Option B — Full Cloud Run managed stack

**Cost:** ~$70/mo baseline
- Cloud SQL Postgres (db-f1-micro): $7
- Memorystore Redis basic 1GB: $30
- Cloud Run Postiz service: $10
- Temporal (via Cloud Run self-hosted): $15
- Artifact Registry + egress: $5

**Setup time:** ~90 min
**Tradeoffs:** proper managed infra, scale-to-near-zero, but more knobs to tune.

```bash
# 1. Provision GCP resources (one-time)
./deploy/gcp-provision.sh

# 2. Push image
./deploy/push-image.sh

# 3. Deploy
./deploy/cloud-run-deploy.sh

# 4. Map domain
gcloud run domain-mappings create --service=roc-publisher --domain=publisher.rochomeloans.com --region=us-east4
```

## Secrets to wire (both options)

| Env / Secret | Source |
|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` — store in Secret Manager once chosen |
| `DATABASE_URL` | Option A: docker-compose default. Option B: Cloud SQL connection string. |
| `REDIS_URL` | Option A: docker-compose default. Option B: Memorystore endpoint. |
| `TEMPORAL_ADDRESS` | Postiz needs this for scheduling. |
| `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` | Meta Developer Portal |
| `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` | LinkedIn Developer Portal |
| `X_API_KEY` + `X_API_SECRET` | X/Twitter Developer |
| `TIKTOK_CLIENT_ID` + `TIKTOK_CLIENT_SECRET` | TikTok Developer |
| `YOUTUBE_CLIENT_ID` + `YOUTUBE_CLIENT_SECRET` | Google Cloud Console (OAuth consent) |
| `FRONTEND_URL` | `https://publisher.rochomeloans.com` |
| `NEXT_PUBLIC_BACKEND_URL` | same host + `/api` |

Meta/TikTok/YT/LinkedIn OAuth apps all need the redirect URI set to `https://publisher.rochomeloans.com/integrations/social/{platform}/callback`.

## First-run checklist

- [ ] JWT_SECRET is real (not the placeholder)
- [ ] Database reachable
- [ ] Frontend loads at chosen URL
- [ ] `Sign Up` creates first user (then set `DISABLE_REGISTRATION=true`)
- [ ] Connect IG + FB integrations (OAuth handshake works)
- [ ] Post a test draft via UI
- [ ] Webhook from n8n → Postiz API works (test against `/api/v1/posts`)
