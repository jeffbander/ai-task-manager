// Test live SMS via ngrok tunnel
import fetch from 'node-fetch';

console.log('🏥 Testing LIVE ClawHealth SMS via ngrok...');

const testSms = {
  From: '+15551234567', // Simulated patient phone
  Body: 'Good morning! I forgot to take my morning Lisinopril. Should I take it now or wait until tonight?',
  To: '+19388000613'
};

try {
  console.log('📤 Sending SMS from patient:', testSms.Body);
  
  const response = await fetch('https://bf2f7d81bd75.ngrok.app/sms/inbound', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(testSms)
  });

  if (response.ok) {
    const twiml = await response.text();
    console.log('✅ ClawHealth AI Coordinator responded:');
    console.log(twiml);
  } else {
    console.log('❌ Error:', response.status, response.statusText);
    const error = await response.text();
    console.log(error);
  }
} catch (error) {
  console.error('❌ Failed:', error.message);
}
