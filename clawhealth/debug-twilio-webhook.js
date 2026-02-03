#!/usr/bin/env node

/**
 * Twilio Webhook Debug Tool
 * Monitors incoming webhooks to help debug SMS delivery issues
 */

const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = 3030;

// Log all incoming requests
app.use('*', (req, res, next) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
    };
    
    console.log('\n🔍 WEBHOOK DEBUG - Incoming Request:');
    console.log('='.repeat(60));
    console.log(`📅 Time: ${timestamp}`);
    console.log(`🔗 ${req.method} ${req.url}`);
    console.log(`📱 From: ${req.body.From || 'N/A'}`);
    console.log(`💬 Message: ${req.body.Body || 'N/A'}`);
    console.log(`🎯 To: ${req.body.To || 'N/A'}`);
    console.log('📋 Full Body:', JSON.stringify(req.body, null, 2));
    console.log('='.repeat(60));
    
    // Log to file
    fs.appendFileSync('webhook-debug.log', JSON.stringify(logEntry) + '\n');
    
    next();
});

// Test webhook endpoint
app.post('/webhook/test', (req, res) => {
    console.log('✅ TEST WEBHOOK HIT!');
    res.set('Content-Type', 'application/xml');
    res.send(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>🧪 Webhook test successful! Your Twilio is connected. Time: ${new Date().toISOString()}</Message>
</Response>
    `);
});

// Mirror ClawHealth SMS endpoint
app.post('/sms/inbound', (req, res) => {
    console.log('📱 SMS WEBHOOK HIT!');
    res.set('Content-Type', 'application/xml');
    res.send(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>🔍 Debug mode: Received your message "${req.body.Body}". Webhook is working!</Message>
</Response>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'Twilio Debug Server Running',
        port: PORT,
        time: new Date().toISOString(),
        endpoints: [
            'POST /webhook/test - Test endpoint',
            'POST /sms/inbound - SMS webhook mirror',
            'GET /health - This health check'
        ]
    });
});

app.listen(PORT, () => {
    console.log(`🔍 Twilio Webhook Debug Server`);
    console.log(`🌐 Running on: http://localhost:${PORT}`);
    console.log(`📱 Test endpoint: http://localhost:${PORT}/webhook/test`);
    console.log(`💬 SMS mirror: http://localhost:${PORT}/sms/inbound`);
    console.log(`\n🎯 To test with ngrok:`);
    console.log(`   1. Run: ngrok http ${PORT}`);
    console.log(`   2. Copy the ngrok URL`);
    console.log(`   3. Set Twilio webhook to: [ngrok_url]/sms/inbound`);
    console.log(`   4. Send SMS to your Twilio number`);
    console.log(`\n📋 Logs will appear here and in webhook-debug.log`);
    console.log('='.repeat(60));
});

// Handle shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down debug server...');
    process.exit(0);
});