#!/usr/bin/env bash
# Builds the API image with Cloud Build and deploys it to Cloud Run.
# Run from the repo root after the one-time setup in packages/api/DEPLOY.md.
set -euo pipefail

PROJECT="${PROJECT:?Set PROJECT to your Google Cloud project id}"
REGION=us-central1
SERVICE=legal-lint-api
REPO=legal-lint
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/api:$(git rev-parse --short HEAD)"

gcloud builds submit --project "$PROJECT" --config packages/api/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE" .

# Free-tier guard rails: one instance at most, scale to zero, CPU only while handling a request.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --service-account "legal-lint-api@$PROJECT.iam.gserviceaccount.com" \
  --execution-environment gen2 \
  --max-instances 1 \
  --min-instances 0 \
  --cpu 1 \
  --memory 2Gi \
  --concurrency 10 \
  --timeout 120 \
  --cpu-throttling \
  --allow-unauthenticated
