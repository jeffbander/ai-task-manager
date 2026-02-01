/**
 * Onboarding Types
 *
 * Shared types for the patient onboarding system.
 * Covers bulk data import formats, onboarding state machine,
 * and patient goal/monitoring structures.
 */

// ──────────────────────────────────────────────
// Onboarding State Machine
// ──────────────────────────────────────────────

export type OnboardingStep =
  | "welcome"
  | "verify_identity"
  | "confirm_demographics"
  | "confirm_conditions"
  | "confirm_medications"
  | "review_labs"
  | "review_imaging"
  | "confirm_insurance"
  | "set_goals"
  | "set_communication_prefs"
  | "set_monitoring_prefs"
  | "complete";

export interface OnboardingState {
  patientId: string;
  currentStep: OnboardingStep;
  stepsCompleted: OnboardingStep[];
  startedAt: string;
  lastInteractionAt: string;
  completedAt?: string;
  verificationCode?: string;
  patientConfirmations: Record<string, boolean>;
}

// ──────────────────────────────────────────────
// Bulk Data Import — What the clinic dumps in
// ──────────────────────────────────────────────

export interface BulkPatientImport {
  demographics: PatientDemographics;
  conditions?: ConditionImport[];
  medications?: MedicationImport[];
  labs?: LabImport[];
  imaging?: ImagingImport[];
  notes?: ClinicalNoteImport[];
  insurance?: InsuranceImport;
  allergies?: AllergyImport[];
  appointments?: AppointmentImport[];
  vitals?: VitalImport[];
  goals?: GoalImport[];
}

export interface PatientDemographics {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  timezone?: string;
  language?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export interface ConditionImport {
  icd10Code: string;
  description: string;
  status: "active" | "resolved" | "inactive";
  severity?: "mild" | "moderate" | "severe";
  onsetDate?: string;
  resolvedDate?: string;
  notes?: string;
}

export interface MedicationImport {
  name: string;
  genericName?: string;
  dose: string;
  frequency: string;
  route?: string;
  prescriber?: string;
  startDate?: string;
  pharmacyName?: string;
  pharmacyPhone?: string;
  refillsRemaining?: number;
  nextRefillDate?: string;
  instructions?: string;
  status?: "active" | "discontinued" | "on_hold";
}

export interface LabImport {
  testName: string;
  testCode?: string;
  value: string;
  unit?: string;
  referenceRange?: string;
  flag?: "normal" | "low" | "high" | "critical";
  orderedBy?: string;
  collectedAt: string;
  resultedAt?: string;
  labFacility?: string;
  panelName?: string;
  notes?: string;
}

export interface ImagingImport {
  studyType: string;
  bodyPart: string;
  modality: "xray" | "ct" | "mri" | "ultrasound" | "pet" | "dexa" | "mammogram" | "other";
  indication?: string;
  findings?: string;
  impression?: string;
  orderedBy?: string;
  performedAt: string;
  facility?: string;
  radiologist?: string;
  status: "ordered" | "scheduled" | "completed" | "cancelled";
  followUpNeeded?: boolean;
  followUpNotes?: string;
}

export interface ClinicalNoteImport {
  noteType: "progress" | "hpi" | "discharge" | "consult" | "procedure" | "phone" | "telehealth" | "other";
  author: string;
  authorRole?: string;
  content: string;
  summary?: string;
  dateOfService: string;
  diagnoses?: string[];
  planItems?: string[];
}

export interface InsuranceImport {
  primary: InsurancePlan;
  secondary?: InsurancePlan;
  hasReferralRequirement?: boolean;
  priorAuthNotes?: string;
}

export interface InsurancePlan {
  payerName: string;
  planName?: string;
  memberId: string;
  groupNumber?: string;
  subscriberName?: string;
  subscriberRelationship?: "self" | "spouse" | "child" | "other";
  effectiveDate?: string;
  terminationDate?: string;
  copay?: string;
  deductible?: string;
  deductibleMet?: string;
  outOfPocketMax?: string;
  outOfPocketMet?: string;
  phone?: string;
}

export interface AllergyImport {
  allergen: string;
  type: "drug" | "food" | "environmental" | "other";
  reaction?: string;
  severity?: "mild" | "moderate" | "severe" | "life_threatening";
  onsetDate?: string;
  status?: "active" | "inactive" | "resolved";
}

export interface AppointmentImport {
  providerName: string;
  providerSpecialty?: string;
  location?: string;
  datetime: string;
  durationMinutes?: number;
  type?: "follow_up" | "annual" | "procedure" | "lab_work" | "imaging" | "therapy" | "other";
  reason?: string;
  prepInstructions?: string;
  status?: "scheduled" | "completed" | "cancelled" | "no_show";
}

export interface VitalImport {
  type: "blood_pressure" | "heart_rate" | "weight" | "glucose" | "spo2" | "temperature" | "steps" | "sleep";
  value: string;
  unit?: string;
  source?: string;
  recordedAt: string;
}

export interface GoalImport {
  category: "medication_adherence" | "vitals_monitoring" | "activity" | "diet" | "symptom_management" | "appointment_compliance" | "weight_management" | "lab_targets" | "custom";
  title: string;
  description?: string;
  targetValue?: string;
  targetUnit?: string;
  frequency?: string;
  startDate?: string;
  targetDate?: string;
  priority?: "low" | "medium" | "high";
}

// ──────────────────────────────────────────────
// Patient Goals & Monitoring
// ──────────────────────────────────────────────

export interface PatientGoal {
  id?: number;
  patientId: string;
  category: GoalImport["category"];
  title: string;
  description?: string;
  targetValue?: string;
  targetUnit?: string;
  currentValue?: string;
  frequency?: string;
  startDate: string;
  targetDate?: string;
  status: "active" | "achieved" | "paused" | "abandoned";
  priority: "low" | "medium" | "high";
  checkInSchedule?: string; // cron expression
  lastCheckIn?: string;
  progressNotes?: string;
}

export interface MonitoringRule {
  id?: number;
  patientId: string;
  goalId?: number;
  type: "vitals_threshold" | "medication_adherence" | "appointment_reminder" | "daily_checkin" | "lab_due" | "goal_checkin";
  config: MonitoringConfig;
  enabled: boolean;
  createdAt?: string;
}

export interface MonitoringConfig {
  // For vitals thresholds
  vitalType?: string;
  warningMin?: number;
  warningMax?: number;
  urgentMin?: number;
  urgentMax?: number;

  // For adherence tracking
  medicationName?: string;
  adherenceThreshold?: number; // percentage below which to alert

  // For scheduling
  cronExpression?: string;
  reminderTimes?: string[];
  reminderMessage?: string;

  // For lab tracking
  labTestName?: string;
  labDueDate?: string;
  labTargetRange?: string;
}

// ──────────────────────────────────────────────
// Conversational Onboarding Messages
// ──────────────────────────────────────────────

export interface OnboardingMessage {
  step: OnboardingStep;
  direction: "outbound" | "inbound";
  message: string;
  options?: string[];
  expectsResponse: boolean;
  responseType?: "yes_no" | "free_text" | "number" | "choice" | "none";
}
