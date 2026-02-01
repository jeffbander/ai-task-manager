/**
 * Skill Registry — Health Skills with Real Database Implementations
 *
 * Each skill: JSON schema (tool def for Claude) + handler that reads/writes HealthMemory.
 * All skills are bundled and clinically reviewed. No self-writing, no marketplace.
 */

import type { Logger } from "pino";
import type { HealthMemory } from "./health-memory.js";

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type SkillHandler = (input: Record<string, unknown>) => Promise<string>;

export class SkillRegistry {
  private skills: Map<string, { definition: ToolDefinition; handler: SkillHandler }>;
  private memory: HealthMemory;
  private logger: Logger;
  private patientId: string;

  constructor(memory: HealthMemory, logger: Logger) {
    this.memory = memory;
    this.logger = logger.child({ component: "skills" });
    this.patientId = process.env.PATIENT_ID || "";
    this.skills = new Map();
    this.registerAll();
  }

  private registerAll(): void {
    // --- Medication Management ---
    this.register(
      {
        name: "medication_reminder",
        description:
          "Manages medications. Log when a patient takes or misses a dose, " +
          "check what's due, or list all active medications. Use 'log_taken' when " +
          "the patient says they took their meds, 'log_missed' when they forgot.",
        input_schema: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["log_taken", "log_missed", "log_skipped", "list_active", "check_adherence"],
              description: "The action to perform",
            },
            medication_name: {
              type: "string",
              description: "Name of the specific medication (optional for list/adherence)",
            },
            notes: {
              type: "string",
              description: "Any notes about the dose (e.g., 'took late', 'half dose')",
            },
          },
          required: ["action"],
        },
      },
      async (input) => {
        const action = input.action as string;
        const medName = input.medication_name as string | undefined;
        const notes = input.notes as string | undefined;

        switch (action) {
          case "log_taken":
          case "log_missed":
          case "log_skipped": {
            const dbAction = action.replace("log_", "") as "taken" | "missed" | "skipped";
            // Find medication ID by name if provided
            const meds = await this.memory.getMedications(this.patientId) as Array<{ id: number; name: string }>;
            if (medName) {
              const match = meds.find((m) => m.name.toLowerCase().includes(medName.toLowerCase()));
              if (match) {
                await this.memory.logAdherence(this.patientId, match.id, dbAction, notes);
                return `Logged ${match.name} as ${dbAction}.`;
              }
            }
            // Log against first active med or generic
            if (meds.length > 0) {
              await this.memory.logAdherence(this.patientId, meds[0].id, dbAction, notes);
              return `Logged medication as ${dbAction}.`;
            }
            return `Noted that medication was ${dbAction}.`;
          }
          case "list_active": {
            const meds = await this.memory.getMedications(this.patientId) as Array<{ name: string; dose: string; frequency: string }>;
            if (meds.length === 0) return "No active medications on file.";
            return "Active medications:\n" + meds.map((m) => `- ${m.name} ${m.dose} ${m.frequency}`).join("\n");
          }
          case "check_adherence": {
            const stats = await this.memory.getAdherenceStats(this.patientId, 7);
            if (!stats.adherenceRate) return "Not enough data to calculate adherence yet.";
            return `7-day adherence: ${stats.adherenceRate}% (${stats.taken} taken, ${stats.missed} missed)`;
          }
          default:
            return "Unknown medication action.";
        }
      }
    );

    // --- Vitals Recording ---
    this.register(
      {
        name: "vitals_recorder",
        description:
          "Records and retrieves patient vitals. Use 'record' when the patient " +
          "reports a blood pressure, heart rate, weight, or other reading. " +
          "Use 'get_recent' to see recent trends.",
        input_schema: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["record", "get_recent"],
              description: "Record a new reading or get recent values",
            },
            vital_type: {
              type: "string",
              enum: ["blood_pressure", "heart_rate", "weight", "glucose", "spo2", "temperature"],
              description: "Type of vital sign",
            },
            value: {
              type: "string",
              description: "The reading value (e.g., '120/80', '72 bpm', '185 lbs')",
            },
          },
          required: ["action", "vital_type"],
        },
      },
      async (input) => {
        const action = input.action as string;
        const type = input.vital_type as string;
        const value = input.value as string | undefined;

        if (action === "record" && value) {
          // Parse numeric value if possible
          const numericMatch = value.match(/[\d.]+/);
          const numeric = numericMatch ? parseFloat(numericMatch[0]) : null;
          const unit = type === "blood_pressure" ? "mmHg"
            : type === "heart_rate" ? "bpm"
            : type === "weight" ? "lbs"
            : type === "glucose" ? "mg/dL"
            : type === "spo2" ? "%"
            : type === "temperature" ? "°F"
            : "";

          await this.memory.recordVitals(this.patientId, type, value, numeric, unit, "patient_reported");

          // Check thresholds and flag if concerning
          let warning = "";
          if (type === "blood_pressure") {
            const bpMatch = value.match(/(\d+)\s*\/\s*(\d+)/);
            if (bpMatch) {
              const systolic = parseInt(bpMatch[1]);
              const diastolic = parseInt(bpMatch[2]);
              if (systolic >= 180 || diastolic >= 120) {
                await this.memory.createAlert(this.patientId, {
                  severity: "urgent",
                  category: "vitals",
                  title: `High BP: ${value}`,
                  description: `Patient reported blood pressure of ${value}`,
                });
                warning = " ⚠️ This reading is elevated — flagging for your doctor.";
              } else if (systolic >= 140 || diastolic >= 90) {
                warning = " This is a bit high — keep monitoring.";
              }
            }
          }
          if (type === "heart_rate" && numeric) {
            if (numeric < 50 || numeric > 120) {
              await this.memory.createAlert(this.patientId, {
                severity: "warning",
                category: "vitals",
                title: `Abnormal HR: ${value}`,
                description: `Patient reported heart rate of ${value}`,
              });
              warning = " This is outside the normal range — flagging for your doctor.";
            }
          }

          return `Recorded ${type.replace("_", " ")}: ${value}.${warning}`;
        }

        if (action === "get_recent") {
          const vitals = await this.memory.getVitals(this.patientId, 7) as Array<{
            type: string; value_text: string; recorded_at: string;
          }>;
          const filtered = vitals.filter((v) => v.type === type);
          if (filtered.length === 0) return `No recent ${type.replace("_", " ")} readings.`;
          return `Recent ${type.replace("_", " ")} readings:\n` +
            filtered.slice(0, 5).map((v) => `- ${v.value_text} (${v.recorded_at})`).join("\n");
        }

        return "Please provide a value to record.";
      }
    );

    // --- Symptom Tracker ---
    this.register(
      {
        name: "symptom_tracker",
        description:
          "Logs patient-reported symptoms for physician review. Always use this " +
          "when the patient mentions any physical symptom or change in how they feel.",
        input_schema: {
          type: "object" as const,
          properties: {
            symptom: { type: "string", description: "Description of the symptom" },
            severity: { type: "string", enum: ["mild", "moderate", "severe"], description: "Severity" },
            duration: { type: "string", description: "How long it has been present" },
          },
          required: ["symptom"],
        },
      },
      async (input) => {
        const symptom = input.symptom as string;
        const severity = (input.severity as string) || "unspecified";
        const duration = (input.duration as string) || "not specified";

        // Log as an alert for physician visibility
        const alertSeverity = severity === "severe" ? "urgent" : severity === "moderate" ? "warning" : "info";
        await this.memory.createAlert(this.patientId, {
          severity: alertSeverity,
          category: "symptom",
          title: `Symptom: ${symptom}`,
          description: `Severity: ${severity}, Duration: ${duration}`,
        });

        return `Recorded symptom: ${symptom} (${severity}, duration: ${duration}). Your doctor will be notified.`;
      }
    );

    // --- Appointment Manager ---
    this.register(
      {
        name: "appointment_manager",
        description:
          "Lists upcoming appointments and provides preparation instructions.",
        input_schema: {
          type: "object" as const,
          properties: {
            action: {
              type: "string",
              enum: ["list_upcoming", "get_prep"],
              description: "List appointments or get prep instructions",
            },
          },
          required: ["action"],
        },
      },
      async (input) => {
        const appointments = await this.memory.getAppointments(this.patientId) as Array<{
          provider_name: string; datetime: string; location: string; prep_instructions: string; provider_specialty: string;
        }>;

        if (appointments.length === 0) return "No upcoming appointments on file.";

        if (input.action === "get_prep") {
          const next = appointments[0];
          const prep = next.prep_instructions || "No special preparation instructions on file.";
          return `Next appointment: ${next.provider_name} (${next.provider_specialty || ""}) on ${next.datetime} at ${next.location || "TBD"}.\nPrep: ${prep}`;
        }

        return "Upcoming appointments:\n" +
          appointments.slice(0, 5).map((a) =>
            `- ${a.provider_name}${a.provider_specialty ? ` (${a.provider_specialty})` : ""}: ${a.datetime}${a.location ? ` at ${a.location}` : ""}`
          ).join("\n");
      }
    );

    // --- Physician Escalation ---
    this.register(
      {
        name: "escalate_to_physician",
        description:
          "Flags an issue for the supervising physician. Use when the patient asks " +
          "a clinical question you cannot safely answer, reports concerning symptoms, " +
          "or any situation requiring physician judgment.",
        input_schema: {
          type: "object" as const,
          properties: {
            severity: { type: "string", enum: ["info", "warning", "urgent"], description: "Urgency" },
            category: { type: "string", enum: ["symptom", "medication", "adherence", "vitals", "appointment", "general"], description: "Category" },
            summary: { type: "string", description: "Brief summary for the physician" },
          },
          required: ["severity", "category", "summary"],
        },
      },
      async (input) => {
        await this.memory.createAlert(this.patientId, {
          severity: input.severity as string,
          category: input.category as string,
          title: input.summary as string,
          description: `Escalated by AI agent. Category: ${input.category}`,
        });

        this.logger.info({ severity: input.severity, category: input.category }, "Physician escalation created");
        return `Flagged for Dr.'s review: ${input.summary}`;
      }
    );
  }

  register(definition: ToolDefinition, handler: SkillHandler): void {
    this.skills.set(definition.name, { definition, handler });
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.skills.values()).map((s) => s.definition);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    return skill.handler(input);
  }
}
