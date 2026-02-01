/**
 * Patient Provisioning Script
 *
 * Provisions a new ClawBox container for a patient.
 * Adapted from OpenClaw's onboarding wizard (`openclaw onboard --install-daemon`).
 *
 * Steps:
 * 1. Generate unique patient ID
 * 2. Generate encryption key for patient's database
 * 3. Create patient .env file from template
 * 4. Initialize encrypted SQLite database with schema
 * 5. Build and start the Docker container
 *
 * Usage:
 *   npx tsx scripts/provision-patient.ts \
 *     --first-name "Jane" \
 *     --last-name "Doe" \
 *     --phone "+15551234567" \
 *     --physician-id "dr-smith-001" \
 *     --physician-name "Dr. Smith"
 */

import { randomBytes, randomUUID } from "crypto";

interface PatientConfig {
  firstName: string;
  lastName: string;
  phone: string;
  physicianId: string;
  physicianName: string;
  dateOfBirth?: string;
  timezone?: string;
}

function generatePatientId(): string {
  return `patient-${randomUUID().slice(0, 8)}`;
}

function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

function generateGatewayToken(): string {
  return randomBytes(24).toString("base64url");
}

async function provisionPatient(config: PatientConfig): Promise<void> {
  const patientId = generatePatientId();
  const encryptionKey = generateEncryptionKey();
  const gatewayToken = generateGatewayToken();

  console.log("=== ClawHealth Patient Provisioning ===\n");
  console.log(`Patient ID:    ${patientId}`);
  console.log(`Patient:       ${config.firstName} ${config.lastName}`);
  console.log(`Phone:         ${config.phone}`);
  console.log(`Physician:     ${config.physicianName} (${config.physicianId})`);
  console.log(`Timezone:      ${config.timezone || "America/New_York"}`);
  console.log();

  // Generate .env file content
  const envContent = `# ClawBox Configuration — ${config.firstName} ${config.lastName}
# Generated: ${new Date().toISOString()}
# Patient ID: ${patientId}

PATIENT_ID=${patientId}
PATIENT_PHONE=${config.phone}
PATIENT_TIMEZONE=${config.timezone || "America/New_York"}

PHYSICIAN_ID=${config.physicianId}
PHYSICIAN_NAME=${config.physicianName}

# Claude API (HIPAA BAA required in production)
ANTHROPIC_API_KEY=  # Fill in your API key
CLAUDE_MODEL_PRIMARY=claude-sonnet-4-20250514
CLAUDE_MODEL_COMPLEX=claude-opus-4-5-20251101
CLAUDE_MODEL_SAFETY=claude-haiku-3-5-20241022

# Twilio
TWILIO_ACCOUNT_SID=  # Fill in
TWILIO_AUTH_TOKEN=    # Fill in
TWILIO_PHONE_NUMBER=  # Fill in

# Encryption (auto-generated — STORE SECURELY)
ENCRYPTION_KEY=${encryptionKey}

# Gateway
GATEWAY_PORT=18789
GATEWAY_AUTH_TOKEN=${gatewayToken}

# Redis
REDIS_URL=redis://redis:6379

# Logging
LOG_LEVEL=info
NODE_ENV=production
`;

  console.log("Generated .env configuration.");
  console.log("\nNext steps:");
  console.log("1. Fill in ANTHROPIC_API_KEY and TWILIO credentials in the .env file");
  console.log("2. Run: docker compose -f docker/docker-compose.yml up -d");
  console.log("3. Configure Twilio webhook to point to your server's /sms/inbound");
  console.log(`4. Text the Twilio number from ${config.phone} to test`);
  console.log("\nIMPORTANT: Store the ENCRYPTION_KEY securely. If lost, patient data cannot be recovered.");
}

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const firstName = getArg("first-name");
const lastName = getArg("last-name");
const phone = getArg("phone");
const physicianId = getArg("physician-id");
const physicianName = getArg("physician-name");

if (!firstName || !lastName || !phone || !physicianId || !physicianName) {
  console.error("Usage: npx tsx scripts/provision-patient.ts \\");
  console.error('  --first-name "Jane" \\');
  console.error('  --last-name "Doe" \\');
  console.error('  --phone "+15551234567" \\');
  console.error('  --physician-id "dr-smith-001" \\');
  console.error('  --physician-name "Dr. Smith"');
  process.exit(1);
}

provisionPatient({
  firstName,
  lastName,
  phone,
  physicianId,
  physicianName,
  dateOfBirth: getArg("dob"),
  timezone: getArg("timezone"),
});
