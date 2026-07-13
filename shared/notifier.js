const notifier = require('node-notifier');

/**
 * @typedef {Object} NotificationPayload
 * @property {string} title - e.g., "API_Project: Change Detected"
 * @property {string} message - e.g., "Field 'date_of_birth' added to schema"
 * @property {"Database_Project" | "API_Project" | "UI_Project"} project
 * @property {"field_added" | "endpoint_updated" | "component_modified"} changeType
 * @property {string} fieldName
 */

const CHANGE_TYPE_DESCRIPTIONS = {
  field_added: 'Field added',
  endpoint_updated: 'Endpoint updated',
  component_modified: 'Component modified',
};

/**
 * Formats a notification title containing the project name.
 * @param {string} project - The project name
 * @returns {string} Formatted title
 */
function formatTitle(project) {
  return `${project}: Change Detected`;
}

/**
 * Formats a notification body containing the change type and field name.
 * @param {string} changeType - The type of change
 * @param {string} fieldName - The affected field/resource name
 * @returns {string} Formatted message body
 */
function formatMessage(changeType, fieldName) {
  const description = CHANGE_TYPE_DESCRIPTIONS[changeType] || changeType;
  return `${description}: '${fieldName}'`;
}

/**
 * Sends a macOS notification using node-notifier.
 * Falls back to console output if notification delivery fails.
 *
 * @param {NotificationPayload} payload - The notification payload
 * @param {object} [options] - Optional configuration
 * @param {object} [options.notifierInstance] - Custom notifier instance (for testing)
 * @returns {Promise<void>}
 */
function sendNotification(payload, options = {}) {
  const { project, changeType, fieldName } = payload;
  const notifierInstance = options.notifierInstance || notifier;

  const title = formatTitle(project);
  const message = formatMessage(changeType, fieldName);

  return new Promise((resolve) => {
    try {
      notifierInstance.notify(
        {
          title,
          message,
          sound: true,
        },
        (err) => {
          if (err) {
            console.error('[Notification Failed]', err.message || err);
            console.error('[Intended Notification]', { title, message, project, changeType, fieldName });
          }
          resolve();
        }
      );
    } catch (err) {
      console.error('[Notification Failed]', err.message || err);
      console.error('[Intended Notification]', { title, message, project, changeType, fieldName });
      resolve();
    }
  });
}

module.exports = {
  sendNotification,
  formatTitle,
  formatMessage,
  CHANGE_TYPE_DESCRIPTIONS,
};
