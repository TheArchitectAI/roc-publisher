#!/usr/bin/env bash
# One-time GCP resource provisioning for roc-publisher Cloud Run deploy.
# Run once. Idempotent — safe to re-run.
set -euo pipefail

PROJECT="${GCP_PROJECT:-silver-pad-459411-e7}"
REGION="${GCP_REGION:-us-east4}"
SQL_INSTANCE="${SQL_INSTANCE:-roc-publisher-db}"
REDIS_INSTANCE="${REDIS_INSTANCE:-roc-publisher-redis}"

echo "=== project: $PROJECT, region: $REGION ==="
gcloud config set project "$PROJECT"

echo "=== enabling required APIs ==="
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
  --quiet

echo "=== Cloud SQL Postgres (db-f1-micro, ~\$7/mo) ==="
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_17 \
    --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=10 \
    --storage-type=SSD \
    --backup
else
  echo "  (exists, skipping)"
fi

# DB + user
gcloud sql databases create postiz --instance="$SQL_INSTANCE" 2>/dev/null || true
DB_PASS=$(openssl rand -hex 16)
gcloud sql users create postiz-user --instance="$SQL_INSTANCE" --password="$DB_PASS" 2>/dev/null \
  || echo "  user exists (password unchanged)"
echo "  DATABASE_URL = postgresql://postiz-user:$DB_PASS@/postiz?host=/cloudsql/$PROJECT:$REGION:$SQL_INSTANCE"
echo "  (store in Secret Manager as ROC_PUBLISHER_DATABASE_URL)"

echo "=== Memorystore Redis (basic 1GB, ~\$30/mo) ==="
if ! gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" >/dev/null 2>&1; then
  gcloud redis instances create "$REDIS_INSTANCE" \
    --size=1 \
    --region="$REGION" \
    --redis-version=redis_7_2
else
  echo "  (exists, skipping)"
fi
REDIS_IP=$(gcloud redis instances describe "$REDIS_INSTANCE" --region="$REGION" --format='value(host)')
echo "  REDIS_URL = redis://$REDIS_IP:6379"

echo "=== Artifact Registry repo for container images ==="
gcloud artifacts repositories create roc-publisher \
  --repository-format=docker \
  --location="$REGION" \
  --description="ROC publisher Docker images" 2>/dev/null || echo "  (exists)"

echo "=== seed Secret Manager placeholders (fill values manually after) ==="
for s in ROC_PUBLISHER_JWT_SECRET ROC_PUBLISHER_DATABASE_URL ROC_PUBLISHER_REDIS_URL \
         ROC_PUBLISHER_FACEBOOK_APP_ID ROC_PUBLISHER_FACEBOOK_APP_SECRET \
         ROC_PUBLISHER_LINKEDIN_CLIENT_ID ROC_PUBLISHER_LINKEDIN_CLIENT_SECRET \
         ROC_PUBLISHER_X_API_KEY ROC_PUBLISHER_X_API_SECRET \
         ROC_PUBLISHER_TIKTOK_CLIENT_ID ROC_PUBLISHER_TIKTOK_CLIENT_SECRET \
         ROC_PUBLISHER_YOUTUBE_CLIENT_ID ROC_PUBLISHER_YOUTUBE_CLIENT_SECRET; do
  gcloud secrets create "$s" --replication-policy=automatic 2>/dev/null \
    && echo "  created placeholder: $s" \
    || true
done

# JWT secret gets a real value immediately
if ! gcloud secrets versions access latest --secret=ROC_PUBLISHER_JWT_SECRET >/dev/null 2>&1; then
  echo -n "$(openssl rand -hex 32)" | gcloud secrets versions add ROC_PUBLISHER_JWT_SECRET --data-file=-
  echo "  wrote JWT secret value"
fi

echo ""
echo "=== done ==="
echo "Next: fill OAuth secrets via 'gcloud secrets versions add SECRET_NAME --data-file=-'"
echo "Then: ./deploy/push-image.sh && ./deploy/cloud-run-deploy.sh"
