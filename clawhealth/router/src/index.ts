/**
 * SMS Router — The Single Entry Point
 *
 * This is the piece that makes multi-patient work on one server.
 * Twilio sends ALL inbound SMS/Voice to ONE webhook URL. This router
 * looks up which patient container owns that phone number and forwards
 * the request to the correct container's Gateway.
 *
 * Architecture:
 *   Twilio → Nginx (port 443) → SMS Router (port 3000) → ClawBox container (port 18789+N)
 *
 * The router maintains a patient registry (JSON file) mapping phone
 * numbers to container ports. When a new patient is provisioned,
 * they're added to this registry.
 */

import express from "express";
import pino from "pino";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const REGISTRY_PATH = process.env.REGISTRY_PATH || "/data/registry/patients.json";
const ROUTER_PORT = parseInt(process.env.ROUTER_PORT || "3000", 10);

// --- Patient Registry ---

interface PatientEntry {
  patientId: string;
  firstName: string;
  lastName: string;
  phone: string;           // Patient's phone number (the "From" in Twilio)
  containerPort: number;   // Internal port for this patient's ClawBox Gateway
  physicianId: string;
  physicianName: string;
  status: "active" | "paused" | "deactivated";
  createdAt: string;
}

interface Registry {
  patients: PatientEntry[];
  nextPort: number;        // Next available container port (starts at 18790)
}

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    const empty: Registry = { patients: [], nextPort: 18790 };
    writeFileSync(REGISTRY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

function saveRegistry(registry: Registry): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

function findPatientByPhone(phone: string): PatientEntry | undefined {
  const registry = loadRegistry();
  // Normalize phone: strip spaces, ensure +1 prefix
  const normalized = phone.replace(/\s/g, "");
  return registry.patients.find(
    (p) => p.phone === normalized && p.status === "active"
  );
}

// --- SMS Webhook (inbound from Twilio) ---

app.post("/sms/inbound", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;

  logger.info({ from, bodyPreview: body?.slice(0, 50) }, "Inbound SMS received");

  const patient = findPatientByPhone(from);
  if (!patient) {
    logger.warn({ from }, "No patient registered for this phone number");
    res.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>This number is not registered with ClawHealth. Please contact your care team for setup.</Message>
</Response>`
    );
    return;
  }

  // Forward to the patient's ClawBox container
  try {
    const containerUrl = `http://clawbox-${patient.patientId}:18789/sms/inbound`;
    const response = await fetch(containerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(req.body).toString(),
    });

    const twiml = await response.text();
    res.type("text/xml").send(twiml);

    logger.info(
      { patientId: patient.patientId, from },
      "Forwarded SMS to patient container"
    );
  } catch (err) {
    logger.error({ err, patientId: patient.patientId }, "Failed to forward to container");
    res.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>I'm temporarily unavailable. Please try again in a few minutes, or call your doctor if urgent.</Message>
</Response>`
    );
  }
});

// --- Voice Webhook (inbound from Twilio) ---

app.post("/voice/inbound", async (req, res) => {
  const from = req.body.From;
  logger.info({ from }, "Inbound voice call received");

  const patient = findPatientByPhone(from);
  if (!patient) {
    res.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This number is not registered with ClawHealth. Please contact your care team. Goodbye.</Say>
  <Hangup/>
</Response>`
    );
    return;
  }

  // Forward to patient container
  try {
    const containerUrl = `http://clawbox-${patient.patientId}:18789/voice/inbound`;
    const response = await fetch(containerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(req.body).toString(),
    });

    const twiml = await response.text();
    res.type("text/xml").send(twiml);
  } catch (err) {
    logger.error({ err, patientId: patient.patientId }, "Failed to forward voice to container");
    res.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, I'm having technical difficulties. Please call your doctor directly if this is urgent.</Say>
  <Hangup/>
</Response>`
    );
  }
});

// --- Twilio Status Callbacks ---

app.post("/sms/status", (req, res) => {
  const { MessageSid, MessageStatus, To } = req.body;
  logger.info({ sid: MessageSid, status: MessageStatus, to: To }, "SMS status update");
  res.sendStatus(200);
});

// --- Registry Management API (used by CLI scripts) ---

app.get("/api/patients", (_req, res) => {
  const registry = loadRegistry();
  res.json(registry.patients);
});

app.get("/api/patients/:phone", (req, res) => {
  const patient = findPatientByPhone(req.params.phone);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  res.json(patient);
});

app.post("/api/patients", (req, res) => {
  const registry = loadRegistry();
  const { patientId, firstName, lastName, phone, physicianId, physicianName } = req.body;

  // Check for duplicate phone
  if (registry.patients.some((p) => p.phone === phone && p.status === "active")) {
    res.status(409).json({ error: "Phone number already registered" });
    return;
  }

  const entry: PatientEntry = {
    patientId,
    firstName,
    lastName,
    phone,
    containerPort: registry.nextPort,
    physicianId,
    physicianName,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  registry.patients.push(entry);
  registry.nextPort++;
  saveRegistry(registry);

  logger.info({ patientId, phone, port: entry.containerPort }, "Patient registered");
  res.status(201).json(entry);
});

app.delete("/api/patients/:patientId", (req, res) => {
  const registry = loadRegistry();
  const patient = registry.patients.find((p) => p.patientId === req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: "Patient not found" });
    return;
  }
  patient.status = "deactivated";
  saveRegistry(registry);
  logger.info({ patientId: patient.patientId }, "Patient deactivated");
  res.json({ status: "deactivated" });
});

// --- Health Check ---

app.get("/health", (_req, res) => {
  const registry = loadRegistry();
  const activeCount = registry.patients.filter((p) => p.status === "active").length;
  res.json({
    status: "ok",
    activePatients: activeCount,
    uptime: process.uptime(),
  });
});

// --- Start ---

app.listen(ROUTER_PORT, () => {
  const registry = loadRegistry();
  logger.info(
    {
      port: ROUTER_PORT,
      activePatients: registry.patients.filter((p) => p.status === "active").length,
    },
    "ClawHealth SMS Router started"
  );
});

export { app, loadRegistry, saveRegistry };
