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

    // --- Goal Manager ---
    this.register(
      {
        name: "goal_manager",
        description:
          "Manages patient health goals. Can list current goals, check progress, " +
          "add new goals, update goal status, and provide encouragement. Use this " +
          "when the patient asks about their goals, progress, or wants to set new ones.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["list_goals", "check_progress", "add_goal", "update_goal", "suggest_goals"],
              description: "The action to perform",
            },
            goal_title: {
              type: "string",
              description: "Title for a new goal or name of existing goal to update",
            },
            goal_category: {
              type: "string",
              enum: [
                "medication_adherence", "vitals_monitoring", "activity", "diet",
                "symptom_management", "appointment_compliance", "weight_management",
                "lab_targets", "custom",
              ],
              description: "Category of the goal",
            },
            progress_value: {
              type: "string",
              description: "Current progress value to record",
            },
          },
          required: ["action"],
        },
      },
      async (input, memory) => {
        const db = memory.getDb();
        if (!db) return "Goal tracking is not yet initialized.";

        const patientId = process.env.PATIENT_ID || "";

        switch (input.action) {
          case "list_goals":
          case "check_progress": {
            const { generateGoalsSummary } = await import("./onboarding/goals.js");
            return generateGoalsSummary(db, patientId);
          }
          case "add_goal": {
            if (!input.goal_title) return "What goal would you like to add?";
            const { createGoal } = await import("./onboarding/goals.js");
            createGoal(db, {
              patientId,
              category: (input.goal_category as any) || "custom",
              title: input.goal_title as string,
              startDate: new Date().toISOString().split("T")[0],
              priority: "medium",
            });
            return `Goal added: "${input.goal_title}". I'll check in with you on this.`;
          }
          case "suggest_goals": {
            const { generateGoalSuggestions } = await import("./onboarding/goals.js");
            const suggestions = generateGoalSuggestions(db, patientId);
            if (suggestions.length === 0) return "I don't have enough info to suggest goals yet.";
            let msg = "Based on your health profile, here are some goals to consider:\n\n";
            suggestions.forEach((s, i) => {
              msg += `${i + 1}. ${s.title}\n   ${s.reason}\n`;
            });
            msg += "\nWant me to add any of these? Just tell me which ones.";
            return msg;
          }
          default:
            return "I can help with your goals. Try asking 'how am I doing?' or 'add a goal'.";
        }
      }
    );

    // --- Lab Results Viewer ---
    this.register(
      {
        name: "lab_results",
        description:
          "Retrieves and summarizes the patient's lab results. Can show recent results, " +
          "trends over time, or flag abnormal values. Use when the patient asks about " +
          "their labs, bloodwork, test results, A1c, cholesterol, etc.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["recent", "specific_test", "flagged", "trends"],
              description: "What to show",
            },
            test_name: {
              type: "string",
              description: "Specific test name to look up (e.g., 'A1c', 'cholesterol')",
            },
          },
          required: ["action"],
        },
      },
      async (input, memory) => {
        const db = memory.getDb();
        if (!db) return "Lab data is not available yet.";
        const patientId = process.env.PATIENT_ID || "";

        switch (input.action) {
          case "recent": {
            const labs = db.prepare(`
              SELECT test_name, value, unit, reference_range, flag, collected_at
              FROM labs WHERE patient_id = ? ORDER BY collected_at DESC LIMIT 15
            `).all(patientId);
            if (!labs.length) return "No lab results on file yet.";
            let msg = "Your most recent lab results:\n\n";
            labs.forEach((l: any) => {
              const marker = l.flag === "high" ? " (HIGH)" : l.flag === "low" ? " (LOW)" : l.flag === "critical" ? " (CRITICAL)" : "";
              msg += `${l.test_name}: ${l.value}${l.unit ? " " + l.unit : ""}${marker}\n`;
            });
            return msg;
          }
          case "specific_test": {
            const name = input.test_name as string;
            if (!name) return "Which test would you like to see?";
            const labs = db.prepare(`
              SELECT test_name, value, unit, reference_range, flag, collected_at
              FROM labs WHERE patient_id = ? AND test_name LIKE ?
              ORDER BY collected_at DESC LIMIT 5
            `).all(patientId, `%${name}%`);
            if (!labs.length) return `No results found for "${name}".`;
            let msg = `Results for ${name}:\n\n`;
            labs.forEach((l: any) => {
              msg += `${l.collected_at}: ${l.value}${l.unit ? " " + l.unit : ""} (ref: ${l.reference_range || "N/A"})\n`;
            });
            return msg;
          }
          case "flagged": {
            const flagged = db.prepare(`
              SELECT test_name, value, unit, flag, collected_at
              FROM labs WHERE patient_id = ? AND flag IN ('high','low','critical')
              ORDER BY collected_at DESC LIMIT 10
            `).all(patientId);
            if (!flagged.length) return "All your recent labs are within normal range.";
            let msg = "These lab results were flagged:\n\n";
            flagged.forEach((l: any) => {
              msg += `${l.test_name}: ${l.value}${l.unit ? " " + l.unit : ""} (${l.flag.toUpperCase()}) — ${l.collected_at}\n`;
            });
            msg += "\nYour doctor is aware of these results.";
            return msg;
          }
          default:
            return "I can show your recent labs, look up a specific test, or show flagged results.";
        }
      }
    );

    // --- Insurance Info ---
    this.register(
      {
        name: "insurance_info",
        description:
          "Retrieves the patient's insurance information including plan details, " +
          "copay, deductible status, and member ID. Use when the patient asks about " +
          "their insurance, coverage, copay, or needs their member ID.",
        input_schema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["summary", "member_id", "copay", "deductible"],
              description: "What insurance info to retrieve",
            },
          },
          required: ["action"],
        },
      },
      async (input, memory) => {
        const db = memory.getDb();
        if (!db) return "Insurance data is not available yet.";
        const patientId = process.env.PATIENT_ID || "";

        const plans = db.prepare(
          "SELECT * FROM insurance WHERE patient_id = ? ORDER BY tier"
        ).all(patientId);
        if (!plans.length) return "No insurance information on file.";

        switch (input.action) {
          case "summary": {
            let msg = "";
            plans.forEach((p: any) => {
              msg += `${p.tier.toUpperCase()}: ${p.payer_name}`;
              if (p.plan_name) msg += ` (${p.plan_name})`;
              msg += `\nMember ID: ${p.member_id}`;
              if (p.copay) msg += `\nCopay: ${p.copay}`;
              if (p.deductible) msg += `\nDeductible: ${p.deductible} (met: ${p.deductible_met || "unknown"})`;
              if (p.phone) msg += `\nPhone: ${p.phone}`;
              msg += "\n\n";
            });
            return msg;
          }
          case "member_id": {
            return plans.map((p: any) => `${p.tier}: ${p.member_id}`).join("\n");
          }
          case "copay": {
            return plans.map((p: any) => `${p.tier}: ${p.copay || "not on file"}`).join("\n");
          }
          case "deductible": {
            return plans.map((p: any) =>
              `${p.tier}: Deductible ${p.deductible || "N/A"}, Met: ${p.deductible_met || "unknown"}, OOP Max: ${p.out_of_pocket_max || "N/A"}, OOP Met: ${p.out_of_pocket_met || "unknown"}`
            ).join("\n");
          }
          default:
            return "I can show your insurance summary, member ID, copay info, or deductible status.";
        }
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
