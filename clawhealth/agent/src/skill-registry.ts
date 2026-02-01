/**
 * Skill Registry
 *
 * Adapted from OpenClaw's skill system. OpenClaw skills live in
 * ~/.openclaw/workspace/skills/<skill>/SKILL.md and consist of a
 * JSON schema (tool definition for the LLM) + a JS/TS implementation.
 *
 * OpenClaw has three skill types:
 * - bundled: built-in to the platform
 * - managed: installed from ClawHub registry
 * - workspace: user-created custom skills
 *
 * ClawHealth's key difference: NO self-writing skills, NO community
 * marketplace. All skills are clinically reviewed and version-locked.
 * Patient safety requires every skill to be audited.
 */

import type { HealthMemory } from "./health-memory.js";

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface SkillHandler {
  (input: Record<string, unknown>, memory: HealthMemory): Promise<string>;
}

export class SkillRegistry {
  private skills: Map<string, { definition: ToolDefinition; handler: SkillHandler }>;

  constructor() {
    this.skills = new Map();
    this.registerBuiltinSkills();
  }

  /**
   * Register all built-in health skills.
   * Each skill provides a JSON schema for the LLM (so Claude knows
   * when and how to call it) and a handler function.
   */
  private registerBuiltinSkills(): void {
    // --- Medication Reminder ---
    this.register(
      {
        name: "medication_reminder",
        description:
          "Manages medication reminders. Can check what medications are due, " +
          "log that a medication was taken or missed, and list upcoming doses.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["check_due", "log_taken", "log_missed", "list_upcoming"],
              description: "The action to perform",
            },
            medication_name: {
              type: "string",
              description: "Name of the specific medication (optional)",
            },
          },
          required: ["action"],
        },
      },
      async (input, memory) => {
        // TODO: Implement with real database queries
        switch (input.action) {
          case "check_due":
            return "Checked medication schedule. No medications currently due.";
          case "log_taken":
            return `Logged ${input.medication_name || "medication"} as taken.`;
          case "log_missed":
            return `Logged ${input.medication_name || "medication"} as missed.`;
          case "list_upcoming":
            return "No upcoming medications scheduled.";
          default:
            return "Unknown medication action.";
        }
      }
    );

    // --- Symptom Tracker ---
    this.register(
      {
        name: "symptom_tracker",
        description:
          "Logs patient-reported symptoms for physician review. Records the " +
          "symptom type, severity, duration, and any associated factors.",
        input_schema: {
          type: "object",
          properties: {
            symptom: {
              type: "string",
              description: "Description of the symptom",
            },
            severity: {
              type: "string",
              enum: ["mild", "moderate", "severe"],
              description: "Severity level",
            },
            duration: {
              type: "string",
              description: "How long the symptom has been present",
            },
          },
          required: ["symptom"],
        },
      },
      async (input, memory) => {
        // TODO: Store in database and check against care plan thresholds
        return `Recorded symptom: ${input.symptom} (severity: ${input.severity || "not specified"}).`;
      }
    );

    // --- Vitals Recorder ---
    this.register(
      {
        name: "vitals_recorder",
        description:
          "Records patient-reported vitals readings (blood pressure, heart rate, " +
          "weight, blood glucose, etc.) and can retrieve recent trends.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["record", "get_trend"],
              description: "Record a new reading or retrieve trends",
            },
            type: {
              type: "string",
              enum: [
                "blood_pressure",
                "heart_rate",
                "weight",
                "glucose",
                "spo2",
                "temperature",
              ],
              description: "Type of vital sign",
            },
            value: {
              type: "string",
              description: "The reading value (e.g., '120/80', '72', '185')",
            },
          },
          required: ["action", "type"],
        },
      },
      async (input, memory) => {
        if (input.action === "record") {
          return `Recorded ${input.type}: ${input.value}.`;
        }
        return `No recent ${input.type} data available yet.`;
      }
    );

    // --- Appointment Manager ---
    this.register(
      {
        name: "appointment_manager",
        description:
          "Manages upcoming appointments. Can list appointments, provide " +
          "preparation instructions, and log appointment outcomes.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list_upcoming", "get_prep", "log_completed"],
              description: "The action to perform",
            },
            appointment_id: {
              type: "number",
              description: "ID of the specific appointment (optional)",
            },
          },
          required: ["action"],
        },
      },
      async (input, memory) => {
        switch (input.action) {
          case "list_upcoming":
            return "No upcoming appointments found.";
          case "get_prep":
            return "No preparation instructions available.";
          default:
            return "Appointment action completed.";
        }
      }
    );

    // --- Physician Escalation ---
    this.register(
      {
        name: "escalate_to_physician",
        description:
          "Flags an issue for the supervising physician's review. Use this " +
          "when the patient asks a clinical question you cannot answer, reports " +
          "concerning symptoms, or when any situation requires physician judgment.",
        input_schema: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["info", "warning", "urgent"],
              description: "How urgent is this escalation",
            },
            category: {
              type: "string",
              enum: [
                "symptom",
                "medication",
                "adherence",
                "vitals",
                "appointment",
                "general",
              ],
              description: "Category of the issue",
            },
            summary: {
              type: "string",
              description: "Brief summary of what needs physician attention",
            },
          },
          required: ["severity", "category", "summary"],
        },
      },
      async (input, memory) => {
        // TODO: Create physician alert in database + push notification
        return `Flagged for physician review: ${input.summary}`;
      }
    );
  }

  /**
   * Register a skill with the registry.
   */
  register(definition: ToolDefinition, handler: SkillHandler): void {
    this.skills.set(definition.name, { definition, handler });
  }

  /**
   * Get all tool definitions for the LLM.
   * These are passed to Claude's tool_use parameter.
   */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.skills.values()).map((s) => s.definition);
  }

  /**
   * Execute a skill by name with the given input.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    memory: HealthMemory
  ): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Unknown skill: ${name}`);
    }
    return skill.handler(input, memory);
  }
}
