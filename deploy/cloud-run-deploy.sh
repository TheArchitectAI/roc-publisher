#!/usr/bin/env bash
# Deploy roc-publisher to Cloud Run with all secrets wired.
set -euo pipefail

PROJECT="${GCP_PROJECT:-silver-pad-459411-e7}"
REGION="${GCP_REGION:-us-east4}"
SERVICE="${SERVICE:-roc-publisher}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/roc-publisher/postiz:${TAG}"
SQL_INSTANCE="${SQL_INSTANCE:-roc-publisher-db}"

echo "=== deploying $SERVICE from $IMAGE ==="

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --allow-unauthenticated \
  --memory=2Gi \
  --cpu=2 \
  --concurrency=50 \
  --min-instances=1 \
  --max-instances=5 \
  --timeout=300 \
  --port=5000 \
  --add-cloudsql-instances="$PROJECT:$REGION:$SQL_INSTANCE" \
  --set-env-vars="FRONTEND_URL=https://publisher.rochomeloans.com,NEXT_PUBLIC_BACKEND_URL=https://publisher.rochomeloans.com/api,BACKEND_INTERNAL_URL=http://localhost:3000,STORAGE_PROVIDER=local,UPLOAD_DIRECTORY=/uploads,IS_GENERAL=true,DISABLE_REGISTRATION=true,API_LIMIT=60" \
  --set-secrets="JWT_SECRET=ROC_PUBLISHER_JWT_SECRET:latest,DATABASE_URL=ROC_PUBLISHER_DATABASE_URL:latest,REDIS_URL=ROC_PUBLISHER_REDIS_URL:latest,FACEBOOK_APP_ID=ROC_PUBLISHER_FACEBOOK_APP_ID:latest,FACEBOOK_APP_SECRET=ROC_PUBLISHER_FACEBOOK_APP_SECRET:latest,LINKEDIN_CLIENT_ID=ROC_PUBLISHER_LINKEDIN_CLIENT_ID:latest,LINKEDIN_CLIENT_SECRET=ROC_PUBLISHER_LINKEDIN_CLIENT_SECRET:latest,X_API_KEY=ROC_PUBLISHER_X_API_KEY:latest,X_API_SECRET=ROC_PUBLISHER_X_API_SECRET:latest,TIKTOK_CLIENT_ID=ROC_PUBLISHER_TIKTOK_CLIENT_ID:latest,TIKTOK_CLIENT_SECRET=ROC_PUBLISHER_TIKTOK_CLIENT_SECRET:latest,YOUTUBE_CLIENT_ID=ROC_PUBLISHER_YOUTUBE_CLIENT_ID:latest,YOUTUBE_CLIENT_SECRET=ROC_PUBLISHER_YOUTUBE_CLIENT_SECRET:latest"

echo ""
echo "=== Cloud Run URL ==="
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'

echo ""
echo "=== Next ==="
echo "  1. Map domain: gcloud run domain-mappings create --service=$SERVICE --domain=publisher.rochomeloans.com --region=$REGION"
echo "  2. Set DNS CNAME: publisher.rochomeloans.com → ghs.googlehosted.com"
echo "  3. Verify: curl -I https://publisher.rochomeloans.com"
