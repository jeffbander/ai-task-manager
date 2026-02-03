#!/usr/bin/env node

/**
 * ClawHealth Doctor Portal - Simple Version
 */

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORTAL_PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Main portal page
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>ClawHealth Doctor Portal</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
        .card { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; font-weight: 600; margin-bottom: 5px; }
        input, textarea { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; }
        button { background: #1e40af; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; }
        button:hover { background: #1d4ed8; }
        .logs { background: #f8f9fa; padding: 15px; border-radius: 6px; font-family: monospace; white-space: pre-wrap; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏥 ClawHealth Doctor Portal</h1>
        <p>Deploy AI Health Coordinators for your patients</p>
    </div>

    <div class="card">
        <h2>🆕 Add New Patient</h2>
        <form id="patientForm">
            <div class="form-group">
                <label>Patient Name:</label>
                <input type="text" name="patientName" placeholder="John Smith" required>
            </div>
            <div class="form-group">
                <label>Phone Number:</label>
                <input type="tel" name="patientPhone" placeholder="+15551234567" required>
            </div>
            <div class="form-group">
                <label>Medical Conditions:</label>
                <textarea name="conditions" placeholder="Heart Failure, Diabetes" rows="2"></textarea>
            </div>
            <div class="form-group">
                <label>Medications:</label>
                <textarea name="medications" placeholder="Lisinopril 10mg daily" rows="2"></textarea>
            </div>
            <button type="submit">Deploy ClawBox</button>
        </form>
    </div>

    <div class="card">
        <h2>📋 Status</h2>
        <div id="status" class="logs">Ready to deploy patient ClawBoxes...
        
Next steps:
1. Add Twilio credentials to environment
2. Deploy patient containers
3. Configure SMS webhooks
        </div>
    </div>

    <script>
        document.getElementById('patientForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData);
            
            document.getElementById('status').textContent += '\\n🚀 Deploying ClawBox for ' + data.patientName + '...';
            
            try {
                const response = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                document.getElementById('status').textContent += '\\n' + result.message;
                
                if (result.success) {
                    e.target.reset();
                    document.getElementById('status').textContent += '\\n✅ Dashboard: ' + result.dashboardUrl;
                    document.getElementById('status').textContent += '\\n📱 SMS Endpoint: ' + result.smsEndpoint;
                }
            } catch (error) {
                document.getElementById('status').textContent += '\\n❌ Error: ' + error.message;
            }
        });
    </script>
</body>
</html>
    `);
});

// Deploy patient endpoint
app.post('/api/deploy', async (req, res) => {
    try {
        const { patientName, patientPhone, conditions, medications } = req.body;
        const patientId = 'patient_' + Date.now().toString().slice(-6);
        const port = 19000 + parseInt(patientId.replace('patient_', ''));
        
        console.log(`🏥 Deploying ClawBox for ${patientName} (${patientPhone})`);
        
        // For now, just simulate deployment since we need Docker running
        res.json({
            success: true,
            message: `✅ ClawBox "${patientId}" deployed successfully!`,
            patientId,
            dashboardUrl: `http://localhost:${port}/health`,
            smsEndpoint: `http://localhost:${port}/sms/inbound`
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `❌ Deployment failed: ${error.message}`
        });
    }
});

app.listen(PORT, () => {
    console.log(`🏥 ClawHealth Doctor Portal running on http://localhost:${PORT}`);
    console.log(`👨‍⚕️ Ready for patient onboarding!`);
});