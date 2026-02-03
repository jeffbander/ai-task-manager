/**
 * Patient Goals & Monitoring
 *
 * Manages patient health goals and the monitoring rules that track them.
 * Goals are set during onboarding and can be updated anytime via text.
 *
 * The system is designed to be dead simple for patients:
 * - "How am I doing?" → shows goal progress
 * - "BP 130/85" → logs vitals, checks against thresholds
 * - "Took my metformin" → logs adherence, updates goal progress
 * - "Add a goal: walk 30 min a day" → creates a new goal
 *
 * Monitoring rules run on a schedule (via BullMQ) and trigger
 * outbound texts when it's time for check-ins or reminders.
 */

import type { PatientGoal, MonitoringRule, MonitoringConfig } from "./types.js";

// ──────────────────────────────────────────────
// Goal CRUD Operations
// ──────────────────────────────────────────────

export function createGoal(db: any, goal: Omit<PatientGoal, "id" | "status"> & { status?: string }): number {
  const result = db.prepare(`
    INSERT INTO patient_goals (patient_id, category, title, description,
      target_value, target_unit, current_value, frequency,
      start_date, target_date, status, priority, check_in_schedule)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    goal.patientId, goal.category, goal.title, goal.description || null,
    goal.targetValue || null, goal.targetUnit || null, goal.currentValue || null,
    goal.frequency || null, goal.startDate, goal.targetDate || null,
    goal.status || "active", goal.priority, goal.checkInSchedule || null
  );
  return Number(result.lastInsertRowid);
}

export function getActiveGoals(db: any, patientId: string): PatientGoal[] {
  return db.prepare(`
    SELECT * FROM patient_goals WHERE patient_id = ? AND status = 'active'
    ORDER BY priority DESC, created_at ASC
  `).all(patientId);
}

export function getGoalById(db: any, goalId: number): PatientGoal | null {
  return db.prepare("SELECT * FROM patient_goals WHERE id = ?").get(goalId) || null;
}

export function updateGoalProgress(
  db: any,
  goalId: number,
  currentValue: string,
  notes?: string
): void {
  db.prepare(`
    UPDATE patient_goals SET
      current_value = ?,
      progress_notes = COALESCE(progress_notes || '\n', '') || ?,
      last_check_in = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(currentValue, notes || "", goalId);
}

export function markGoalAchieved(db: any, goalId: number): void {
  db.prepare(`
    UPDATE patient_goals SET status = 'achieved', updated_at = datetime('now')
    WHERE id = ?
  `).run(goalId);
}

export function pauseGoal(db: any, goalId: number): void {
  db.prepare(`
    UPDATE patient_goals SET status = 'paused', updated_at = datetime('now')
    WHERE id = ?
  `).run(goalId);
}

// ──────────────────────────────────────────────
// Goal Check-In Logging
// ──────────────────────────────────────────────

export function logGoalCheckIn(
  db: any,
  goalId: number,
  patientId: string,
  value: string,
  status: "on_track" | "behind" | "ahead" | "needs_attention",
  notes?: string
): void {
  db.prepare(`
    INSERT INTO goal_checkins (goal_id, patient_id, value, status, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(goalId, patientId, value, status, notes || null);

  // Update the goal's last check-in
  db.prepare(`
    UPDATE patient_goals SET last_check_in = datetime('now'), current_value = ?
    WHERE id = ?
  `).run(value, goalId);
}

export function getGoalCheckIns(db: any, goalId: number, limit: number = 10): any[] {
  return db.prepare(`
    SELECT * FROM goal_checkins WHERE goal_id = ?
    ORDER BY checked_in_at DESC LIMIT ?
  `).all(goalId, limit);
}

// ──────────────────────────────────────────────
// Monitoring Rules
// ──────────────────────────────────────────────

export function createMonitoringRule(db: any, rule: Omit<MonitoringRule, "id">): number {
  const result = db.prepare(`
    INSERT INTO monitoring_rules (patient_id, goal_id, type, config, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    rule.patientId, rule.goalId || null, rule.type,
    JSON.stringify(rule.config), rule.enabled ? 1 : 0
  );
  return Number(result.lastInsertRowid);
}

export function getActiveMonitoringRules(db: any, patientId: string): MonitoringRule[] {
  const rows = db.prepare(`
    SELECT * FROM monitoring_rules WHERE patient_id = ? AND enabled = 1
  `).all(patientId);

  return rows.map((r: any) => ({
    ...r,
    config: JSON.parse(r.config),
    enabled: Boolean(r.enabled),
  }));
}

export function disableMonitoringRule(db: any, ruleId: number): void {
  db.prepare("UPDATE monitoring_rules SET enabled = 0 WHERE id = ?").run(ruleId);
}

// ──────────────────────────────────────────────
// Goal Progress Summary (for patient texts)
// ──────────────────────────────────────────────

/**
 * Generate a friendly text summary of patient's goal progress.
 * Used when patient texts "how am I doing?" or "goals" or "progress".
 */
export function generateGoalsSummary(db: any, patientId: string): string {
  const goals = getActiveGoals(db, patientId);

  if (goals.length === 0) {
    return "You don't have any active goals right now. Want to set one? Just tell me what you'd like to work on!";
  }

  let msg = "Here's how you're doing on your goals:\n\n";

  for (const goal of goals) {
    msg += `${goalEmoji(goal.category)} ${goal.title}\n`;

    if (goal.currentValue && goal.targetValue) {
      msg += `   Progress: ${goal.currentValue} / ${goal.targetValue}${goal.targetUnit ? " " + goal.targetUnit : ""}\n`;
    }

    if (goal.lastCheckIn) {
      const lastCheckIn = getGoalCheckIns(db, goal.id!, 1);
      if (lastCheckIn.length > 0) {
        msg += `   Last check-in: ${lastCheckIn[0].status.replace("_", " ")} (${formatRelativeDate(lastCheckIn[0].checked_in_at)})\n`;
      }
    } else {
      msg += "   No check-ins yet\n";
    }
    msg += "\n";
  }

  // Calculate overall adherence for medication goals
  const medGoals = goals.filter((g: any) => g.category === "medication_adherence");
  if (medGoals.length > 0) {
    const adherenceRate = calculateMedicationAdherence(db, patientId, 7);
    if (adherenceRate !== null) {
      msg += `Medication adherence (last 7 days): ${adherenceRate}%\n`;
      if (adherenceRate >= 90) msg += "Excellent work!\n";
      else if (adherenceRate >= 80) msg += "Good job — keep it up!\n";
      else msg += "Let's work on getting that higher. I can help with reminders.\n";
    }
  }

  return msg;
}

/**
 * Process a natural-language goal update from the patient.
 * Handles texts like "add goal: walk 30 min", "pause my weight goal", etc.
 */
export function processGoalCommand(db: any, patientId: string, message: string): string | null {
  const lower = message.toLowerCase().trim();

  // "how am I doing" / "goals" / "progress" / "my goals"
  if (/^(how am i doing|goals?|progress|my goals|check.?in|status)$/i.test(lower)) {
    return generateGoalsSummary(db, patientId);
  }

  // "add goal: ..."
  const addMatch = lower.match(/^(?:add|new|create|set)\s+(?:a\s+)?goal[:\s]+(.+)/i);
  if (addMatch) {
    const title = addMatch[1].trim();
    const goalId = createGoal(db, {
      patientId,
      category: "custom",
      title: message.match(/goal[:\s]+(.+)/i)?.[1]?.trim() || title, // preserve original case
      startDate: new Date().toISOString().split("T")[0],
      priority: "medium",
    });
    return `Goal added: "${title}". I'll check in with you on this. You can update me anytime!`;
  }

  // "pause goal" / "stop tracking"
  if (/^(?:pause|stop|hold)\s+(?:my\s+)?(?:goal|tracking)/i.test(lower)) {
    const goals = getActiveGoals(db, patientId);
    if (goals.length === 0) return "You don't have any active goals to pause.";
    if (goals.length === 1) {
      pauseGoal(db, goals[0].id!);
      return `Paused your goal: "${goals[0].title}". Text "resume goal" whenever you're ready to restart.`;
    }
    let msg = "Which goal do you want to pause?\n";
    goals.forEach((g: any, i: number) => {
      msg += `${i + 1}. ${g.title}\n`;
    });
    msg += "\nReply with the number.";
    return msg;
  }

  // Not a goal command
  return null;
}

// ──────────────────────────────────────────────
// Vitals Threshold Checking
// ──────────────────────────────────────────────

interface ThresholdResult {
  isAlert: boolean;
  severity: "normal" | "warning" | "urgent";
  message?: string;
}

/**
 * Check a vitals reading against the patient's monitoring thresholds.
 * Returns alert info if the reading is outside safe range.
 */
export function checkVitalsThreshold(
  db: any,
  patientId: string,
  vitalType: string,
  value: number
): ThresholdResult {
  const rules = db.prepare(`
    SELECT config FROM monitoring_rules
    WHERE patient_id = ? AND type = 'vitals_threshold' AND enabled = 1
  `).all(patientId);

  for (const rule of rules) {
    const config: MonitoringConfig = JSON.parse(rule.config);
    if (config.vitalType !== vitalType) continue;

    // Check urgent thresholds
    if ((config.urgentMax && value >= config.urgentMax) ||
        (config.urgentMin && value <= config.urgentMin)) {
      return {
        isAlert: true,
        severity: "urgent",
        message: `Your ${vitalType.replace("_", " ")} reading of ${value} is outside the safe range. I'm flagging this for your doctor right away.`,
      };
    }

    // Check warning thresholds
    if ((config.warningMax && value >= config.warningMax) ||
        (config.warningMin && value <= config.warningMin)) {
      return {
        isAlert: true,
        severity: "warning",
        message: `Your ${vitalType.replace("_", " ")} reading of ${value} is a bit outside the target range. I'll keep an eye on this.`,
      };
    }
  }

  return { isAlert: false, severity: "normal" };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function calculateMedicationAdherence(db: any, patientId: string, days: number): number | null {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN action = 'taken' OR action = 'late' THEN 1 ELSE 0 END) as taken
    FROM medication_adherence ma
    JOIN medications m ON ma.medication_id = m.id
    WHERE m.patient_id = ? AND ma.reported_at >= ?
  `).get(patientId, since);

  if (!stats || stats.total === 0) return null;
  return Math.round((stats.taken / stats.total) * 100);
}

function goalEmoji(category: string): string {
  const emojis: Record<string, string> = {
    medication_adherence: "[Rx]",
    vitals_monitoring: "[BP]",
    activity: "[Steps]",
    diet: "[Diet]",
    symptom_management: "[Sx]",
    appointment_compliance: "[Appt]",
    weight_management: "[Wt]",
    lab_targets: "[Lab]",
    custom: "[Goal]",
  };
  return emojis[category] || "[*]";
}

function formatRelativeDate(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.floor(days / 7)} week(s) ago`;
}

// ──────────────────────────────────────────────
// Smart Goal Suggestions (based on patient data)
// ──────────────────────────────────────────────

/**
 * Auto-generate goal suggestions based on the patient's conditions,
 * medications, and recent lab results. Used during onboarding and
 * when patient asks "what should I work on?"
 */
export function generateGoalSuggestions(db: any, patientId: string): Array<{
  title: string;
  category: string;
  reason: string;
}> {
  const suggestions: Array<{ title: string; category: string; reason: string }> = [];

  const conditions = db.prepare(
    "SELECT description FROM conditions WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const meds = db.prepare(
    "SELECT name FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const flaggedLabs = db.prepare(
    "SELECT test_name, flag FROM labs WHERE patient_id = ? AND flag IN ('high','low','critical') ORDER BY collected_at DESC LIMIT 5"
  ).all(patientId);

  // Medication adherence (always if patient has meds)
  if (meds.length > 0) {
    suggestions.push({
      title: "Take all medications on time",
      category: "medication_adherence",
      reason: `You have ${meds.length} active medication(s) — consistent timing makes them work better.`,
    });
  }

  // Condition-specific suggestions
  for (const c of conditions) {
    const desc = (c as any).description.toLowerCase();

    if (/hypertension|high blood pressure|htn/.test(desc)) {
      suggestions.push({
        title: "Keep blood pressure below 130/80",
        category: "vitals_monitoring",
        reason: "Regular BP monitoring helps catch trends early.",
      });
    }

    if (/diabetes|type 2|t2dm|a1c/.test(desc)) {
      suggestions.push({
        title: "Keep fasting glucose between 80-130",
        category: "vitals_monitoring",
        reason: "Daily glucose tracking helps you and your doctor fine-tune your care.",
      });
    }

    if (/heart failure|chf/.test(desc)) {
      suggestions.push({
        title: "Weigh yourself every morning",
        category: "weight_management",
        reason: "Sudden weight gain can signal fluid retention — catching it early matters.",
      });
    }

    if (/copd|asthma/.test(desc)) {
      suggestions.push({
        title: "Track breathing symptoms daily",
        category: "symptom_management",
        reason: "Knowing your baseline helps spot flare-ups before they get bad.",
      });
    }
  }

  // Lab-based suggestions
  for (const lab of flaggedLabs) {
    const name = (lab as any).test_name.toLowerCase();

    if (/a1c|hemoglobin a1c/.test(name) && (lab as any).flag === "high") {
      suggestions.push({
        title: "Get A1C below 7.0%",
        category: "lab_targets",
        reason: "Your last A1C was elevated — small daily choices add up.",
      });
    }

    if (/ldl|cholesterol/.test(name) && (lab as any).flag === "high") {
      suggestions.push({
        title: "Lower LDL cholesterol",
        category: "lab_targets",
        reason: "Your LDL was flagged high — diet and exercise can help alongside medication.",
      });
    }
  }

  // Universal suggestions
  suggestions.push({
    title: "Walk at least 30 minutes a day",
    category: "activity",
    reason: "Walking is the single best exercise for nearly every chronic condition.",
  });

  suggestions.push({
    title: "Keep all doctor appointments",
    category: "appointment_compliance",
    reason: "Regular visits help your team catch problems early.",
  });

  return suggestions;
}
