# ClawHealth WhatsApp Integration Setup

## Overview

Replace expensive SMS with WhatsApp Business API for patient communication. Much lower cost and better engagement.

## WhatsApp Business API Setup

### 1. Create Meta Business Account
- Go to https://business.facebook.com/
- Create business account or use existing
- Add WhatsApp Business API

### 2. Get API Credentials
```bash
# Required environment variables
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=clawhealth_webhook_2026
```

### 3. Phone Number Verification
- Add business phone number to Meta account
- Verify ownership with SMS/call
- Request WhatsApp Business API access

## Deployment

### 1. Install Dependencies
```bash
cd repos/ai-task-manager/clawhealth
npm install axios
```

### 2. Configure Environment
```bash
# Add to .env
echo "WHATSAPP_ACCESS_TOKEN=your_token_here" >> .env
echo "WHATSAPP_PHONE_NUMBER_ID=your_phone_id_here" >> .env
echo "WHATSAPP_WEBHOOK_VERIFY_TOKEN=clawhealth_webhook_2026" >> .env
echo "WHATSAPP_PORT=3001" >> .env
```

### 3. Start WhatsApp Gateway
```bash
node whatsapp-gateway.js
```

### 4. Configure Webhook
Set webhook URL in Meta Developer Console:
```
https://your-domain.com/webhook/whatsapp
```

## Integration with ClawHealth

### Updated message sending
```javascript
// Instead of SMS
await sendSMS(patientPhone, message);

// Use WhatsApp
await sendWhatsAppMessage(patientPhone, message, 'medication_reminder');
```

### Message Types
- `medication_reminder` - Pill reminders with action buttons
- `appointment_reminder` - Calendar notifications
- `urgent_alert` - Critical health alerts
- `adherence_check` - Medication compliance follow-ups
- `welcome_message` - Patient onboarding

## Benefits Over SMS

### Cost Savings
- **SMS**: ~$0.01-0.05 per message
- **WhatsApp**: ~$0.005-0.01 per message
- **50-80% cost reduction**

### Enhanced Features
- ✅ Rich messaging (formatting, emojis)
- ✅ Read receipts and delivery status
- ✅ Media support (images, documents)
- ✅ Quick reply buttons
- ✅ Better international support
- ✅ Higher patient engagement rates

### Patient Experience
- Familiar WhatsApp interface
- No additional app downloads
- Rich formatting for medical instructions
- Better accessibility features

## Message Templates

### Medication Reminder
```
💊 *Medication Reminder*

Time to take your Lisinopril (10mg)

Take with water, preferably in the morning

Reply *TAKEN* when you've taken it, or *SKIP* if you're missing this dose.
```

### Urgent Alert
```
🚨 *URGENT HEALTH ALERT*

Blood pressure reading too high (180/95)

*Immediate Action Required:*
• Sit down and rest
• Take emergency medication if prescribed
• Monitor for symptoms (headache, vision changes)

Contact Dr. Bander's office immediately if symptoms persist.
```

## Security & Compliance

### HIPAA Considerations
- WhatsApp Business API is NOT HIPAA-compliant by default
- Use only for non-PHI communications
- Generic reminders and educational content only
- No specific lab values or detailed medical information

### Safe Message Content
✅ **OK to send**:
- Medication name and dosage
- Appointment reminders
- General health education
- Emergency contact instructions

❌ **Never send**:
- Lab results or values
- Detailed diagnostic information
- Personal health records
- Insurance information

## Monitoring & Analytics

### Message Delivery Tracking
```sql
SELECT 
  status,
  COUNT(*) as count,
  AVG(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) * 100 as delivery_rate
FROM whatsapp_delivery_status 
GROUP BY status;
```

### Patient Engagement Metrics
```sql
SELECT 
  DATE(timestamp) as date,
  COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as sent,
  COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as replies,
  COUNT(CASE WHEN direction = 'inbound' THEN 1 END) * 100.0 / 
    COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as response_rate
FROM whatsapp_messages 
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

## Failover Strategy

If WhatsApp fails, automatically fall back to SMS:

```javascript
async function sendPatientMessage(patientPhone, message, type) {
  try {
    // Try WhatsApp first
    return await sendWhatsAppMessage(patientPhone, message, type);
  } catch (whatsappError) {
    console.log('WhatsApp failed, falling back to SMS');
    // Fallback to SMS
    return await sendSMS(patientPhone, message);
  }
}
```

## Production Deployment

### 1. Domain Setup
- Configure webhook URL with your domain
- SSL certificate required
- Consider using ngrok for development

### 2. Scaling Considerations
- Rate limits: 1000 messages/second
- Webhook timeout: 15 seconds
- Consider message queuing for high volume

### 3. Monitoring
```bash
# Health check endpoint
curl http://localhost:3001/health/whatsapp

# Expected response:
{
  "status": "healthy",
  "service": "ClawHealth WhatsApp Gateway",
  "configured": true
}
```

## Next Steps

1. **Set up Meta Business Account** - Get API access
2. **Configure credentials** - Add to .env file
3. **Test with demo patient** - Verify message flow
4. **Update ClawHealth agent** - Switch from SMS to WhatsApp
5. **Monitor delivery rates** - Ensure reliable messaging
6. **Train Dr. Bander** - Show new dashboard features

## Support

For WhatsApp Business API issues:
- Meta Business Help: https://business.facebook.com/help/
- WhatsApp API Docs: https://developers.facebook.com/docs/whatsapp

For ClawHealth integration:
- Check logs: `tail -f clawhealth.log`
- Test endpoint: `curl -X POST localhost:3001/api/send-whatsapp`