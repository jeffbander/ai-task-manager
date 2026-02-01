/**
 * Gateway Configuration
 *
 * Adapted from OpenClaw's ~/.openclaw/openclaw.json configuration system.
 * OpenClaw uses a hierarchical JSON config with sensible defaults.
 * ClawHealth adds healthcare-specific configuration.
 */

import "dotenv/config";

export const config = {
  // Patient identity (each ClawBox serves exactly one patient)
  patientId: process.env.PATIENT_ID || "",
  patientPhone: process.env.PATIENT_PHONE || "",
  patientTimezone: process.env.PATIENT_TIMEZONE || "America/New_York",

  // Physician supervision
  physicianId: process.env.PHYSICIAN_ID || "",
  physicianName: process.env.PHYSICIAN_NAME || "",

  // Gateway networking (OpenClaw defaults to ws://127.0.0.1:18789)
  gatewayPort: parseInt(process.env.GATEWAY_PORT || "18789", 10),
  gatewayAuthToken: process.env.GATEWAY_AUTH_TOKEN || "",

  // Twilio configuration (primary communication channel)
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  },

  // Claude API (with HIPAA BAA)
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    modelPrimary: process.env.CLAUDE_MODEL_PRIMARY || "claude-sonnet-4-20250514",
    modelComplex: process.env.CLAUDE_MODEL_COMPLEX || "claude-opus-4-5-20251101",
    modelSafety: process.env.CLAUDE_MODEL_SAFETY || "claude-haiku-3-5-20241022",
  },

  // Voice (ElevenLabs TTS + Deepgram STT)
  voice: {
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
    deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  },

  // Database encryption
  encryptionKey: process.env.ENCRYPTION_KEY || "",

  // Redis (for BullMQ job scheduling)
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
  nodeEnv: process.env.NODE_ENV || "development",
} as const;

/**
 * Validate required configuration at startup.
 * Fail fast if critical values are missing.
 */
export function validateConfig(): void {
  const required: Array<{ key: string; value: string }> = [
    { key: "PATIENT_ID", value: config.patientId },
    { key: "PATIENT_PHONE", value: config.patientPhone },
    { key: "ANTHROPIC_API_KEY", value: config.anthropic.apiKey },
    { key: "TWILIO_ACCOUNT_SID", value: config.twilio.accountSid },
    { key: "TWILIO_AUTH_TOKEN", value: config.twilio.authToken },
    { key: "ENCRYPTION_KEY", value: config.encryptionKey },
  ];

  const missing = required.filter((r) => !r.value);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.map((m) => m.key).join(", ")}`
    );
  }
}
