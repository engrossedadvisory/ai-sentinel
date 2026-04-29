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

# ── Require root ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Run as root:  sudo bash deploy.sh [--pull]" >&2
  exit 1
fi

PULL_ONLY=false
[[ "${1:-}" == "--pull" ]] && PULL_ONLY=true

# ── Docker compose detection ──────────────────────────────────────────────
echo "==> Detecting Docker Compose…"
if docker compose version &>/dev/null 2>&1; then
  COMPOSE_BIN="docker compose"
  echo "    ✓ docker compose (v2)"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_BIN="docker-compose"
  echo "    ✓ docker-compose (v1)"
else
  echo "ERROR: Neither 'docker compose' nor 'docker-compose' found." >&2
  echo "       Install Docker: https://docs.docker.com/engine/install/" >&2
  exit 1
fi

# ── Port detection ────────────────────────────────────────────────────────
# Check all three sources: host listeners, lsof, AND running Docker containers
port_in_use() {
  local port=$1
  # 1. Host-level listeners via ss
  ss -tlnH 2>/dev/null | awk '{print $4}' | grep -q ":${port}$" && return 0
  # 2. lsof fallback
  if command -v lsof &>/dev/null; then
    lsof -i "TCP:${port}" -sTCP:LISTEN &>/dev/null 2>&1 && return 0
  fi
  # 3. ALL Docker containers (running + stopped) — catches Docker's internal allocation table
  if command -v docker &>/dev/null; then
    docker ps -a --format '{{.Ports}}' 2>/dev/null \
      | grep -q "0\.0\.0\.0:${port}->\|:::${port}->" && return 0
  fi
  # 4. /proc/net/tcp — final fallback, always present on Linux
  local hex_port
  hex_port=$(printf '%04X' "${port}")
  grep -qi " 00000000:${hex_port} " /proc/net/tcp  2>/dev/null && return 0
  grep -qi " 00000000:${hex_port} " /proc/net/tcp6 2>/dev/null && return 0
  return 1
}

find_free_port() {
  local port=$1
  while port_in_use "${port}"; do
    port=$((port + 1))
  done
  echo "${port}"
}

# ── Ensure Docker networking is healthy before checking ports ─────────────
echo "==> Ensuring Docker daemon is running…"
if ! docker info &>/dev/null 2>&1; then
  echo "    Docker not responding — attempting restart…"
  systemctl restart docker
  sleep 3
fi
echo "    ✓ Docker daemon OK"

echo "==> Checking port availability…"

FRONTEND_PORT=3000
BACKEND_PORT=8000

# Check frontend port
DETECTED_FRONTEND=$(find_free_port ${FRONTEND_PORT})
if [[ "${DETECTED_FRONTEND}" != "${FRONTEND_PORT}" ]]; then
  echo "    ⚠ Port ${FRONTEND_PORT} in use → using port ${DETECTED_FRONTEND} for dashboard"
  FRONTEND_PORT=${DETECTED_FRONTEND}
else
  echo "    ✓ Port ${FRONTEND_PORT} available (dashboard)"
fi

# Check backend port
DETECTED_BACKEND=$(find_free_port ${BACKEND_PORT})
if [[ "${DETECTED_BACKEND}" != "${BACKEND_PORT}" ]]; then
  echo "    ⚠ Port ${BACKEND_PORT} in use → using port ${DETECTED_BACKEND} for API"
  BACKEND_PORT=${DETECTED_BACKEND}
else
  echo "    ✓ Port ${BACKEND_PORT} available (API)"
fi

# ── GitHub auth check ─────────────────────────────────────────────────────
echo "==> Checking GitHub authentication…"
if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null; then
    echo "    ✓ gh CLI authenticated"
    GH_TOKEN="$(gh auth token 2>/dev/null || true)"
    if [[ -n "${GH_TOKEN}" ]]; then
      REPO_URL="https://oauth2:${GH_TOKEN}@github.com/${REPO}.git"
    fi
  else
    echo "    ⚠ gh CLI not authenticated — run:  gh auth login"
    echo "    Continuing with public HTTPS…"
  fi
else
  echo "    ⚠ gh CLI not found — continuing with public HTTPS"
fi

# ── Clone or pull ─────────────────────────────────────────────────────────
if [[ "${PULL_ONLY}" == "true" ]]; then
  echo "==> Pulling latest from GitHub…"
  if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    echo "ERROR: ${INSTALL_DIR} is not a git repo. Run without --pull for a fresh clone." >&2
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

# ── Write .env (ports always updated; other keys only set if file is new) ──
ENV_FILE="${INSTALL_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "==> Creating ${ENV_FILE}…"
  cat > "${ENV_FILE}" << ENVEOF
# ─────────────────────────────────────────────────────────────────
#  AI SENTINEL — environment configuration
#  "AI acts. SENTINEL answers."
#
#  Edit this file then restart the service:
#    sudo systemctl restart ai-sentinel
# ─────────────────────────────────────────────────────────────────

# ── Ports (auto-detected at deploy time) ─────────────────────────
FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}

# ── Global AI fallback ────────────────────────────────────────────
# Provider: none | claude | openai | gemini | ollama
AI_PROVIDER=none
AI_MODEL=

# ── API keys ──────────────────────────────────────────────────────
# Keys can also be set at runtime via Brain Center → Provider Keys tab
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=

# ── Ollama (local / on-premise) ───────────────────────────────────
OLLAMA_HOST=http://localhost:11434

# ── Per-brain configuration (overrides global above) ─────────────
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
else
  # .env already exists — update/add port lines only
  echo "==> Updating ports in existing ${ENV_FILE}…"
  # Remove old port lines then append fresh ones
  sed -i '/^FRONTEND_PORT=/d' "${ENV_FILE}"
  sed -i '/^BACKEND_PORT=/d'  "${ENV_FILE}"
  # Insert port lines right after the first comment block (line 1)
  sed -i "1a BACKEND_PORT=${BACKEND_PORT}\nFRONTEND_PORT=${FRONTEND_PORT}" "${ENV_FILE}"
fi

chmod 600 "${ENV_FILE}"
echo "    ✓ Ports set: frontend=${FRONTEND_PORT}, backend=${BACKEND_PORT}"

# ── systemd service ───────────────────────────────────────────────────────
echo "==> Writing systemd service…"
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
# Tear down first to release any stale Docker port allocations, then start fresh
ExecStartPre=-${COMPOSE_BIN} down --remove-orphans
ExecStart=${COMPOSE_BIN} up -d --build
ExecStop=${COMPOSE_BIN} down --remove-orphans
ExecReload=${COMPOSE_BIN} pull && ${COMPOSE_BIN} up -d --build
TimeoutStartSec=300

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
echo "  Ports assigned:"
echo "    Dashboard  → http://$(hostname -I | awk '{print $1}'):${FRONTEND_PORT}"
echo "    API / docs → http://$(hostname -I | awk '{print $1}'):${BACKEND_PORT}/docs"
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
echo "  To update from GitHub:"
echo "    sudo bash ${INSTALL_DIR}/deploy.sh --pull"
echo ""
