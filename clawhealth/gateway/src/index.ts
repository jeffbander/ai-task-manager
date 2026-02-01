/**
 * ClawHealth Gateway
 *
 * Adapted from OpenClaw's Gateway architecture.
 * Central WebSocket hub that routes messages between patient communication
 * channels (SMS, WhatsApp, Voice) and the Clinical Agent Runtime.
 *
 * OpenClaw's Gateway runs as a daemon on ws://127.0.0.1:18789 managing
 * 13+ messaging platforms. ClawHealth's Gateway focuses on healthcare
 * channels: Twilio SMS/Voice, WhatsApp (Baileys), and a companion app.
 */

import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import pino from "pino";
import { config } from "./config.js";
import { TwilioChannel } from "./channels/twilio-sms.js";
import { AgentConnection } from "./agent-connection.js";
import { JobScheduler } from "./scheduler.js";

const logger = pino({ level: config.logLevel });

// Express app for Twilio webhooks (inbound SMS/Voice hit HTTP endpoints)
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// HTTP server shared between Express and WebSocket
const server = createServer(app);

// WebSocket server for internal agent communication
// (mirrors OpenClaw's ws://127.0.0.1:18789 control plane)
const wss = new WebSocketServer({ server, path: "/ws" });

// Agent runtime connection (RPC over WebSocket, like OpenClaw's Pi agent)
let agentConnection: AgentConnection | null = null;

wss.on("connection", (ws: WebSocket) => {
  logger.info("Agent runtime connected via WebSocket");
  agentConnection = new AgentConnection(ws, logger);

  ws.on("close", () => {
    logger.warn("Agent runtime disconnected");
    agentConnection = null;
  });
});

/**
 * Route an inbound patient message to the agent runtime.
 * This is the core Gateway function — same pattern as OpenClaw's
 * message routing from chat platforms to the Pi agent.
 */
async function routeToAgent(message: {
  channel: string;
  from: string;
  body: string;
  timestamp: Date;
}): Promise<string> {
  if (!agentConnection) {
    logger.error("No agent runtime connected — cannot process message");
    return "I'm temporarily unavailable. Please try again in a moment.";
  }

  const response = await agentConnection.sendMessage({
    type: "patient_message",
    patientId: config.patientId,
    channel: message.channel,
    from: message.from,
    body: message.body,
    timestamp: message.timestamp.toISOString(),
  });

  return response.body;
}

// --- Channel: Twilio SMS ---
// Twilio sends inbound SMS as HTTP POST webhooks
const twilioChannel = new TwilioChannel(config.twilio, logger);

app.post("/sms/inbound", async (req, res) => {
  try {
    const { From, Body } = req.body;
    logger.info({ from: From }, "Inbound SMS received");

    const response = await routeToAgent({
      channel: "sms",
      from: From,
      body: Body,
      timestamp: new Date(),
    });

    // Respond with TwiML
    res.type("text/xml").send(twilioChannel.buildTwimlResponse(response));
  } catch (err) {
    logger.error(err, "Error processing inbound SMS");
    res.status(500).send("<Response><Message>An error occurred.</Message></Response>");
  }
});

// --- Channel: Twilio Voice ---
app.post("/voice/inbound", async (req, res) => {
  logger.info("Inbound voice call received");
  // Initial TwiML: gather speech input
  res.type("text/xml").send(`
    <Response>
      <Say voice="Polly.Joanna">Hello, this is your health coordinator. How can I help you today?</Say>
      <Gather input="speech" action="/voice/process" speechTimeout="auto" />
    </Response>
  `);
});

app.post("/voice/process", async (req, res) => {
  try {
    const speechResult = req.body.SpeechResult;
    logger.info({ speech: speechResult }, "Voice input transcribed");

    const response = await routeToAgent({
      channel: "voice",
      from: req.body.From,
      body: speechResult,
      timestamp: new Date(),
    });

    res.type("text/xml").send(`
      <Response>
        <Say voice="Polly.Joanna">${response}</Say>
        <Gather input="speech" action="/voice/process" speechTimeout="auto" />
      </Response>
    `);
  } catch (err) {
    logger.error(err, "Error processing voice input");
    res.status(500).send("<Response><Say>I'm sorry, an error occurred.</Say></Response>");
  }
});

// --- Health check endpoint ---
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    patientId: config.patientId,
    agentConnected: agentConnection !== null,
    uptime: process.uptime(),
  });
});

// --- Start Gateway ---
server.listen(config.gatewayPort, () => {
  logger.info(
    { port: config.gatewayPort, patientId: config.patientId },
    "ClawHealth Gateway started"
  );
});

// Initialize job scheduler for medication reminders, check-ins, etc.
// (Equivalent to OpenClaw's cron system)
const scheduler = new JobScheduler(config.redisUrl, logger);
scheduler.start();

export { app, server, routeToAgent };
