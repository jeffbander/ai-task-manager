# Medication Reminder Skill

## Purpose
Manages medication schedules, sends reminders at prescribed times, tracks
adherence (taken/missed/late), and alerts the physician when adherence drops.

## Clinical References
- WHO Adherence Report: medication non-adherence affects 50% of chronic patients
- CMS CCM Guidelines: medication management is a core CCM billable activity

## Safety Notes
- This skill NEVER recommends medication changes
- It only reminds about medications already prescribed by the supervising physician
- Missed dose patterns are flagged to the physician, not actioned autonomously

## Triggers
- Cron-based: fires at each medication's scheduled time
- Patient-initiated: "Did I take my morning pills?"
- Adherence check: weekly summary of adherence rates
