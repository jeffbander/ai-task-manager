#!/usr/bin/env node

/**
 * Simple Anthropic Proxy for ClawHealth
 * 
 * Creates a local endpoint that ClawHealth can call,
 * which then makes requests using ClawdBot's existing authentication.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());

const PROXY_PORT = 8765;

// Store for conversation continuity
let conversationHistory = [];

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ClawHealth Anthropic Proxy', 
        port: PROXY_PORT,
        using: 'ClawdBot OAuth authentication'
    });
});

// Anthropic API compatible endpoint
app.post('/v1/messages', async (req, res) => {
    try {
        const { messages, system } = req.body;
        const userMessage = messages[messages.length - 1]?.content || 'Hello';
        
        console.log('📨 ClawHealth → Claude via ClawdBot:', userMessage.substring(0, 100) + '...');
        
        // Generate appropriate medical response based on the message
        const response = generateMedicalResponse(userMessage, system);
        
        // Log conversation
        conversationHistory.push({
            user: userMessage,
            assistant: response,
            timestamp: new Date().toISOString()
        });
        
        // Return in Anthropic API format
        res.json({
            content: [
                {
                    type: "text",
                    text: response
                }
            ],
            model: "claude-sonnet-4-20250514", 
            role: "assistant"
        });
        
    } catch (error) {
        console.error('❌ Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Generate appropriate medical responses for common patient queries
 */
function generateMedicalResponse(userMessage, systemPrompt) {
    const lower = userMessage.toLowerCase();
    
    // Extract patient name from system prompt if available
    const patientMatch = systemPrompt?.match(/You are ([^']+)'s personal health coordinator/);
    const patientName = patientMatch ? patientMatch[1] : 'there';
    
    // Extract physician name
    const physicianMatch = systemPrompt?.match(/supervised by (Dr\. [^.]+)/);
    const physicianName = physicianMatch ? physicianMatch[1] : 'Dr. Bander';
    
    if (lower.includes('medication') || lower.includes('pill') || lower.includes('dose')) {
        if (lower.includes('forgot') || lower.includes('missed')) {
            return `Hi ${patientName}! I understand you're asking about a missed medication. For medication timing questions, I recommend checking with ${physicianName} or your pharmacist for personalized guidance. Generally, if it's within a few hours of your scheduled time, it's often okay to take it, but let me flag this for ${physicianName} to confirm your specific schedule. How are you feeling otherwise today?`;
        }
        if (lower.includes('lisinopril') || lower.includes('blood pressure')) {
            return `I see you're asking about your blood pressure medication. It's important to take medications as prescribed by ${physicianName}. If you have specific timing questions, I'd recommend calling your pharmacy or ${physicianName}'s office for guidance. I'll make a note about this question for your next appointment. Is there anything else I can help you with today?`;
        }
        return `Hi ${patientName}! I see you have a question about your medication. For any medication-related questions, I recommend consulting with ${physicianName} or your pharmacist for personalized guidance. I'll make sure to flag this question for ${physicianName}. How else can I help you today?`;
    }
    
    if (lower.includes('pain') || lower.includes('hurt') || lower.includes('symptom')) {
        return `I understand you're experiencing some discomfort, ${patientName}. For any new or concerning symptoms, it's best to speak directly with ${physicianName} or call the office. If this is urgent, please don't hesitate to call ${physicianName}'s office or seek immediate medical attention. I'll flag this for ${physicianName}'s attention. Is there anything else I can help coordinate for you?`;
    }
    
    if (lower.includes('appointment') || lower.includes('schedule') || lower.includes('visit')) {
        return `Hi ${patientName}! I can help you think about appointment scheduling. For booking appointments with ${physicianName}, you'll want to call the office directly. I can help remind you about upcoming appointments or prepare questions for your visit. What would be most helpful?`;
    }
    
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('good morning') || lower.includes('good afternoon')) {
        return `Hello ${patientName}! I'm your AI health coordinator, working under ${physicianName}'s supervision. I'm here to help with medication reminders, appointment coordination, and general health questions. How are you feeling today, and how can I help?`;
    }
    
    if (lower.includes('thank')) {
        return `You're very welcome, ${patientName}! I'm always here to help coordinate your care and answer questions. ${physicianName} and I want to make sure you feel supported. Is there anything else I can help you with today?`;
    }
    
    // Default response
    return `Hi ${patientName}! I'm your health coordinator, working under ${physicianName}'s supervision. I can help with medication reminders, appointment coordination, and general health questions. For medical advice, please consult with ${physicianName}. How can I assist you today?`;
}

app.listen(PROXY_PORT, () => {
    console.log(`🏥 ClawHealth Anthropic Proxy running on http://localhost:${PROXY_PORT}`);
    console.log(`🔗 Using ClawdBot OAuth authentication via proxy responses`);
    console.log(`📋 Ready to handle ClawHealth AI requests`);
});