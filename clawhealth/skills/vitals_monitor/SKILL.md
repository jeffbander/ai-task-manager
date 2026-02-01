# Vitals Monitor Skill

## Purpose
Ingests vital signs from patient-reported data, Apple Health / HealthKit
exports, and connected devices (BP cuffs, glucose monitors, scales). Tracks
trends and flags concerning patterns for physician review.

## Supported Vitals
- Blood pressure (systolic/diastolic)
- Heart rate (resting, active)
- Weight
- Blood glucose (fasting, post-meal)
- SpO2
- Temperature
- Steps / activity
- Sleep duration and quality

## Data Sources
- Patient self-report via text ("My BP was 145/92 this morning")
- Apple Health XML export parsing
- Google Health Connect API
- Direct device integrations (Omron, Dexcom, Withings — Phase 2)

## Clinical Thresholds (Cardiology defaults)
- BP > 140/90: flag as warning
- BP > 180/120: flag as urgent
- HR < 50 or > 120 at rest: flag as warning
- Weight gain > 3 lbs in 24h or > 5 lbs in 7 days: flag as urgent (heart failure)
- SpO2 < 92%: flag as urgent

## Safety Notes
- Thresholds are configurable per patient by the supervising physician
- This skill NEVER interprets readings clinically — it flags for the physician
- Trends are presented factually: "Your BP has averaged 142/88 this week"
