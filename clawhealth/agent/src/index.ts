/**
 * Clinical Agent Runtime
 *
 * Adapted from OpenClaw's Pi agent (RPC mode). OpenClaw's agent receives
 * routed messages from the Gateway via WebSocket, calls the LLM, executes
 * tools/skills, and streams responses back.
 *
 * ClawHealth's agent adds:
 * - Clinical guideline RAG (retrieval-augmented generation)
 * - Multi-model safety validation pipeline
 * - Structured health context loading from the Health Memory
 * - Physician escalation logic
 * - Scope boundaries (never diagnose, never prescribe)
 */

import WebSocket from "ws";
import pino from "pino";
import { ClinicalReasoning } from "./clinical-reasoning.js";
import { SafetyValidator } from "./safety-validator.js";
import { HealthMemory } from "./health-memory.js";
import { SkillRegistry } from "./skill-registry.js";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const GATEWAY_WS_URL = process.env.GATEWAY_WS_URL || "ws://localhost:18789/ws";

/**
 * Connect to the Gateway via WebSocket (mirrors OpenClaw's Pi agent
 * connecting to the Gateway daemon).
 */
function connectToGateway(): void {
  const ws = new WebSocket(GATEWAY_WS_URL);

  const healthMemory = new HealthMemory(
    process.env.DATABASE_PATH || "/data/db/health.db",
    process.env.ENCRYPTION_KEY || ""
  );

  const skillRegistry = new SkillRegistry();

  const reasoning = new ClinicalReasoning({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    modelPrimary: process.env.CLAUDE_MODEL_PRIMARY || "claude-sonnet-4-20250514",
    modelComplex: process.env.CLAUDE_MODEL_COMPLEX || "claude-opus-4-5-20251101",
  });

  const safetyValidator = new SafetyValidator({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    modelSafety: process.env.CLAUDE_MODEL_SAFETY || "claude-haiku-3-5-20241022",
  });

  ws.on("open", () => {
    logger.info("Connected to Gateway — Clinical Agent Runtime ready");
  });

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "patient_message") {
        const response = await processPatientMessage(
          message,
          healthMemory,
          skillRegistry,
          reasoning,
          safetyValidator
        );

        ws.send(
          JSON.stringify({
            requestId: message.requestId,
            type: "agent_response",
            ...response,
          })
        );
      }
    } catch (err) {
      logger.error({ err }, "Error processing message");
    }
  });

  ws.on("close", () => {
    logger.warn("Disconnected from Gateway — reconnecting in 5s");
    setTimeout(connectToGateway, 5000);
  });

  ws.on("error", (err) => {
    logger.error({ err }, "WebSocket error");
  });
}

/**
 * Process a patient message through the clinical reasoning pipeline.
 *
 * Pipeline (adapted from OpenClaw's agent processing):
 * 1. Load patient context from Health Memory
 * 2. Check for emergency keywords (fast path)
 * 3. Run clinical reasoning with Claude API
 * 4. Execute any skill calls the LLM requests
 * 5. Validate response through safety layer
 * 6. Log conversation and return response
 */
async function processPatientMessage(
  message: {
    patientId: string;
    channel: string;
    from: string;
    body: string;
    timestamp: string;
  },
  healthMemory: HealthMemory,
  skillRegistry: SkillRegistry,
  reasoning: ClinicalReasoning,
  safetyValidator: SafetyValidator
): Promise<{
  body: string;
  skillUsed?: string;
  flagForPhysician?: boolean;
  alertSeverity?: string;
}> {
  const patientId = message.patientId;

  // Step 1: Load patient context
  const context = await healthMemory.loadPatientContext(patientId);

  // Step 2: Emergency keyword check (fast path — before LLM call)
  const emergencyKeywords = [
    "chest pain",
    "can't breathe",
    "difficulty breathing",
    "passing out",
    "severe bleeding",
    "stroke",
    "heart attack",
    "unconscious",
    "suicide",
    "overdose",
  ];

  const lowerBody = message.body.toLowerCase();
  const isEmergency = emergencyKeywords.some((kw) => lowerBody.includes(kw));

  if (isEmergency) {
    logger.warn({ patientId, body: message.body }, "EMERGENCY keywords detected");

    // Log the alert
    await healthMemory.createPhysicianAlert(patientId, {
      severity: "emergency",
      category: "symptom",
      title: "Emergency keywords detected in patient message",
      description: `Patient said: "${message.body}"`,
    });

    return {
      body:
        "I'm concerned about what you're describing. If this is a medical emergency, " +
        "please call 911 immediately. I'm also alerting your doctor right now. " +
        "Are you safe?",
      flagForPhysician: true,
      alertSeverity: "emergency",
    };
  }

  // Step 3: Clinical reasoning (Claude API)
  const tools = skillRegistry.getToolDefinitions();
  const agentResponse = await reasoning.process(message.body, context, tools);

  // Step 4: Execute skill calls if the LLM requested them
  let skillUsed: string | undefined;
  if (agentResponse.toolCalls && agentResponse.toolCalls.length > 0) {
    for (const toolCall of agentResponse.toolCalls) {
      skillUsed = toolCall.name;
      await skillRegistry.execute(toolCall.name, toolCall.input, healthMemory);
    }
  }

  // Step 5: Safety validation
  const safetyCheck = await safetyValidator.validate(
    message.body,
    agentResponse.response
  );

  if (!safetyCheck.safe) {
    logger.warn(
      { reason: safetyCheck.reason },
      "Safety check failed — using fallback response"
    );
    return {
      body:
        "That's a great question. Let me flag this for your doctor to make sure " +
        "you get the most accurate answer. I'll get back to you soon.",
      flagForPhysician: true,
      alertSeverity: "warning",
    };
  }

  // Step 6: Log conversation
  await healthMemory.logConversation(patientId, {
    channel: message.channel,
    direction: "inbound",
    message: message.body,
    intent: agentResponse.intent,
    skillUsed,
  });

  await healthMemory.logConversation(patientId, {
    channel: message.channel,
    direction: "outbound",
    message: agentResponse.response,
    intent: "response",
    skillUsed,
  });

  return {
    body: agentResponse.response,
    skillUsed,
    flagForPhysician: agentResponse.flagForPhysician,
    alertSeverity: agentResponse.alertSeverity,
  };
}

// Start the agent
connectToGateway();
