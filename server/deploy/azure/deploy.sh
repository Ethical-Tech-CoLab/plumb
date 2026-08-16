#!/usr/bin/env bash
# Plumb backend — one-shot Azure deployment.
#
#   ./deploy.sh rg-plumb eastus ghcr.io/ethical-tech-colab/plumb-backend:0.1.0
#
# Creates the resource group if needed, deploys the Bicep template, then
# re-applies the resulting public URL so contract exports carry correct
# image_url values (a two-pass step that is easy to forget by hand).

set -euo pipefail

RESOURCE_GROUP="${1:-rg-plumb}"
LOCATION="${2:-eastus}"
IMAGE="${3:-}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://ethical-tech-colab.github.io}"

if [[ -z "$IMAGE" ]]; then
  echo "usage: $0 <resource-group> <location> <image>" >&2
  echo "example: $0 rg-plumb eastus ghcr.io/ethical-tech-colab/plumb-backend:0.1.0" >&2
  exit 1
fi

command -v az >/dev/null || { echo "Azure CLI (az) not found." >&2; exit 1; }

# A token is generated if the operator did not supply one. Writes must never be
# open on a public host.
API_TOKENS="${PLUMB_API_TOKENS:-$(openssl rand -hex 32)}"

echo "==> Resource group $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> Deploying container app from $IMAGE"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/main.bicep" \
  --parameters \
      image="$IMAGE" \
      allowedOrigins="$ALLOWED_ORIGINS" \
      requireAuth=true \
      apiTokens="$API_TOKENS" \
      tsaUrl="${PLUMB_TSA_URL:-}" \
  --output none

BACKEND_URL=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name main \
  --query properties.outputs.backendUrl.value -o tsv)

echo "==> Second pass: setting PLUMB_PUBLIC_BASE_URL=$BACKEND_URL"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$(dirname "$0")/main.bicep" \
  --parameters \
      image="$IMAGE" \
      allowedOrigins="$ALLOWED_ORIGINS" \
      publicBaseUrl="$BACKEND_URL" \
      requireAuth=true \
      apiTokens="$API_TOKENS" \
      tsaUrl="${PLUMB_TSA_URL:-}" \
  --output none

echo
echo "Backend URL : $BACKEND_URL"
echo "API token   : $API_TOKENS"
echo
echo "Verify:"
echo "  curl -fsS $BACKEND_URL/v1/meta | jq"
echo
echo "Store the API token in a secret manager. It is not recoverable from the template."
