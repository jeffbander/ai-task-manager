#!/bin/bash

# ClawHealth System Shutdown Script

echo "🛑 Stopping ClawHealth System..."

# Function to stop service by PID file
stop_service() {
    local name=$1
    local pidfile="${name,,}.pid"
    
    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            echo "🛑 Stopping $name (PID: $pid)..."
            kill "$pid"
            rm "$pidfile"
        else
            echo "⚠️  $name not running (stale PID file)"
            rm "$pidfile"
        fi
    else
        echo "ℹ️  $name PID file not found"
    fi
}

# Stop all services
stop_service "WhatsApp-Gateway"
stop_service "API-Server"  
stop_service "Agent"

# Force kill any remaining processes on our ports
echo "🧹 Cleaning up any remaining processes..."

ports=(3000 3001)
for port in "${ports[@]}"; do
    pids=$(lsof -ti:$port 2>/dev/null || true)
    if [ ! -z "$pids" ]; then
        echo "🛑 Killing processes on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
done

# Clean up any remaining ClawHealth processes
pkill -f "clawhealth" 2>/dev/null || true
pkill -f "whatsapp-gateway" 2>/dev/null || true
pkill -f "api-server" 2>/dev/null || true

echo ""
echo "✅ ClawHealth system stopped"
echo "🏥 All patient communication channels disabled"
echo ""