/**
 * Job Scheduler
 *
 * Adapted from OpenClaw's cron system. OpenClaw supports scheduled tasks
 * via its Gateway (cron jobs and webhook handlers). ClawHealth uses BullMQ
 * for reliable, persistent job scheduling — critical for medication reminders
 * that must not be missed.
 *
 * Job types:
 * - medication_reminder: Scheduled SMS at medication times
 * - daily_checkin: Morning check-in message
 * - appointment_reminder: Reminder before appointments (24h, 2h)
 * - vitals_check: Periodic request for vitals input
 * - physician_summary: Daily/weekly summary for the supervising doctor
 * - refill_alert: Medication refill reminders
 */

import type { Logger } from "pino";

interface JobData {
  type: string;
  patientId: string;
  payload: Record<string, unknown>;
}

export class JobScheduler {
  private redisUrl: string;
  private logger: Logger;

  constructor(redisUrl: string, logger: Logger) {
    this.redisUrl = redisUrl;
    this.logger = logger.child({ component: "scheduler" });
  }

  /**
   * Start the job scheduler and register recurring jobs.
   * In production, this connects to Redis via BullMQ.
   * For MVP, can fall back to in-memory scheduling with node-cron.
   */
  async start(): Promise<void> {
    this.logger.info("Job scheduler started");

    // TODO: Initialize BullMQ queues
    // const { Queue, Worker } = await import('bullmq');
    // const connection = new IORedis(this.redisUrl);
    //
    // Queues:
    // - clawhealth:medication-reminders
    // - clawhealth:daily-checkins
    // - clawhealth:appointment-reminders
    // - clawhealth:vitals-checks
    // - clawhealth:physician-summaries
    //
    // Each queue has a Worker that processes jobs by calling
    // the appropriate Health Skill through the Agent Runtime.
  }

  /**
   * Schedule a one-time job (e.g., appointment reminder 24h before).
   */
  async scheduleOnce(jobData: JobData, runAt: Date): Promise<string> {
    const delay = runAt.getTime() - Date.now();
    if (delay <= 0) {
      this.logger.warn({ jobData }, "Scheduled time is in the past, running immediately");
    }

    // TODO: Add to BullMQ with delay
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info({ jobId, type: jobData.type, runAt: runAt.toISOString() }, "Job scheduled");
    return jobId;
  }

  /**
   * Schedule a recurring job (e.g., daily medication reminder at 8am).
   */
  async scheduleRecurring(
    jobData: JobData,
    cronExpression: string
  ): Promise<string> {
    // TODO: Add repeatable job to BullMQ
    const jobId = `recurring_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info(
      { jobId, type: jobData.type, cron: cronExpression },
      "Recurring job scheduled"
    );
    return jobId;
  }

  /**
   * Cancel a scheduled job.
   */
  async cancel(jobId: string): Promise<void> {
    // TODO: Remove from BullMQ
    this.logger.info({ jobId }, "Job cancelled");
  }
}
