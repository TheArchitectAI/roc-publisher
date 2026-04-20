#!/usr/bin/env bash
# Run ON roclaw-new to bring up roc-publisher alongside OpenClaw.
# Assumes: docker installed, git installed, caller is user `dwizy`.
set -euo pipefail

INSTALL_DIR="${HOME}/roc-publisher"

if [ ! -d "$INSTALL_DIR" ]; then
  echo "=== cloning fork ==="
  git clone https://github.com/TheArchitectAI/roc-publisher.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
git pull --ff-only || true

# Generate a real JWT secret on first run
if grep -q "random string that is unique" docker-compose.yaml; then
  JWT=$(openssl rand -hex 32)
  sed -i.bak "s|JWT_SECRET: 'random string that is unique to every install - just type random characters here!'|JWT_SECRET: '$JWT'|" docker-compose.yaml
  echo "JWT_SECRET seeded"
fi

# Pull + start
docker compose pull
docker compose up -d

sleep 15
echo ""
echo "=== container status ==="
docker compose ps

echo ""
echo "=== reachability test ==="
curl -I -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4007 || true

echo ""
echo "=== done ==="
echo "Next: expose publisher.rochomeloans.com via nginx or Cloudflare Tunnel to localhost:4007"
