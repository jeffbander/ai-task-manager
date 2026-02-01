/**
 * Bulk Data Import System
 *
 * Lets clinic staff dump a ton of patient data in one shot:
 * - Lab results (CBC, BMP, lipids, A1C, etc.)
 * - Imaging reports (CT, MRI, X-ray, etc.)
 * - Clinical notes (progress notes, discharge summaries, consults)
 * - Insurance info (primary/secondary plans, copays, auth requirements)
 * - Conditions, medications, allergies, vitals, appointments
 *
 * Accepts JSON objects matching the import types defined in types.ts.
 * Each import is logged in the data_imports table for audit trail.
 *
 * Design principle: Accept messy real-world data. Parse what we can,
 * flag what needs human review. Never reject a whole import because
 * one field is weird.
 */

import type {
  BulkPatientImport,
  LabImport,
  ImagingImport,
  ClinicalNoteImport,
  InsuranceImport,
  ConditionImport,
  MedicationImport,
  AllergyImport,
  AppointmentImport,
  VitalImport,
  GoalImport,
} from "./types.js";

export interface ImportResult {
  success: boolean;
  importId?: number;
  recordsImported: number;
  recordsFailed: number;
  errors: string[];
  warnings: string[];
}

/**
 * Import all patient data in one bulk operation.
 * This is the main entry point for clinic staff to load patient records.
 *
 * @param db - better-sqlite3 Database instance (already opened with encryption)
 * @param patientId - the patient's unique ID
 * @param data - full bulk import payload
 */
export function importBulkPatientData(
  db: any,
  patientId: string,
  data: BulkPatientImport
): ImportResult {
  const result: ImportResult = {
    success: true,
    recordsImported: 0,
    recordsFailed: 0,
    errors: [],
    warnings: [],
  };

  const importLog = db.prepare(`
    INSERT INTO data_imports (patient_id, import_type, source, record_count, status)
    VALUES (?, 'bulk', 'clinic_import', 0, 'processing')
  `);
  const { lastInsertRowid } = importLog.run(patientId);
  result.importId = Number(lastInsertRowid);

  // Run everything in a transaction for atomicity
  const transaction = db.transaction(() => {
    // Demographics — upsert the patient record
    if (data.demographics) {
      const d = data.demographics;
      db.prepare(`
        INSERT INTO patient (id, first_name, last_name, date_of_birth, phone, email,
          address_street, address_city, address_state, address_zip,
          timezone, language, emergency_contact_name, emergency_contact_phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          first_name=excluded.first_name, last_name=excluded.last_name,
          date_of_birth=excluded.date_of_birth, phone=excluded.phone,
          email=excluded.email, address_street=excluded.address_street,
          address_city=excluded.address_city, address_state=excluded.address_state,
          address_zip=excluded.address_zip, timezone=excluded.timezone,
          language=excluded.language, emergency_contact_name=excluded.emergency_contact_name,
          emergency_contact_phone=excluded.emergency_contact_phone,
          updated_at=datetime('now')
      `).run(
        patientId, d.firstName, d.lastName, d.dateOfBirth || null, d.phone,
        d.email || null, d.address?.street || null, d.address?.city || null,
        d.address?.state || null, d.address?.zip || null,
        d.timezone || "America/New_York", d.language || "en",
        d.emergencyContactName || null, d.emergencyContactPhone || null
      );
      result.recordsImported++;
    }

    // Conditions
    if (data.conditions?.length) {
      const r = importConditions(db, patientId, data.conditions);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Medications
    if (data.medications?.length) {
      const r = importMedications(db, patientId, data.medications);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Labs
    if (data.labs?.length) {
      const r = importLabs(db, patientId, data.labs);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Imaging
    if (data.imaging?.length) {
      const r = importImaging(db, patientId, data.imaging);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Clinical Notes
    if (data.notes?.length) {
      const r = importNotes(db, patientId, data.notes);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Insurance
    if (data.insurance) {
      const r = importInsurance(db, patientId, data.insurance);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Allergies
    if (data.allergies?.length) {
      const r = importAllergies(db, patientId, data.allergies);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Appointments
    if (data.appointments?.length) {
      const r = importAppointments(db, patientId, data.appointments);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Vitals
    if (data.vitals?.length) {
      const r = importVitals(db, patientId, data.vitals);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Goals
    if (data.goals?.length) {
      const r = importGoals(db, patientId, data.goals);
      result.recordsImported += r.imported;
      result.recordsFailed += r.failed;
      result.warnings.push(...r.warnings);
    }

    // Update import log
    db.prepare(`
      UPDATE data_imports SET record_count = ?, status = 'completed'
      WHERE id = ?
    `).run(result.recordsImported, result.importId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (action, resource, actor, details)
      VALUES ('import', 'bulk_patient_data', 'system',
        'Imported ' || ? || ' records for patient ' || ?)
    `).run(result.recordsImported, patientId);
  });

  try {
    transaction();
  } catch (err: any) {
    result.success = false;
    result.errors.push(`Transaction failed: ${err.message}`);
    db.prepare(`
      UPDATE data_imports SET status = 'failed', error_message = ? WHERE id = ?
    `).run(err.message, result.importId);
  }

  return result;
}

// ──────────────────────────────────────────────
// Individual import functions
// ──────────────────────────────────────────────

interface SubImportResult {
  imported: number;
  failed: number;
  warnings: string[];
}

function importConditions(db: any, patientId: string, items: ConditionImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO conditions (patient_id, icd10_code, description, status, severity, onset_date, resolved_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of items) {
    try {
      stmt.run(patientId, c.icd10Code, c.description, c.status || "active",
        c.severity || null, c.onsetDate || null, c.resolvedDate || null, c.notes || null);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Condition "${c.description}": ${err.message}`);
    }
  }
  return r;
}

function importMedications(db: any, patientId: string, items: MedicationImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO medications (patient_id, name, generic_name, dose, frequency, route,
      prescriber, start_date, pharmacy_name, pharmacy_phone,
      refills_remaining, next_refill_date, instructions, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of items) {
    try {
      stmt.run(patientId, m.name, m.genericName || null, m.dose, m.frequency,
        m.route || null, m.prescriber || null, m.startDate || null,
        m.pharmacyName || null, m.pharmacyPhone || null,
        m.refillsRemaining ?? null, m.nextRefillDate || null,
        m.instructions || null, m.status || "active");
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Medication "${m.name}": ${err.message}`);
    }
  }
  return r;
}

function importLabs(db: any, patientId: string, items: LabImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO labs (patient_id, test_name, test_code, value, unit, reference_range,
      flag, panel_name, ordered_by, collected_at, resulted_at, lab_facility, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const l of items) {
    try {
      stmt.run(patientId, l.testName, l.testCode || null, l.value,
        l.unit || null, l.referenceRange || null, l.flag || null,
        l.panelName || null, l.orderedBy || null, l.collectedAt,
        l.resultedAt || null, l.labFacility || null, l.notes || null);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Lab "${l.testName}": ${err.message}`);
    }
  }
  return r;
}

function importImaging(db: any, patientId: string, items: ImagingImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO imaging (patient_id, study_type, body_part, modality, indication,
      findings, impression, ordered_by, performed_at, facility, radiologist,
      status, follow_up_needed, follow_up_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const i of items) {
    try {
      stmt.run(patientId, i.studyType, i.bodyPart, i.modality,
        i.indication || null, i.findings || null, i.impression || null,
        i.orderedBy || null, i.performedAt, i.facility || null,
        i.radiologist || null, i.status || "completed",
        i.followUpNeeded ? 1 : 0, i.followUpNotes || null);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Imaging "${i.studyType} ${i.bodyPart}": ${err.message}`);
    }
  }
  return r;
}

function importNotes(db: any, patientId: string, items: ClinicalNoteImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO clinical_notes (patient_id, note_type, author, author_role, content,
      summary, date_of_service, diagnoses, plan_items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const n of items) {
    try {
      stmt.run(patientId, n.noteType, n.author, n.authorRole || null,
        n.content, n.summary || null, n.dateOfService,
        n.diagnoses ? JSON.stringify(n.diagnoses) : null,
        n.planItems ? JSON.stringify(n.planItems) : null);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Note from "${n.author}": ${err.message}`);
    }
  }
  return r;
}

function importInsurance(db: any, patientId: string, data: InsuranceImport): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO insurance (patient_id, tier, payer_name, plan_name, member_id,
      group_number, subscriber_name, subscriber_relationship, effective_date,
      termination_date, copay, deductible, deductible_met, out_of_pocket_max,
      out_of_pocket_met, phone, has_referral_requirement, prior_auth_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const plans: Array<{ tier: string; plan: any }> = [
    { tier: "primary", plan: data.primary },
  ];
  if (data.secondary) {
    plans.push({ tier: "secondary", plan: data.secondary });
  }

  for (const { tier, plan } of plans) {
    try {
      stmt.run(patientId, tier, plan.payerName, plan.planName || null,
        plan.memberId, plan.groupNumber || null, plan.subscriberName || null,
        plan.subscriberRelationship || null, plan.effectiveDate || null,
        plan.terminationDate || null, plan.copay || null, plan.deductible || null,
        plan.deductibleMet || null, plan.outOfPocketMax || null,
        plan.outOfPocketMet || null, plan.phone || null,
        data.hasReferralRequirement ? 1 : 0, data.priorAuthNotes || null);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Insurance ${tier} "${plan.payerName}": ${err.message}`);
    }
  }
  return r;
}

function importAllergies(db: any, patientId: string, items: AllergyImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO allergies (patient_id, allergen, type, reaction, severity, onset_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const a of items) {
    try {
      stmt.run(patientId, a.allergen, a.type, a.reaction || null,
        a.severity || null, a.onsetDate || null, a.status || "active");
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Allergy "${a.allergen}": ${err.message}`);
    }
  }
  return r;
}

function importAppointments(db: any, patientId: string, items: AppointmentImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO appointments (patient_id, provider_name, provider_specialty, location,
      datetime, duration_minutes, type, reason, prep_instructions, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const a of items) {
    try {
      stmt.run(patientId, a.providerName, a.providerSpecialty || null,
        a.location || null, a.datetime, a.durationMinutes || 30,
        a.type || "follow_up", a.reason || null, a.prepInstructions || null,
        a.status || "scheduled");
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Appointment with "${a.providerName}": ${err.message}`);
    }
  }
  return r;
}

function importVitals(db: any, patientId: string, items: VitalImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO vitals (patient_id, type, value_text, unit, source, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const v of items) {
    try {
      stmt.run(patientId, v.type, v.value, v.unit || null,
        v.source || "import", v.recordedAt);
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Vital "${v.type}": ${err.message}`);
    }
  }
  return r;
}

function importGoals(db: any, patientId: string, items: GoalImport[]): SubImportResult {
  const r: SubImportResult = { imported: 0, failed: 0, warnings: [] };
  const stmt = db.prepare(`
    INSERT INTO patient_goals (patient_id, category, title, description,
      target_value, target_unit, frequency, start_date, target_date, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const g of items) {
    try {
      stmt.run(patientId, g.category, g.title, g.description || null,
        g.targetValue || null, g.targetUnit || null, g.frequency || null,
        g.startDate || new Date().toISOString().split("T")[0],
        g.targetDate || null, g.priority || "medium");
      r.imported++;
    } catch (err: any) {
      r.failed++;
      r.warnings.push(`Goal "${g.title}": ${err.message}`);
    }
  }
  return r;
}

// ──────────────────────────────────────────────
// Convenience: Import from JSON file
// ──────────────────────────────────────────────

export function parseImportJson(jsonString: string): BulkPatientImport {
  const raw = JSON.parse(jsonString);
  // Basic validation — just check demographics exists
  if (!raw.demographics || !raw.demographics.firstName || !raw.demographics.phone) {
    throw new Error("Import JSON must include demographics with at least firstName and phone");
  }
  return raw as BulkPatientImport;
}
