/**
 * Conversational Onboarding Flow
 *
 * The patient texts the bot and walks through onboarding step-by-step.
 * Design principles:
 *  - SUPER EASY. Short messages. One question at a time.
 *  - Patient can say "yes", "no", "skip", "next" — natural language
 *  - Bot confirms what the clinic already loaded (labs, meds, conditions)
 *  - Patient sets their own goals with gentle guidance
 *  - Everything is opt-in. Patient controls their data.
 *
 * The flow uses a state machine stored in onboarding_state table.
 * Each step produces an outbound message and processes the patient's reply.
 */

import type { OnboardingStep, OnboardingState, PatientGoal } from "./types.js";

// ──────────────────────────────────────────────
// Step Definitions
// ──────────────────────────────────────────────

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "verify_identity",
  "confirm_demographics",
  "confirm_conditions",
  "confirm_medications",
  "review_labs",
  "review_imaging",
  "confirm_insurance",
  "set_goals",
  "set_communication_prefs",
  "set_monitoring_prefs",
  "complete",
];

/**
 * Main entry point: process an inbound patient message during onboarding.
 * Returns the bot's response text to send back via SMS.
 */
export function processOnboardingMessage(
  db: any,
  patientId: string,
  inboundMessage: string
): string {
  let state = getOnboardingState(db, patientId);

  if (!state) {
    // First interaction — initialize onboarding
    state = initializeOnboarding(db, patientId);
    return generateStepMessage(db, patientId, state.currentStep);
  }

  if (state.currentStep === "complete") {
    return "You're all set! Your health coordinator is ready. Just text me anytime you need help with medications, appointments, or anything health-related.";
  }

  // Process the patient's response for the current step
  const result = processStepResponse(db, patientId, state, inboundMessage);

  // Update state
  updateOnboardingState(db, patientId, state);

  return result;
}

/**
 * Generate the initial message for a given onboarding step.
 * These are the outbound messages the bot sends to guide the patient.
 */
export function generateStepMessage(
  db: any,
  patientId: string,
  step: OnboardingStep
): string {
  switch (step) {
    case "welcome":
      return getWelcomeMessage(db, patientId);
    case "verify_identity":
      return "For your security, I need to verify it's you. Can you confirm your date of birth? (MM/DD/YYYY)";
    case "confirm_demographics":
      return getDemographicsConfirmation(db, patientId);
    case "confirm_conditions":
      return getConditionsConfirmation(db, patientId);
    case "confirm_medications":
      return getMedicationsConfirmation(db, patientId);
    case "review_labs":
      return getLabsReview(db, patientId);
    case "review_imaging":
      return getImagingReview(db, patientId);
    case "confirm_insurance":
      return getInsuranceConfirmation(db, patientId);
    case "set_goals":
      return getGoalsPrompt(db, patientId);
    case "set_communication_prefs":
      return "How would you like me to check in with you?\n\n1. Text me daily (morning check-in)\n2. Text me a few times a week\n3. Only text me for reminders\n4. I'll reach out when I need you\n\nJust reply with a number or tell me what works best.";
    case "set_monitoring_prefs":
      return getMonitoringPrompt(db, patientId);
    case "complete":
      return getCompletionMessage(db, patientId);
    default:
      return "Let's continue setting things up. Type 'next' to move on.";
  }
}

// ──────────────────────────────────────────────
// Step Message Generators
// ──────────────────────────────────────────────

function getWelcomeMessage(db: any, patientId: string): string {
  const patient = db.prepare("SELECT first_name FROM patient WHERE id = ?").get(patientId);
  const name = patient?.first_name || "there";
  const physician = db.prepare(
    "SELECT details FROM audit_log WHERE resource = 'patient_provisioned' AND actor = 'system' LIMIT 1"
  ).get();

  return `Hi ${name}! I'm your health coordinator from ClawHealth. Your doctor's office set me up to help you stay on top of your health.\n\nI can help with:\n- Medication reminders\n- Tracking symptoms & vitals\n- Appointment prep\n- Answering health questions\n\nLet's get you set up — it only takes a few minutes. Ready? Reply YES to start.`;
}

function getDemographicsConfirmation(db: any, patientId: string): string {
  const p = db.prepare("SELECT * FROM patient WHERE id = ?").get(patientId);
  if (!p) return "I don't have your info on file yet. Let's skip ahead. Reply 'next'.";

  let msg = "Let me confirm we have the right info:\n\n";
  msg += `Name: ${p.first_name} ${p.last_name}\n`;
  if (p.date_of_birth) msg += `DOB: ${p.date_of_birth}\n`;
  if (p.phone) msg += `Phone: ${p.phone}\n`;
  if (p.email) msg += `Email: ${p.email || "not on file"}\n`;
  if (p.emergency_contact_name) {
    msg += `Emergency contact: ${p.emergency_contact_name} (${p.emergency_contact_phone})\n`;
  }
  msg += "\nDoes this look right? Reply YES or tell me what needs to be updated.";
  return msg;
}

function getConditionsConfirmation(db: any, patientId: string): string {
  const conditions = db.prepare(
    "SELECT description, icd10_code, status, severity FROM conditions WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  if (!conditions.length) {
    return "I don't have any health conditions on file for you. If you'd like to add any, just tell me about them. Otherwise reply 'next' to continue.";
  }

  let msg = "Here are the health conditions your doctor has on file:\n\n";
  conditions.forEach((c: any, i: number) => {
    msg += `${i + 1}. ${c.description}`;
    if (c.severity) msg += ` (${c.severity})`;
    msg += "\n";
  });
  msg += "\nDoes this look right? Reply YES to confirm, or tell me if anything is missing or should be removed.";
  return msg;
}

function getMedicationsConfirmation(db: any, patientId: string): string {
  const meds = db.prepare(
    "SELECT name, dose, frequency, instructions FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  if (!meds.length) {
    return "No medications on file. If you're taking anything, just list them and I'll add them. Or reply 'next' to continue.";
  }

  let msg = "Here are your current medications:\n\n";
  meds.forEach((m: any, i: number) => {
    msg += `${i + 1}. ${m.name} ${m.dose} — ${m.frequency}`;
    if (m.instructions) msg += `\n   (${m.instructions})`;
    msg += "\n";
  });
  msg += "\nLook right? Reply YES to confirm. Want me to set up reminders for these? I can text you when it's time to take them.";
  return msg;
}

function getLabsReview(db: any, patientId: string): string {
  const labs = db.prepare(`
    SELECT test_name, value, unit, reference_range, flag, collected_at
    FROM labs WHERE patient_id = ?
    ORDER BY collected_at DESC LIMIT 15
  `).all(patientId);

  if (!labs.length) {
    return "No lab results on file yet. When you get labs done, I can track them for you. Reply 'next' to continue.";
  }

  let msg = "Here's a summary of your recent lab results:\n\n";
  let flaggedCount = 0;
  labs.forEach((l: any) => {
    const flagMarker = l.flag === "high" ? " ⬆" : l.flag === "low" ? " ⬇" : l.flag === "critical" ? " ⚠" : "";
    msg += `${l.test_name}: ${l.value}${l.unit ? " " + l.unit : ""}${flagMarker}`;
    if (l.reference_range) msg += ` (ref: ${l.reference_range})`;
    msg += "\n";
    if (l.flag && l.flag !== "normal") flaggedCount++;
  });

  if (flaggedCount > 0) {
    msg += `\n${flaggedCount} result(s) are flagged — your doctor is aware of these.`;
  }
  msg += "\n\nI'll keep track of your labs over time so you can see trends. Reply 'next' to continue.";
  return msg;
}

function getImagingReview(db: any, patientId: string): string {
  const studies = db.prepare(`
    SELECT study_type, body_part, modality, impression, performed_at, follow_up_needed, follow_up_notes
    FROM imaging WHERE patient_id = ?
    ORDER BY performed_at DESC LIMIT 10
  `).all(patientId);

  if (!studies.length) {
    return "No imaging studies on file. Reply 'next' to continue.";
  }

  let msg = "Your imaging studies on file:\n\n";
  studies.forEach((s: any, i: number) => {
    msg += `${i + 1}. ${s.study_type} (${s.modality.toUpperCase()}) — ${s.body_part}`;
    msg += `\n   Date: ${s.performed_at}`;
    if (s.impression) msg += `\n   Finding: ${s.impression.slice(0, 100)}${s.impression.length > 100 ? "..." : ""}`;
    if (s.follow_up_needed) msg += `\n   Follow-up needed: ${s.follow_up_notes || "Yes"}`;
    msg += "\n";
  });
  msg += "\nReply 'next' to continue.";
  return msg;
}

function getInsuranceConfirmation(db: any, patientId: string): string {
  const plans = db.prepare(
    "SELECT tier, payer_name, plan_name, member_id, copay FROM insurance WHERE patient_id = ?"
  ).all(patientId);

  if (!plans.length) {
    return "No insurance info on file. You can add it later or tell me your plan details now. Reply 'next' to skip.";
  }

  let msg = "Insurance on file:\n\n";
  plans.forEach((p: any) => {
    msg += `${p.tier.toUpperCase()}: ${p.payer_name}`;
    if (p.plan_name) msg += ` (${p.plan_name})`;
    msg += `\nMember ID: ${p.member_id}`;
    if (p.copay) msg += `\nCopay: ${p.copay}`;
    msg += "\n\n";
  });
  msg += "Look right? Reply YES to confirm or tell me what needs updating.";
  return msg;
}

function getGoalsPrompt(db: any, patientId: string): string {
  const existingGoals = db.prepare(
    "SELECT title, category FROM patient_goals WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const conditions = db.prepare(
    "SELECT description FROM conditions WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const meds = db.prepare(
    "SELECT name FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  let msg = "Now let's set some health goals! These help me know what to focus on when we chat.\n\n";

  if (existingGoals.length) {
    msg += "Your doctor already set up some goals:\n";
    existingGoals.forEach((g: any, i: number) => {
      msg += `${i + 1}. ${g.title}\n`;
    });
    msg += "\n";
  }

  msg += "Here are some common goals I can help with:\n\n";

  // Suggest goals based on their conditions and meds
  const suggestions: string[] = [];

  if (meds.length > 0) {
    suggestions.push("Take my medications on time every day");
  }
  if (conditions.some((c: any) => /hypertension|blood pressure/i.test(c.description))) {
    suggestions.push("Keep my blood pressure under control");
  }
  if (conditions.some((c: any) => /diabetes|a1c|glucose/i.test(c.description))) {
    suggestions.push("Manage my blood sugar levels");
  }
  if (conditions.some((c: any) => /weight|obesity|bmi/i.test(c.description))) {
    suggestions.push("Reach a healthy weight");
  }

  // Always offer these
  suggestions.push("Stay active — walk or exercise regularly");
  suggestions.push("Keep up with all my doctor appointments");
  suggestions.push("Track my symptoms and vitals");

  suggestions.forEach((s, i) => {
    msg += `${i + 1}. ${s}\n`;
  });

  msg += "\nPick any numbers that matter to you (like '1, 3, 5'), or tell me your own goal in your own words. You can always add more later.";
  return msg;
}

function getMonitoringPrompt(db: any, patientId: string): string {
  const goals = db.prepare(
    "SELECT id, title, category FROM patient_goals WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const meds = db.prepare(
    "SELECT name, frequency FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  let msg = "Last step — let's set up your monitoring so I know when to check in.\n\n";

  if (meds.length > 0) {
    msg += "MEDICATION REMINDERS:\n";
    msg += "Want me to remind you when it's time to take your meds? Reply YES and I'll set that up based on your medication schedule.\n\n";
  }

  if (goals.some((g: any) => g.category === "vitals_monitoring" || g.category === "weight_management")) {
    msg += "VITALS CHECK-INS:\n";
    msg += "I can ask you for your BP, weight, or glucose readings on a regular schedule.\n\n";
  }

  msg += "DAILY CHECK-IN:\n";
  msg += "I can send you a quick \"How are you feeling?\" each morning. It takes 10 seconds to reply.\n\n";

  msg += "Reply YES to set up all of these, or tell me which ones you want. You can change this anytime.";
  return msg;
}

function getCompletionMessage(db: any, patientId: string): string {
  const patient = db.prepare("SELECT first_name FROM patient WHERE id = ?").get(patientId);
  const name = patient?.first_name || "there";
  const goalCount = db.prepare(
    "SELECT COUNT(*) as count FROM patient_goals WHERE patient_id = ? AND status = 'active'"
  ).get(patientId)?.count || 0;
  const medCount = db.prepare(
    "SELECT COUNT(*) as count FROM medications WHERE patient_id = ? AND status = 'active'"
  ).get(patientId)?.count || 0;

  let msg = `You're all set, ${name}! Here's what I've got:\n\n`;
  if (medCount > 0) msg += `- ${medCount} medication(s) I'm tracking\n`;
  if (goalCount > 0) msg += `- ${goalCount} health goal(s) we're working on\n`;
  msg += `- Your health records are loaded and secure\n\n`;
  msg += "From now on, just text me anytime. I'm here 24/7. Some things you can try:\n\n";
  msg += "- \"Took my Metformin\" — log a medication\n";
  msg += "- \"BP 128/82\" — record a vitals reading\n";
  msg += "- \"Feeling dizzy today\" — log a symptom\n";
  msg += "- \"When's my next appointment?\" — check your schedule\n";
  msg += "- \"How are my labs?\" — review recent results\n\n";
  msg += "I'll send you reminders based on your preferences. You can always text STOP to pause or HELP for options.";
  return msg;
}

// ──────────────────────────────────────────────
// Response Processors (handle patient replies)
// ──────────────────────────────────────────────

function processStepResponse(
  db: any,
  patientId: string,
  state: OnboardingState,
  message: string
): string {
  const lower = message.trim().toLowerCase();
  const step = state.currentStep;

  // Universal commands
  if (lower === "skip" || lower === "next") {
    return advanceStep(db, patientId, state);
  }
  if (lower === "back" || lower === "previous") {
    return goBackStep(db, patientId, state);
  }
  if (lower === "help") {
    return "You're going through the setup process. Reply:\n- 'next' or 'skip' to move on\n- 'back' to go to the previous step\n- 'yes' to confirm\n- Or just answer the question naturally!\n\nYour current step: " + friendlyStepName(step);
  }

  switch (step) {
    case "welcome":
      if (isAffirmative(lower)) {
        return advanceStep(db, patientId, state);
      }
      return "No rush! Just reply YES whenever you're ready to get started.";

    case "verify_identity":
      return processVerification(db, patientId, state, message);

    case "confirm_demographics":
      if (isAffirmative(lower)) {
        state.patientConfirmations["demographics"] = true;
        return advanceStep(db, patientId, state);
      }
      // They want to update something — store the note and move on
      logPatientNote(db, patientId, "demographics_update", message);
      state.patientConfirmations["demographics"] = true;
      return "Got it — I've noted that update for your records. " + advanceStep(db, patientId, state);

    case "confirm_conditions":
      if (isAffirmative(lower)) {
        state.patientConfirmations["conditions"] = true;
        return advanceStep(db, patientId, state);
      }
      logPatientNote(db, patientId, "conditions_update", message);
      state.patientConfirmations["conditions"] = true;
      return "Noted! I'll flag that for your doctor. " + advanceStep(db, patientId, state);

    case "confirm_medications":
      if (isAffirmative(lower) || /remind/i.test(lower)) {
        state.patientConfirmations["medications"] = true;
        if (/remind/i.test(lower) || /yes/i.test(lower)) {
          setupMedicationReminders(db, patientId);
        }
        return advanceStep(db, patientId, state);
      }
      logPatientNote(db, patientId, "medications_update", message);
      state.patientConfirmations["medications"] = true;
      return "Got it — I've noted those medication updates. " + advanceStep(db, patientId, state);

    case "review_labs":
    case "review_imaging":
      return advanceStep(db, patientId, state);

    case "confirm_insurance":
      if (isAffirmative(lower)) {
        state.patientConfirmations["insurance"] = true;
        return advanceStep(db, patientId, state);
      }
      logPatientNote(db, patientId, "insurance_update", message);
      state.patientConfirmations["insurance"] = true;
      return "I've noted those updates. " + advanceStep(db, patientId, state);

    case "set_goals":
      return processGoalSelection(db, patientId, state, message);

    case "set_communication_prefs":
      return processCommunicationPrefs(db, patientId, state, message);

    case "set_monitoring_prefs":
      return processMonitoringPrefs(db, patientId, state, message);

    default:
      return advanceStep(db, patientId, state);
  }
}

function processVerification(db: any, patientId: string, state: OnboardingState, message: string): string {
  const patient = db.prepare("SELECT date_of_birth FROM patient WHERE id = ?").get(patientId);

  if (!patient?.date_of_birth) {
    // No DOB on file — just accept and move on
    state.patientConfirmations["identity"] = true;
    return "Thanks! " + advanceStep(db, patientId, state);
  }

  // Normalize both dates for comparison (strip dashes, slashes)
  const normalize = (d: string) => d.replace(/[-/]/g, "").replace(/^(\d{2})(\d{2})(\d{4})$/, "$3$1$2");
  const inputNorm = normalize(message.trim());
  const dobNorm = normalize(patient.date_of_birth);

  // Fuzzy match — be generous
  if (inputNorm.includes(dobNorm) || dobNorm.includes(inputNorm) || message.trim().includes(patient.date_of_birth)) {
    state.patientConfirmations["identity"] = true;
    return "Verified! " + advanceStep(db, patientId, state);
  }

  return "That doesn't match what I have on file. Can you try again? Format: MM/DD/YYYY";
}

function processGoalSelection(db: any, patientId: string, state: OnboardingState, message: string): string {
  const lower = message.trim().toLowerCase();

  // Build the same suggestion list as the prompt
  const conditions = db.prepare(
    "SELECT description FROM conditions WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);
  const meds = db.prepare(
    "SELECT name FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  const suggestions: Array<{ title: string; category: string }> = [];

  if (meds.length > 0) {
    suggestions.push({ title: "Take my medications on time every day", category: "medication_adherence" });
  }
  if (conditions.some((c: any) => /hypertension|blood pressure/i.test(c.description))) {
    suggestions.push({ title: "Keep my blood pressure under control", category: "vitals_monitoring" });
  }
  if (conditions.some((c: any) => /diabetes|a1c|glucose/i.test(c.description))) {
    suggestions.push({ title: "Manage my blood sugar levels", category: "vitals_monitoring" });
  }
  if (conditions.some((c: any) => /weight|obesity|bmi/i.test(c.description))) {
    suggestions.push({ title: "Reach a healthy weight", category: "weight_management" });
  }
  suggestions.push({ title: "Stay active — walk or exercise regularly", category: "activity" });
  suggestions.push({ title: "Keep up with all my doctor appointments", category: "appointment_compliance" });
  suggestions.push({ title: "Track my symptoms and vitals", category: "vitals_monitoring" });

  // Parse number selections (e.g., "1, 3, 5" or "1 3 5" or "1,3,5")
  const numbers = message.match(/\d+/g);
  const selectedGoals: Array<{ title: string; category: string }> = [];

  if (numbers) {
    for (const n of numbers) {
      const idx = parseInt(n) - 1;
      if (idx >= 0 && idx < suggestions.length) {
        selectedGoals.push(suggestions[idx]);
      }
    }
  }

  // If they typed a custom goal (no numbers or mixed)
  if (selectedGoals.length === 0 && !isAffirmative(lower) && lower !== "none") {
    // Treat their message as a custom goal
    const stmt = db.prepare(`
      INSERT INTO patient_goals (patient_id, category, title, start_date, priority, status)
      VALUES (?, 'custom', ?, date('now'), 'medium', 'active')
    `);
    stmt.run(patientId, message.trim());
    selectedGoals.push({ title: message.trim(), category: "custom" });
  }

  // Insert selected suggestion goals
  const stmt = db.prepare(`
    INSERT INTO patient_goals (patient_id, category, title, start_date, priority, status)
    VALUES (?, ?, ?, date('now'), 'medium', 'active')
  `);
  for (const g of selectedGoals) {
    if (g.category !== "custom") { // custom already inserted above
      stmt.run(patientId, g.category, g.title);
    }
  }

  if (selectedGoals.length > 0) {
    let msg = `Great choices! I've set up ${selectedGoals.length} goal(s):\n`;
    selectedGoals.forEach((g, i) => {
      msg += `- ${g.title}\n`;
    });
    msg += "\nI'll check in with you on these regularly. ";
    state.patientConfirmations["goals"] = true;
    return msg + advanceStep(db, patientId, state);
  }

  if (lower === "none" || isAffirmative(lower)) {
    state.patientConfirmations["goals"] = true;
    return "No problem — you can always add goals later by texting me. " + advanceStep(db, patientId, state);
  }

  return "Just pick some numbers from the list (like '1, 3, 5'), type your own goal, or reply 'none' to skip.";
}

function processCommunicationPrefs(db: any, patientId: string, state: OnboardingState, message: string): string {
  const lower = message.trim().toLowerCase();
  let schedule = "daily"; // default

  if (lower.includes("1") || lower.includes("daily")) {
    schedule = "daily";
  } else if (lower.includes("2") || lower.includes("few")) {
    schedule = "3x_weekly";
  } else if (lower.includes("3") || lower.includes("reminder")) {
    schedule = "reminders_only";
  } else if (lower.includes("4") || lower.includes("reach out") || lower.includes("i'll")) {
    schedule = "on_demand";
  }

  // Store preference as a monitoring rule
  db.prepare(`
    INSERT INTO monitoring_rules (patient_id, type, config, enabled)
    VALUES (?, 'daily_checkin', ?, 1)
  `).run(patientId, JSON.stringify({
    schedule,
    cronExpression: schedule === "daily" ? "0 9 * * *" :
                    schedule === "3x_weekly" ? "0 9 * * 1,3,5" :
                    null,
    reminderMessage: "Good morning! How are you feeling today?"
  }));

  const scheduleMsg = schedule === "daily" ? "every morning" :
                      schedule === "3x_weekly" ? "a few times a week" :
                      schedule === "reminders_only" ? "only for medication/appointment reminders" :
                      "only when you reach out";

  state.patientConfirmations["communication_prefs"] = true;
  return `Got it — I'll check in ${scheduleMsg}. You can always change this by texting me "change check-in schedule". ` + advanceStep(db, patientId, state);
}

function processMonitoringPrefs(db: any, patientId: string, state: OnboardingState, message: string): string {
  const lower = message.trim().toLowerCase();

  if (isAffirmative(lower) || lower.includes("all") || lower.includes("set")) {
    // Set up everything
    setupMedicationReminders(db, patientId);
    setupVitalsMonitoring(db, patientId);
    setupDailyCheckin(db, patientId);

    state.patientConfirmations["monitoring_prefs"] = true;
    return "All set! I've turned on medication reminders, vitals tracking, and daily check-ins. " + advanceStep(db, patientId, state);
  }

  if (lower.includes("med")) {
    setupMedicationReminders(db, patientId);
    state.patientConfirmations["monitoring_prefs"] = true;
    return "Medication reminders are on! " + advanceStep(db, patientId, state);
  }

  if (lower.includes("vital") || lower.includes("bp") || lower.includes("weight")) {
    setupVitalsMonitoring(db, patientId);
    state.patientConfirmations["monitoring_prefs"] = true;
    return "Vitals tracking is on! " + advanceStep(db, patientId, state);
  }

  if (lower.includes("no") || lower.includes("none")) {
    state.patientConfirmations["monitoring_prefs"] = true;
    return "No problem — you can always turn on monitoring later. " + advanceStep(db, patientId, state);
  }

  state.patientConfirmations["monitoring_prefs"] = true;
  return advanceStep(db, patientId, state);
}

// ──────────────────────────────────────────────
// Monitoring Setup Helpers
// ──────────────────────────────────────────────

function setupMedicationReminders(db: any, patientId: string): void {
  const meds = db.prepare(
    "SELECT id, name, frequency FROM medications WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  for (const med of meds) {
    // Parse frequency into reminder times
    const times = parseFrequencyToTimes(med.frequency);
    db.prepare(`
      INSERT INTO monitoring_rules (patient_id, type, config, enabled)
      VALUES (?, 'medication_adherence', ?, 1)
    `).run(patientId, JSON.stringify({
      medicationName: med.name,
      reminderTimes: times,
      reminderMessage: `Time to take your ${med.name}!`,
      adherenceThreshold: 80,
    }));
  }
}

function setupVitalsMonitoring(db: any, patientId: string): void {
  const conditions = db.prepare(
    "SELECT description FROM conditions WHERE patient_id = ? AND status = 'active'"
  ).all(patientId);

  // Set up BP monitoring if hypertension
  if (conditions.some((c: any) => /hypertension|blood pressure|htn/i.test(c.description))) {
    db.prepare(`
      INSERT INTO monitoring_rules (patient_id, type, config, enabled)
      VALUES (?, 'vitals_threshold', ?, 1)
    `).run(patientId, JSON.stringify({
      vitalType: "blood_pressure",
      warningMax: 140,
      urgentMax: 180,
      cronExpression: "0 8 * * *",
      reminderMessage: "Good morning! Can you check your blood pressure and text me the reading?"
    }));
  }

  // Set up glucose monitoring if diabetes
  if (conditions.some((c: any) => /diabetes|glucose|a1c/i.test(c.description))) {
    db.prepare(`
      INSERT INTO monitoring_rules (patient_id, type, config, enabled)
      VALUES (?, 'vitals_threshold', ?, 1)
    `).run(patientId, JSON.stringify({
      vitalType: "glucose",
      warningMin: 70,
      warningMax: 180,
      urgentMin: 54,
      urgentMax: 300,
      cronExpression: "0 7 * * *",
      reminderMessage: "Morning! What's your fasting blood sugar today?"
    }));
  }

  // Weight monitoring if relevant
  if (conditions.some((c: any) => /heart failure|chf|weight|obesity/i.test(c.description))) {
    db.prepare(`
      INSERT INTO monitoring_rules (patient_id, type, config, enabled)
      VALUES (?, 'vitals_threshold', ?, 1)
    `).run(patientId, JSON.stringify({
      vitalType: "weight",
      cronExpression: "0 7 * * *",
      reminderMessage: "Good morning! Can you step on the scale and text me your weight?"
    }));
  }
}

function setupDailyCheckin(db: any, patientId: string): void {
  // Check if already exists
  const existing = db.prepare(
    "SELECT id FROM monitoring_rules WHERE patient_id = ? AND type = 'daily_checkin'"
  ).get(patientId);

  if (!existing) {
    db.prepare(`
      INSERT INTO monitoring_rules (patient_id, type, config, enabled)
      VALUES (?, 'daily_checkin', ?, 1)
    `).run(patientId, JSON.stringify({
      cronExpression: "0 9 * * *",
      reminderMessage: "Good morning! How are you feeling today?"
    }));
  }
}

// ──────────────────────────────────────────────
// State Machine Helpers
// ──────────────────────────────────────────────

function advanceStep(db: any, patientId: string, state: OnboardingState): string {
  const currentIdx = STEP_ORDER.indexOf(state.currentStep);
  if (currentIdx < 0 || currentIdx >= STEP_ORDER.length - 1) {
    state.currentStep = "complete";
    state.completedAt = new Date().toISOString();
    updateOnboardingState(db, patientId, state);
    return generateStepMessage(db, patientId, "complete");
  }

  state.stepsCompleted.push(state.currentStep);

  // Find next step that has relevant data (skip empty steps)
  let nextIdx = currentIdx + 1;
  while (nextIdx < STEP_ORDER.length - 1) {
    const nextStep = STEP_ORDER[nextIdx];
    if (shouldSkipStep(db, patientId, nextStep)) {
      state.stepsCompleted.push(nextStep);
      nextIdx++;
    } else {
      break;
    }
  }

  state.currentStep = STEP_ORDER[nextIdx];
  state.lastInteractionAt = new Date().toISOString();
  updateOnboardingState(db, patientId, state);
  return generateStepMessage(db, patientId, state.currentStep);
}

function goBackStep(db: any, patientId: string, state: OnboardingState): string {
  if (state.stepsCompleted.length === 0) {
    return "You're at the beginning! " + generateStepMessage(db, patientId, state.currentStep);
  }
  state.currentStep = state.stepsCompleted.pop()!;
  updateOnboardingState(db, patientId, state);
  return generateStepMessage(db, patientId, state.currentStep);
}

function shouldSkipStep(db: any, patientId: string, step: OnboardingStep): boolean {
  switch (step) {
    case "review_labs": {
      const count = db.prepare("SELECT COUNT(*) as c FROM labs WHERE patient_id = ?").get(patientId)?.c;
      return count === 0;
    }
    case "review_imaging": {
      const count = db.prepare("SELECT COUNT(*) as c FROM imaging WHERE patient_id = ?").get(patientId)?.c;
      return count === 0;
    }
    case "confirm_insurance": {
      const count = db.prepare("SELECT COUNT(*) as c FROM insurance WHERE patient_id = ?").get(patientId)?.c;
      return count === 0;
    }
    default:
      return false;
  }
}

// ──────────────────────────────────────────────
// Database State Operations
// ──────────────────────────────────────────────

function getOnboardingState(db: any, patientId: string): OnboardingState | null {
  const row = db.prepare("SELECT * FROM onboarding_state WHERE patient_id = ?").get(patientId);
  if (!row) return null;

  return {
    patientId: row.patient_id,
    currentStep: row.current_step as OnboardingStep,
    stepsCompleted: JSON.parse(row.steps_completed),
    startedAt: row.started_at,
    lastInteractionAt: row.last_interaction_at,
    completedAt: row.completed_at || undefined,
    patientConfirmations: JSON.parse(row.patient_confirmations),
  };
}

function initializeOnboarding(db: any, patientId: string): OnboardingState {
  const state: OnboardingState = {
    patientId,
    currentStep: "welcome",
    stepsCompleted: [],
    startedAt: new Date().toISOString(),
    lastInteractionAt: new Date().toISOString(),
    patientConfirmations: {},
  };

  db.prepare(`
    INSERT INTO onboarding_state (patient_id, current_step, steps_completed,
      started_at, last_interaction_at, patient_confirmations)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(patient_id) DO UPDATE SET
      current_step = excluded.current_step,
      steps_completed = excluded.steps_completed,
      last_interaction_at = excluded.last_interaction_at,
      patient_confirmations = excluded.patient_confirmations
  `).run(
    patientId, state.currentStep,
    JSON.stringify(state.stepsCompleted),
    state.startedAt, state.lastInteractionAt,
    JSON.stringify(state.patientConfirmations)
  );

  return state;
}

function updateOnboardingState(db: any, patientId: string, state: OnboardingState): void {
  db.prepare(`
    UPDATE onboarding_state SET
      current_step = ?,
      steps_completed = ?,
      last_interaction_at = ?,
      completed_at = ?,
      patient_confirmations = ?
    WHERE patient_id = ?
  `).run(
    state.currentStep,
    JSON.stringify(state.stepsCompleted),
    state.lastInteractionAt,
    state.completedAt || null,
    JSON.stringify(state.patientConfirmations),
    patientId
  );
}

// ──────────────────────────────────────────────
// Utility Helpers
// ──────────────────────────────────────────────

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|yup|sure|ok|okay|y|confirm|correct|right|looks good|that's right|lgtm)$/i.test(text.trim());
}

function logPatientNote(db: any, patientId: string, type: string, message: string): void {
  db.prepare(`
    INSERT INTO clinical_notes (patient_id, note_type, author, author_role, content, date_of_service, summary)
    VALUES (?, 'other', 'patient', 'patient', ?, date('now'), ?)
  `).run(patientId, message, `Patient update during onboarding: ${type}`);
}

function friendlyStepName(step: OnboardingStep): string {
  const names: Record<OnboardingStep, string> = {
    welcome: "Welcome",
    verify_identity: "Identity Verification",
    confirm_demographics: "Contact Info",
    confirm_conditions: "Health Conditions",
    confirm_medications: "Medications",
    review_labs: "Lab Results",
    review_imaging: "Imaging",
    confirm_insurance: "Insurance",
    set_goals: "Health Goals",
    set_communication_prefs: "Communication Preferences",
    set_monitoring_prefs: "Monitoring Setup",
    complete: "All Done!",
  };
  return names[step] || step;
}

function parseFrequencyToTimes(frequency: string): string[] {
  const lower = frequency.toLowerCase();

  if (/once daily|qd|every day|daily/.test(lower)) return ["08:00"];
  if (/twice daily|bid|2x|two times/.test(lower)) return ["08:00", "20:00"];
  if (/three times|tid|3x/.test(lower)) return ["08:00", "14:00", "20:00"];
  if (/four times|qid|4x/.test(lower)) return ["08:00", "12:00", "16:00", "20:00"];
  if (/morning|am|breakfast/.test(lower)) return ["08:00"];
  if (/evening|pm|dinner|bedtime|night/.test(lower)) return ["20:00"];
  if (/every (\d+) hours?/.test(lower)) {
    const match = lower.match(/every (\d+) hours?/);
    const interval = parseInt(match![1]);
    const times: string[] = [];
    for (let h = 8; h < 22; h += interval) {
      times.push(`${h.toString().padStart(2, "0")}:00`);
    }
    return times;
  }

  // Default: once daily in the morning
  return ["08:00"];
}

/**
 * Check if a patient is currently in the onboarding flow.
 * Used by the gateway to route messages to onboarding vs. normal agent.
 */
export function isPatientOnboarding(db: any, patientId: string): boolean {
  const state = db.prepare(
    "SELECT current_step, completed_at FROM onboarding_state WHERE patient_id = ?"
  ).get(patientId);

  if (!state) return false;
  return state.current_step !== "complete" && !state.completed_at;
}
