#!/usr/bin/env bash
# Build + push the Postiz fork image to Artifact Registry.
set -euo pipefail

PROJECT="${GCP_PROJECT:-silver-pad-459411-e7}"
REGION="${GCP_REGION:-us-east4}"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/roc-publisher/postiz:${TAG}"

echo "=== building image: $IMAGE ==="
gcloud builds submit \
  --tag="$IMAGE" \
  --project="$PROJECT" \
  --timeout=30m \
  --machine-type=e2-highcpu-8

echo "=== also tagging as :latest ==="
gcloud artifacts docker tags add "$IMAGE" "${REGION}-docker.pkg.dev/${PROJECT}/roc-publisher/postiz:latest"

echo ""
echo "=== done ==="
echo "Image: $IMAGE"
echo "Also: ${REGION}-docker.pkg.dev/${PROJECT}/roc-publisher/postiz:latest"
echo ""
echo "Next: ./deploy/cloud-run-deploy.sh [tag]"
