#!/bin/bash

# ClawHealth Complete System Startup
# Starts all components: WhatsApp gateway, API server, and agent

echo "🏥 Starting ClawHealth System..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "📝 Please configure .env with your credentials"
    exit 1
fi

# Install dependencies if needed
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build TypeScript if needed
if [ ! -d dist ]; then
    echo "🔨 Building TypeScript..."
    npm run build
fi

# Function to start a service in background
start_service() {
    local name=$1
    local script=$2
    local port=$3
    
    echo "🚀 Starting $name on port $port..."
    
    # Kill existing process if running
    lsof -ti:$port | xargs kill -9 2>/dev/null || true
    
    # Start new process
    node $script &
    local pid=$!
    echo "$pid" > "${name,,}.pid"
    echo "✅ $name started (PID: $pid)"
}

# Start WhatsApp Gateway
start_service "WhatsApp-Gateway" "whatsapp-gateway.js" 3001

# Start API Server  
start_service "API-Server" "api-server.js" 3000

# Start ClawHealth Agent
echo "🤖 Starting ClawHealth Agent..."
npm start &
agent_pid=$!
echo "$agent_pid" > agent.pid
echo "✅ ClawHealth Agent started (PID: $agent_pid)"

# Wait a moment for services to initialize
sleep 3

echo ""
echo "🏥 ClawHealth System Status:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 WhatsApp Gateway:  http://localhost:3001"
echo "🌐 API Server:        http://localhost:3000"  
echo "📊 Doctor Dashboard:  http://localhost:3000/"
echo "👥 Patient Onboarding: http://localhost:3000/onboarding"
echo "🤖 Agent:             WebSocket to Gateway"
echo ""
echo "📋 To check status: curl http://localhost:3000/health"
echo "📱 WhatsApp health:   curl http://localhost:3001/health/whatsapp"
echo ""
echo "🛑 To stop all services: ./stop-clawhealth.sh"
echo "📊 To view logs: tail -f *.log"
echo ""

# Monitor services (optional - comment out for background operation)
echo "🔍 Monitoring services (Ctrl+C to stop monitoring)..."
echo "Press Enter to run in background..."
read -t 5

echo "✅ ClawHealth system running in background"
echo "🏥 Ready for patient care coordination!"