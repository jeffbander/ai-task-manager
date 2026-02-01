# Physician Escalation Skill

## Purpose
Detects situations requiring physician attention and creates alerts on the
Doctor Portal. This is the critical safety skill — it ensures no concerning
patient interaction goes unnoticed.

## Escalation Triggers
- Emergency keywords detected (chest pain, difficulty breathing, etc.)
- Patient reports new or worsening symptoms
- Medication adherence drops below threshold (configurable, default 80%)
- Vital signs outside safe ranges
- Patient asks clinical questions the agent cannot safely answer
- Any situation where the agent is uncertain

## Severity Levels
- **info**: FYI for the physician (e.g., patient asked about diet)
- **warning**: Needs physician review within 24h (e.g., adherence dropping)
- **urgent**: Needs physician review within 4h (e.g., new symptoms)
- **emergency**: Immediate attention (e.g., chest pain reported)

## Safety Notes
- When in doubt, ALWAYS escalate
- Emergency escalations also instruct the patient to call 911
- All escalations are logged in the audit trail
