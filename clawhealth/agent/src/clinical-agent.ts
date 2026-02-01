/**
 * Clinical Agent — The Brain of Each ClawBox
 *
 * This is the unified agent that the Gateway calls directly (in-process).
 * Combines: clinical reasoning (Claude API), safety validation, health memory,
 * and skill execution into a single pipeline.
 */

import type { Logger } from "pino";
import { HealthMemory } from "./health-memory.js";
import { SkillRegistry } from "./skill-registry.js";

interface AgentConfig {
  patientId: string;
  anthropic: {
    apiKey: string;
    modelPrimary: string;
    modelComplex: string;
    modelSafety: string;
  };
  databasePath: string;
  encryptionKey: string;
  physicianName: string;
  logger: Logger;
}

interface InboundMessage {
  channel: string;
  from: string;
  body: string;
  timestamp: Date;
}

interface AgentResponse {
  body: string;
  skillUsed?: string;
  flagForPhysician?: boolean;
  alertSeverity?: string;
  followUp?: string;
  followUpDelayMs?: number;
}

// Emergency keywords — checked BEFORE hitting the LLM (fast path)
const EMERGENCY_KEYWORDS = [
  "chest pain", "can't breathe", "cannot breathe", "difficulty breathing",
  "shortness of breath", "passing out", "fainted", "fainting",
  "severe bleeding", "stroke", "heart attack", "unconscious",
  "suicide", "want to die", "kill myself", "overdose", "unresponsive",
  "sudden weakness", "face drooping", "slurred speech",
];

export class ClinicalAgent {
  private config: AgentConfig;
  private logger: Logger;
  private memory: HealthMemory;
  private skills: SkillRegistry;

  constructor(config: AgentConfig) {
    this.config = config;
    this.logger = config.logger.child({ component: "agent" });
    this.memory = new HealthMemory(config.databasePath);
    this.skills = new SkillRegistry(this.memory, this.logger);
  }

  /** Initialize database schema on first run. */
  async initialize(): Promise<void> {
    await this.memory.initialize();
    this.logger.info("Clinical agent initialized");
  }

  /** Main message processing pipeline. */
  async processMessage(message: InboundMessage): Promise<AgentResponse> {
    const { body } = message;

    // Step 1: Emergency fast path
    const lower = body.toLowerCase();
    const emergencyMatch = EMERGENCY_KEYWORDS.find((kw) => lower.includes(kw));
    if (emergencyMatch) {
      this.logger.warn({ keyword: emergencyMatch }, "EMERGENCY detected");
      await this.memory.createAlert(this.config.patientId, {
        severity: "emergency",
        category: "symptom",
        title: `Emergency: "${emergencyMatch}" reported`,
        description: `Patient said: "${body}"`,
      });
      await this.memory.logConversation(this.config.patientId, "inbound", message.channel, body, "emergency");
      const emergencyResponse =
        "I'm very concerned about what you're describing. " +
        "If this is a medical emergency, please call 911 right now. " +
        `I'm alerting Dr. ${this.config.physicianName} immediately. ` +
        "Are you somewhere safe? Is someone with you?";
      await this.memory.logConversation(this.config.patientId, "outbound", message.channel, emergencyResponse, "emergency");
      return {
        body: emergencyResponse,
        flagForPhysician: true,
        alertSeverity: "emergency",
      };
    }

    // Step 2: Load patient context for LLM
    const context = await this.memory.loadPatientContext(this.config.patientId);
    context.physicianName = this.config.physicianName;

    // Step 3: Call Claude with tool use
    const tools = this.skills.getToolDefinitions();
    const systemPrompt = this.buildSystemPrompt(context);
    const conversationHistory = await this.memory.getRecentConversations(this.config.patientId, 10);

    let agentResponse: string;
    let skillUsed: string | undefined;

    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: this.config.anthropic.apiKey });

      // Build message history
      const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const conv of conversationHistory) {
        messages.push({
          role: conv.direction === "inbound" ? "user" : "assistant",
          content: conv.message,
        });
      }
      messages.push({ role: "user", content: body });

      const response = await client.messages.create({
        model: this.config.anthropic.modelPrimary,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
        })),
      });

      // Parse response blocks
      let textParts: string[] = [];
      const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
        }
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        skillUsed = tc.name;
        this.logger.info({ skill: tc.name, input: tc.input }, "Executing skill");
        await this.skills.execute(tc.name, tc.input);
      }

      agentResponse = textParts.join("\n").trim() || "I'm here for you. Is there anything else I can help with?";
    } catch (err) {
      this.logger.error({ err }, "Claude API error");
      agentResponse =
        "I had a brief issue processing your message. Could you try sending that again? " +
        `If it's urgent, please call Dr. ${this.config.physicianName}'s office directly.`;
    }

    // Step 4: Safety validation (second model pass)
    const safe = await this.validateSafety(body, agentResponse);
    if (!safe) {
      this.logger.warn("Safety check failed — using fallback");
      agentResponse =
        `That's a good question. Let me check with Dr. ${this.config.physicianName} ` +
        "to make sure I give you the right answer. I'll get back to you soon.";
      await this.memory.createAlert(this.config.patientId, {
        severity: "warning",
        category: "general",
        title: "Safety check triggered",
        description: `Patient asked: "${body.slice(0, 200)}"`,
      });
    }

    // Step 5: Log conversation
    const intent = this.classifyIntent(body);
    await this.memory.logConversation(this.config.patientId, "inbound", message.channel, body, intent, skillUsed);
    await this.memory.logConversation(this.config.patientId, "outbound", message.channel, agentResponse, "response", skillUsed);

    return { body: agentResponse, skillUsed };
  }

  /** Handle scheduled jobs (medication reminders, check-ins). */
  async handleScheduledJob(jobType: string, _payload: Record<string, unknown>): Promise<string> {
    const context = await this.memory.loadPatientContext(this.config.patientId);
    const firstName = context.patient.firstName || "there";

    switch (jobType) {
      case "daily_checkin": {
        const meds = context.medications.filter((m) => m.status === "active");
        const medList = meds.slice(0, 3).map((m) => m.name).join(", ");
        return (
          `Good morning, ${firstName}! Hope you slept well. ` +
          (medList
            ? `Quick reminder about your morning medications: ${medList}. ` +
              "Just reply 'taken' when you've had them!"
            : "How are you feeling today?")
        );
      }
      case "evening_checkin":
        return (
          `Good evening, ${firstName}. How was your day? ` +
          "Did you remember your evening medications? " +
          "If you checked your blood pressure today, let me know the numbers."
        );
      case "medication_reminder":
        return `Hi ${firstName}, it's time for your medication. Reply 'taken' when done!`;
      default:
        return "";
    }
  }

  /** Safety validation via a second fast model. */
  private async validateSafety(patientMessage: string, agentResponse: string): Promise<boolean> {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: this.config.anthropic.apiKey });

      const result = await client.messages.create({
        model: this.config.anthropic.modelSafety,
        max_tokens: 128,
        system: `You validate healthcare AI responses. Check for: diagnosing conditions, prescribing/changing medications, harmful advice, or missed emergencies. Reply ONLY "SAFE" or "UNSAFE: reason".`,
        messages: [
          {
            role: "user",
            content: `Patient: "${patientMessage}"\nAgent: "${agentResponse}"`,
          },
        ],
      });

      const text = result.content[0].type === "text" ? result.content[0].text : "";
      return text.trim().startsWith("SAFE");
    } catch (err) {
      this.logger.error({ err }, "Safety validation failed — allowing response");
      // If safety check itself fails, allow the response rather than blocking all messages
      return true;
    }
  }

  private classifyIntent(message: string): string {
    const lower = message.toLowerCase();
    if (/\b(taken|took)\b/.test(lower)) return "medication_taken";
    if (/\b(missed|forgot|skip)\b/.test(lower)) return "medication_missed";
    if (/\b(medication|medicine|pill|dose|refill)\b/.test(lower)) return "medication";
    if (/\b(appointment|visit|doctor|schedule)\b/.test(lower)) return "appointment";
    if (/\b(pain|hurt|symptom|feel|nausea|dizzy|tired|weak)\b/.test(lower)) return "symptom";
    if (/\b(blood pressure|bp|heart rate|weight|glucose|sugar|pulse)\b/.test(lower)) return "vitals";
    if (/\b(hi|hello|hey|good morning|good evening|good afternoon)\b/.test(lower)) return "greeting";
    if (/\b(thank|thanks)\b/.test(lower)) return "gratitude";
    return "general";
  }

  private buildSystemPrompt(context: {
    patient: { firstName: string; lastName: string; dateOfBirth: string; timezone: string };
    conditions: Array<{ description: string; icd10Code: string; status: string; severity?: string }>;
    medications: Array<{ name: string; dose: string; frequency: string; instructions?: string; status?: string }>;
    recentVitals: Array<{ type: string; value: string; recordedAt: string }>;
    carePlan?: { goals: string[]; interventions: string[]; guidelineSource: string } | null;
    physicianName: string;
  }): string {
    const { patient, conditions, medications, recentVitals, carePlan, physicianName } = context;

    const medList = medications
      .filter((m) => !m.status || m.status === "active")
      .map((m) => `  - ${m.name} ${m.dose} ${m.frequency}${m.instructions ? ` (${m.instructions})` : ""}`)
      .join("\n") || "  None recorded yet";

    const condList = conditions
      .filter((c) => c.status === "active")
      .map((c) => `  - ${c.description} [${c.icd10Code}]${c.severity ? ` — ${c.severity}` : ""}`)
      .join("\n") || "  None recorded yet";

    const vitalsList = recentVitals.slice(0, 10)
      .map((v) => `  - ${v.type}: ${v.value} (${v.recordedAt})`)
      .join("\n") || "  None recorded yet";

    let carePlanSection = "No active care plan.";
    if (carePlan) {
      carePlanSection =
        `Source: ${carePlan.guidelineSource}\n` +
        `Goals:\n${carePlan.goals.map((g) => `  - ${g}`).join("\n")}\n` +
        `Interventions:\n${carePlan.interventions.map((i) => `  - ${i}`).join("\n")}`;
    }

    return `You are ${patient.firstName || "the patient"}'s personal health coordinator, supervised by Dr. ${physicianName}. You communicate via text message — keep responses concise (2-4 sentences unless the patient needs more detail). Be warm and encouraging, like a knowledgeable friend.

SCOPE RULES (never violate):
1. NEVER diagnose conditions or suggest diagnoses
2. NEVER recommend starting, stopping, or changing medications
3. NEVER provide specific medical advice beyond what Dr. ${physicianName} has approved
4. For any clinical question you're unsure about, say "Let me check with Dr. ${physicianName}"
5. You MAY give general wellness encouragement (walking, hydration, sleep, diet)
6. You MAY remind about prescribed medications and log when they're taken
7. You MAY record vitals the patient reports and note trends factually
8. If the patient says "taken" or similar, log their medication as taken and encourage them

PATIENT: ${patient.firstName} ${patient.lastName}
DOB: ${patient.dateOfBirth || "Not recorded"}

CONDITIONS:
${condList}

ACTIVE MEDICATIONS:
${medList}

RECENT VITALS:
${vitalsList}

CARE PLAN:
${carePlanSection}

Current time: ${new Date().toLocaleString("en-US", { timeZone: patient.timezone || "America/New_York" })}`;
  }

  // --- Data Access Methods (used by Gateway API routes) ---

  async getPatientSummary(): Promise<Record<string, unknown>> {
    return this.memory.loadPatientContext(this.config.patientId);
  }

  async getMedications(): Promise<unknown[]> {
    return this.memory.getMedications(this.config.patientId);
  }

  async getVitals(days: number): Promise<unknown[]> {
    return this.memory.getVitals(this.config.patientId, days);
  }

  async getAlerts(): Promise<unknown[]> {
    return this.memory.getAlerts(this.config.patientId);
  }

  async acknowledgeAlert(alertId: number, by: string): Promise<void> {
    return this.memory.acknowledgeAlert(alertId, by);
  }

  async getConversations(limit: number): Promise<unknown[]> {
    return this.memory.getRecentConversations(this.config.patientId, limit);
  }

  async getAdherenceStats(days: number): Promise<Record<string, unknown>> {
    return this.memory.getAdherenceStats(this.config.patientId, days);
  }

  async logPhysicianMessage(message: string, from: string): Promise<void> {
    await this.memory.logConversation(this.config.patientId, "outbound", "physician_portal", message, "physician_message");
  }
}
