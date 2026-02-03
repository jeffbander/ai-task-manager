#!/usr/bin/env node

/**
 * ClawHealth Patient Medication Management System
 * 
 * Handles medication schedules, adherence tracking, and intelligent reminders
 */

import Database from 'better-sqlite3';
import cron from 'node-cron';
import { format, addHours, isAfter, isBefore } from 'date-fns';

class MedicationManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.initializeDatabase();
    this.startScheduler();
  }

  initializeDatabase() {
    // Enhanced medication tracking schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        name TEXT NOT NULL,
        generic_name TEXT,
        dosage TEXT NOT NULL,
        frequency TEXT NOT NULL,
        times_per_day INTEGER NOT NULL,
        schedule_times TEXT, -- JSON array of times
        instructions TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        prescriber TEXT,
        pharmacy TEXT,
        refill_reminder_days INTEGER DEFAULT 7,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS medication_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER REFERENCES medications(id),
        patient_id TEXT NOT NULL,
        scheduled_time TIMESTAMP NOT NULL,
        actual_time TIMESTAMP,
        status TEXT CHECK(status IN ('taken', 'missed', 'skipped', 'late')) NOT NULL,
        notes TEXT,
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS adherence_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        medication_id INTEGER REFERENCES medications(id),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        total_doses INTEGER NOT NULL,
        taken_doses INTEGER NOT NULL,
        adherence_percentage REAL NOT NULL,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS medication_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL,
        medication_id INTEGER REFERENCES medications(id),
        reminder_time TIMESTAMP NOT NULL,
        status TEXT CHECK(status IN ('pending', 'sent', 'acknowledged', 'missed')) DEFAULT 'pending',
        reminder_type TEXT CHECK(reminder_type IN ('dose', 'refill', 'appointment')) DEFAULT 'dose',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Medication management database initialized');
  }

  // Add medication for a patient
  addMedication(patientId, medicationData) {
    const {
      name,
      genericName,
      dosage,
      frequency,
      timesPerDay,
      scheduleTimes,
      instructions,
      startDate,
      endDate,
      prescriber,
      pharmacy
    } = medicationData;

    const stmt = this.db.prepare(`
      INSERT INTO medications (
        patient_id, name, generic_name, dosage, frequency, times_per_day,
        schedule_times, instructions, start_date, end_date, prescriber, pharmacy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      patientId,
      name,
      genericName,
      dosage,
      frequency,
      timesPerDay,
      JSON.stringify(scheduleTimes),
      instructions,
      startDate,
      endDate,
      prescriber,
      pharmacy
    );

    this.generateMedicationSchedule(result.lastInsertRowid, patientId, scheduleTimes, startDate, endDate);
    
    return result.lastInsertRowid;
  }

  // Generate scheduled doses for a medication
  generateMedicationSchedule(medicationId, patientId, scheduleTimes, startDate, endDate) {
    const reminderStmt = this.db.prepare(`
      INSERT INTO medication_reminders (patient_id, medication_id, reminder_time, reminder_type)
      VALUES (?, ?, ?, 'dose')
    `);

    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : addHours(start, 24 * 365); // Default to 1 year

    // Generate reminders for the next 30 days
    for (let date = start; isBefore(date, end) && isBefore(date, addHours(start, 24 * 30)); date = addHours(date, 24)) {
      scheduleTimes.forEach(time => {
        const [hours, minutes] = time.split(':').map(Number);
        const reminderTime = new Date(date);
        reminderTime.setHours(hours, minutes, 0, 0);

        if (isAfter(reminderTime, new Date())) { // Only future reminders
          reminderStmt.run(patientId, medicationId, reminderTime.toISOString());
        }
      });
    }

    console.log(`✅ Generated medication schedule for medication ${medicationId}`);
  }

  // Log medication taken/missed
  logMedicationEvent(patientId, medicationId, scheduledTime, status, notes = null) {
    const stmt = this.db.prepare(`
      INSERT INTO medication_logs (patient_id, medication_id, scheduled_time, actual_time, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const actualTime = status === 'taken' ? new Date().toISOString() : null;
    
    const result = stmt.run(
      patientId,
      medicationId,
      scheduledTime,
      actualTime,
      status,
      notes
    );

    // Update reminder status
    const updateReminderStmt = this.db.prepare(`
      UPDATE medication_reminders 
      SET status = 'acknowledged' 
      WHERE patient_id = ? AND medication_id = ? AND reminder_time = ?
    `);
    
    updateReminderStmt.run(patientId, medicationId, scheduledTime);

    // Recalculate adherence
    this.calculateAdherence(patientId, medicationId);

    return result.lastInsertRowid;
  }

  // Calculate adherence percentage
  calculateAdherence(patientId, medicationId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_doses,
        SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) as taken_doses
      FROM medication_logs
      WHERE patient_id = ? AND medication_id = ? AND scheduled_time >= ?
    `);

    const result = stmt.get(patientId, medicationId, startDate.toISOString());
    
    if (result.total_doses === 0) return 100; // No doses scheduled yet

    const adherencePercentage = (result.taken_doses / result.total_doses) * 100;

    // Store adherence stats
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO adherence_stats 
      (patient_id, medication_id, period_start, period_end, total_doses, taken_doses, adherence_percentage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      patientId,
      medicationId,
      startDate.toISOString().split('T')[0],
      new Date().toISOString().split('T')[0],
      result.total_doses,
      result.taken_doses,
      Math.round(adherencePercentage * 100) / 100
    );

    return adherencePercentage;
  }

  // Get pending medication reminders
  getPendingReminders(patientId = null) {
    const now = new Date().toISOString();
    let query = `
      SELECT 
        r.id,
        r.patient_id,
        r.medication_id,
        r.reminder_time,
        r.reminder_type,
        m.name as medication_name,
        m.dosage,
        m.instructions
      FROM medication_reminders r
      JOIN medications m ON r.medication_id = m.id
      WHERE r.status = 'pending' AND r.reminder_time <= ?
    `;

    const params = [now];
    
    if (patientId) {
      query += ' AND r.patient_id = ?';
      params.push(patientId);
    }

    query += ' ORDER BY r.reminder_time ASC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  // Get patient's medication summary
  getPatientMedicationSummary(patientId) {
    const medicationsStmt = this.db.prepare(`
      SELECT 
        m.*,
        COALESCE(a.adherence_percentage, 100) as recent_adherence
      FROM medications m
      LEFT JOIN adherence_stats a ON m.id = a.medication_id AND a.patient_id = m.patient_id
      WHERE m.patient_id = ? AND (m.end_date IS NULL OR m.end_date >= date('now'))
      ORDER BY m.created_at DESC
    `);

    const upcomingRemindersStmt = this.db.prepare(`
      SELECT 
        r.reminder_time,
        r.reminder_type,
        m.name as medication_name,
        m.dosage
      FROM medication_reminders r
      JOIN medications m ON r.medication_id = m.id
      WHERE r.patient_id = ? AND r.status = 'pending' 
        AND r.reminder_time > datetime('now')
        AND r.reminder_time <= datetime('now', '+24 hours')
      ORDER BY r.reminder_time ASC
      LIMIT 10
    `);

    const recentLogsStmt = this.db.prepare(`
      SELECT 
        l.*,
        m.name as medication_name,
        m.dosage
      FROM medication_logs l
      JOIN medications m ON l.medication_id = m.id
      WHERE l.patient_id = ?
      ORDER BY l.scheduled_time DESC
      LIMIT 20
    `);

    return {
      medications: medicationsStmt.all(patientId),
      upcomingReminders: upcomingRemindersStmt.all(patientId),
      recentLogs: recentLogsStmt.all(patientId)
    };
  }

  // Mark reminder as sent
  markReminderSent(reminderId) {
    const stmt = this.db.prepare(`
      UPDATE medication_reminders 
      SET status = 'sent' 
      WHERE id = ?
    `);
    
    return stmt.run(reminderId);
  }

  // Medication reminder scheduler
  startScheduler() {
    // Check for pending reminders every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.processPendingReminders();
    });

    console.log('✅ Medication reminder scheduler started');
  }

  async processPendingReminders() {
    const pendingReminders = this.getPendingReminders();
    
    for (const reminder of pendingReminders) {
      try {
        await this.sendMedicationReminder(reminder);
        this.markReminderSent(reminder.id);
      } catch (error) {
        console.error(`❌ Failed to send reminder ${reminder.id}:`, error);
      }
    }
  }

  async sendMedicationReminder(reminder) {
    const message = this.generateReminderMessage(reminder);
    
    // Send via ClawHealth SMS gateway
    const response = await fetch('http://localhost:19789/api/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: reminder.patient_id,
        message: message,
        type: 'medication_reminder'
      })
    });

    if (!response.ok) {
      throw new Error(`SMS send failed: ${response.status}`);
    }

    console.log(`✅ Medication reminder sent to patient ${reminder.patient_id}`);
  }

  generateReminderMessage(reminder) {
    const time = format(new Date(reminder.reminder_time), 'h:mm a');
    
    switch (reminder.reminder_type) {
      case 'dose':
        return `💊 Medication Reminder: It's time to take your ${reminder.medication_name} (${reminder.dosage}). ${reminder.instructions || ''} Reply TAKEN when you've taken it.`;
      
      case 'refill':
        return `🏥 Refill Reminder: Your ${reminder.medication_name} prescription is running low. Please contact your pharmacy or Dr. Bander's office to arrange a refill.`;
      
      case 'appointment':
        return `📅 Appointment Reminder: You have a follow-up appointment to discuss your ${reminder.medication_name}. Please contact Dr. Bander's office to schedule.`;
      
      default:
        return `💊 Medication Reminder: Please take your ${reminder.medication_name} as prescribed.`;
    }
  }
}

// Export for use in ClawHealth
export default MedicationManager;

// CLI usage
if (process.argv[2] === 'demo') {
  const manager = new MedicationManager('demo.db');
  
  // Demo: Add medication for test patient
  const medicationId = manager.addMedication('test_patient_001', {
    name: 'Lisinopril',
    genericName: 'Lisinopril',
    dosage: '10mg',
    frequency: 'Daily',
    timesPerDay: 1,
    scheduleTimes: ['08:00'],
    instructions: 'Take with water, preferably in the morning',
    startDate: new Date().toISOString().split('T')[0],
    prescriber: 'Dr. Jeffrey Bander',
    pharmacy: 'CVS Pharmacy'
  });

  console.log('📋 Demo medication added:', medicationId);
  console.log('🏥 ClawHealth Medication Manager ready for production');
}