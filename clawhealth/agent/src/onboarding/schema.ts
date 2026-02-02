/**
 * Database Schema — Full Patient Onboarding
 *
 * Extends the base ClawHealth schema with tables for:
 * - Labs results
 * - Imaging studies
 * - Clinical notes
 * - Insurance information
 * - Allergies
 * - Patient goals & monitoring rules
 * - Onboarding state tracking
 * - Bulk data imports
 *
 * All tables use SQLCipher encryption at rest.
 * Schema follows FHIR R4 concepts where practical.
 */

export const SCHEMA_VERSION = 2;

/**
 * Full database schema DDL.
 * Called during HealthMemory.initialize() to create all tables.
 */
export const CREATE_TABLES_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Core Patient ───────────────────────────
CREATE TABLE IF NOT EXISTS patient (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  language TEXT DEFAULT 'en',
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Conditions / Diagnoses ─────────────────
CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  icd10_code TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','inactive')),
  severity TEXT CHECK(severity IN ('mild','moderate','severe')),
  onset_date TEXT,
  resolved_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Medications ────────────────────────────
CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  name TEXT NOT NULL,
  generic_name TEXT,
  dose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  route TEXT,
  prescriber TEXT,
  start_date TEXT,
  pharmacy_name TEXT,
  pharmacy_phone TEXT,
  refills_remaining INTEGER,
  next_refill_date TEXT,
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','discontinued','on_hold')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Medication Adherence ───────────────────
CREATE TABLE IF NOT EXISTS medication_adherence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications(id),
  scheduled_time TEXT,
  action TEXT NOT NULL CHECK(action IN ('taken','missed','skipped','late')),
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

-- ─── Vitals ─────────────────────────────────
CREATE TABLE IF NOT EXISTS vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  type TEXT NOT NULL,
  value_numeric REAL,
  value_text TEXT,
  unit TEXT,
  source TEXT DEFAULT 'manual',
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Lab Results ────────────────────────────
CREATE TABLE IF NOT EXISTS labs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  test_name TEXT NOT NULL,
  test_code TEXT,
  value TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  flag TEXT CHECK(flag IN ('normal','low','high','critical')),
  panel_name TEXT,
  ordered_by TEXT,
  collected_at TEXT NOT NULL,
  resulted_at TEXT,
  lab_facility TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_labs_patient ON labs(patient_id);
CREATE INDEX IF NOT EXISTS idx_labs_test ON labs(test_name);
CREATE INDEX IF NOT EXISTS idx_labs_collected ON labs(collected_at);

-- ─── Imaging Studies ────────────────────────
CREATE TABLE IF NOT EXISTS imaging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  study_type TEXT NOT NULL,
  body_part TEXT NOT NULL,
  modality TEXT NOT NULL CHECK(modality IN ('xray','ct','mri','ultrasound','pet','dexa','mammogram','other')),
  indication TEXT,
  findings TEXT,
  impression TEXT,
  ordered_by TEXT,
  performed_at TEXT NOT NULL,
  facility TEXT,
  radiologist TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('ordered','scheduled','completed','cancelled')),
  follow_up_needed INTEGER DEFAULT 0,
  follow_up_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_imaging_patient ON imaging(patient_id);
CREATE INDEX IF NOT EXISTS idx_imaging_performed ON imaging(performed_at);

-- ─── Clinical Notes ─────────────────────────
CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  note_type TEXT NOT NULL CHECK(note_type IN ('progress','hpi','discharge','consult','procedure','phone','telehealth','other')),
  author TEXT NOT NULL,
  author_role TEXT,
  content TEXT NOT NULL,
  summary TEXT,
  date_of_service TEXT NOT NULL,
  diagnoses TEXT,
  plan_items TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_notes_date ON clinical_notes(date_of_service);

-- ─── Insurance ──────────────────────────────
CREATE TABLE IF NOT EXISTS insurance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  tier TEXT NOT NULL CHECK(tier IN ('primary','secondary')),
  payer_name TEXT NOT NULL,
  plan_name TEXT,
  member_id TEXT NOT NULL,
  group_number TEXT,
  subscriber_name TEXT,
  subscriber_relationship TEXT CHECK(subscriber_relationship IN ('self','spouse','child','other')),
  effective_date TEXT,
  termination_date TEXT,
  copay TEXT,
  deductible TEXT,
  deductible_met TEXT,
  out_of_pocket_max TEXT,
  out_of_pocket_met TEXT,
  phone TEXT,
  has_referral_requirement INTEGER DEFAULT 0,
  prior_auth_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_patient ON insurance(patient_id);

-- ─── Allergies ──────────────────────────────
CREATE TABLE IF NOT EXISTS allergies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  allergen TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('drug','food','environmental','other')),
  reaction TEXT,
  severity TEXT CHECK(severity IN ('mild','moderate','severe','life_threatening')),
  onset_date TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Appointments ───────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  provider_name TEXT NOT NULL,
  provider_specialty TEXT,
  location TEXT,
  datetime TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  type TEXT DEFAULT 'follow_up' CHECK(type IN ('follow_up','annual','procedure','lab_work','imaging','therapy','other')),
  reason TEXT,
  prep_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_datetime ON appointments(datetime);

-- ─── Care Plans ─────────────────────────────
CREATE TABLE IF NOT EXISTS care_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  condition_id INTEGER REFERENCES conditions(id),
  guideline_source TEXT,
  goals TEXT NOT NULL,
  interventions TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','paused')),
  physician_approved INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Patient Goals ──────────────────────────
CREATE TABLE IF NOT EXISTS patient_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  category TEXT NOT NULL CHECK(category IN (
    'medication_adherence','vitals_monitoring','activity','diet',
    'symptom_management','appointment_compliance','weight_management',
    'lab_targets','custom'
  )),
  title TEXT NOT NULL,
  description TEXT,
  target_value TEXT,
  target_unit TEXT,
  current_value TEXT,
  frequency TEXT,
  start_date TEXT NOT NULL,
  target_date TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','achieved','paused','abandoned')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  check_in_schedule TEXT,
  last_check_in TEXT,
  progress_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goals_patient ON patient_goals(patient_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON patient_goals(status);

-- ─── Goal Check-In Log ──────────────────────
CREATE TABLE IF NOT EXISTS goal_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES patient_goals(id),
  patient_id TEXT NOT NULL REFERENCES patient(id),
  value TEXT,
  notes TEXT,
  status TEXT CHECK(status IN ('on_track','behind','ahead','needs_attention')),
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkins_goal ON goal_checkins(goal_id);

-- ─── Monitoring Rules ───────────────────────
CREATE TABLE IF NOT EXISTS monitoring_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  goal_id INTEGER REFERENCES patient_goals(id),
  type TEXT NOT NULL CHECK(type IN (
    'vitals_threshold','medication_adherence','appointment_reminder',
    'daily_checkin','lab_due','goal_checkin'
  )),
  config TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Onboarding State ───────────────────────
CREATE TABLE IF NOT EXISTS onboarding_state (
  patient_id TEXT PRIMARY KEY REFERENCES patient(id),
  current_step TEXT NOT NULL DEFAULT 'welcome',
  steps_completed TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_interaction_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  patient_confirmations TEXT NOT NULL DEFAULT '{}'
);

-- ─── Data Imports Log ───────────────────────
CREATE TABLE IF NOT EXISTS data_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  import_type TEXT NOT NULL CHECK(import_type IN (
    'bulk','labs','imaging','notes','insurance','medications','conditions',
    'allergies','vitals','appointments','goals','ehr_sync'
  )),
  source TEXT,
  record_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
  error_message TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Conversations ──────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  channel TEXT DEFAULT 'sms' CHECK(channel IN ('sms','whatsapp','voice','app')),
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  message TEXT NOT NULL,
  intent TEXT,
  skill_used TEXT,
  flagged_for_physician INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_patient ON conversations(patient_id);

-- ─── Physician Alerts ───────────────────────
CREATE TABLE IF NOT EXISTS physician_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','urgent','emergency')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  acknowledged INTEGER DEFAULT 0,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Audit Log ──────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK(action IN ('read','write','delete','export','share','import')),
  resource TEXT NOT NULL,
  actor TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource);
`;
