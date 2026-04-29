#!/usr/bin/env bash
# deploy.sh — install AI Governance Platform to /opt and register systemd service
set -euo pipefail

INSTALL_DIR="/opt/ai-governance-platform"
SERVICE_NAME="ai-governance"
COMPOSE_BIN="$(command -v docker-compose 2>/dev/null || echo 'docker compose')"

# ── Require root ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy.sh" >&2
  exit 1
fi

echo "==> Deploying AI Governance Platform to ${INSTALL_DIR}"

# ── Copy files ────────────────────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}"
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '__pycache__' \
  "$(dirname "$0")/" "${INSTALL_DIR}/"

# ── Persistent data directory ─────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"

# ── Create .env if it doesn't exist ──────────────────────────────────────
ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" << 'ENVEOF'
# AI Governance Platform — environment configuration
# Edit this file to configure the AI analysis engine.

# AI engine: none | claude | ollama | openai
AI_PROVIDER=none

# Model override (leave blank to use the default for the provider)
AI_MODEL=

# API keys — fill in whichever provider you choose
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Ollama host (used when AI_PROVIDER=ollama)
OLLAMA_HOST=http://ollama:11434
ENVEOF
  echo "==> Created ${ENV_FILE} — edit it to configure AI_PROVIDER and API keys"
fi
chmod 600 "${ENV_FILE}"

# ── Update docker-compose volume path to use /opt data dir ───────────────
# The docker-compose.yml uses a named volume; Docker stores it in
# /var/lib/docker/volumes/ by default.  For an explicit host-path bind
# (easier to back up), uncomment the sed below:
#
# sed -i "s|governance_data:|governance_data:\n    driver_opts:\n      type: none\n      o: bind\n      device: ${INSTALL_DIR}/data|" \
#   "${INSTALL_DIR}/docker-compose.yml"

# ── systemd service ───────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "${SERVICE_FILE}" << SVCEOF
[Unit]
Description=AI Governance Platform
Documentation=https://github.com/your-org/ai-governance-platform
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${INSTALL_DIR}/.env
ExecStart=${COMPOSE_BIN} up -d --build
ExecStop=${COMPOSE_BIN} down
ExecReload=${COMPOSE_BIN} pull && ${COMPOSE_BIN} up -d --build
TimeoutStartSec=300
Restart=on-failure

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

echo ""
echo "==> Installation complete"
echo ""
echo "    Install dir : ${INSTALL_DIR}"
echo "    Config file : ${ENV_FILE}"
echo "    Service     : ${SERVICE_NAME}"
echo ""
echo "Commands:"
echo "    sudo systemctl start   ${SERVICE_NAME}    # start the platform"
echo "    sudo systemctl stop    ${SERVICE_NAME}    # stop"
echo "    sudo systemctl restart ${SERVICE_NAME}    # restart"
echo "    sudo systemctl status  ${SERVICE_NAME}    # check status"
echo ""
echo "Ports (after start):"
echo "    Dashboard  → http://localhost:3000"
echo "    API / docs → http://localhost:8000/docs"
echo ""
echo "To configure the AI engine, edit ${ENV_FILE} then restart the service."
