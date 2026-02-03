// Test ClawHealth SMS pipeline
// Simulates Twilio webhook for inbound SMS

import fetch from 'node-fetch';

console.log('🏥 Testing ClawHealth SMS pipeline...');

const testSms = {
  From: '+15551234567', // Test patient phone
  Body: 'Good morning! I forgot to take my morning medication. Should I take it now?'
};

try {
  console.log('📤 Sending test SMS:', testSms.Body);
  
  const response = await fetch('http://localhost:19789/sms/inbound', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(testSms)
  });

  if (response.ok) {
    const twiml = await response.text();
    console.log('✅ ClawHealth responded with TwiML:');
    console.log(twiml);
  } else {
    console.log('❌ Error:', response.status, response.statusText);
    const error = await response.text();
    console.log(error);
  }
} catch (error) {
  console.error('❌ Failed to send test SMS:', error.message);
}