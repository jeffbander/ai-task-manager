// Test script to simulate patient messaging ClawHealth
// This bypasses Twilio and directly tests the agent pipeline

import WebSocket from 'ws';

const GATEWAY_URL = 'ws://localhost:18789/ws';

console.log('🏥 Testing ClawHealth messaging pipeline...');

const ws = new WebSocket(GATEWAY_URL);

ws.on('open', () => {
  console.log('✅ Connected to ClawHealth Gateway');
  
  // Simulate incoming patient message
  const testMessage = {
    type: 'inbound_message',
    patient_id: 'test_patient_001',
    channel: 'sms',
    message: 'Good morning! I forgot to take my morning medication. Should I take it now?',
    timestamp: new Date().toISOString()
  };
  
  console.log('📤 Sending test message:', testMessage.message);
  ws.send(JSON.stringify(testMessage));
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  console.log('📥 ClawHealth response:', response);
  
  if (response.type === 'outbound_message') {
    console.log('🤖 AI Coordinator says:', response.message);
  }
  
  // Close after receiving response
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 1000);
});

ws.on('error', (error) => {
  console.error('❌ Connection error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 Connection closed');
});