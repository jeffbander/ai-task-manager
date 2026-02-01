# ClawHealth Technical Architecture

## Mapping OpenClaw → ClawHealth

This document maps OpenClaw's proven open-source agent architecture to the
ClawHealth patient-owned autonomous AI health coordinator.

### Component Mapping

| OpenClaw Component | ClawHealth Equivalent | Key Adaptation |
|---|---|---|
| Gateway (WS hub, Node.js daemon) | ClawBox Gateway | Twilio SMS/Voice as primary channel + WhatsApp via Baileys |
| Agent Runtime (model-agnostic RPC) | Clinical Agent Runtime | Claude API (HIPAA BAA) + clinical guideline RAG + safety layer |
| Sandbox (Docker per-session) | Patient Container | 1 encrypted Docker container per patient, no data co-mingling |
| Skills (JSON schema + JS/TS) | Health Skills | Clinically validated, version-locked modules (no self-writing) |
| Persistent Memory (local Markdown) | Health Memory (FHIR) | Encrypted SQLite (SQLCipher) + vector store + FHIR R4 schema |
| ClawHub (skill marketplace) | HealthSkill Registry | Curated registry, clinical review required for all skills |

---

## System Architecture

```
                    Patient
                      |
        +-------------+-------------+
        |             |             |
    SMS/iMessage   WhatsApp    Twilio Voice
    (Twilio)      (Baileys)   (Programmable Voice + ElevenLabs TTS)
        |             |             |
        +-------------+-------------+
                      |
              +-------v--------+
              |  ClawBox       |  <-- 1 container per patient
              |  (Docker Pod)  |
              |                |
              |  +----------+  |
              |  | Gateway  |  |  <-- Node.js WebSocket hub
              |  | (msg     |  |      Twilio webhooks, WhatsApp,
              |  |  router) |  |      Voice, Companion App
              |  +----+-----+  |
              |       |        |
              |  +----v-----+  |
              |  | Clinical |  |  <-- Claude API (HIPAA BAA)
              |  | Agent    |  |      + Safety validation model
              |  | Runtime  |  |      + Clinical guideline RAG
              |  +----+-----+  |
              |       |        |
              |  +----v-----+  |
              |  | Health   |  |  <-- FHIR R4 patient record
              |  | Memory   |  |      Encrypted SQLite + ChromaDB
              |  | (PHR)    |  |      Medications, vitals, plans
              |  +----+-----+  |
              |       |        |
              |  +----v-----+  |
              |  | Health   |  |  <-- Modular skill system
              |  | Skills   |  |      med_reminders, pharmacy,
              |  +----------+  |      appointments, devices,
              |                |      escalation, doctor_summary
              +--------+-------+
                       |
              +--------v--------+
              |  Doctor Portal  |  <-- React dashboard
              |  (Web App)      |      Patient summaries, alerts,
              +-----------------+      CCM billing, care plans
```

---

## Component Deep Dives

### 1. ClawBox Gateway

**Adapted from:** OpenClaw Gateway (`ws://127.0.0.1:18789`)

OpenClaw's Gateway is a Node.js WebSocket daemon that routes messages between
13+ chat platforms and the agent runtime. ClawHealth adapts this with
healthcare-specific channels.

**Tech stack:**
- Node.js >= 22 (matching OpenClaw requirement)
- Express/Fastify for Twilio webhook endpoints
- Twilio SDK (`twilio`) for SMS/MMS/Voice
- Baileys (`@whiskeysockets/baileys`) for WhatsApp Web protocol
- `ws` library for internal WebSocket communication
- Bull/BullMQ for job queues (reminders, scheduled calls)

**Key flows:**

```
Inbound SMS:
  Twilio webhook POST /sms/inbound
    -> Gateway parses message
    -> Routes to Agent Runtime via internal WS
    -> Agent processes + responds
    -> Gateway sends response via Twilio REST API

Outbound Reminder (cron-triggered):
  BullMQ scheduled job fires
    -> Agent Runtime generates reminder message
    -> Gateway routes to patient's preferred channel
    -> Delivery confirmation logged

Voice Call (inbound):
  Twilio webhook POST /voice/inbound
    -> Gateway initiates TwiML stream
    -> Speech-to-text (Twilio/Deepgram)
    -> Agent Runtime processes transcript
    -> Text-to-speech (ElevenLabs)
    -> Audio streamed back via Twilio

Voice Call (outbound check-in):
  BullMQ scheduled job fires
    -> Gateway initiates Twilio outbound call
    -> Same STT -> Agent -> TTS pipeline
```

**Configuration (adapted from OpenClaw's `~/.openclaw/openclaw.json`):**

```json
{
  "gateway": {
    "bind": "0.0.0.0",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "${GATEWAY_TOKEN}"
    }
  },
  "channels": {
    "twilio_sms": {
      "enabled": true,
      "account_sid": "${TWILIO_SID}",
      "auth_token": "${TWILIO_AUTH}",
      "phone_number": "+1XXXXXXXXXX",
      "webhook_path": "/sms/inbound"
    },
    "twilio_voice": {
      "enabled": true,
      "webhook_path": "/voice/inbound",
      "tts_provider": "elevenlabs",
      "stt_provider": "deepgram"
    },
    "whatsapp": {
      "enabled": false,
      "protocol": "baileys"
    }
  },
  "patient": {
    "id": "${PATIENT_ID}",
    "phone": "${PATIENT_PHONE}",
    "preferred_channel": "twilio_sms",
    "timezone": "America/New_York",
    "language": "en"
  }
}
```

---

### 2. Clinical Agent Runtime

**Adapted from:** OpenClaw's Pi agent (RPC mode)

OpenClaw's agent receives routed messages, calls the LLM, executes tools, and
streams responses back. ClawHealth adds clinical safety layers.

**Pipeline:**

```
1. Message received from Gateway (via WebSocket RPC)
2. Load context window:
   a. Patient health profile (structured FHIR data)
   b. Active medications with schedules
   c. Current care plan and goals
   d. Recent conversation history (last N turns)
   e. Relevant clinical guidelines (RAG retrieval)
3. Intent classification:
   - greeting / small_talk
   - symptom_report -> trigger symptom_tracker skill
   - medication_question -> query health memory
   - appointment_inquiry -> trigger appointment_manager skill
   - emergency_keywords -> trigger escalation skill IMMEDIATELY
   - care_plan_question -> reference active care plan
4. LLM reasoning (Claude API with HIPAA BAA):
   - System prompt: patient profile + scope boundaries
   - User message: patient's text
   - Tool definitions: available health skills
5. Safety validation (second model pass):
   - Check: no diagnosis made
   - Check: no prescription given
   - Check: no harmful advice
   - Check: emergency keywords not missed
   - Check: tone is empathetic and appropriate
6. Response routed back through Gateway to patient
7. Conversation logged to Health Memory
8. If physician alert needed: push to Doctor Portal
```

**System prompt structure:**

```
You are {patient_name}'s personal health coordinator, supervised by
Dr. {physician_name}. You help coordinate care, remind about medications,
track symptoms, and encourage healthy behaviors.

CRITICAL RULES:
- NEVER diagnose conditions
- NEVER recommend starting/stopping/changing medications
- NEVER provide specific medical advice beyond what the physician has approved
- If the patient describes emergency symptoms (chest pain, difficulty breathing,
  sudden weakness, etc.), IMMEDIATELY escalate
- Always be warm, empathetic, and encouraging
- When uncertain, say "Let me flag this for Dr. {physician_name}"

PATIENT PROFILE:
{structured_health_profile}

ACTIVE MEDICATIONS:
{medication_list_with_schedules}

CARE PLAN:
{active_care_plan}

RECENT CONTEXT:
{last_5_conversations_summary}
```

**Model configuration:**
- Primary: `claude-sonnet-4-20250514` (fast, capable, cost-effective for routine interactions)
- Complex reasoning: `claude-opus-4-5-20251101` (care plan generation, anomaly analysis)
- Safety check: `claude-haiku-3-5-20241022` (fast validation pass on every response)
- Voice: ElevenLabs API for speech synthesis

---

### 3. Patient Container (Isolation)

**Adapted from:** OpenClaw's Docker sandbox (`Dockerfile.sandbox`)

OpenClaw isolates non-main sessions in per-session Docker containers.
ClawHealth extends this to **per-patient persistent containers**.

**Container template:**

```dockerfile
FROM node:22-slim

# Security hardening
RUN apt-get update && apt-get install -y \
    sqlite3 libsqlcipher-dev \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash clawhealth

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY skills/ ./skills/

# Health data volume mount point
VOLUME ["/data"]

# Run as non-root
USER clawhealth

# Gateway port
EXPOSE 18789

# Health check
HEALTHCHECK --interval=30s --timeout=10s \
    CMD node dist/healthcheck.js

CMD ["node", "dist/gateway.js"]
```

**Docker Compose (per-patient):**

```yaml
version: '3.8'
services:
  clawbox:
    build: .
    container_name: clawbox-${PATIENT_ID}
    environment:
      - PATIENT_ID=${PATIENT_ID}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TWILIO_ACCOUNT_SID=${TWILIO_SID}
      - TWILIO_AUTH_TOKEN=${TWILIO_AUTH}
      - TWILIO_PHONE_NUMBER=${TWILIO_PHONE}
      - PATIENT_PHONE=${PATIENT_PHONE}
      - ENCRYPTION_KEY=${PATIENT_ENCRYPTION_KEY}
      - PHYSICIAN_ID=${PHYSICIAN_ID}
      - NODE_ENV=production
    volumes:
      - patient-data:/data
    networks:
      - clawhealth-internal
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  patient-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /encrypted/${PATIENT_ID}/data

networks:
  clawhealth-internal:
    external: true
```

**Kubernetes (at scale):**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: clawbox-${PATIENT_ID}
  labels:
    app: clawhealth
    component: clawbox
    patient: ${PATIENT_ID}
spec:
  replicas: 1
  selector:
    matchLabels:
      patient: ${PATIENT_ID}
  template:
    spec:
      containers:
        - name: clawbox
          image: clawhealth/clawbox:latest
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          envFrom:
            - secretRef:
                name: clawbox-${PATIENT_ID}-secrets
          volumeMounts:
            - name: patient-data
              mountPath: /data
      volumes:
        - name: patient-data
          persistentVolumeClaim:
            claimName: pvc-${PATIENT_ID}
```

---

### 4. Health Skills

**Adapted from:** OpenClaw's skill system (`~/.openclaw/workspace/skills/`)

OpenClaw skills are JSON schema + JS/TS implementation. ClawHealth uses the
same pattern but all skills are clinically reviewed and version-locked.

**Skill structure:**

```
skills/
  medication_reminder/
    SKILL.md              # Clinical references, scope, safety notes
    skill.json            # JSON Schema tool definition for LLM
    index.ts              # Implementation
    __tests__/
      index.test.ts       # Required: unit + safety tests

  pharmacy_refill/
    SKILL.md
    skill.json
    index.ts
    __tests__/

  appointment_manager/
    SKILL.md
    skill.json
    index.ts
    __tests__/

  vitals_monitor/
    SKILL.md
    skill.json
    index.ts              # Apple HealthKit / device data parser
    __tests__/

  symptom_tracker/
    SKILL.md
    skill.json
    index.ts              # Conversational symptom logging
    __tests__/

  care_plan_engine/
    SKILL.md
    skill.json
    index.ts              # Guideline-driven care plan management
    __tests__/

  escalation/
    SKILL.md
    skill.json
    index.ts              # Emergency detection + physician alert
    __tests__/

  doctor_summary/
    SKILL.md
    skill.json
    index.ts              # Daily/weekly physician report generation
    __tests__/
```

**Example skill definition (medication_reminder/skill.json):**

```json
{
  "name": "medication_reminder",
  "description": "Manages medication reminders for the patient. Can schedule reminders, check adherence, and send nudges for missed doses.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["schedule", "check_adherence", "log_taken", "log_missed", "list_upcoming"],
        "description": "The action to perform"
      },
      "medication_name": {
        "type": "string",
        "description": "Name of the medication"
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "description": "When the action occurred or should occur"
      }
    },
    "required": ["action"]
  }
}
```

---

### 5. Health Memory

**Adapted from:** OpenClaw's persistent memory (local Markdown files)

OpenClaw stores context as Markdown in `~/.openclaw/`. ClawHealth needs
structured clinical data with encryption.

**Storage layers:**

```
/data/
  db/
    health.db              # SQLCipher-encrypted SQLite
  vectors/
    chroma/                # ChromaDB for RAG
  documents/
    uploads/               # Encrypted patient-uploaded files
    exports/               # FHIR bundle exports
  logs/
    conversations/         # Encrypted conversation transcripts
    audit/                 # Access audit trail
```

**Database schema (SQLite with SQLCipher):**

```sql
-- Patient profile
CREATE TABLE patient (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    phone TEXT NOT NULL,
    email TEXT,
    timezone TEXT DEFAULT 'America/New_York',
    language TEXT DEFAULT 'en',
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conditions (ICD-10 coded)
CREATE TABLE conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    icd10_code TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT CHECK(status IN ('active', 'resolved', 'inactive')) DEFAULT 'active',
    onset_date DATE,
    resolved_date DATE,
    severity TEXT CHECK(severity IN ('mild', 'moderate', 'severe')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medications
CREATE TABLE medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    name TEXT NOT NULL,
    generic_name TEXT,
    dose TEXT NOT NULL,
    frequency TEXT NOT NULL,
    route TEXT DEFAULT 'oral',
    prescriber TEXT,
    pharmacy_name TEXT,
    pharmacy_phone TEXT,
    refills_remaining INTEGER,
    next_refill_date DATE,
    start_date DATE,
    end_date DATE,
    status TEXT CHECK(status IN ('active', 'discontinued', 'on_hold')) DEFAULT 'active',
    instructions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Medication adherence log
CREATE TABLE medication_adherence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER REFERENCES medications(id),
    scheduled_time TIMESTAMP NOT NULL,
    action TEXT CHECK(action IN ('taken', 'missed', 'skipped', 'late')) NOT NULL,
    reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Vitals / device readings
CREATE TABLE vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    type TEXT NOT NULL,  -- blood_pressure, heart_rate, weight, glucose, spo2, steps, sleep
    value_numeric REAL,
    value_text TEXT,      -- for compound values like "120/80"
    unit TEXT,
    source TEXT,          -- apple_health, manual, kardia, omron, etc.
    recorded_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Appointments
CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    provider_name TEXT NOT NULL,
    provider_specialty TEXT,
    location TEXT,
    datetime TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 30,
    type TEXT,            -- follow_up, annual, procedure, lab_work, imaging
    prep_instructions TEXT,
    status TEXT CHECK(status IN ('scheduled', 'completed', 'cancelled', 'no_show')) DEFAULT 'scheduled',
    notes TEXT,
    reminded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Care plans
CREATE TABLE care_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    condition_id INTEGER REFERENCES conditions(id),
    guideline_source TEXT,  -- e.g. "ACC/AHA 2022 Heart Failure Guidelines"
    goals TEXT NOT NULL,     -- JSON array of goals
    interventions TEXT NOT NULL,  -- JSON array of interventions
    status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
    physician_approved BOOLEAN DEFAULT FALSE,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation log
CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    channel TEXT NOT NULL,   -- sms, whatsapp, voice, app
    direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL,
    message TEXT NOT NULL,
    intent TEXT,             -- classified intent
    skill_used TEXT,         -- which skill handled this
    flagged_for_physician BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Physician alerts
CREATE TABLE physician_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patient(id),
    severity TEXT CHECK(severity IN ('info', 'warning', 'urgent', 'emergency')) NOT NULL,
    category TEXT NOT NULL,  -- adherence, vitals, symptom, appointment, general
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit log (HIPAA requirement)
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,     -- read, write, delete, export, share
    resource TEXT NOT NULL,   -- table/record accessed
    actor TEXT NOT NULL,      -- patient, agent, physician, system
    details TEXT,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### 6. Doctor Portal

**New component** (not in OpenClaw). Built with the existing project's
React + Flask stack.

**Features:**
- Patient list with status indicators (green/yellow/red)
- Per-patient dashboard: health profile, adherence charts, vitals trends
- Alert queue: items needing physician review, sorted by severity
- Messaging: send instructions through the ClawBox to patients
- Care plan editor: review and approve AI-generated care plans
- CCM time tracker: log minutes for Medicare billing (CPT 99490/99491/99487)

---

## Security & Compliance

### Encryption
- All patient data encrypted at rest (SQLCipher for SQLite, LUKS for volumes)
- All communication encrypted in transit (TLS 1.3)
- Encryption keys derived per-patient, stored in cloud KMS (AWS KMS / Azure Key Vault)

### Access Control
- Patient authenticates via phone number verification (Twilio Verify)
- Physician authenticates via SSO / MFA
- All API calls require JWT tokens
- Role-based access: patient, physician, caregiver, admin

### Audit Trail
- Every data access logged to audit_log table
- Logs include: who, what, when, from where
- Logs are append-only and tamper-evident

### HIPAA Technical Safeguards
- Unique user identification (per-patient containers)
- Emergency access procedure (physician override)
- Automatic logoff (session timeouts)
- Encryption and decryption (SQLCipher + TLS)
- Audit controls (comprehensive logging)
- Integrity controls (checksums on health records)
- Transmission security (TLS everywhere)

---

## Cost Estimates (Per Patient, Per Month)

| Component | Cost |
|---|---|
| Container hosting (512MB, 0.5 CPU) | $5-10 |
| Claude API calls (~500 interactions) | $5-15 |
| Twilio SMS (~150 messages) | $1.50 |
| Twilio Voice (~30 min calls) | $0.50 |
| ElevenLabs TTS (~30 min) | $2-5 |
| Storage (encrypted volume) | $0.50 |
| **Total COGS** | **$15-32** |
| **Price point** | **$75/month** |
| **Gross margin** | **57-80%** |

---

## Development Stack Summary

| Layer | Technology | Rationale |
|---|---|---|
| Gateway | Node.js 22 + Express | Matches OpenClaw, async I/O for messaging |
| SMS/Voice | Twilio | Industry standard, HIPAA eligible |
| WhatsApp | Baileys | Same as OpenClaw, proven at scale |
| Agent LLM | Claude API | HIPAA BAA available, best reasoning |
| Safety Layer | Claude Haiku | Fast, cheap validation pass |
| Voice TTS | ElevenLabs | Natural speech, low latency |
| Voice STT | Deepgram | Medical vocabulary support |
| Database | SQLite + SQLCipher | Per-container, encrypted, no server needed |
| Vector Store | ChromaDB | Embedded, for clinical guideline RAG |
| Job Queue | BullMQ + Redis | Scheduled reminders, cron tasks |
| Doctor Portal | React + Vite | Reuse existing frontend stack |
| Portal API | Flask + SQLAlchemy | Reuse existing backend stack |
| Containers | Docker + K8s | Per-patient isolation |
| Cloud | AWS/Azure (HIPAA) | BAA-eligible infrastructure |
| CI/CD | GitHub Actions | Automated testing + deployment |
