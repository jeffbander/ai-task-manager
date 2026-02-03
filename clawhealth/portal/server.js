#!/usr/bin/env node

/**
 * ClawHealth Doctor Portal
 * 
 * Simple Express server for patient onboarding and management.
 * Allows Dr. Bander to:
 * - Add new patients
 * - Deploy their ClawBoxes  
 * - Monitor patient conversations
 * - Manage care plans
 */

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORTAL_PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Simple HTML template for the portal
const portalHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ClawHealth Doctor Portal</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
            background: #f8faff; 
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { 
            background: linear-gradient(135deg, #1e40af, #3b82f6); 
            color: white; 
            padding: 30px; 
            border-radius: 12px; 
            margin-bottom: 30px;
        }
        .header h1 { margin-bottom: 10px; }
        .card { 
            background: white; 
            padding: 30px; 
            border-radius: 12px; 
            box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
            margin-bottom: 30px;
        }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-weight: 600; margin-bottom: 8px; color: #374151; }
        input, textarea { 
            width: 100%; 
            padding: 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 8px; 
            font-size: 16px;
        }
        button { 
            background: linear-gradient(135deg, #1e40af, #3b82f6); 
            color: white; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 8px; 
            font-weight: 600; 
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover { transform: translateY(-2px); }
        .patients-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); 
            gap: 20px; 
        }
        .patient-card { 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            border: 1px solid #e5e7eb;
        }
        .status-active { color: #059669; font-weight: 600; }
        .status-pending { color: #d97706; font-weight: 600; }
        .logs { 
            background: #1f2937; 
            color: #f9fafb; 
            padding: 20px; 
            border-radius: 8px; 
            font-family: monospace; 
            white-space: pre-wrap; 
            max-height: 400px; 
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏥 ClawHealth Doctor Portal</h1>
            <p>Manage AI Health Coordinators for your patients</p>
        </div>

        <div class="card">
            <h2>🆕 Add New Patient</h2>
            <form id="addPatientForm">
                <div class="form-group">
                    <label for="patientName">Patient Name</label>
                    <input type="text" id="patientName" name="patientName" placeholder="John Smith" required>
                </div>
                <div class="form-group">
                    <label for="patientPhone">Phone Number</label>
                    <input type="tel" id="patientPhone" name="patientPhone" placeholder="+15551234567" required>
                </div>
                <div class="form-group">
                    <label for="conditions">Medical Conditions</label>
                    <textarea id="conditions" name="conditions" placeholder="Heart Failure, Diabetes Type 2" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label for="medications">Current Medications</label>
                    <textarea id="medications" name="medications" placeholder="Lisinopril 10mg daily, Metformin 500mg BID" rows="3"></textarea>
                </div>
                <button type="submit">Deploy ClawBox</button>
            </form>
        </div>

        <div class="card">
            <h2>👥 Active Patients</h2>
            <div id="patientsList" class="patients-grid">
                <div class="patient-card">
                    <h3>Demo Patient</h3>
                    <p>📱 +15551234567</p>
                    <p><span class="status-pending">⚪ Ready for deployment</span></p>
                    <button onclick="viewPatient('demo')">View Details</button>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>📋 Deployment Logs</h2>
            <div id="deploymentLogs" class="logs">Ready to deploy patient ClawBoxes...\n</div>
        </div>
    </div>

    <script>
        const form = document.getElementById('addPatientForm');
        const logs = document.getElementById('deploymentLogs');
        
        function addLog(message) {
            logs.textContent += new Date().toLocaleTimeString() + ' - ' + message + '\\n';
            logs.scrollTop = logs.scrollHeight;
        }
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(form);
            const patientData = Object.fromEntries(formData);
            
            addLog('🚀 Starting ClawBox deployment for ' + patientData.patientName);
            
            try {
                const response = await fetch('/api/patients', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patientData)
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    addLog('✅ ClawBox deployed successfully!');
                    addLog('📊 Dashboard: ' + result.dashboardUrl);
                    addLog('📱 SMS Endpoint: ' + result.smsEndpoint);
                    form.reset();
                    loadPatients();
                } else {
                    addLog('❌ Deployment failed: ' + result.error);
                }
            } catch (error) {
                addLog('❌ Network error: ' + error.message);
            }
        });
        
        async function loadPatients() {
            try {
                const response = await fetch('/api/patients');
                const patients = await response.json();
                
                const patientsList = document.getElementById('patientsList');
                patientsList.innerHTML = patients.map(patient => \`
                    <div class="patient-card">
                        <h3>\${patient.name}</h3>
                        <p>📱 \${patient.phone}</p>
                        <p><span class="status-active">🟢 Active</span></p>
                        <p>Port: \${patient.port}</p>
                        <button onclick="viewPatient('\${patient.id}')">View Details</button>
                    </div>
                \`).join('');
            } catch (error) {
                addLog('❌ Failed to load patients: ' + error.message);
            }
        }
        
        function viewPatient(patientId) {
            addLog('👀 Opening patient dashboard for ' + patientId);
            // Open patient-specific dashboard
            window.open(\`http://localhost:\${getPortForPatient(patientId)}/health\`, '_blank');
        }
        
        function getPortForPatient(patientId) {
            // Simple port calculation based on patient ID
            const idNum = parseInt(patientId.replace('patient_', '')) || 1;
            return 19000 + idNum;
        }
        
        // Load patients on page load
        loadPatients();
    </script>
</body>
</html>
`;

// Routes
app.get('/', (req, res) => {
    res.send(portalHTML);
});

// Deploy new patient ClawBox
app.post('/api/patients', async (req, res) => {
    try {
        const { patientName, patientPhone, conditions, medications } = req.body;
        
        // Generate patient ID
        const patientId = 'patient_' + Date.now().toString().slice(-6);
        
        console.log(`🏥 Deploying ClawBox for ${patientName} (${patientPhone})`);
        
        // Run deployment script
        const deployScript = path.join(__dirname, '../deploy-patient.sh');
        const deployment = spawn('bash', [deployScript, patientId, patientName, patientPhone], {
            cwd: path.join(__dirname, '..')
        });
        
        let deploymentOutput = '';
        
        deployment.stdout.on('data', (data) => {
            deploymentOutput += data.toString();
        });
        
        deployment.stderr.on('data', (data) => {
            deploymentOutput += data.toString();
        });
        
        deployment.on('close', async (code) => {
            if (code === 0) {
                // Store patient data
                const patientData = {
                    id: patientId,
                    name: patientName,
                    phone: patientPhone,
                    conditions,
                    medications,
                    deployedAt: new Date().toISOString(),
                    port: 19000 + parseInt(patientId.replace('patient_', ''))
                };
                
                await storePatientData(patientData);
                
                res.json({
                    success: true,
                    patientId,
                    dashboardUrl: \`http://localhost:\${patientData.port}/health\`,
                    smsEndpoint: \`http://localhost:\${patientData.port}/sms/inbound\`,
                    output: deploymentOutput
                });
            } else {
                res.status(500).json({
                    error: 'Deployment failed',
                    output: deploymentOutput
                });
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all patients
app.get('/api/patients', async (req, res) => {
    try {
        const patients = await loadPatientsData();
        res.json(patients);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Simple file-based patient storage
async function storePatientData(patientData) {
    const patientsFile = path.join(__dirname, '../deployments/patients.json');
    
    let patients = [];
    try {
        const data = await fs.readFile(patientsFile, 'utf8');
        patients = JSON.parse(data);
    } catch (error) {
        // File doesn't exist yet, start with empty array
    }
    
    patients.push(patientData);
    
    // Ensure deployments directory exists
    await fs.mkdir(path.dirname(patientsFile), { recursive: true });
    await fs.writeFile(patientsFile, JSON.stringify(patients, null, 2));
}

async function loadPatientsData() {
    const patientsFile = path.join(__dirname, '../deployments/patients.json');
    
    try {
        const data = await fs.readFile(patientsFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

app.listen(PORT, () => {
    console.log(\`🏥 ClawHealth Doctor Portal running on http://localhost:\${PORT}\`);
    console.log(\`👨‍⚕️ Ready for patient onboarding!\`);
});