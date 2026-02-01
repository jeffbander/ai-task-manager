/**
 * Job Scheduler
 *
 * Adapted from OpenClaw's cron system. For POC, uses simple setInterval-based
 * scheduling (no Redis dependency needed for initial pilot). Can be upgraded
 * to BullMQ + Redis for production reliability.
 *
 * Job types:
 * - medication_reminder: SMS at medication times
 * - daily_checkin: Morning check-in message
 * - appointment_reminder: Before appointments (24h, 2h)
 * - vitals_request: Periodic request for vitals input
 * - physician_summary: Daily summary for the doctor
 */

import type { Logger } from "pino";

interface SchedulerConfig {
  redisUrl: string;
  patientId: string;
  logger: Logger;
  onJob: (jobType: string, payload: Record<string, unknown>) => Promise<string>;
  sendMessage: (body: string) => Promise<void>;
}

interface ScheduledJob {
  id: string;
  type: string;
  cronHour: number;
  cronMinute: number;
  payload: Record<string, unknown>;
  lastRun?: Date;
}

export class JobScheduler {
  private config: SchedulerConfig;
  private logger: Logger;
  private jobs: ScheduledJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SchedulerConfig) {
    this.config = config;
    this.logger = config.logger.child({ component: "scheduler" });
  }

  async start(): Promise<void> {
    // Register default daily jobs
    this.addRecurring({
      id: "daily-checkin",
      type: "daily_checkin",
      cronHour: 8,
      cronMinute: 0,
      payload: {},
    });

    this.addRecurring({
      id: "evening-checkin",
      type: "evening_checkin",
      cronHour: 20,
      cronMinute: 0,
      payload: {},
    });

    // Check every 60 seconds if any jobs should fire
    this.timer = setInterval(() => this.tick(), 60_000);
    this.logger.info({ jobCount: this.jobs.length }, "Scheduler started");
  }

  addRecurring(job: ScheduledJob): void {
    // Deduplicate
    this.jobs = this.jobs.filter((j) => j.id !== job.id);
    this.jobs.push(job);
    this.logger.info({ jobId: job.id, hour: job.cronHour, min: job.cronMinute }, "Recurring job registered");
  }

  removeJob(jobId: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== jobId);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    for (const job of this.jobs) {
      if (job.cronHour === hour && job.cronMinute === minute) {
        // Don't fire the same job twice in the same minute
        if (job.lastRun && now.getTime() - job.lastRun.getTime() < 120_000) {
          continue;
        }

        job.lastRun = now;
        this.logger.info({ jobId: job.id, type: job.type }, "Firing scheduled job");

        try {
          const message = await this.config.onJob(job.type, job.payload);
          if (message) {
            await this.config.sendMessage(message);
          }
        } catch (err) {
          this.logger.error({ err, jobId: job.id }, "Scheduled job failed");
        }
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
