/**
 * Safety Validator
 *
 * Inspired by Hippocratic AI's 22-model constellation approach for
 * clinical safety. ClawHealth uses a lightweight second-pass model
 * (Claude Haiku) to validate every agent response before it reaches
 * the patient.
 *
 * This is a critical addition over OpenClaw's architecture — OpenClaw
 * has no safety validation layer because it's a general-purpose assistant.
 * In healthcare, every response must be checked for:
 * - Unauthorized diagnoses
 * - Medication recommendations
 * - Harmful or misleading advice
 * - Missed emergency signals
 * - Appropriate tone and empathy
 */

interface SafetyConfig {
  apiKey: string;
  modelSafety: string;
}

interface SafetyResult {
  safe: boolean;
  reason?: string;
  flags: string[];
}

export class SafetyValidator {
  private config: SafetyConfig;

  constructor(config: SafetyConfig) {
    this.config = config;
  }

  /**
   * Validate an agent response before sending to the patient.
   * Uses a fast, cheap model (Haiku) for rapid safety screening.
   */
  async validate(
    patientMessage: string,
    agentResponse: string
  ): Promise<SafetyResult> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const response = await client.messages.create({
      model: this.config.modelSafety,
      max_tokens: 256,
      system: `You are a clinical safety reviewer for a healthcare AI assistant. Your job is to check if the assistant's response is safe to send to a patient.

Review the assistant's response and check for these violations:
1. DIAGNOSIS: Does the response diagnose or suggest a specific diagnosis?
2. PRESCRIBE: Does it recommend starting, stopping, or changing medications?
3. HARMFUL: Could the advice cause harm if followed?
4. EMERGENCY_MISSED: Does the patient describe emergency symptoms that the assistant failed to address?
5. INAPPROPRIATE_TONE: Is the tone dismissive, cold, or inappropriate?

Respond in this exact JSON format:
{"safe": true/false, "flags": ["VIOLATION_TYPE"], "reason": "explanation if unsafe"}

If the response is safe, respond: {"safe": true, "flags": [], "reason": null}`,
      messages: [
        {
          role: "user",
          content: `PATIENT MESSAGE: ${patientMessage}\n\nASSISTANT RESPONSE: ${agentResponse}`,
        },
      ],
    });

    try {
      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      const result = JSON.parse(text);
      return {
        safe: result.safe === true,
        reason: result.reason || undefined,
        flags: Array.isArray(result.flags) ? result.flags : [],
      };
    } catch {
      // If parsing fails, err on the side of caution
      return {
        safe: false,
        reason: "Safety check response could not be parsed",
        flags: ["PARSE_ERROR"],
      };
    }
  }
}
