/**
 * Clinical Reasoning Engine
 *
 * The "brain" of the ClawBox. Adapted from OpenClaw's model-agnostic
 * reasoning layer. OpenClaw sends user intent to the LLM and lets it
 * decide which tools to execute. ClawHealth does the same but with
 * clinical guidelines as grounding context and strict scope boundaries.
 *
 * Uses Claude API via local proxy that leverages ClawdBot's OAuth authentication.
 */

import fetch from "node-fetch";

interface ClinicalReasoningConfig {
  apiKey: string;
  modelPrimary: string;
  modelComplex: string;
}

interface PatientContext {
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    timezone: string;
  };
  conditions: Array<{
    icd10Code: string;
    description: string;
    status: string;
    severity?: string;
  }>;
  medications: Array<{
    name: string;
    dose: string;
    frequency: string;
    instructions?: string;
  }>;
  recentVitals: Array<{
    type: string;
    value: string;
    recordedAt: string;
  }>;
  carePlan?: {
    goals: string[];
    interventions: string[];
    guidelineSource: string;
  };
  recentConversations: Array<{
    direction: string;
    message: string;
    createdAt: string;
  }>;
  physicianName: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface ReasoningResult {
  response: string;
  intent?: string;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  flagForPhysician?: boolean;
  alertSeverity?: string;
}

export class ClinicalReasoning {
  private config: ClinicalReasoningConfig;

  constructor(config: ClinicalReasoningConfig) {
    this.config = config;
  }

  /**
   * Build the clinical system prompt with the patient's full context.
   * This is the core adaptation from OpenClaw — instead of a generic
   * assistant prompt, we inject structured health data and scope rules.
   */
  private buildSystemPrompt(context: PatientContext): string {
    const medicationList = context.medications
      .map((m) => `- ${m.name} ${m.dose} ${m.frequency}${m.instructions ? ` (${m.instructions})` : ""}`)
      .join("\n");

    const conditionList = context.conditions
      .map((c) => `- ${c.description} (${c.icd10Code}) — ${c.status}${c.severity ? `, ${c.severity}` : ""}`)
      .join("\n");

    const recentVitals = context.recentVitals
      .map((v) => `- ${v.type}: ${v.value} (${v.recordedAt})`)
      .join("\n");

    const carePlanSection = context.carePlan
      ? `
CARE PLAN (Source: ${context.carePlan.guidelineSource}):
Goals:
${context.carePlan.goals.map((g) => `- ${g}`).join("\n")}
Interventions:
${context.carePlan.interventions.map((i) => `- ${i}`).join("\n")}`
      : "No active care plan.";

    return `You are ${context.patient.firstName}'s personal health coordinator, supervised by Dr. ${context.physicianName}. You help coordinate care, remind about medications, track symptoms, and encourage healthy behaviors.

You are warm, empathetic, and encouraging. You speak naturally, like a caring friend who happens to know a lot about health. Keep responses concise for text messages (2-4 sentences unless more detail is needed).

CRITICAL SCOPE RULES — NEVER VIOLATE THESE:
1. NEVER diagnose conditions or suggest diagnoses
2. NEVER recommend starting, stopping, or changing medications
3. NEVER provide specific medical advice beyond what Dr. ${context.physicianName} has approved in the care plan
4. If the patient describes emergency symptoms (chest pain, difficulty breathing, sudden weakness, severe bleeding), IMMEDIATELY respond with emergency instructions
5. When uncertain about ANY clinical question, say "Let me flag this for Dr. ${context.physicianName}"
6. You may provide general wellness encouragement (walking, hydration, sleep) that is in the care plan
7. You may remind about medications that are already prescribed
8. You may relay information that Dr. ${context.physicianName} has communicated

PATIENT PROFILE:
Name: ${context.patient.firstName} ${context.patient.lastName}
DOB: ${context.patient.dateOfBirth}
Timezone: ${context.patient.timezone}

CONDITIONS:
${conditionList || "None recorded"}

ACTIVE MEDICATIONS:
${medicationList || "None recorded"}

RECENT VITALS:
${recentVitals || "None recorded"}

${carePlanSection}

Today's date/time: ${new Date().toLocaleString("en-US", { timeZone: context.patient.timezone })}`;
  }

  /**
   * Process a patient message through the Claude API with tool use.
   * Mirrors OpenClaw's pattern of sending user intent + available tools
   * to the LLM and handling tool calls in the response.
   */
  async process(
    userMessage: string,
    context: PatientContext,
    tools: ToolDefinition[]
  ): Promise<ReasoningResult> {
    // Debug logging
    console.log('Full API Key:', this.config.apiKey);
    console.log('Contains mock?', this.config.apiKey.includes('mock'));
    console.log('Contains demo?', this.config.apiKey.includes('demo'));
    
    // Demo mode for testing without real API keys
    if (this.config.apiKey.includes('mock') || this.config.apiKey.includes('demo')) {
      console.log('Using mock mode');
      return this.getMockResponse(userMessage, context);
    }
    
    console.log('Using real Anthropic API');

    const systemPrompt = this.buildSystemPrompt(context);

    // Build conversation history from recent messages
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // Add recent conversation context (last 10 exchanges)
    for (const conv of context.recentConversations.slice(-10)) {
      messages.push({
        role: conv.direction === "inbound" ? "user" : "assistant",
        content: conv.message,
      });
    }

    // Add current message
    messages.push({ role: "user", content: userMessage });

    // Use real Anthropic API with actual API key
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const response = await client.messages.create({
      model: this.config.modelPrimary,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object',
          ...t.input_schema,
        },
      })),
    });

    // Parse response — handle text and tool use blocks
    let textResponse = "";
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textResponse += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // Simple intent classification from the response
    const intent = this.classifyIntent(userMessage);

    return {
      response: textResponse || "I'm here to help. Could you tell me more?",
      intent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Basic intent classification for logging and routing.
   * In production, this could be a separate lightweight model call.
   */
  private classifyIntent(message: string): string {
    const lower = message.toLowerCase();

    if (/\b(medication|medicine|pill|dose|refill)\b/.test(lower)) return "medication";
    if (/\b(appointment|visit|doctor|schedule)\b/.test(lower)) return "appointment";
    if (/\b(pain|hurt|symptom|feel|feeling|nausea|dizzy)\b/.test(lower)) return "symptom";
    if (/\b(blood pressure|bp|heart rate|weight|glucose|sugar)\b/.test(lower)) return "vitals";
    if (/\b(lab|labs|bloodwork|a1c|cholesterol|test results?|blood test)\b/.test(lower)) return "labs";
    if (/\b(goal|goals|progress|how am i doing)\b/.test(lower)) return "goals";
    if (/\b(insurance|copay|deductible|member id|coverage)\b/.test(lower)) return "insurance";
    if (/\b(hi|hello|hey|good morning|good evening)\b/.test(lower)) return "greeting";
    if (/\b(thank|thanks)\b/.test(lower)) return "gratitude";

    return "general";
  }

  /**
   * Mock response for demo mode (when using mock API keys)
   */
  private getMockResponse(userMessage: string, context: any): { response: string; intent: string; toolCalls?: any[] } {
    const intent = this.classifyIntent(userMessage);
    const lower = userMessage.toLowerCase();
    
    if (intent === "medication") {
      if (lower.includes("forgot") || lower.includes("missed")) {
        return {
          response: "I see you're asking about a missed medication. Since it's been less than 2 hours from your scheduled time, it's generally okay to take it now. However, let me check with Dr. Bander about your specific medication schedule to make sure. For now, please take your morning dose and I'll send a note to your care team about adjusting your reminder time if needed.",
          intent,
          toolCalls: [{
            name: "medication_reminder",
            action: "log_missed",
            medication: "morning_medications"
          }]
        };
      }
      return {
        response: "I'm here to help with your medication questions. Can you tell me more about which medication you're asking about?",
        intent
      };
    }
    
    if (intent === "greeting") {
      return {
        response: "Good morning! I'm your AI health coordinator, working under Dr. Bander's supervision. How are you feeling today? Is there anything I can help you with regarding your health or medications?",
        intent
      };
    }

    if (intent === "symptom") {
      return {
        response: "Thank you for letting me know about your symptoms. I'm going to log this information and may need to alert Dr. Bander depending on what you're experiencing. Can you describe your symptoms in more detail?",
        intent,
        toolCalls: [{
          name: "symptom_tracker",
          action: "log_symptom"
        }]
      };
    }

    return {
      response: "I'm here to help coordinate your healthcare under Dr. Bander's supervision. I can assist with medication reminders, symptom tracking, appointment scheduling, and answering questions about your care plan. How can I help you today?",
      intent
    };
  }
}
