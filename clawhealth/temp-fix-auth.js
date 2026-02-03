#!/usr/bin/env node

// Temporary fix for ClawHealth authentication
// Creates a mock Claude response until real API key is provided

const fs = require('fs');
const path = require('path');

// Create a temporary mock anthropic client
const mockClientCode = `
class MockAnthropic {
  constructor(options) {
    this.apiKey = options.apiKey;
  }
  
  get messages() {
    return {
      create: async (params) => {
        // Mock clinical response for medication questions
        if (params.messages[0].content.toLowerCase().includes('medication') || 
            params.messages[0].content.toLowerCase().includes('lisinopril')) {
          return {
            content: [{
              type: 'text',
              text: 'I understand you have a question about your Lisinopril. For any medication timing questions, I recommend consulting with Dr. Bander or your pharmacist for personalized guidance. In the meantime, you can also call your pharmacy for general medication timing advice. Is there anything else I can help you with today?'
            }],
            model: 'mock-claude',
            role: 'assistant'
          };
        }
        
        // Default response
        return {
          content: [{
            type: 'text', 
            text: 'Hello! I\'m your health coordinator. I can help with medication reminders, appointment scheduling, and general health questions. For medical advice, please consult with Dr. Bander. How can I assist you today?'
          }],
          model: 'mock-claude',
          role: 'assistant'
        };
      }
    };
  }
}

export default MockAnthropic;
`;

// Write temporary mock file
fs.writeFileSync(
  path.join(__dirname, 'node_modules/@anthropic-ai/mock-sdk.mjs'),
  mockClientCode
);

console.log('✅ Temporary mock Anthropic client created');
console.log('🔧 ClawHealth will respond with safe mock responses until real API key is configured');