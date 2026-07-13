'use strict';

const readline = require('readline');

/**
 * Creates an askApproval function with an optional injectable readline creator.
 * This factory pattern enables testing without mocking the readline module.
 *
 * @param {Object} [options]
 * @param {function} [options.createReadlineInterface] - Factory for readline interfaces (defaults to readline.createInterface)
 * @returns {function(string): Promise<boolean>}
 */
function createAskApproval(options = {}) {
  const _createInterface = options.createReadlineInterface || (() =>
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
  );

  /**
   * Prompts the developer via terminal stdin to approve or reject an action.
   * Waits indefinitely for a response before resolving.
   *
   * @param {string} message - The prompt message to display to the developer
   * @returns {Promise<boolean>} Resolves with true if approved, false if rejected
   */
  return function askApproval(message) {
    return new Promise((resolve) => {
      const rl = _createInterface();

      rl.question(`${message} (y/n): `, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        const approved = normalized === 'y' || normalized === 'yes';
        resolve(approved);
      });
    });
  };
}

/**
 * Default askApproval function using real stdin/stdout.
 * Prompts the developer via terminal stdin to approve or reject an action.
 * Waits indefinitely for a response before resolving.
 *
 * @param {string} message - The prompt message to display to the developer
 * @returns {Promise<boolean>} Resolves with true if approved, false if rejected
 */
const askApproval = createAskApproval();

module.exports = { askApproval, createAskApproval };
