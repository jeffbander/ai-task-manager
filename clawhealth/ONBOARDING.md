# Patient Onboarding

Complete documentation for the ClawHealth patient onboarding system.

## Overview

Getting a patient into ClawHealth is a two-step process:

1. **Clinic staff** load the patient's clinical data via a JSON file and CLI script
2. **Patient** texts the bot and walks through a conversational setup

The goal: go from "raw EHR data dump" to "patient actively texting their health coordinator" with as little friction as possible.

## Phase 1: Bulk Data Import

### CLI Usage

```bash
npx tsx scripts/onboard-patient.ts \
  --patient-id "patient-jane-doe-001" \
  --data-file "./patient-data/jane-doe.json" \
  --db-path "./data/db/health.db" \
  --encryption-key "64-char-hex-key" \
  --physician-name "Dr. Smith" \
  --physician-id "dr-smith-001" \
  --send-welcome \
  --dry-run        # validate without importing
```

| Flag | Required | Description |
|---|---|---|
| `--patient-id` | Yes | Unique patient identifier (from provision-patient.ts) |
| `--data-file` | Yes | Path to JSON file with patient data |
| `--db-path` | No | Database path (default: `./data/db/health.db`) |
| `--encryption-key` | Yes | 32-byte hex key (or set `ENCRYPTION_KEY` env var) |
| `--physician-name` | No | Supervising physician name |
| `--physician-id` | No | Supervising physician ID |
| `--send-welcome` | No | Send welcome SMS to patient after import |
| `--dry-run` | No | Validate data without importing |

### JSON Data Format

The import file is a single JSON object matching the `BulkPatientImport` type. Every field except `demographics.firstName` and `demographics.phone` is optional. Include what you have; skip what you don't.

#### Demographics (required)

```json
{
  "demographics": {
    "firstName": "Jane",
    "lastName": "Doe",
    "dateOfBirth": "1965-03-15",
    "phone": "+15551234567",
    "email": "jane.doe@email.com",
    "address": {
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zip": "62701"
    },
    "timezone": "America/Chicago",
    "language": "en",
    "emergencyContactName": "John Doe",
    "emergencyContactPhone": "+15559876543"
  }
}
```

#### Conditions

ICD-10 coded diagnoses with status and severity.

```json
{
  "conditions": [
    {
      "icd10Code": "I10",
      "description": "Essential Hypertension",
      "status": "active",
      "severity": "moderate",
      "onsetDate": "2020-06-01"
    },
    {
      "icd10Code": "E11.65",
      "description": "Type 2 Diabetes Mellitus with hyperglycemia",
      "status": "active",
      "severity": "moderate",
      "onsetDate": "2019-11-15"
    }
  ]
}
```

Status: `active`, `resolved`, `inactive`
Severity: `mild`, `moderate`, `severe`

#### Medications

```json
{
  "medications": [
    {
      "name": "Metformin",
      "genericName": "metformin hydrochloride",
      "dose": "1000mg",
      "frequency": "twice daily",
      "route": "oral",
      "prescriber": "Dr. Smith",
      "startDate": "2019-12-01",
      "pharmacyName": "CVS Pharmacy",
      "pharmacyPhone": "+15551112222",
      "refillsRemaining": 3,
      "nextRefillDate": "2026-02-15",
      "instructions": "Take with meals",
      "status": "active"
    }
  ]
}
```

The `frequency` field is parsed into reminder times:
- "once daily" / "qd" -> 8:00 AM
- "twice daily" / "bid" -> 8:00 AM, 8:00 PM
- "three times daily" / "tid" -> 8:00 AM, 2:00 PM, 8:00 PM
- "morning" / "am" -> 8:00 AM
- "bedtime" / "evening" -> 8:00 PM
- "every N hours" -> evenly spaced starting at 8:00 AM

#### Lab Results

```json
{
  "labs": [
    {
      "testName": "Hemoglobin A1c",
      "testCode": "4548-4",
      "value": "7.8",
      "unit": "%",
      "referenceRange": "4.0-5.6",
      "flag": "high",
      "orderedBy": "Dr. Smith",
      "collectedAt": "2026-01-10",
      "resultedAt": "2026-01-12",
      "labFacility": "Quest Diagnostics",
      "panelName": "Diabetes Panel",
      "notes": "Repeat in 3 months"
    }
  ]
}
```

Flag: `normal`, `low`, `high`, `critical`

Labs are shown to the patient during onboarding with flag indicators. Flagged labs also drive goal suggestions (e.g., high A1c -> "Get A1c below 7.0%").

#### Imaging Studies

```json
{
  "imaging": [
    {
      "studyType": "X-ray",
      "bodyPart": "Lumbar Spine",
      "modality": "xray",
      "indication": "Chronic low back pain",
      "findings": "Mild degenerative disc disease at L4-L5 and L5-S1.",
      "impression": "Mild degenerative changes. No acute abnormality.",
      "orderedBy": "Dr. Smith",
      "performedAt": "2024-10-15",
      "facility": "Springfield Medical Imaging",
      "radiologist": "Dr. Johnson",
      "status": "completed",
      "followUpNeeded": true,
      "followUpNotes": "Repeat in 1-2 years to monitor"
    }
  ]
}
```

Modality: `xray`, `ct`, `mri`, `ultrasound`, `pet`, `dexa`, `mammogram`, `other`

#### Clinical Notes

```json
{
  "notes": [
    {
      "noteType": "progress",
      "author": "Dr. Smith",
      "authorRole": "PCP",
      "content": "Full text of the progress note...",
      "summary": "Routine follow-up. A1c up to 7.8%, BP 142/88.",
      "dateOfService": "2026-01-15",
      "diagnoses": ["E11.65", "I10", "E78.5"],
      "planItems": [
        "Improve Metformin adherence",
        "Recheck BP in 2 weeks",
        "Nutritionist referral"
      ]
    }
  ]
}
```

Note types: `progress`, `hpi`, `discharge`, `consult`, `procedure`, `phone`, `telehealth`, `other`

#### Insurance

```json
{
  "insurance": {
    "primary": {
      "payerName": "Blue Cross Blue Shield",
      "planName": "PPO Gold",
      "memberId": "XYZ123456789",
      "groupNumber": "GRP-5544",
      "subscriberName": "Jane Doe",
      "subscriberRelationship": "self",
      "effectiveDate": "2025-01-01",
      "copay": "$30 PCP / $50 Specialist",
      "deductible": "$1,500",
      "deductibleMet": "$350",
      "outOfPocketMax": "$6,000",
      "outOfPocketMet": "$580",
      "phone": "+18001234567"
    },
    "secondary": { ... },
    "hasReferralRequirement": false,
    "priorAuthNotes": "Prior auth needed for MRI, CT, and specialty medications"
  }
}
```

#### Allergies

```json
{
  "allergies": [
    {
      "allergen": "Penicillin",
      "type": "drug",
      "reaction": "Rash, hives",
      "severity": "moderate",
      "status": "active"
    }
  ]
}
```

Type: `drug`, `food`, `environmental`, `other`
Severity: `mild`, `moderate`, `severe`, `life_threatening`

#### Appointments

```json
{
  "appointments": [
    {
      "providerName": "Dr. Smith",
      "providerSpecialty": "Internal Medicine",
      "location": "Springfield Medical Center, Suite 200",
      "datetime": "2026-02-15T10:30:00",
      "durationMinutes": 30,
      "type": "follow_up",
      "reason": "BP recheck, medication review",
      "prepInstructions": "Bring home BP readings from past 2 weeks.",
      "status": "scheduled"
    }
  ]
}
```

#### Vitals

```json
{
  "vitals": [
    { "type": "blood_pressure", "value": "142/88", "recordedAt": "2026-01-15", "source": "clinic" },
    { "type": "glucose", "value": "145", "unit": "mg/dL", "recordedAt": "2026-01-20", "source": "manual" },
    { "type": "weight", "value": "198", "unit": "lbs", "recordedAt": "2026-01-15", "source": "clinic" }
  ]
}
```

Types: `blood_pressure`, `heart_rate`, `weight`, `glucose`, `spo2`, `temperature`, `steps`, `sleep`

#### Goals

Pre-set goals from the physician or care team.

```json
{
  "goals": [
    {
      "category": "medication_adherence",
      "title": "Take Metformin consistently -- zero missed doses",
      "description": "Focus on evening dose. Use phone alarm at 8pm.",
      "frequency": "daily",
      "priority": "high"
    },
    {
      "category": "lab_targets",
      "title": "Get A1c below 7.0%",
      "targetValue": "7.0",
      "targetUnit": "%",
      "targetDate": "2026-05-01",
      "priority": "high"
    }
  ]
}
```

Categories: `medication_adherence`, `vitals_monitoring`, `activity`, `diet`, `symptom_management`, `appointment_compliance`, `weight_management`, `lab_targets`, `custom`

### Full Example

See [examples/sample-patient-import.json](examples/sample-patient-import.json) for a complete, realistic patient file (HTN, T2DM, hyperlipidemia with labs, imaging, notes, and insurance).

---

## Phase 2: Conversational Onboarding

### How It Works

When a patient texts the ClawHealth number, the gateway checks if they're in onboarding mode. If so, messages are routed to the conversational onboarding flow instead of the normal clinical agent.

The flow is a state machine with 11 steps. Each step:
1. Sends the patient a message (question, confirmation, or info)
2. Waits for a response
3. Processes the response
4. Advances to the next step

### Onboarding Steps

| Step | What the bot does | Patient responds |
|---|---|---|
| `welcome` | Introduces itself, explains what it does | "YES" to start |
| `verify_identity` | Asks for date of birth | "03/15/1965" |
| `confirm_demographics` | Shows name, phone, email, emergency contact | "yes" or corrections |
| `confirm_conditions` | Lists active diagnoses from import | "yes" or updates |
| `confirm_medications` | Lists meds with dose/frequency, offers reminders | "yes" or corrections |
| `review_labs` | Summarizes recent lab results with flags | "next" (informational) |
| `review_imaging` | Shows imaging studies and findings | "next" (informational) |
| `confirm_insurance` | Shows plan details and member ID | "yes" or updates |
| `set_goals` | Suggests goals based on conditions/labs, lets patient pick | "1, 3, 5" or custom |
| `set_communication_prefs` | Asks check-in frequency preference | "1" (daily) to "4" (on demand) |
| `set_monitoring_prefs` | Offers med reminders, vitals tracking, daily check-ins | "yes" for all or specific |
| `complete` | Summary of what's set up, shows example commands | Done |

### Smart Behaviors

**Auto-skip empty sections:** If the patient has no labs imported, the `review_labs` step is skipped automatically. Same for imaging and insurance. No awkward "you have nothing here" messages.

**Smart goal suggestions:** The bot looks at the patient's conditions and flagged labs to suggest relevant goals:
- HTN -> BP monitoring goal
- Diabetes -> glucose management goal
- High A1c lab -> A1c reduction target
- High LDL -> cholesterol goal
- Active medications -> adherence goal
- Universal: exercise, appointment compliance

**Medication frequency parsing:** When setting up reminders, the system parses natural medication frequencies ("twice daily", "every 8 hours", "at bedtime") into specific reminder times.

**Patient corrections:** If the patient says something other than "yes" during a confirmation step, the system logs their correction as a clinical note and flags it for review. Onboarding keeps moving.

### Universal Commands

At any step, the patient can text:
- `skip` or `next` -> advance to next step
- `back` or `previous` -> go back one step
- `help` -> show current step name and available commands

### After Onboarding

Once complete, messages route to the normal Clinical Agent Runtime. The patient can:
- `"Took my Metformin"` -> log medication adherence
- `"BP 128/82"` -> record a vitals reading
- `"Feeling dizzy today"` -> log a symptom
- `"When's my next appointment?"` -> check schedule
- `"How are my labs?"` -> review recent results
- `"How am I doing?"` -> see goal progress
- `"What's my copay?"` -> check insurance info
- `"Add goal: walk 30 min a day"` -> create a new goal

---

## Monitoring Rules

During onboarding, the system creates monitoring rules based on the patient's preferences and health profile.

### Rule Types

| Type | Trigger | Action |
|---|---|---|
| `medication_adherence` | Scheduled med times | SMS reminder + log response |
| `vitals_threshold` | Patient reports a reading | Check against min/max, escalate if urgent |
| `daily_checkin` | Cron schedule (e.g., 9am) | "How are you feeling?" check-in |
| `appointment_reminder` | Day before appointment | Prep instructions + reminder |
| `lab_due` | Scheduled lab date | "Time to get your labs done" |
| `goal_checkin` | Weekly/custom schedule | Goal progress check-in |

### Vitals Thresholds (Defaults)

These are auto-configured based on conditions:

| Condition | Vital | Warning | Urgent |
|---|---|---|---|
| Hypertension | Blood pressure | > 140 systolic | > 180 systolic |
| Diabetes | Glucose | < 70 or > 180 | < 54 or > 300 |
| Heart failure | Weight | > 3 lbs/24h gain | > 5 lbs/7 day gain |

When a reading triggers a threshold:
- **Warning:** Bot notes it, keeps monitoring the trend
- **Urgent:** Bot flags for physician immediately, instructs patient if needed

---

## Database Tables

The onboarding system creates these tables (see `agent/src/onboarding/schema.ts` for the full DDL):

### New Tables (added by onboarding)

| Table | Columns | Purpose |
|---|---|---|
| `labs` | test_name, test_code, value, unit, reference_range, flag, panel_name, ordered_by, collected_at, resulted_at, lab_facility, notes | Lab results |
| `imaging` | study_type, body_part, modality, indication, findings, impression, ordered_by, performed_at, facility, radiologist, status, follow_up_needed, follow_up_notes | Imaging studies |
| `clinical_notes` | note_type, author, author_role, content, summary, date_of_service, diagnoses (JSON), plan_items (JSON) | Clinical notes |
| `insurance` | tier, payer_name, plan_name, member_id, group_number, subscriber_name, copay, deductible, deductible_met, out_of_pocket_max, phone, has_referral_requirement, prior_auth_notes | Insurance plans |
| `allergies` | allergen, type, reaction, severity, onset_date, status | Allergies |
| `patient_goals` | category, title, description, target_value, target_unit, current_value, frequency, start_date, target_date, status, priority, check_in_schedule, last_check_in, progress_notes | Health goals |
| `goal_checkins` | goal_id, value, status (on_track/behind/ahead/needs_attention), notes | Goal check-in log |
| `monitoring_rules` | goal_id, type, config (JSON), enabled | Monitoring rules |
| `onboarding_state` | current_step, steps_completed (JSON), started_at, last_interaction_at, completed_at, patient_confirmations (JSON) | Onboarding state machine |
| `data_imports` | import_type, source, record_count, status, error_message | Import audit trail |
| `schema_version` | version, applied_at | Schema migration tracking |

### Extended Tables (added columns)

The `patient` table gains: `address_street`, `address_city`, `address_state`, `address_zip`
The `medications` table gains: `start_date`, `instructions`

---

## File Map

```
agent/src/onboarding/
  types.ts                  # TypeScript types for all import/onboarding data
  schema.ts                 # Full CREATE TABLE DDL (20+ tables)
  data-import.ts            # Bulk import logic for each data type
  conversational-flow.ts    # 11-step onboarding state machine
  goals.ts                  # Goal CRUD, suggestions, monitoring, progress
  index.ts                  # Module exports

scripts/
  onboard-patient.ts        # CLI script for clinic staff

examples/
  sample-patient-import.json  # Full realistic patient example
```

## Integration Points

- **Gateway** (`gateway/src/index.ts`): Check `isPatientOnboarding()` before routing to clinical agent
- **HealthMemory** (`agent/src/health-memory.ts`): `initialize()` creates the full schema; `getDb()` exposes the database for onboarding queries
- **Skill Registry** (`agent/src/skill-registry.ts`): `goal_manager`, `lab_results`, `insurance_info` skills use onboarding data
- **Clinical Reasoning** (`agent/src/clinical-reasoning.ts`): Intent classification handles `labs`, `goals`, `insurance` intents
