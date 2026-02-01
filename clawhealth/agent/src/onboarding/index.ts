/**
 * Patient Onboarding — Module Exports
 *
 * Everything needed to onboard a patient:
 * 1. Import bulk clinical data (clinic staff)
 * 2. Run conversational onboarding (patient texts bot)
 * 3. Set up goals and monitoring
 */

// Types
export type {
  BulkPatientImport,
  PatientDemographics,
  ConditionImport,
  MedicationImport,
  LabImport,
  ImagingImport,
  ClinicalNoteImport,
  InsuranceImport,
  AllergyImport,
  AppointmentImport,
  VitalImport,
  GoalImport,
  OnboardingStep,
  OnboardingState,
  PatientGoal,
  MonitoringRule,
  MonitoringConfig,
} from "./types.js";

// Schema
export { CREATE_TABLES_SQL, SCHEMA_VERSION } from "./schema.js";

// Bulk Data Import
export { importBulkPatientData, parseImportJson } from "./data-import.js";
export type { ImportResult } from "./data-import.js";

// Conversational Onboarding Flow
export {
  processOnboardingMessage,
  generateStepMessage,
  isPatientOnboarding,
} from "./conversational-flow.js";

// Goals & Monitoring
export {
  createGoal,
  getActiveGoals,
  getGoalById,
  updateGoalProgress,
  markGoalAchieved,
  pauseGoal,
  logGoalCheckIn,
  getGoalCheckIns,
  createMonitoringRule,
  getActiveMonitoringRules,
  disableMonitoringRule,
  generateGoalsSummary,
  processGoalCommand,
  checkVitalsThreshold,
  generateGoalSuggestions,
} from "./goals.js";
