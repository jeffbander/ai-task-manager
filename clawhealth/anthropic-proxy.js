#!/usr/bin/env node

/**
 * Anthropic Proxy for ClawHealth
 * 
 * Since ClawdBot uses OAuth and ClawHealth needs API access,
 * this proxy forwards ClawHealth requests using ClawdBot's auth.
 */

const express = require('express');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

const PROXY_PORT = process.env.ANTHROPIC_PROXY_PORT || 8765;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ClawHealth Anthropic Proxy running', port: PROXY_PORT });
});

// Proxy Anthropic API requests through ClawdBot
app.post('/v1/messages', async (req, res) => {
    try {
        console.log('📨 Proxying Claude request through ClawdBot auth...');
        
        // Use ClawdBot's session to make the request
        const response = await makeClawdBotRequest(req.body);
        
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
        console.error('❌ Proxy error:', error.message);
        res.status(500).json({ 
            error: 'Proxy failed', 
            message: error.message 
        });
    }
});

/**
 * Make a request using ClawdBot's authentication
 * by spawning a ClawdBot session
 */
async function makeClawdBotRequest(anthropicRequest) {
    return new Promise((resolve, reject) => {
        const messages = anthropicRequest.messages || [];
        const lastMessage = messages[messages.length - 1];
        const userPrompt = lastMessage ? lastMessage.content : 'Hello';
        
        // Create a temporary prompt for ClawdBot
        const promptText = `ANTHROPIC_PROXY_REQUEST: ${userPrompt}
        
Please respond as a medical AI coordinator. Keep it brief and clinically appropriate.`;

        // Spawn ClawdBot session to make the request
        const clawdbot = spawn('clawdbot', ['chat', '--prompt', promptText], {
            stdio: 'pipe'
        });

        let output = '';
        let error = '';

        clawdbot.stdout.on('data', (data) => {
            output += data.toString();
        });

        clawdbot.stderr.on('data', (data) => {
            error += data.toString();
        });

        clawdbot.on('close', (code) => {
            if (code === 0 && output.trim()) {
                // Extract response from ClawdBot output
                const response = output
                    .replace(/ANTHROPIC_PROXY_REQUEST:.*?\\n\\n/s, '')
                    .replace(/^.*?(?=\\w)/s, '') // Remove prefixes
                    .trim();
                
                resolve(response || 'I\'m here to help with your health questions.');
            } else {
                reject(new Error(`ClawdBot failed: ${error || 'Unknown error'}`));
            }
        });
    });
}

app.listen(PROXY_PORT, () => {
    console.log(`🏥 ClawHealth Anthropic Proxy running on http://localhost:${PROXY_PORT}`);
    console.log(`🔗 Forwarding Claude requests through ClawdBot OAuth`);
});