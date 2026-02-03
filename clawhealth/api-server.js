#!/usr/bin/env node

/**
 * ClawHealth API Server
 * 
 * RESTful API for patient management, care plans, and doctor dashboard
 * Integrates with the ClawHealth gateway and agent runtime
 */

import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { carePlans, generateCarePlan } from './care-plans/care-plan-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'doctor-dashboard')));
app.use('/onboarding', express.static(path.join(__dirname, 'patient-onboarding')));

// Database initialization
const db = new Database(path.join(__dirname, 'clawhealth.db'));

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    date_of_birth DATE,
    phone TEXT UNIQUE NOT NULL,
    email TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    insurance_provider TEXT,
    medical_conditions TEXT,
    allergies TEXT,
    medical_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('active', 'inactive', 'paused')) DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS patient_medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patients(id),
    name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    instructions TEXT,
    start_date DATE,
    end_date DATE,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_care_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patients(id),
    condition TEXT NOT NULL,
    care_plan_data TEXT, -- JSON
    status TEXT CHECK(status IN ('draft', 'active', 'completed', 'paused')) DEFAULT 'draft',
    created_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS patient_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patients(id),
    severity TEXT CHECK(severity IN ('info', 'warning', 'urgent', 'emergency')) NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT REFERENCES patients(id),
    direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL,
    message TEXT NOT NULL,
    channel TEXT DEFAULT 'sms',
    intent TEXT,
    flagged BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ ClawHealth API database initialized');

// API Routes

// Get dashboard stats
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const patientCount = db.prepare('SELECT COUNT(*) as count FROM patients WHERE status = "active"').get().count;
    const alertCount = db.prepare('SELECT COUNT(*) as count FROM patient_alerts WHERE acknowledged = false').get().count;
    const messageCount = db.prepare(`
      SELECT COUNT(*) as count FROM conversation_logs 
      WHERE date(created_at) = date('now')
    `).get().count;

    // Calculate adherence rate (mock for now)
    const adherenceRate = 94; // This would be calculated from medication logs

    res.json({
      patients: patientCount,
      alerts: alertCount,
      messages: messageCount,
      adherenceRate: adherenceRate + '%'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all patients
app.get('/api/patients', (req, res) => {
  try {
    const patients = db.prepare(`
      SELECT 
        p.*,
        COUNT(pa.id) as alert_count,
        MAX(cl.created_at) as last_message_at
      FROM patients p
      LEFT JOIN patient_alerts pa ON p.id = pa.patient_id AND pa.acknowledged = false
      LEFT JOIN conversation_logs cl ON p.id = cl.patient_id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `).all();

    res.json(patients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get patient by ID
app.get('/api/patients/:id', (req, res) => {
  try {
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Get medications
    const medications = db.prepare('SELECT * FROM patient_medications WHERE patient_id = ? AND active = true').all(req.params.id);
    
    // Get care plans
    const carePlans = db.prepare('SELECT * FROM patient_care_plans WHERE patient_id = ?').all(req.params.id);
    
    // Get recent messages
    const recentMessages = db.prepare(`
      SELECT * FROM conversation_logs 
      WHERE patient_id = ? 
      ORDER BY created_at DESC 
      LIMIT 20
    `).all(req.params.id);

    // Get alerts
    const alerts = db.prepare(`
      SELECT * FROM patient_alerts 
      WHERE patient_id = ? 
      ORDER BY created_at DESC 
      LIMIT 10
    `).all(req.params.id);

    res.json({
      patient,
      medications,
      carePlans: carePlans.map(cp => ({
        ...cp,
        care_plan_data: JSON.parse(cp.care_plan_data || '{}')
      })),
      recentMessages,
      alerts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new patient
app.post('/api/patients', (req, res) => {
  try {
    const {
      firstName,
      lastName,
      dateOfBirth,
      phone,
      email,
      emergencyContactName,
      emergencyContactPhone,
      insuranceProvider,
      medicalConditions,
      allergies,
      medicalNotes,
      medications = []
    } = req.body;

    // Generate patient ID
    const patientId = 'patient_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    // Insert patient
    const insertPatient = db.prepare(`
      INSERT INTO patients (
        id, first_name, last_name, date_of_birth, phone, email,
        emergency_contact_name, emergency_contact_phone, insurance_provider,
        medical_conditions, allergies, medical_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPatient.run(
      patientId,
      firstName,
      lastName,
      dateOfBirth,
      phone,
      email,
      emergencyContactName,
      emergencyContactPhone,
      insuranceProvider,
      medicalConditions,
      allergies,
      medicalNotes
    );

    // Insert medications
    if (medications.length > 0) {
      const insertMedication = db.prepare(`
        INSERT INTO patient_medications (patient_id, name, dosage, frequency)
        VALUES (?, ?, ?, ?)
      `);

      medications.forEach(med => {
        insertMedication.run(patientId, med.name, med.dose || med.dosage, med.frequency);
      });
    }

    // Generate care plan if conditions are specified
    if (medicalConditions) {
      const conditions = medicalConditions.toLowerCase();
      let carePlanType = null;

      if (conditions.includes('heart failure') || conditions.includes('hf')) {
        carePlanType = 'heartFailure';
      } else if (conditions.includes('diabetes')) {
        carePlanType = 'diabetes';
      } else if (conditions.includes('hypertension') || conditions.includes('high blood pressure')) {
        carePlanType = 'hypertension';
      } else if (conditions.includes('copd') || conditions.includes('emphysema')) {
        carePlanType = 'copd';
      }

      if (carePlanType) {
        const carePlan = generateCarePlan(carePlanType, {
          id: patientId,
          firstName,
          lastName,
          physicianName: 'Dr. Jeffrey Bander'
        });

        const insertCarePlan = db.prepare(`
          INSERT INTO patient_care_plans (patient_id, condition, care_plan_data, status, created_by)
          VALUES (?, ?, ?, 'active', 'Dr. Jeffrey Bander')
        `);

        insertCarePlan.run(patientId, carePlanType, JSON.stringify(carePlan));
      }
    }

    res.status(201).json({
      success: true,
      patientId,
      message: 'Patient created successfully',
      dashboardUrl: `http://localhost:${PORT}/patient/${patientId}`,
      smsNumber: process.env.TWILIO_PHONE_NUMBER || '+19388000613'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get patient alerts
app.get('/api/alerts', (req, res) => {
  try {
    const alerts = db.prepare(`
      SELECT 
        a.*,
        p.first_name,
        p.last_name
      FROM patient_alerts a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.acknowledged = false
      ORDER BY 
        CASE a.severity 
          WHEN 'emergency' THEN 1
          WHEN 'urgent' THEN 2  
          WHEN 'warning' THEN 3
          WHEN 'info' THEN 4
        END,
        a.created_at DESC
      LIMIT 50
    `).all();

    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge alert
app.put('/api/alerts/:id/acknowledge', (req, res) => {
  try {
    const { acknowledgedBy = 'Dr. Jeffrey Bander' } = req.body;
    
    const stmt = db.prepare(`
      UPDATE patient_alerts 
      SET acknowledged = true, acknowledged_by = ?, acknowledged_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(acknowledgedBy, req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available care plan templates
app.get('/api/care-plans/templates', (req, res) => {
  const templates = Object.keys(carePlans).map(key => ({
    id: key,
    name: carePlans[key].name,
    description: carePlans[key].description,
    guidelineSource: carePlans[key].guidelineSource
  }));

  res.json(templates);
});

// Create care plan for patient
app.post('/api/patients/:id/care-plans', (req, res) => {
  try {
    const { condition, customizations = {} } = req.body;
    const patientId = req.params.id;

    // Get patient info
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }

    const carePlan = generateCarePlan(condition, {
      id: patientId,
      firstName: patient.first_name,
      lastName: patient.last_name,
      physicianName: 'Dr. Jeffrey Bander'
    }, customizations);

    const insertCarePlan = db.prepare(`
      INSERT INTO patient_care_plans (patient_id, condition, care_plan_data, status, created_by)
      VALUES (?, ?, ?, 'active', 'Dr. Jeffrey Bander')
    `);

    const result = insertCarePlan.run(patientId, condition, JSON.stringify(carePlan));

    res.status(201).json({
      success: true,
      carePlanId: result.lastInsertRowid,
      carePlan
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log patient conversation
app.post('/api/patients/:id/conversations', (req, res) => {
  try {
    const { direction, message, channel = 'sms', intent, flagged = false } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO conversation_logs (patient_id, direction, message, channel, intent, flagged)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(req.params.id, direction, message, channel, intent, flagged);

    res.status(201).json({
      success: true,
      conversationId: result.lastInsertRowid
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create patient alert
app.post('/api/patients/:id/alerts', (req, res) => {
  try {
    const { severity, category, title, description } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO patient_alerts (patient_id, severity, category, title, description)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(req.params.id, severity, category, title, description);

    res.status(201).json({
      success: true,
      alertId: result.lastInsertRowid
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'doctor-dashboard', 'dashboard.html'));
});

app.get('/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, 'patient-onboarding', 'onboarding-wizard.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ClawHealth API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🏥 ClawHealth API Server running on http://localhost:${PORT}`);
  console.log(`📊 Doctor Dashboard: http://localhost:${PORT}/`);
  console.log(`👥 Patient Onboarding: http://localhost:${PORT}/onboarding`);
  console.log('✅ Ready for patient management and clinical oversight');
});