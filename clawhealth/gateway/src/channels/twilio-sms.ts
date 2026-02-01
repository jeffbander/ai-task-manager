/**
 * Twilio SMS Channel
 *
 * In OpenClaw, each messaging platform (WhatsApp via Baileys, Telegram via
 * grammY, Discord via discord.js, etc.) has its own channel adapter. This
 * is the ClawHealth equivalent for Twilio SMS — the primary patient channel.
 *
 * Twilio is chosen over raw SMS/iMessage because:
 * - HIPAA-eligible (Twilio offers BAA)
 * - Programmable Voice for check-in calls
 * - Twilio Verify for patient authentication
 * - Reliable delivery receipts for medication adherence tracking
 */

import type { Logger } from "pino";

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  verifyServiceSid: string;
}

export class TwilioChannel {
  private config: TwilioConfig;
  private logger: Logger;

  constructor(config: TwilioConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child({ channel: "twilio-sms" });
  }

  /**
   * Send an outbound SMS to the patient.
   * Used for medication reminders, appointment alerts, and proactive check-ins.
   */
  async sendSms(to: string, body: string): Promise<void> {
    // Dynamic import to avoid loading Twilio SDK until needed
    const twilio = await import("twilio");
    const client = twilio.default(this.config.accountSid, this.config.authToken);

    try {
      const message = await client.messages.create({
        to,
        from: this.config.phoneNumber,
        body,
      });

      this.logger.info(
        { sid: message.sid, to },
        "Outbound SMS sent"
      );
    } catch (err) {
      this.logger.error({ err, to }, "Failed to send SMS");
      throw err;
    }
  }

  /**
   * Build a TwiML XML response for synchronous webhook replies.
   * Twilio expects TwiML in response to inbound message webhooks.
   */
  buildTwimlResponse(message: string): string {
    // Escape XML special characters
    const escaped = message
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escaped}</Message>
</Response>`;
  }

  /**
   * Initiate patient phone verification via Twilio Verify.
   * Used during onboarding to confirm patient identity.
   */
  async sendVerificationCode(to: string): Promise<void> {
    const twilio = await import("twilio");
    const client = twilio.default(this.config.accountSid, this.config.authToken);

    await client.verify.v2
      .services(this.config.verifyServiceSid)
      .verifications.create({ to, channel: "sms" });

    this.logger.info({ to }, "Verification code sent");
  }

  /**
   * Check a verification code submitted by the patient.
   */
  async checkVerificationCode(to: string, code: string): Promise<boolean> {
    const twilio = await import("twilio");
    const client = twilio.default(this.config.accountSid, this.config.authToken);

    const check = await client.verify.v2
      .services(this.config.verifyServiceSid)
      .verificationChecks.create({ to, code });

    return check.status === "approved";
  }
}
