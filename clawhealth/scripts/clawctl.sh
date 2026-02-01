#!/usr/bin/env bash
#
# clawctl.sh — ClawHealth Command Line Control Tool
#
# The main CLI for managing the ClawHealth single-server deployment.
# Provisions patient containers, starts/stops the stack, and manages patients.
#
# Usage:
#   ./clawctl.sh setup              # First-time server setup
#   ./clawctl.sh up                 # Start shared infrastructure
#   ./clawctl.sh down               # Stop everything
#   ./clawctl.sh add-patient        # Provision a new patient container
#   ./clawctl.sh remove-patient ID  # Deactivate a patient container
#   ./clawctl.sh list-patients      # List all registered patients
#   ./clawctl.sh status             # Show system status
#   ./clawctl.sh logs [service]     # Tail logs for a service

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_DIR/docker"
REGISTRY_DIR="$PROJECT_DIR/data/registry"
PATIENTS_DIR="$PROJECT_DIR/data/patients"
ENV_FILE="$PROJECT_DIR/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[clawctl]${NC} $1"; }
success() { echo -e "${GREEN}[clawctl]${NC} $1"; }
warn() { echo -e "${YELLOW}[clawctl]${NC} $1"; }
error() { echo -e "${RED}[clawctl]${NC} $1" >&2; }

# --- Setup ---
cmd_setup() {
  log "Setting up ClawHealth on this server..."

  # Create data directories
  mkdir -p "$REGISTRY_DIR" "$PATIENTS_DIR"

  # Initialize empty patient registry
  if [ ! -f "$REGISTRY_DIR/patients.json" ]; then
    echo '{"patients":[],"nextPort":18790}' > "$REGISTRY_DIR/patients.json"
    success "Created patient registry"
  fi

  # Create .env from template if it doesn't exist
  if [ ! -f "$ENV_FILE" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    warn "Created .env file — EDIT THIS with your Twilio and Anthropic API keys!"
    warn "  $ENV_FILE"
  fi

  # Build Docker images
  log "Building Docker images..."
  docker compose -f "$DOCKER_DIR/docker-compose.yml" build

  success "Setup complete!"
  echo ""
  log "Next steps:"
  echo "  1. Edit $ENV_FILE with your API keys"
  echo "  2. Run: ./clawctl.sh up"
  echo "  3. Run: ./clawctl.sh add-patient"
}

# --- Start shared infrastructure ---
cmd_up() {
  log "Starting ClawHealth infrastructure..."
  docker compose -f "$DOCKER_DIR/docker-compose.yml" up -d
  success "Infrastructure started"

  # Also start any existing patient containers
  for patient_dir in "$PATIENTS_DIR"/*/; do
    if [ -f "$patient_dir/docker-compose.yml" ]; then
      patient_id=$(basename "$patient_dir")
      log "Starting patient container: $patient_id"
      docker compose -f "$patient_dir/docker-compose.yml" up -d
    fi
  done

  cmd_status
}

# --- Stop everything ---
cmd_down() {
  log "Stopping all containers..."

  # Stop patient containers first
  for patient_dir in "$PATIENTS_DIR"/*/; do
    if [ -f "$patient_dir/docker-compose.yml" ]; then
      docker compose -f "$patient_dir/docker-compose.yml" down 2>/dev/null || true
    fi
  done

  # Stop shared infrastructure
  docker compose -f "$DOCKER_DIR/docker-compose.yml" down
  success "All containers stopped"
}

# --- Add a patient ---
cmd_add_patient() {
  echo ""
  echo -e "${BLUE}=== Add New Patient ===${NC}"
  echo ""

  read -rp "First name: " FIRST_NAME
  read -rp "Last name: " LAST_NAME
  read -rp "Phone (e.g. +15551234567): " PHONE
  read -rp "Physician name: " PHYSICIAN_NAME
  read -rp "Physician ID: " PHYSICIAN_ID

  # Generate unique ID and encryption key
  PATIENT_ID="patient-$(openssl rand -hex 4)"
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  GATEWAY_TOKEN="$(openssl rand -base64 18)"

  log "Provisioning ClawBox for $FIRST_NAME $LAST_NAME ($PATIENT_ID)..."

  # Create patient directory
  PATIENT_DIR="$PATIENTS_DIR/$PATIENT_ID"
  mkdir -p "$PATIENT_DIR/data/db"

  # Load shared env vars
  source "$ENV_FILE" 2>/dev/null || true

  # Create patient-specific .env
  cat > "$PATIENT_DIR/.env" <<ENVEOF
PATIENT_ID=$PATIENT_ID
PATIENT_PHONE=$PHONE
PATIENT_TIMEZONE=America/New_York
PHYSICIAN_ID=$PHYSICIAN_ID
PHYSICIAN_NAME=$PHYSICIAN_NAME
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
CLAUDE_MODEL_PRIMARY=${CLAUDE_MODEL_PRIMARY:-claude-sonnet-4-20250514}
CLAUDE_MODEL_COMPLEX=${CLAUDE_MODEL_COMPLEX:-claude-opus-4-5-20251101}
CLAUDE_MODEL_SAFETY=${CLAUDE_MODEL_SAFETY:-claude-haiku-3-5-20241022}
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}
TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER:-}
DATABASE_PATH=/data/db/health.db
ENCRYPTION_KEY=$ENCRYPTION_KEY
GATEWAY_PORT=18789
GATEWAY_AUTH_TOKEN=$GATEWAY_TOKEN
REDIS_URL=redis://:${REDIS_PASSWORD:-clawhealth_redis_dev}@clawhealth-redis:6379
LOG_LEVEL=info
NODE_ENV=production
ENVEOF

  # Create per-patient docker-compose
  cat > "$PATIENT_DIR/docker-compose.yml" <<COMPEOF
services:
  clawbox:
    build:
      context: $PROJECT_DIR
      dockerfile: docker/Dockerfile
    container_name: clawbox-$PATIENT_ID
    env_file:
      - .env
    volumes:
      - ./data:/data
    networks:
      - clawhealth
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

networks:
  clawhealth:
    external: true
    name: clawhealth
COMPEOF

  # Register with SMS Router
  log "Registering with SMS Router..."

  # Read current registry
  REGISTRY="$REGISTRY_DIR/patients.json"
  NEXT_PORT=$(python3 -c "import json; r=json.load(open('$REGISTRY')); print(r.get('nextPort', 18790))")

  # Add patient to registry using python (safe JSON manipulation)
  python3 <<PYEOF
import json
from datetime import datetime

with open("$REGISTRY") as f:
    registry = json.load(f)

registry["patients"].append({
    "patientId": "$PATIENT_ID",
    "firstName": "$FIRST_NAME",
    "lastName": "$LAST_NAME",
    "phone": "$PHONE",
    "containerPort": $NEXT_PORT,
    "physicianId": "$PHYSICIAN_ID",
    "physicianName": "$PHYSICIAN_NAME",
    "status": "active",
    "createdAt": datetime.now().isoformat()
})
registry["nextPort"] = $NEXT_PORT + 1

with open("$REGISTRY", "w") as f:
    json.dump(registry, f, indent=2)
PYEOF

  # Start the container
  log "Starting ClawBox container..."
  docker compose -f "$PATIENT_DIR/docker-compose.yml" up -d --build

  echo ""
  success "Patient provisioned successfully!"
  echo ""
  echo "  Patient ID:      $PATIENT_ID"
  echo "  Name:            $FIRST_NAME $LAST_NAME"
  echo "  Phone:           $PHONE"
  echo "  Physician:       $PHYSICIAN_NAME"
  echo "  Container:       clawbox-$PATIENT_ID"
  echo ""
  echo "  The patient can now text $TWILIO_PHONE_NUMBER to interact with their ClawBox."
  echo ""
  warn "SAVE THIS ENCRYPTION KEY SECURELY: $ENCRYPTION_KEY"
}

# --- Remove a patient ---
cmd_remove_patient() {
  local PATIENT_ID="${1:-}"
  if [ -z "$PATIENT_ID" ]; then
    error "Usage: clawctl.sh remove-patient <patient-id>"
    exit 1
  fi

  log "Deactivating patient $PATIENT_ID..."

  # Stop container
  PATIENT_DIR="$PATIENTS_DIR/$PATIENT_ID"
  if [ -f "$PATIENT_DIR/docker-compose.yml" ]; then
    docker compose -f "$PATIENT_DIR/docker-compose.yml" down
  fi

  # Update registry
  python3 <<PYEOF
import json

with open("$REGISTRY_DIR/patients.json") as f:
    registry = json.load(f)

for p in registry["patients"]:
    if p["patientId"] == "$PATIENT_ID":
        p["status"] = "deactivated"

with open("$REGISTRY_DIR/patients.json", "w") as f:
    json.dump(registry, f, indent=2)
PYEOF

  success "Patient $PATIENT_ID deactivated. Data preserved in $PATIENT_DIR/data/"
}

# --- List patients ---
cmd_list_patients() {
  echo ""
  echo -e "${BLUE}=== Registered Patients ===${NC}"
  echo ""

  if [ ! -f "$REGISTRY_DIR/patients.json" ]; then
    warn "No patient registry found. Run: ./clawctl.sh setup"
    return
  fi

  python3 <<'PYEOF'
import json

try:
    with open("REGISTRY_DIR/patients.json".replace("REGISTRY_DIR", "REGPATH")) as f:
        registry = json.load(f)
except:
    print("  No patients registered.")
    exit()

patients = registry.get("patients", [])
if not patients:
    print("  No patients registered yet.")
    exit()

for p in patients:
    status_icon = "●" if p.get("status") == "active" else "○"
    print(f"  {status_icon} {p['patientId']}")
    print(f"    Name:      {p.get('firstName', '')} {p.get('lastName', '')}")
    print(f"    Phone:     {p.get('phone', 'N/A')}")
    print(f"    Physician: {p.get('physicianName', 'N/A')}")
    print(f"    Status:    {p.get('status', 'unknown')}")
    print(f"    Created:   {p.get('createdAt', 'N/A')}")
    print()
PYEOF
}

# Fix the python path in list_patients
cmd_list_patients() {
  echo ""
  echo -e "${BLUE}=== Registered Patients ===${NC}"
  echo ""

  if [ ! -f "$REGISTRY_DIR/patients.json" ]; then
    warn "No patient registry found. Run: ./clawctl.sh setup"
    return
  fi

  python3 -c "
import json
with open('$REGISTRY_DIR/patients.json') as f:
    registry = json.load(f)
patients = registry.get('patients', [])
if not patients:
    print('  No patients registered yet.')
else:
    for p in patients:
        icon = '[ON]' if p.get('status') == 'active' else '[OFF]'
        print(f\"  {icon} {p['patientId']}\")
        print(f\"    Name:      {p.get('firstName', '')} {p.get('lastName', '')}\")
        print(f\"    Phone:     {p.get('phone', 'N/A')}\")
        print(f\"    Physician: {p.get('physicianName', 'N/A')}\")
        print(f\"    Status:    {p.get('status', 'unknown')}\")
        print()
"
}

# --- Status ---
cmd_status() {
  echo ""
  echo -e "${BLUE}=== ClawHealth System Status ===${NC}"
  echo ""

  # Check shared infrastructure
  log "Shared Infrastructure:"
  for svc in clawhealth-nginx clawhealth-router clawhealth-redis clawhealth-portal; do
    if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
      echo -e "  ${GREEN}●${NC} $svc — running"
    else
      echo -e "  ${RED}●${NC} $svc — stopped"
    fi
  done

  echo ""
  log "Patient Containers:"
  local found=false
  for patient_dir in "$PATIENTS_DIR"/*/; do
    [ -d "$patient_dir" ] || continue
    found=true
    patient_id=$(basename "$patient_dir")
    container="clawbox-$patient_id"
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
      echo -e "  ${GREEN}●${NC} $container — running"
    else
      echo -e "  ${RED}●${NC} $container — stopped"
    fi
  done
  if [ "$found" = false ]; then
    echo "  No patient containers provisioned yet."
  fi
  echo ""
}

# --- Logs ---
cmd_logs() {
  local service="${1:-router}"
  log "Tailing logs for $service..."

  case "$service" in
    router)    docker logs -f clawhealth-router ;;
    portal)    docker logs -f clawhealth-portal ;;
    redis)     docker logs -f clawhealth-redis ;;
    nginx)     docker logs -f clawhealth-nginx ;;
    patient-*) docker logs -f "clawbox-$service" ;;
    *)         docker logs -f "clawbox-$service" 2>/dev/null || docker logs -f "$service" ;;
  esac
}

# --- Main ---
case "${1:-help}" in
  setup)          cmd_setup ;;
  up|start)       cmd_up ;;
  down|stop)      cmd_down ;;
  add-patient)    cmd_add_patient ;;
  remove-patient) cmd_remove_patient "${2:-}" ;;
  list-patients)  cmd_list_patients ;;
  status)         cmd_status ;;
  logs)           cmd_logs "${2:-}" ;;
  help|*)
    echo ""
    echo "ClawHealth Control Tool"
    echo ""
    echo "Usage: clawctl.sh <command>"
    echo ""
    echo "Commands:"
    echo "  setup              First-time server setup (build images, create dirs)"
    echo "  up                 Start shared infrastructure + all patient containers"
    echo "  down               Stop everything"
    echo "  add-patient        Provision a new patient ClawBox (interactive)"
    echo "  remove-patient ID  Deactivate a patient container"
    echo "  list-patients      List all registered patients"
    echo "  status             Show system status"
    echo "  logs [service]     Tail logs (router|portal|redis|nginx|patient-xxx)"
    echo ""
    ;;
esac
