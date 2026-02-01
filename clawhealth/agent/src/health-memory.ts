/**
 * Health Memory
 *
 * Adapted from OpenClaw's persistent memory system. OpenClaw stores
 * context as local Markdown files in ~/.openclaw/. ClawHealth needs
 * structured clinical data with encryption, so we use SQLCipher
 * (encrypted SQLite) for the health record and ChromaDB for RAG.
 *
 * This is the patient's Personal Health Record (PHR) — the core data
 * store that makes the ClawBox valuable over time.
 */

interface PatientAlert {
  severity: "info" | "warning" | "urgent" | "emergency";
  category: string;
  title: string;
  description: string;
}

interface ConversationEntry {
  channel: string;
  direction: "inbound" | "outbound";
  message: string;
  intent?: string;
  skillUsed?: string;
}

interface PatientContext {
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    timezone: string;
  };
  conditions: Array<{
    icd10Code: string;
    description: string;
    status: string;
    severity?: string;
  }>;
  medications: Array<{
    name: string;
    dose: string;
    frequency: string;
    instructions?: string;
  }>;
  recentVitals: Array<{
    type: string;
    value: string;
    recordedAt: string;
  }>;
  carePlan?: {
    goals: string[];
    interventions: string[];
    guidelineSource: string;
  };
  recentConversations: Array<{
    direction: string;
    message: string;
    createdAt: string;
  }>;
  physicianName: string;
}

export class HealthMemory {
  private dbPath: string;
  private encryptionKey: string;

  constructor(dbPath: string, encryptionKey: string) {
    this.dbPath = dbPath;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Load the full patient context for the clinical reasoning engine.
   * This assembles the structured health profile that gets injected
   * into the Claude system prompt.
   */
  async loadPatientContext(patientId: string): Promise<PatientContext> {
    // TODO: Implement with better-sqlite3 + SQLCipher
    // For MVP, return a placeholder that will be populated during onboarding

    return {
      patient: {
        firstName: "Patient",
        lastName: "",
        dateOfBirth: "",
        timezone: "America/New_York",
      },
      conditions: [],
      medications: [],
      recentVitals: [],
      recentConversations: [],
      physicianName: process.env.PHYSICIAN_NAME || "your doctor",
    };
  }

  /**
   * Log a conversation turn (inbound or outbound).
   * Used for context continuity and physician review.
   */
  async logConversation(
    patientId: string,
    entry: ConversationEntry
  ): Promise<void> {
    // TODO: INSERT INTO conversations table
    // For now, log to console
    console.log(`[${patientId}] ${entry.direction}: ${entry.message.slice(0, 100)}`);
  }

  /**
   * Create a physician alert.
   * These show up on the Doctor Portal dashboard.
   */
  async createPhysicianAlert(
    patientId: string,
    alert: PatientAlert
  ): Promise<void> {
    // TODO: INSERT INTO physician_alerts table
    console.log(
      `[ALERT:${alert.severity}] ${patientId}: ${alert.title} — ${alert.description}`
    );
  }

  /**
   * Record a medication adherence event.
   */
  async logMedicationAdherence(
    medicationId: number,
    action: "taken" | "missed" | "skipped" | "late",
    notes?: string
  ): Promise<void> {
    // TODO: INSERT INTO medication_adherence table
    console.log(`[MED] ${medicationId}: ${action}${notes ? ` — ${notes}` : ""}`);
  }

  /**
   * Record a vitals reading.
   */
  async recordVitals(
    patientId: string,
    type: string,
    value: string,
    source: string
  ): Promise<void> {
    // TODO: INSERT INTO vitals table
    console.log(`[VITALS] ${patientId}: ${type} = ${value} (${source})`);
  }

  /**
   * Initialize the database schema.
   * Called during patient onboarding.
   */
  async initialize(): Promise<void> {
    // TODO: Create all tables from the schema in ARCHITECTURE.md
    // using better-sqlite3 with SQLCipher encryption
    console.log(`Initializing health memory at ${this.dbPath}`);
  }
}
