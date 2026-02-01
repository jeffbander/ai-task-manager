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

import { CREATE_TABLES_SQL, SCHEMA_VERSION } from "./onboarding/schema.js";

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
  private db: any = null;

  constructor(dbPath: string, encryptionKey: string) {
    this.dbPath = dbPath;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Get the raw database instance (for onboarding and direct queries).
   */
  getDb(): any {
    return this.db;
  }

  /**
   * Load the full patient context for the clinical reasoning engine.
   * This assembles the structured health profile that gets injected
   * into the Claude system prompt.
   */
  async loadPatientContext(patientId: string): Promise<PatientContext> {
    if (!this.db) {
      return this.placeholderContext();
    }

    try {
      const patient = this.db.prepare(
        "SELECT * FROM patient WHERE id = ?"
      ).get(patientId);

      if (!patient) return this.placeholderContext();

      const conditions = this.db.prepare(
        "SELECT icd10_code, description, status, severity FROM conditions WHERE patient_id = ? AND status = 'active'"
      ).all(patientId);

      const medications = this.db.prepare(
        "SELECT name, dose, frequency, instructions FROM medications WHERE patient_id = ? AND status = 'active'"
      ).all(patientId);

      const recentVitals = this.db.prepare(
        "SELECT type, value_text as value, recorded_at FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 20"
      ).all(patientId);

      const carePlanRow = this.db.prepare(
        "SELECT goals, interventions, guideline_source FROM care_plans WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      ).get(patientId);

      const recentConversations = this.db.prepare(
        "SELECT direction, message, created_at FROM conversations WHERE patient_id = ? ORDER BY created_at DESC LIMIT 10"
      ).all(patientId);

      // Also load active goals as part of care plan context
      const activeGoals = this.db.prepare(
        "SELECT title FROM patient_goals WHERE patient_id = ? AND status = 'active'"
      ).all(patientId);

      let carePlan: PatientContext["carePlan"] | undefined;
      if (carePlanRow) {
        carePlan = {
          goals: JSON.parse(carePlanRow.goals),
          interventions: JSON.parse(carePlanRow.interventions),
          guidelineSource: carePlanRow.guideline_source || "clinical team",
        };
      } else if (activeGoals.length > 0) {
        // Build care plan from patient goals if no formal care plan exists
        carePlan = {
          goals: activeGoals.map((g: any) => g.title),
          interventions: [],
          guidelineSource: "patient goals",
        };
      }

      return {
        patient: {
          firstName: patient.first_name,
          lastName: patient.last_name,
          dateOfBirth: patient.date_of_birth || "",
          timezone: patient.timezone || "America/New_York",
        },
        conditions: conditions.map((c: any) => ({
          icd10Code: c.icd10_code,
          description: c.description,
          status: c.status,
          severity: c.severity,
        })),
        medications: medications.map((m: any) => ({
          name: m.name,
          dose: m.dose,
          frequency: m.frequency,
          instructions: m.instructions,
        })),
        recentVitals: recentVitals.map((v: any) => ({
          type: v.type,
          value: v.value,
          recordedAt: v.recorded_at,
        })),
        carePlan,
        recentConversations: recentConversations.reverse().map((c: any) => ({
          direction: c.direction,
          message: c.message,
          createdAt: c.created_at,
        })),
        physicianName: process.env.PHYSICIAN_NAME || "your doctor",
      };
    } catch (err) {
      console.error("Failed to load patient context:", err);
      return this.placeholderContext();
    }
  }

  private placeholderContext(): PatientContext {
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
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO conversations (patient_id, channel, direction, message, intent, skill_used)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(patientId, entry.channel, entry.direction, entry.message,
          entry.intent || null, entry.skillUsed || null);
      } catch (err) {
        console.error("Failed to log conversation:", err);
      }
    }
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
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO physician_alerts (patient_id, severity, category, title, description)
          VALUES (?, ?, ?, ?, ?)
        `).run(patientId, alert.severity, alert.category, alert.title, alert.description);
      } catch (err) {
        console.error("Failed to create physician alert:", err);
      }
    }
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
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO medication_adherence (medication_id, action, notes)
          VALUES (?, ?, ?)
        `).run(medicationId, action, notes || null);
      } catch (err) {
        console.error("Failed to log medication adherence:", err);
      }
    }
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
    if (this.db) {
      try {
        this.db.prepare(`
          INSERT INTO vitals (patient_id, type, value_text, source)
          VALUES (?, ?, ?, ?)
        `).run(patientId, type, value, source);
      } catch (err) {
        console.error("Failed to record vitals:", err);
      }
    }
    console.log(`[VITALS] ${patientId}: ${type} = ${value} (${source})`);
  }

  /**
   * Initialize the database schema.
   * Called during patient onboarding or on first boot.
   */
  async initialize(): Promise<void> {
    console.log(`Initializing health memory at ${this.dbPath}`);

    try {
      const Database = (await import("better-sqlite3")).default;
      this.db = new Database(this.dbPath);

      // Enable encryption if SQLCipher is available
      try {
        this.db.pragma(`key='${this.encryptionKey}'`);
      } catch {
        // SQLCipher not available — continue with plain SQLite
      }

      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");

      // Create all tables
      this.db.exec(CREATE_TABLES_SQL);

      // Track schema version
      const currentVersion = this.db.prepare(
        "SELECT MAX(version) as v FROM schema_version"
      ).get();
      if (!currentVersion || currentVersion.v < SCHEMA_VERSION) {
        this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      }

      console.log(`Health memory initialized (schema v${SCHEMA_VERSION})`);
    } catch (err) {
      console.error("Failed to initialize health memory:", err);
      console.log("Running without database — limited functionality");
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
