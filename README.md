# ClawHealth

Patient-owned autonomous AI health coordinator built on the [OpenClaw](https://github.com/openclaw) agent architecture, adapted for healthcare.

ClawHealth gives every patient a personal health coordinator they can text 24/7. It handles medication reminders, vitals tracking, symptom logging, appointment prep, and lab result review -- all through plain SMS. Physicians get a dashboard with alerts, adherence trends, and care plan management.

## How It Works

```
Patient texts "took my metformin"
  -> Twilio webhook
  -> ClawBox Gateway (per-patient Docker container)
  -> Clinical Agent Runtime (Claude API w/ safety validation)
  -> Logs adherence, checks goal progress, responds via SMS
  -> Physician dashboard updated if anything needs attention
```

Each patient gets an isolated encrypted container (ClawBox) with their own health record, conversation history, and monitoring rules. No data co-mingling.

## Architecture

```
clawhealth/
  agent/src/              # Clinical Agent Runtime
    clinical-reasoning.ts    # Claude API integration + intent classification
    health-memory.ts         # Encrypted SQLite (SQLCipher) patient record
    safety-validator.ts      # Second-pass safety check on every response
    skill-registry.ts        # Modular health skills (meds, vitals, labs, goals, insurance)
    onboarding/              # Patient onboarding system
      conversational-flow.ts    # Text-based onboarding (11-step state machine)
      data-import.ts            # Bulk clinical data import
      goals.ts                  # Patient goals & monitoring rules
      schema.ts                 # Full database schema (20+ tables)
      types.ts                  # TypeScript types for all data models

  gateway/src/            # ClawBox Gateway (message routing)
    index.ts                 # Express server + WebSocket hub
    channels/twilio-sms.ts   # Twilio SMS/Voice channel adapter
    scheduler.ts             # BullMQ job scheduling (reminders, check-ins)

  skills/                 # Modular Health Skills
    medication_reminder/     # Adherence tracking + reminder scheduling
    vitals_monitor/          # BP, glucose, weight threshold monitoring
    escalation/              # Emergency detection + physician alerts

  scripts/                # CLI Tools
    provision-patient.ts     # Generate patient ID, encryption key, env file
    onboard-patient.ts       # Bulk data import + onboarding initialization

  docker/                 # Per-patient container config
  examples/               # Sample data files
```

See [ARCHITECTURE.md](clawhealth/ARCHITECTURE.md) for the full technical deep dive.

## Patient Onboarding

The onboarding process has two phases:

### Phase 1: Clinic Loads Patient Data

Clinic staff dumps everything into a single JSON file and runs one command:

```bash
npx tsx scripts/onboard-patient.ts \
  --patient-id "patient-jane-doe-001" \
  --data-file "./patient-data/jane-doe.json" \
  --encryption-key "$ENCRYPTION_KEY"
```

The JSON file accepts: demographics, conditions (ICD-10), medications, lab results, imaging reports, clinical notes, insurance plans, allergies, appointments, vitals history, and care goals. See [examples/sample-patient-import.json](clawhealth/examples/sample-patient-import.json) for a complete example.

### Phase 2: Patient Texts the Bot

The patient sends any text to the ClawHealth number and walks through setup:

```
Bot:  Hi Jane! I'm your health coordinator. Ready? Reply YES.
Jane: Yes

Bot:  Can you confirm your date of birth? (MM/DD/YYYY)
Jane: 03/15/1965

Bot:  Here are your current medications:
      1. Metformin 1000mg -- twice daily
      2. Lisinopril 20mg -- once daily
      3. Atorvastatin 40mg -- once daily
      Look right? Want me to set up reminders?
Jane: Yes please

Bot:  Let's set some health goals! Pick any numbers:
      1. Take my medications on time every day
      2. Keep my blood pressure under control
      3. Manage my blood sugar levels
      ...
Jane: 1, 2, 3

Bot:  You're all set! Text me anytime:
      "Took my Metformin" -- log a medication
      "BP 128/82" -- record a vitals reading
      "How are my labs?" -- review recent results
```

See [ONBOARDING.md](clawhealth/ONBOARDING.md) for the full onboarding documentation.

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Agent LLM | Claude API (HIPAA BAA) | Best reasoning, safety layer |
| Safety | Claude Haiku | Fast validation on every response |
| Gateway | Node.js 22 + Express | Async I/O for messaging |
| SMS/Voice | Twilio | HIPAA eligible, BAA available |
| Database | SQLite + SQLCipher | Per-container, encrypted, no server |
| Vector Store | ChromaDB | Embedded clinical guideline RAG |
| Job Queue | BullMQ + Redis | Scheduled reminders |
| Containers | Docker | Per-patient isolation |
| Language | TypeScript 5.7 | Full type safety |

## Key Features

**For Patients:**
- Text-based health coordinator (SMS, no app needed)
- Medication reminders at scheduled times
- Vitals tracking with threshold alerts
- Lab result summaries with flagged values
- Appointment prep and reminders
- Health goal tracking with progress check-ins
- 24/7 availability

**For Physicians:**
- Real-time alert dashboard (info/warning/urgent/emergency)
- Patient adherence trends
- Care plan management and approval
- CCM time tracking for billing (CPT 99490/99491)
- HIPAA-compliant audit trail

**Safety:**
- Every bot response validated by a second AI model
- Never diagnoses, prescribes, or gives medical advice
- Emergency keyword detection with immediate escalation
- Physician escalation for anything uncertain
- Encrypted at rest (SQLCipher) and in transit (TLS 1.3)
- Per-patient container isolation
- HIPAA technical safeguards built in

## Getting Started

### Prerequisites

- Node.js >= 22
- npm or pnpm
- Docker (for container deployment)
- Twilio account (for SMS)
- Anthropic API key (for Claude)

### Development Setup

```bash
cd clawhealth
npm install
cp .env.example .env   # Configure API keys
npm run dev             # Start gateway in dev mode
```

### Provision a Patient

```bash
npm run patient:provision -- \
  --first-name "Jane" \
  --last-name "Doe" \
  --phone "+15551234567" \
  --physician-name "Dr. Smith" \
  --physician-id "dr-smith-001"
```

### Onboard with Data

```bash
npm run patient:onboard -- \
  --patient-id "patient-abc12345" \
  --data-file "./examples/sample-patient-import.json" \
  --encryption-key "$ENCRYPTION_KEY"
```

### Docker Deployment

```bash
npm run docker:build
npm run docker:up
```

## Project Structure

```
.
├── clawhealth/           # Core healthcare platform
│   ├── ARCHITECTURE.md      # Technical architecture (OpenClaw mapping)
│   ├── ONBOARDING.md        # Patient onboarding documentation
│   ├── agent/               # Clinical Agent Runtime
│   ├── gateway/             # Message routing gateway
│   ├── skills/              # Modular health skills
│   ├── scripts/             # CLI tools
│   ├── docker/              # Container configuration
│   └── examples/            # Sample data files
├── backend/              # Doctor Portal API (Flask) [planned]
├── frontend/             # Doctor Portal UI (React) [planned]
└── README.md
```

## License

MIT License. See [LICENSE](LICENSE) for details.
