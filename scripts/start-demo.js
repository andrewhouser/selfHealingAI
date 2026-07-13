#!/usr/bin/env node
'use strict';

/**
 * start-demo.js — Orchestration script for the Agentic API Contract Demo
 *
 * Starts the API agentic loop and UI agentic loop as child processes.
 * Output is interleaved in a shared terminal with colored prefixes.
 * Stdin is shared so approval prompts work natively.
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
  'API Loop': '\x1b[33m',  // Yellow
  'UI Loop':  '\x1b[35m',  // Magenta
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const processes = [];
let shuttingDown = false;

/**
 * Spawns a child process with colored prefixed output.
 */
function startProcess(label, command, args) {
  const color = COLORS[label] || '';

  const proc = spawn(command, args, {
    cwd: ROOT_DIR,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(`${color}${BOLD}[${label}]${RESET} ${line}\n`);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        process.stderr.write(`${color}${BOLD}[${label}]${RESET} ${line}\n`);
      }
    }
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

  console.log(`\n${DIM}Shutting down all services...${RESET}`);

  processes.forEach(({ proc }) => {
    if (!proc.killed) proc.kill('SIGTERM');
  });

  setTimeout(() => {
    processes.forEach(({ label, proc }) => {
      if (!proc.killed) {
        console.log(`[${label}] Force killing...`);
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 5000);

  const check = setInterval(() => {
    const allExited = processes.every(({ proc }) => proc.killed || proc.exitCode !== null);
    if (allExited) {
      clearInterval(check);
      console.log(`${DIM}All services stopped.${RESET}`);
      process.exit(0);
    }
  }, 200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Start ───────────────────────────────────────────────────────────────────

console.log(`${BOLD}=== Agentic API Contract Demo ===${RESET}\n`);
console.log(`Cascade: database-project/schema.json → ${COLORS['API Loop']}API Loop${RESET} → api-project/swagger.json → ${COLORS['UI Loop']}UI Loop${RESET}`);
console.log(`Trigger: node scripts/add-field.js <fieldName> [fieldType]\n`);

startProcess('API Loop', 'node', ['api-project/agentic-loop.js']);
startProcess('UI Loop', 'node', ['ui-project/agentic-loop.js']);

console.log(`${DIM}Press Ctrl+C to stop all services.${RESET}\n`);
