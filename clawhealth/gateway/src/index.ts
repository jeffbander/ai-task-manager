/**
 * ClawHealth Gateway — Per-Patient Container Entry Point
 *
 * Adapted from OpenClaw's Gateway architecture. In OpenClaw, the Gateway
 * is a separate daemon from the Pi agent, connected via WebSocket.
 * For the ClawHealth POC, we run the Gateway + Agent in the SAME process
 * inside each patient's container. This simplifies deployment — one
 * process per container, no internal WebSocket needed.
 *
 * At scale, they can be separated back into Gateway + Agent processes
 * communicating via WebSocket (matching OpenClaw's architecture).
 *
 * Traffic flow:
 *   Twilio → Nginx → SMS Router → THIS CONTAINER → Agent (in-process) → response
 */

import express from "express";
import pino from "pino";
import { config, validateConfig } from "./config.js";
import { TwilioChannel } from "./channels/twilio-sms.js";
import { JobScheduler } from "./scheduler.js";
import { ClinicalAgent } from "../../agent/src/clinical-agent.js";

// Validate required config before starting
validateConfig();

const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- Initialize Core Components ---

const twilioChannel = new TwilioChannel(config.twilio, logger);

// Agent runs in-process for POC (no WebSocket overhead)
const agent = new ClinicalAgent({
  patientId: config.patientId,
  anthropic: config.anthropic,
  databasePath: config.databasePath,
  encryptionKey: config.encryptionKey,
  physicianName: config.physicianName,
  logger,
});

const scheduler = new JobScheduler({
  redisUrl: config.redisUrl,
  patientId: config.patientId,
  logger,
  onJob: async (jobType, payload) => {
    // Scheduler triggers agent actions (reminders, check-ins)
    return agent.handleScheduledJob(jobType, payload);
  },
  sendMessage: async (body: string) => {
    await twilioChannel.sendSms(config.patientPhone, body);
  },
});

// --- SMS Endpoints (called by the SMS Router) ---

app.post("/sms/inbound", async (req, res) => {
  try {
    const { From, Body } = req.body;
    logger.info({ from: From, preview: Body?.slice(0, 80) }, "Inbound SMS");

    const response = await agent.processMessage({
      channel: "sms",
      from: From,
      body: Body,
      timestamp: new Date(),
    });

    res.type("text/xml").send(twilioChannel.buildTwimlResponse(response.body));

    // Send proactive follow-up via Twilio if the agent flagged one
    if (response.followUp) {
      setTimeout(async () => {
        await twilioChannel.sendSms(config.patientPhone, response.followUp!);
      }, response.followUpDelayMs || 60_000);
    }
  } catch (err) {
    logger.error(err, "Error processing inbound SMS");
    res.type("text/xml").send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>I had a brief issue. Could you send that again?</Message></Response>'
    );
  }
});

// --- Voice Endpoints ---

app.post("/voice/inbound", async (_req, res) => {
  logger.info("Inbound voice call");
  res.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hello, this is your health coordinator. How can I help you today?</Say>
  <Gather input="speech" action="/voice/process" speechTimeout="auto" speechModel="phone_call" />
  <Say voice="Polly.Joanna">I didn't catch that. Goodbye.</Say>
</Response>`
  );
});

app.post("/voice/process", async (req, res) => {
  try {
    const speechResult = req.body.SpeechResult;
    if (!speechResult) {
      res.type("text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I didn't catch that. Could you repeat?</Say>
  <Gather input="speech" action="/voice/process" speechTimeout="auto" />
</Response>`
      );
      return;
    }

    logger.info({ speech: speechResult }, "Voice transcription");

    const response = await agent.processMessage({
      channel: "voice",
      from: req.body.From,
      body: speechResult,
      timestamp: new Date(),
    });

    // Escape XML in response
    const safeResponse = response.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${safeResponse}</Say>
  <Gather input="speech" action="/voice/process" speechTimeout="auto" />
  <Say voice="Polly.Joanna">If there's nothing else, take care and stay healthy!</Say>
</Response>`
    );
  } catch (err) {
    logger.error(err, "Error processing voice");
    res.type("text/xml").send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I had a brief issue. Please try again.</Say></Response>'
    );
  }
});

// --- Internal API (called by Doctor Portal) ---

app.get("/api/patient/summary", async (_req, res) => {
  try {
    const summary = await agent.getPatientSummary();
    res.json(summary);
  } catch (err) {
    logger.error(err, "Error getting patient summary");
    res.status(500).json({ error: "Failed to get summary" });
  }
});

app.get("/api/patient/medications", async (_req, res) => {
  try {
    const meds = await agent.getMedications();
    res.json(meds);
  } catch (err) {
    res.status(500).json({ error: "Failed to get medications" });
  }
});

app.get("/api/patient/vitals", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const vitals = await agent.getVitals(days);
    res.json(vitals);
  } catch (err) {
    res.status(500).json({ error: "Failed to get vitals" });
  }
});

app.get("/api/patient/alerts", async (_req, res) => {
  try {
    const alerts = await agent.getAlerts();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: "Failed to get alerts" });
  }
});

app.post("/api/patient/alerts/:id/acknowledge", async (req, res) => {
  try {
    await agent.acknowledgeAlert(parseInt(req.params.id), req.body.acknowledgedBy || "physician");
    res.json({ status: "acknowledged" });
  } catch (err) {
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

app.get("/api/patient/conversations", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const conversations = await agent.getConversations(limit);
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: "Failed to get conversations" });
  }
});

app.get("/api/patient/adherence", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const adherence = await agent.getAdherenceStats(days);
    res.json(adherence);
  } catch (err) {
    res.status(500).json({ error: "Failed to get adherence stats" });
  }
});

// Doctor sends a message through the bot to the patient
app.post("/api/patient/send-message", async (req, res) => {
  try {
    const { message, from } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message body required" });
      return;
    }

    // Log as physician-initiated message
    await agent.logPhysicianMessage(message, from || "physician");

    // Send via Twilio
    await twilioChannel.sendSms(
      config.patientPhone,
      `Message from Dr. ${config.physicianName}: ${message}`
    );

    res.json({ status: "sent" });
  } catch (err) {
    logger.error(err, "Error sending physician message");
    res.status(500).json({ error: "Failed to send message" });
  }
});

// --- Health Check ---

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    patientId: config.patientId,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  });
});

// --- Start ---

async function start(): Promise<void> {
  // Initialize database schema
  await agent.initialize();

  // Start scheduled jobs (medication reminders, check-ins)
  await scheduler.start();

  app.listen(config.gatewayPort, () => {
    logger.info(
      {
        port: config.gatewayPort,
        patientId: config.patientId,
        physician: config.physicianName,
      },
      "ClawBox Gateway started"
    );
  });
}

start().catch((err) => {
  logger.fatal(err, "Failed to start ClawBox");
  process.exit(1);
});

export { app };
