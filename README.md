# AI Task Manager + ClawHealth AI

AI-powered task management application with natural language processing and smart prioritization — plus **ClawHealth**, an autonomous HIPAA-compliant AI healthcare coordinator.

---

## Projects

### Task Manager
A full-stack task management app with smart prioritization.

- **Frontend:** React 19 + Vite + TailwindCSS + Radix UI (`frontend/task-manager-frontend/`)
- **Backend:** Python Flask + SQLAlchemy + SQLite (`backend/task-manager-backend/`)

### ClawHealth AI Platform
An autonomous AI agent that manages your entire healthcare journey — scheduling appointments, checking medication interactions, finding specialists, tracking vitals, and keeping your doctors updated.

- **Agent Runtime:** TypeScript + Claude API with clinical reasoning and safety validation (`clawhealth/agent/`)
- **Gateway:** Express server with Twilio SMS, WhatsApp, and voice channels (`clawhealth/gateway/`)
- **Healthcare Skills:** Modular clinical skills — medication reminders, vitals monitoring, escalation (`clawhealth/skills/`)
- **Infrastructure:** Per-patient Docker containers, SQLCipher encryption, Redis job queue (`clawhealth/docker/`)

### ClawHealth Marketing Website
A professional single-page marketing site for the ClawHealth AI platform.

- **Location:** `website/`
- **Stack:** Vanilla HTML, CSS, JavaScript (no build step required)
- **Open locally:** Open `website/index.html` in any browser

**Sections include:**
- Hero with live AI chat demo preview
- 6 core feature cards (scheduling, medication interactions, specialist finder, physician reports, 24/7 guidance, vitals monitoring)
- How It Works walkthrough with visual mockups
- HIPAA compliance and security architecture details
- 4 interactive use case tabs (chronic disease, elderly care, post-op recovery, mental health)
- Technical architecture diagram
- Testimonials, pricing tiers, FAQ, and waitlist signup

---

## Key Features

| Feature | Description |
|---|---|
| Appointment Scheduling | AI finds optimal times, coordinates providers, sends reminders |
| Medication Interaction Checker | Real-time drug interaction analysis using FDA databases |
| Specialist Finder | Insurance-verified specialist matching with referral coordination |
| Physician Progress Reports | FHIR-compliant automated summaries sent to your care team |
| 24/7 Health Guidance | Evidence-based health advice via SMS, WhatsApp, or voice |
| Vital Signs Monitoring | Apple HealthKit, Google Health Connect, and device integration |
| Emergency Detection | Automatic crisis recognition with 911 guidance and physician alerts |
| HIPAA Compliance | AES-256 encryption, per-patient isolation, full audit trails, BAA coverage |

---

## Getting Started

### Task Manager
```bash
# Backend
cd backend/task-manager-backend
pip install -r requirements.txt
python src/main.py

# Frontend
cd frontend/task-manager-frontend
pnpm install
pnpm dev
```

### ClawHealth
```bash
cd clawhealth
npm install
cp .env.example .env   # Configure API keys
npm run dev             # Start gateway
```

### Marketing Website
```bash
# No build step — just open in a browser
open website/index.html
```

---

## Architecture

```
ai-task-manager/
├── frontend/            # React task manager UI
├── backend/             # Flask API server
├── clawhealth/          # Healthcare AI platform
│   ├── agent/           # Clinical AI reasoning engine
│   ├── gateway/         # SMS, WhatsApp, voice routing
│   ├── skills/          # Modular healthcare skills
│   ├── docker/          # Container orchestration
│   └── scripts/         # Patient provisioning
├── website/             # Marketing website
│   ├── index.html       # Single-page site
│   ├── styles.css       # Design system
│   └── script.js        # Interactions
└── README.md
```

---

## Compliance & Security

- **HIPAA** — BAA coverage, encrypted PHI, audit trails
- **FHIR R4** — HL7-compliant health data interoperability
- **SOC 2** — Enterprise security controls
- **Per-Patient Isolation** — Dedicated encrypted containers per patient
- **Safety Validation** — Dual-layer AI output verification with physician escalation

---

## License

See [LICENSE](LICENSE) for details.
