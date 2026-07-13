#!/usr/bin/env node
'use strict';

/**
 * start-demo.js — Node.js orchestration script for the Agentic API Contract Demo
 *
 * Starts the API server, API agentic loop, and UI agentic loop as child processes.
 * Provides clean shutdown on SIGINT/SIGTERM.
 *
 * Usage:
 *   node scripts/start-demo.js
 *   npm run demo
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// ANSI color codes for terminal output
const COLORS = {
  'API Server': '\x1b[36m',  // Cyan
  'API Loop':   '\x1b[33m',  // Yellow
  'UI Loop':    '\x1b[35m',  // Magenta
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const processes = [];
let shuttingDown = false;

/**
 * Spawns a child process and tracks it for shutdown.
 * @param {string} label - Display label for logging
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} [options] - spawn options
 * @returns {ChildProcess}
 */
function startProcess(label, command, args, options = {}) {
  const color = COLORS[label] || '';

  const proc = spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      process.stdout.write(`${color}${BOLD}[${label}]${RESET} ${line}\n`);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach((line) => {
      process.stderr.write(`${color}${BOLD}[${label}]${RESET} ${line}\n`);
    });
  });

  proc.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.log(`${color}${BOLD}[${label}]${RESET} Process exited (code: ${code}, signal: ${signal})`);
    }
  });

  processes.push({ label, proc });
  return proc;
}

/**
 * Gracefully shuts down all child processes.
 */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\nShutting down all services...');

  processes.forEach(({ label, proc }) => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }
  });

  // Force kill after 5 seconds if processes haven't exited
  setTimeout(() => {
    processes.forEach(({ label, proc }) => {
      if (!proc.killed) {
        console.log(`[${label}] Force killing...`);
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 5000);

  // Check if all exited naturally
  const checkInterval = setInterval(() => {
    const allExited = processes.every(({ proc }) => proc.killed || proc.exitCode !== null);
    if (allExited) {
      clearInterval(checkInterval);
      console.log('All services stopped.');
      process.exit(0);
    }
  }, 200);
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start services ---

console.log('=== Agentic API Contract Demo ===\n');
console.log('NOTE: Start the API server separately in its own terminal:');
console.log('  node api-project/server.js\n');

// 1. Start API agentic loop (inherits stdin for approval prompts)
console.log('Starting API agentic loop...');
startProcess('API Loop', 'node', ['api-project/agentic-loop.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

// 2. Start UI agentic loop (inherits stdin for approval prompts)
console.log('Starting UI agentic loop...');
startProcess('UI Loop', 'node', ['ui-project/agentic-loop.js'], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

console.log('\n=== Agentic loops running ===\n');
console.log('Cascade flow:');
console.log('  database-project/schema.json → API agentic loop → api-project/swagger.json → UI agentic loop\n');
console.log('To trigger a cascade, add a field to database-project/schema.json');
console.log('  or run: node scripts/add-field.js <fieldName> [fieldType]\n');
console.log('Press Ctrl+C to stop all services.\n');
