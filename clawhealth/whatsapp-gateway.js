#!/usr/bin/env node

/**
 * ClawHealth WhatsApp Gateway
 * 
 * WhatsApp Business API integration for patient communication
 * Replaces SMS to reduce costs and improve patient engagement
 */

import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const app = express();
app.use(express.json());

// WhatsApp Business API Configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'clawhealth_webhook_2026';
const API_URL = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// Database connection
const db = new Database('./clawhealth.db');

// Initialize WhatsApp message logging
db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT,
    patient_phone TEXT NOT NULL,
    direction TEXT CHECK(direction IN ('inbound', 'outbound')) NOT NULL,
    message_type TEXT DEFAULT 'text',
    message_content TEXT NOT NULL,
    whatsapp_message_id TEXT,
    status TEXT DEFAULT 'sent',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context_type TEXT, -- medication_reminder, appointment, urgent_alert, etc.
    clinical_intent TEXT,
    flagged BOOLEAN DEFAULT false
  );

  CREATE TABLE IF NOT EXISTS whatsapp_delivery_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    status TEXT CHECK(status IN ('sent', 'delivered', 'read', 'failed')) NOT NULL,
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ WhatsApp gateway database initialized');

// Webhook verification (Meta requirement)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ WhatsApp webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// Webhook for receiving WhatsApp messages
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const { entry } = req.body;

    if (!entry || !entry[0]?.changes) {
      return res.status(200).send('OK');
    }

    for (const change of entry[0].changes) {
      if (change.field === 'messages') {
        await processWhatsAppMessage(change.value);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error);
    res.status(500).send('Error');
  }
});

// Process incoming WhatsApp messages
async function processWhatsAppMessage(messageData) {
  const { messages, contacts, statuses } = messageData;

  // Handle delivery status updates
  if (statuses) {
    for (const status of statuses) {
      await updateMessageStatus(status);
    }
  }

  // Handle incoming messages
  if (messages) {
    for (const message of messages) {
      await handleIncomingMessage(message, contacts);
    }
  }
}

// Handle incoming patient message
async function handleIncomingMessage(message, contacts) {
  const { from: patientPhone, id: messageId, type, text, timestamp } = message;
  
  // Get patient info
  const patient = db.prepare('SELECT * FROM patients WHERE phone = ?').get(patientPhone);
  const messageContent = text?.body || `[${type} message]`;

  console.log(`📱 WhatsApp message from ${patientPhone}: ${messageContent}`);

  // Log the message
  const logStmt = db.prepare(`
    INSERT INTO whatsapp_messages (patient_id, patient_phone, direction, message_type, message_content, whatsapp_message_id)
    VALUES (?, ?, 'inbound', ?, ?, ?)
  `);
  
  logStmt.run(patient?.id || null, patientPhone, type, messageContent, messageId);

  // Also log in conversation_logs for dashboard
  if (patient) {
    const conversationStmt = db.prepare(`
      INSERT INTO conversation_logs (patient_id, direction, message, channel, created_at)
      VALUES (?, 'inbound', ?, 'whatsapp', datetime('now'))
    `);
    
    conversationStmt.run(patient.id, messageContent);
  }

  // Send to ClawHealth agent for processing
  try {
    await sendToClawHealthAgent({
      patientId: patient?.id,
      patientPhone,
      message: messageContent,
      messageType: type,
      platform: 'whatsapp'
    });
  } catch (error) {
    console.error('❌ Failed to send to ClawHealth agent:', error);
  }

  // Mark message as read
  await markMessageAsRead(messageId);
}

// Send message data to ClawHealth agent
async function sendToClawHealthAgent(data) {
  const clawHealthEndpoint = process.env.CLAWHEALTH_AGENT_URL || 'http://localhost:19789/api/process-message';
  
  const response = await axios.post(clawHealthEndpoint, data, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  console.log('✅ Message sent to ClawHealth agent:', response.status);
  return response.data;
}

// Send WhatsApp message to patient
async function sendWhatsAppMessage(patientPhone, message, messageType = 'medication_reminder') {
  try {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('WhatsApp API credentials not configured');
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: patientPhone.replace(/[^\d]/g, ''), // Clean phone number
      type: 'text',
      text: {
        body: message
      }
    };

    const response = await axios.post(API_URL, payload, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const messageId = response.data.messages[0].id;

    // Log outbound message
    const patient = db.prepare('SELECT id FROM patients WHERE phone = ?').get(patientPhone);
    
    const logStmt = db.prepare(`
      INSERT INTO whatsapp_messages (patient_id, patient_phone, direction, message_content, whatsapp_message_id, context_type)
      VALUES (?, ?, 'outbound', ?, ?, ?)
    `);
    
    logStmt.run(patient?.id || null, patientPhone, message, messageId, messageType);

    // Also log for dashboard
    if (patient) {
      const conversationStmt = db.prepare(`
        INSERT INTO conversation_logs (patient_id, direction, message, channel, created_at)
        VALUES (?, 'outbound', ?, 'whatsapp', datetime('now'))
      `);
      
      conversationStmt.run(patient.id, message);
    }

    console.log(`✅ WhatsApp message sent to ${patientPhone}: ${messageId}`);
    return { success: true, messageId };

  } catch (error) {
    console.error(`❌ Failed to send WhatsApp message to ${patientPhone}:`, error.response?.data || error.message);
    
    // Log failed delivery
    const errorStmt = db.prepare(`
      INSERT INTO whatsapp_delivery_status (message_id, patient_phone, status, error_message)
      VALUES (?, ?, 'failed', ?)
    `);
    
    errorStmt.run('failed_' + Date.now(), patientPhone, error.message);
    
    throw error;
  }
}

// Update message delivery status
async function updateMessageStatus(status) {
  const { id: messageId, status: deliveryStatus, recipient_id: patientPhone, errors } = status;

  const statusStmt = db.prepare(`
    INSERT OR REPLACE INTO whatsapp_delivery_status (message_id, patient_phone, status, error_message)
    VALUES (?, ?, ?, ?)
  `);

  const errorMessage = errors ? JSON.stringify(errors) : null;
  statusStmt.run(messageId, patientPhone, deliveryStatus, errorMessage);

  console.log(`📊 Message ${messageId} status: ${deliveryStatus}`);
}

// Mark message as read
async function markMessageAsRead(messageId) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId
    }, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ Failed to mark message as read:', error.response?.data || error.message);
  }
}

// API endpoint for ClawHealth to send messages
app.post('/api/send-whatsapp', async (req, res) => {
  try {
    const { patientId, patientPhone, message, messageType } = req.body;

    if (!patientPhone || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }

    const result = await sendWhatsAppMessage(patientPhone, message, messageType);
    res.json(result);

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to send WhatsApp message',
      details: error.message 
    });
  }
});

// Get WhatsApp conversation history for patient
app.get('/api/whatsapp/conversations/:patientPhone', (req, res) => {
  try {
    const { patientPhone } = req.params;
    const { limit = 50 } = req.query;

    const messages = db.prepare(`
      SELECT * FROM whatsapp_messages 
      WHERE patient_phone = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(patientPhone, parseInt(limit));

    res.json(messages.reverse()); // Return chronological order
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WhatsApp gateway health check
app.get('/health/whatsapp', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ClawHealth WhatsApp Gateway',
    timestamp: new Date().toISOString(),
    configured: !!WHATSAPP_TOKEN && !!WHATSAPP_PHONE_NUMBER_ID
  });
});

// Enhanced message templates for WhatsApp
const messageTemplates = {
  medicationReminder: (medicationName, dosage, instructions) => {
    return `💊 *Medication Reminder*\n\nTime to take your ${medicationName} (${dosage})\n\n${instructions || 'Take as prescribed'}\n\nReply *TAKEN* when you've taken it, or *SKIP* if you're missing this dose.`;
  },

  appointmentReminder: (appointmentDate, doctorName) => {
    return `📅 *Appointment Reminder*\n\nYou have an appointment with ${doctorName} on ${appointmentDate}.\n\nReply *CONFIRM* to confirm or *RESCHEDULE* if you need to change the time.`;
  },

  urgentAlert: (condition, instructions) => {
    return `🚨 *URGENT HEALTH ALERT*\n\n${condition}\n\n*Immediate Action Required:*\n${instructions}\n\nContact Dr. Bander's office immediately if symptoms persist.`;
  },

  welcomeMessage: (patientName) => {
    return `👋 Welcome to ClawHealth, ${patientName}!\n\nI'm your AI health coordinator. I'll help you:\n• Remember medications\n• Track symptoms\n• Schedule appointments\n• Answer health questions\n\nReply *HELP* anytime for assistance.`;
  },

  adherenceCheck: (medicationName) => {
    return `📊 *Medication Check*\n\nHow are you doing with your ${medicationName}?\n\nReply:\n*GOOD* - No issues\n*MISSED* - Missed some doses\n*SIDE* - Having side effects\n*HELP* - Need assistance`;
  }
};

// Export templates and functions
export { sendWhatsAppMessage, messageTemplates };

const PORT = process.env.WHATSAPP_PORT || 3001;

app.listen(PORT, () => {
  console.log(`📱 ClawHealth WhatsApp Gateway running on port ${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`✅ WhatsApp Business API integration ready`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.log('⚠️  WhatsApp credentials not configured - set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  }
});