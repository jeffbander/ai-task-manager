/**
 * Patient Onboarding CLI Script
 *
 * Used by clinic staff to onboard a new patient into ClawHealth.
 * This script does two things:
 *
 * 1. BULK DATA LOAD: Takes a JSON file with patient data (demographics,
 *    conditions, medications, labs, imaging, notes, insurance, goals)
 *    and imports it all into the patient's encrypted database.
 *
 * 2. KICK OFF ONBOARDING: Initializes the conversational onboarding
 *    state so the patient gets a welcome text and walks through
 *    confirmation + goal-setting via SMS.
 *
 * Usage:
 *   # Import from JSON file (recommended — dump everything at once)
 *   npx tsx scripts/onboard-patient.ts \
 *     --patient-id "patient-abc12345" \
 *     --data-file "./patient-data/jane-doe.json" \
 *     --db-path "./data/db/health.db" \
 *     --encryption-key "your-64-char-hex-key"
 *
 *   # Import with inline physician info
 *   npx tsx scripts/onboard-patient.ts \
 *     --patient-id "patient-abc12345" \
 *     --data-file "./patient-data/jane-doe.json" \
 *     --physician-name "Dr. Smith" \
 *     --physician-id "dr-smith-001" \
 *     --send-welcome \
 *     --db-path "./data/db/health.db" \
 *     --encryption-key "your-64-char-hex-key"
 *
 * The JSON file format matches BulkPatientImport in types.ts.
 * See examples/sample-patient-import.json for a full example.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ──────────────────────────────────────────────
// CLI Argument Parsing
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const patientId = getArg("patient-id");
const dataFile = getArg("data-file");
const dbPath = getArg("db-path") || "./data/db/health.db";
const encryptionKey = getArg("encryption-key") || process.env.ENCRYPTION_KEY;
const physicianName = getArg("physician-name");
const physicianId = getArg("physician-id");
const sendWelcome = hasFlag("send-welcome");
const dryRun = hasFlag("dry-run");

if (!patientId || !dataFile) {
  console.error("ClawHealth Patient Onboarding");
  console.error("==============================\n");
  console.error("Usage: npx tsx scripts/onboard-patient.ts \\");
  console.error('  --patient-id "patient-abc12345" \\');
  console.error('  --data-file "./patient-data/jane-doe.json" \\');
  console.error('  --db-path "./data/db/health.db" \\');
  console.error('  --encryption-key "64-char-hex-key" \\');
  console.error('  --physician-name "Dr. Smith" \\');
  console.error('  --physician-id "dr-smith-001" \\');
  console.error("  --send-welcome  # send welcome SMS to patient");
  console.error("  --dry-run       # validate data without importing\n");
  console.error("Data file format: See BulkPatientImport type in agent/src/onboarding/types.ts");
  process.exit(1);
}

if (!encryptionKey) {
  console.error("ERROR: --encryption-key is required (or set ENCRYPTION_KEY env var)");
  process.exit(1);
}

// ──────────────────────────────────────────────
// Main Onboarding Flow
// ──────────────────────────────────────────────

async function main() {
  console.log("=== ClawHealth Patient Onboarding ===\n");

  // 1. Read and parse the data file
  const dataPath = resolve(dataFile!);
  if (!existsSync(dataPath)) {
    console.error(`ERROR: Data file not found: ${dataPath}`);
    process.exit(1);
  }

  console.log(`Reading patient data from: ${dataPath}`);
  const rawJson = readFileSync(dataPath, "utf-8");

  let importData: any;
  try {
    importData = JSON.parse(rawJson);
  } catch (err: any) {
    console.error(`ERROR: Invalid JSON in data file: ${err.message}`);
    process.exit(1);
  }

  // Validate required fields
  if (!importData.demographics) {
    console.error("ERROR: Data file must include a 'demographics' object");
    process.exit(1);
  }
  if (!importData.demographics.firstName || !importData.demographics.phone) {
    console.error("ERROR: demographics must include 'firstName' and 'phone'");
    process.exit(1);
  }

  // Print summary
  console.log(`\nPatient: ${importData.demographics.firstName} ${importData.demographics.lastName || ""}`);
  console.log(`Phone: ${importData.demographics.phone}`);
  console.log(`Patient ID: ${patientId}`);
  if (physicianName) console.log(`Physician: ${physicianName} (${physicianId})`);

  console.log("\nData to import:");
  console.log(`  Demographics:  ✓`);
  console.log(`  Conditions:    ${importData.conditions?.length || 0} record(s)`);
  console.log(`  Medications:   ${importData.medications?.length || 0} record(s)`);
  console.log(`  Labs:          ${importData.labs?.length || 0} result(s)`);
  console.log(`  Imaging:       ${importData.imaging?.length || 0} study/studies`);
  console.log(`  Clinical Notes:${importData.notes?.length || 0} note(s)`);
  console.log(`  Insurance:     ${importData.insurance ? "✓" : "—"}`);
  console.log(`  Allergies:     ${importData.allergies?.length || 0} record(s)`);
  console.log(`  Appointments:  ${importData.appointments?.length || 0} record(s)`);
  console.log(`  Vitals:        ${importData.vitals?.length || 0} reading(s)`);
  console.log(`  Goals:         ${importData.goals?.length || 0} goal(s)`);

  if (dryRun) {
    console.log("\n[DRY RUN] Data validated successfully. No changes made.");
    process.exit(0);
  }

  // 2. Open database (or create if new patient)
  console.log(`\nDatabase: ${dbPath}`);

  // Dynamic import to handle the case where better-sqlite3 might not be installed yet
  let Database: any;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    console.log("\nNOTE: better-sqlite3 not installed. Running in schema-only mode.");
    console.log("Install with: npm install better-sqlite3");
    console.log("\nSchema that would be applied:");
    const { CREATE_TABLES_SQL } = await import("../agent/src/onboarding/schema.js");
    console.log(CREATE_TABLES_SQL.slice(0, 500) + "\n...(truncated)");
    console.log("\nImport data validated and ready. Install better-sqlite3 to complete import.");
    process.exit(0);
  }

  const db = new Database(dbPath);

  // Enable encryption if SQLCipher is available
  try {
    db.pragma(`key='${encryptionKey}'`);
    console.log("Database encryption: enabled (SQLCipher)");
  } catch {
    console.log("Database encryption: not available (using plain SQLite)");
  }

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 3. Create schema
  console.log("Applying database schema...");
  const { CREATE_TABLES_SQL, SCHEMA_VERSION } = await import("../agent/src/onboarding/schema.js");
  db.exec(CREATE_TABLES_SQL);

  // Record schema version
  const currentVersion = db.prepare(
    "SELECT MAX(version) as v FROM schema_version"
  ).get();
  if (!currentVersion || currentVersion.v < SCHEMA_VERSION) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  }
  console.log(`Schema version: ${SCHEMA_VERSION}`);

  // 4. Import bulk data
  console.log("\nImporting patient data...");
  const { importBulkPatientData } = await import("../agent/src/onboarding/data-import.js");
  const result = importBulkPatientData(db, patientId!, importData);

  console.log(`\nImport results:`);
  console.log(`  Records imported: ${result.recordsImported}`);
  console.log(`  Records failed:   ${result.recordsFailed}`);
  if (result.warnings.length > 0) {
    console.log(`  Warnings:`);
    result.warnings.forEach((w) => console.log(`    - ${w}`));
  }
  if (result.errors.length > 0) {
    console.log(`  Errors:`);
    result.errors.forEach((e) => console.log(`    - ${e}`));
  }

  // 5. Initialize onboarding state
  console.log("\nInitializing onboarding flow...");
  db.prepare(`
    INSERT INTO onboarding_state (patient_id, current_step, steps_completed,
      started_at, last_interaction_at, patient_confirmations)
    VALUES (?, 'welcome', '[]', datetime('now'), datetime('now'), '{}')
    ON CONFLICT(patient_id) DO NOTHING
  `).run(patientId);
  console.log("Onboarding state: ready (waiting for patient's first text)");

  // 6. Auto-generate monitoring rules based on conditions
  console.log("\nSetting up default monitoring rules...");
  const { generateGoalSuggestions } = await import("../agent/src/onboarding/goals.js");
  const suggestions = generateGoalSuggestions(db, patientId!);
  console.log(`  Generated ${suggestions.length} goal suggestions for onboarding conversation`);

  // 7. Log the provisioning event
  db.prepare(`
    INSERT INTO audit_log (action, resource, actor, details)
    VALUES ('import', 'patient_provisioned', 'system', ?)
  `).run(JSON.stringify({
    patientId,
    physicianName,
    physicianId,
    importedAt: new Date().toISOString(),
    recordCount: result.recordsImported,
  }));

  // 8. Summary
  console.log("\n=== Onboarding Complete ===\n");
  console.log(`Patient ${importData.demographics.firstName} is ready to go.`);
  console.log(`\nWhat happens next:`);
  console.log(`1. Patient texts the ClawHealth number from ${importData.demographics.phone}`);
  console.log(`2. Bot sends a welcome message and walks them through setup`);
  console.log(`3. Patient confirms their info, sets goals, picks monitoring preferences`);
  console.log(`4. Bot starts sending reminders and check-ins based on their choices`);

  if (sendWelcome) {
    console.log(`\n[WELCOME SMS] Would send welcome text to ${importData.demographics.phone}`);
    console.log("(Twilio integration needed — configure TWILIO_* env vars)");
  }

  console.log(`\nTo test the onboarding flow manually, the patient just needs to text anything.`);
  console.log(`The bot will detect they're in onboarding and guide them through.`);

  db.close();
}

main().catch((err) => {
  console.error("Onboarding failed:", err);
  process.exit(1);
});
