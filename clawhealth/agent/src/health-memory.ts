/**
 * Health Memory — Per-Patient Database Layer
 *
 * Uses better-sqlite3 for synchronous, fast, single-file database.
 * Each patient container has its own health.db file.
 *
 * In production, replace with SQLCipher for encryption at rest.
 * For POC, plain SQLite with volume-level encryption is sufficient.
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

export class HealthMemory {
  private dbPath: string;
  private db: Database.Database | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb(): Database.Database {
    if (!this.db) {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS patient (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        date_of_birth TEXT,
        phone TEXT,
        timezone TEXT DEFAULT 'America/New_York',
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patient(id),
        icd10_code TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','resolved','inactive')),
        severity TEXT CHECK(severity IN ('mild','moderate','severe')),
        onset_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patient(id),
        name TEXT NOT NULL,
        generic_name TEXT,
        dose TEXT NOT NULL,
        frequency TEXT NOT NULL,
        route TEXT DEFAULT 'oral',
        prescriber TEXT,
        pharmacy_name TEXT,
        pharmacy_phone TEXT,
        refills_remaining INTEGER,
        next_refill_date TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','discontinued','on_hold')),
        instructions TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS medication_adherence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER REFERENCES medications(id),
        patient_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('taken','missed','skipped','late')),
        reported_at TEXT DEFAULT (datetime('now')),
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS vitals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patient(id),
        type TEXT NOT NULL,
        value_numeric REAL,
        value_text TEXT,
        unit TEXT,
        source TEXT DEFAULT 'manual',
        recorded_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patient(id),
        provider_name TEXT NOT NULL,
        provider_specialty TEXT,
        location TEXT,
        datetime TEXT NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        type TEXT,
        prep_instructions TEXT,
        status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS care_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patient(id),
        condition_id INTEGER REFERENCES conditions(id),
        guideline_source TEXT,
        goals TEXT NOT NULL DEFAULT '[]',
        interventions TEXT NOT NULL DEFAULT '[]',
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
        physician_approved INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
        channel TEXT NOT NULL,
        message TEXT NOT NULL,
        intent TEXT,
        skill_used TEXT,
        flagged_for_physician INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS physician_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','urgent','emergency')),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        acknowledged INTEGER DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        actor TEXT NOT NULL,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_patient ON conversations(patient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_adherence_patient ON medication_adherence(patient_id, reported_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_patient ON physician_alerts(patient_id, acknowledged, created_at DESC);
    `);
  }

  // --- Patient ---

  ensurePatient(patientId: string, firstName?: string, lastName?: string, phone?: string): void {
    const db = this.getDb();
    const existing = db.prepare("SELECT id FROM patient WHERE id = ?").get(patientId);
    if (!existing) {
      db.prepare(
        "INSERT INTO patient (id, first_name, last_name, phone) VALUES (?, ?, ?, ?)"
      ).run(patientId, firstName || "", lastName || "", phone || "");
    }
  }

  // --- Context Loading ---

  async loadPatientContext(patientId: string): Promise<{
    patient: { firstName: string; lastName: string; dateOfBirth: string; timezone: string };
    conditions: Array<{ description: string; icd10Code: string; status: string; severity?: string }>;
    medications: Array<{ name: string; dose: string; frequency: string; instructions?: string; status?: string }>;
    recentVitals: Array<{ type: string; value: string; recordedAt: string }>;
    carePlan: { goals: string[]; interventions: string[]; guidelineSource: string } | null;
    physicianName: string;
  }> {
    const db = this.getDb();

    const patient = db.prepare("SELECT * FROM patient WHERE id = ?").get(patientId) as Record<string, unknown> | undefined;

    const conditions = (db.prepare(
      "SELECT icd10_code, description, status, severity FROM conditions WHERE patient_id = ? AND status = 'active'"
    ).all(patientId) as Array<Record<string, unknown>>).map((c) => ({
      icd10Code: c.icd10_code as string,
      description: c.description as string,
      status: c.status as string,
      severity: c.severity as string | undefined,
    }));

    const medications = (db.prepare(
      "SELECT name, dose, frequency, instructions, status FROM medications WHERE patient_id = ? AND status = 'active'"
    ).all(patientId) as Array<Record<string, unknown>>).map((m) => ({
      name: m.name as string,
      dose: m.dose as string,
      frequency: m.frequency as string,
      instructions: m.instructions as string | undefined,
      status: m.status as string | undefined,
    }));

    const recentVitals = (db.prepare(
      "SELECT type, COALESCE(value_text, CAST(value_numeric AS TEXT)) as value, recorded_at FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 20"
    ).all(patientId) as Array<Record<string, unknown>>).map((v) => ({
      type: v.type as string,
      value: v.value as string,
      recordedAt: v.recorded_at as string,
    }));

    const carePlanRow = db.prepare(
      "SELECT guideline_source, goals, interventions FROM care_plans WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
    ).get(patientId) as Record<string, unknown> | undefined;

    let carePlan = null;
    if (carePlanRow) {
      try {
        carePlan = {
          guidelineSource: carePlanRow.guideline_source as string,
          goals: JSON.parse(carePlanRow.goals as string),
          interventions: JSON.parse(carePlanRow.interventions as string),
        };
      } catch {
        carePlan = null;
      }
    }

    return {
      patient: {
        firstName: (patient?.first_name as string) || "",
        lastName: (patient?.last_name as string) || "",
        dateOfBirth: (patient?.date_of_birth as string) || "",
        timezone: (patient?.timezone as string) || "America/New_York",
      },
      conditions,
      medications,
      recentVitals,
      carePlan,
      physicianName: "",
    };
  }

  // --- Conversations ---

  async logConversation(
    patientId: string,
    direction: "inbound" | "outbound",
    channel: string,
    message: string,
    intent?: string,
    skillUsed?: string
  ): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO conversations (patient_id, direction, channel, message, intent, skill_used) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(patientId, direction, channel, message, intent || null, skillUsed || null);
  }

  async getRecentConversations(patientId: string, limit: number): Promise<Array<{
    direction: string; message: string; channel: string; intent: string; createdAt: string;
  }>> {
    const db = this.getDb();
    const rows = db.prepare(
      "SELECT direction, message, channel, intent, created_at FROM conversations WHERE patient_id = ? ORDER BY created_at DESC LIMIT ?"
    ).all(patientId, limit) as Array<Record<string, unknown>>;

    return rows.reverse().map((r) => ({
      direction: r.direction as string,
      message: r.message as string,
      channel: r.channel as string,
      intent: r.intent as string,
      createdAt: r.created_at as string,
    }));
  }

  // --- Alerts ---

  async createAlert(
    patientId: string,
    alert: { severity: string; category: string; title: string; description: string }
  ): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO physician_alerts (patient_id, severity, category, title, description) VALUES (?, ?, ?, ?, ?)"
    ).run(patientId, alert.severity, alert.category, alert.title, alert.description);
  }

  async getAlerts(patientId: string): Promise<unknown[]> {
    const db = this.getDb();
    return db.prepare(
      "SELECT * FROM physician_alerts WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50"
    ).all(patientId);
  }

  async acknowledgeAlert(alertId: number, by: string): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "UPDATE physician_alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?"
    ).run(by, alertId);
  }

  // --- Medications ---

  async getMedications(patientId: string): Promise<unknown[]> {
    const db = this.getDb();
    return db.prepare(
      "SELECT * FROM medications WHERE patient_id = ? ORDER BY status, name"
    ).all(patientId);
  }

  async logAdherence(patientId: string, medicationId: number, action: string, notes?: string): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO medication_adherence (patient_id, medication_id, action, notes) VALUES (?, ?, ?, ?)"
    ).run(patientId, medicationId, action, notes || null);
  }

  async getAdherenceStats(patientId: string, days: number): Promise<Record<string, unknown>> {
    const db = this.getDb();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const total = db.prepare(
      "SELECT COUNT(*) as count FROM medication_adherence WHERE patient_id = ? AND reported_at >= ?"
    ).get(patientId, cutoff) as { count: number };

    const taken = db.prepare(
      "SELECT COUNT(*) as count FROM medication_adherence WHERE patient_id = ? AND action = 'taken' AND reported_at >= ?"
    ).get(patientId, cutoff) as { count: number };

    const missed = db.prepare(
      "SELECT COUNT(*) as count FROM medication_adherence WHERE patient_id = ? AND action = 'missed' AND reported_at >= ?"
    ).get(patientId, cutoff) as { count: number };

    return {
      days,
      totalEvents: total.count,
      taken: taken.count,
      missed: missed.count,
      adherenceRate: total.count > 0 ? Math.round((taken.count / total.count) * 100) : null,
    };
  }

  // --- Vitals ---

  async recordVitals(
    patientId: string,
    type: string,
    valueText: string,
    valueNumeric: number | null,
    unit: string,
    source: string
  ): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO vitals (patient_id, type, value_text, value_numeric, unit, source, recorded_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run(patientId, type, valueText, valueNumeric, unit, source);
  }

  async getVitals(patientId: string, days: number): Promise<unknown[]> {
    const db = this.getDb();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(
      "SELECT * FROM vitals WHERE patient_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC"
    ).all(patientId, cutoff);
  }

  // --- Appointments ---

  async getAppointments(patientId: string): Promise<unknown[]> {
    const db = this.getDb();
    return db.prepare(
      "SELECT * FROM appointments WHERE patient_id = ? AND status = 'scheduled' ORDER BY datetime ASC"
    ).all(patientId);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
