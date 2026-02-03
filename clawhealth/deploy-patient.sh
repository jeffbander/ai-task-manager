#!/bin/bash

# ClawHealth Patient Deployment Script
# Creates isolated ClawBox for a new patient

set -e

PATIENT_ID="$1"
PATIENT_NAME="$2"
PATIENT_PHONE="$3"
PHYSICIAN_NAME="${4:-Dr. Jeffrey Bander, MD}"

if [ -z "$PATIENT_ID" ] || [ -z "$PATIENT_NAME" ] || [ -z "$PATIENT_PHONE" ]; then
    echo "Usage: $0 <patient_id> <patient_name> <patient_phone> [physician_name]"
    echo "Example: $0 patient_001 'John Smith' '+15551234567' 'Dr. Jeffrey Bander, MD'"
    exit 1
fi

echo "🏥 Deploying ClawBox for patient: $PATIENT_NAME"
echo "📱 Phone: $PATIENT_PHONE"
echo "👨‍⚕️ Physician: $PHYSICIAN_NAME"

# Create patient-specific environment
PATIENT_DIR="deployments/patient-$PATIENT_ID"
mkdir -p "$PATIENT_DIR"

# Copy base docker-compose and customize
cp docker/docker-compose.yml "$PATIENT_DIR/"

# Create patient-specific .env file
cat > "$PATIENT_DIR/.env" << EOF
# Patient Configuration
PATIENT_ID=$PATIENT_ID
PATIENT_PHONE=$PATIENT_PHONE
PATIENT_TIMEZONE=America/New_York

# Physician Configuration  
PHYSICIAN_ID=dr_bander_001
PHYSICIAN_NAME=$PHYSICIAN_NAME

# Anthropic (using ClawdBot OAuth - will be configured)
ANTHROPIC_API_KEY=will_be_configured
CLAUDE_MODEL_PRIMARY=claude-sonnet-4-20250514
CLAUDE_MODEL_COMPLEX=claude-opus-4-5-20251101
CLAUDE_MODEL_SAFETY=claude-haiku-3-5-20241022

# Twilio (SMS + Voice) 
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-YOUR_TWILIO_SID}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-YOUR_TWILIO_AUTH}
TWILIO_PHONE_NUMBER=${TWILIO_PHONE_NUMBER:-YOUR_TWILIO_PHONE}

# Database Encryption (unique per patient)
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Gateway (unique port per patient)
GATEWAY_PORT=$((19000 + ${PATIENT_ID#patient_}))
GATEWAY_AUTH_TOKEN=$(openssl rand -hex 16)

# Redis
REDIS_URL=redis://redis:6379

# Doctor Portal
PORTAL_PORT=5000
PORTAL_SECRET_KEY=$(openssl rand -hex 24)

# Logging
LOG_LEVEL=info
NODE_ENV=production
EOF

echo "✅ Created patient environment: $PATIENT_DIR"
echo "🐳 Starting ClawBox containers..."

# Deploy the patient's ClawBox
cd "$PATIENT_DIR"
docker compose up -d

echo "🚀 ClawBox deployed successfully!"
echo ""
echo "📊 Patient Dashboard: http://localhost:$((19000 + ${PATIENT_ID#patient_}))/health"
echo "📱 SMS Endpoint: http://localhost:$((19000 + ${PATIENT_ID#patient_}))/sms/inbound"
echo "📁 Patient Data: $PATIENT_DIR"
echo ""
echo "Next steps:"
echo "1. Configure Twilio webhook to point to SMS endpoint"
echo "2. Add patient medications and care plan via portal"
echo "3. Send test SMS to $PATIENT_PHONE"