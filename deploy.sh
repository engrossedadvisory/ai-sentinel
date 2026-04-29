#!/usr/bin/env bash
# deploy.sh — clone/pull AI SENTINEL from GitHub and deploy to /opt
# Usage:
#   First time:  sudo bash deploy.sh
#   Update:      sudo bash deploy.sh --pull
set -euo pipefail

REPO="engrossedadvisory/ai-sentinel"
REPO_URL="https://github.com/${REPO}.git"
INSTALL_DIR="/opt/ai-sentinel"
SERVICE_NAME="ai-sentinel"
COMPOSE_BIN="$(command -v docker-compose 2>/dev/null || echo 'docker compose')"

# ── Require root ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy.sh [--pull]" >&2
  exit 1
fi

PULL_ONLY=false
[[ "${1:-}" == "--pull" ]] && PULL_ONLY=true

# ── GitHub auth check ─────────────────────────────────────────────────────
echo "==> Checking GitHub authentication…"
if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null; then
    echo "    ✓ gh CLI authenticated"
    GH_TOKEN="$(gh auth token 2>/dev/null || true)"
    if [[ -n "${GH_TOKEN}" ]]; then
      # Use token for git operations (avoids interactive prompts)
      REPO_URL="https://oauth2:${GH_TOKEN}@github.com/${REPO}.git"
    fi
  else
    echo "    ⚠ gh CLI not authenticated — run:  gh auth login"
    echo "    Continuing with public HTTPS (may prompt for credentials)…"
  fi
else
  echo "    ⚠ gh CLI not found — install from https://cli.github.com"
  echo "    Continuing with public HTTPS…"
fi

# ── Clone or pull ─────────────────────────────────────────────────────────
if [[ "${PULL_ONLY}" == "true" ]]; then
  echo "==> Pulling latest from GitHub…"
  if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    echo "ERROR: ${INSTALL_DIR} is not a git repo. Run without --pull to do a fresh clone." >&2
    exit 1
  fi
  git -C "${INSTALL_DIR}" pull --rebase origin main
  echo "    ✓ Updated to latest"
else
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    echo "==> ${INSTALL_DIR} already exists — pulling latest…"
    git -C "${INSTALL_DIR}" pull --rebase origin main
  else
    echo "==> Cloning ${REPO} → ${INSTALL_DIR}…"
    git clone "${REPO_URL}" "${INSTALL_DIR}"
    echo "    ✓ Cloned"
  fi
fi

# ── Persistent data directory ─────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"

# ── Create .env if it doesn't exist ──────────────────────────────────────
ENV_FILE="${INSTALL_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" << 'ENVEOF'
# ─────────────────────────────────────────────────────────────────
#  AI SENTINEL — environment configuration
#  "AI acts. SENTINEL answers."
#
#  Edit this file then restart the service:
#    sudo systemctl restart ai-sentinel
# ─────────────────────────────────────────────────────────────────

# ── Global fallback (used if per-brain vars are not set) ──────────
# Provider: none | claude | openai | gemini | ollama
AI_PROVIDER=none
AI_MODEL=

# ── API keys ──────────────────────────────────────────────────────
# Keys can also be set at runtime via the Brain Center → Provider Keys tab
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=

# ── Ollama (local / on-premise) ───────────────────────────────────
# Use 'ollama' as the service name if running Ollama via Docker Compose
OLLAMA_HOST=http://localhost:11434

# ── Per-brain configuration (overrides global above) ─────────────
# Each brain can use a different provider and model independently.
# Uncomment and fill in to configure each brain:
#
# BRAIN_TRIAGE_PROVIDER=claude
# BRAIN_TRIAGE_MODEL=claude-haiku-3-5
#
# BRAIN_DETECTION_PROVIDER=claude
# BRAIN_DETECTION_MODEL=claude-sonnet-4-5
#
# BRAIN_RISK_PROVIDER=ollama
# BRAIN_RISK_MODEL=llama3.2
#
# BRAIN_POLICY_PROVIDER=gemini
# BRAIN_POLICY_MODEL=gemini-2.0-flash
#
# BRAIN_MITIGATION_PROVIDER=openai
# BRAIN_MITIGATION_MODEL=gpt-4o
ENVEOF
  echo "==> Created ${ENV_FILE} — edit it to configure providers and API keys"
fi
chmod 600 "${ENV_FILE}"

# ── systemd service ───────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "${SERVICE_FILE}" << SVCEOF
[Unit]
Description=AI SENTINEL — AI Agent Governance Platform
Documentation=https://github.com/${REPO}
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

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       AI SENTINEL — Deployment Complete              ║"
echo "║       AI acts. SENTINEL answers.                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Install dir : ${INSTALL_DIR}"
echo "  Config      : ${ENV_FILE}"
echo "  GitHub      : https://github.com/${REPO}"
echo ""
echo "  Next steps:"
echo "    1. Edit config:   sudo nano ${ENV_FILE}"
echo "    2. Start service: sudo systemctl start ${SERVICE_NAME}"
echo ""
echo "  Service commands:"
echo "    sudo systemctl start   ${SERVICE_NAME}"
echo "    sudo systemctl stop    ${SERVICE_NAME}"
echo "    sudo systemctl restart ${SERVICE_NAME}"
echo "    sudo systemctl status  ${SERVICE_NAME}"
echo "    sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "  URLs (after start):"
echo "    Dashboard  → http://localhost:3000"
echo "    API / docs → http://localhost:8000/docs"
echo ""
echo "  To update from GitHub:"
echo "    sudo bash ${INSTALL_DIR}/deploy.sh --pull"
echo ""
