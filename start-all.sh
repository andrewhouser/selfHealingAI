#!/bin/bash
#
# start-all.sh — Starts all services for the Agentic API Contract Demo
#
# This script launches the API server, the API agentic loop, and the UI agentic loop.
# Each process runs in the background. Press Ctrl+C to stop all processes.
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Agentic API Contract Demo ==="
echo ""
echo "Starting services..."
echo ""

# Track PIDs for cleanup
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
    fi
  done
  wait
  echo "All services stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM

# 1. Start the API server
echo "[API Server] Starting on port ${PORT:-3000}..."
node "$ROOT_DIR/api-project/server.js" &
PIDS+=($!)
echo "[API Server] PID: ${PIDS[-1]}"

# Give the API server a moment to start
sleep 1

# 2. Start the API agentic loop
echo "[API Loop]   Starting schema watcher..."
node "$ROOT_DIR/api-project/agentic-loop.js" &
PIDS+=($!)
echo "[API Loop]   PID: ${PIDS[-1]}"

# 3. Start the UI agentic loop
echo "[UI Loop]    Starting swagger watcher..."
node "$ROOT_DIR/ui-project/agentic-loop.js" &
PIDS+=($!)
echo "[UI Loop]    PID: ${PIDS[-1]}"

echo ""
echo "=== All services running ==="
echo ""
echo "Cascade flow:"
echo "  database-project/schema.json → API agentic loop → api-project/swagger.json → UI agentic loop"
echo ""
echo "To trigger a cascade, add a field to database-project/schema.json"
echo "  or run: node scripts/add-field.js <fieldName> [fieldType]"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Wait for all background processes
wait
