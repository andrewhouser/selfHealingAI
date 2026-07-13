import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendNotification, formatTitle, formatMessage, CHANGE_TYPE_DESCRIPTIONS } from './notifier.js';

describe('shared/notifier', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatTitle', () => {
    it('includes the project name in the title', () => {
      expect(formatTitle('API_Project')).toContain('API_Project');
      expect(formatTitle('Database_Project')).toContain('Database_Project');
      expect(formatTitle('UI_Project')).toContain('UI_Project');
    });
  });

  describe('formatMessage', () => {
    it('includes change type description and field name', () => {
      const msg = formatMessage('field_added', 'date_of_birth');
      expect(msg).toContain('Field added');
      expect(msg).toContain('date_of_birth');
    });

    it('includes endpoint_updated description', () => {
      const msg = formatMessage('endpoint_updated', 'GET /persons');
      expect(msg).toContain('Endpoint updated');
      expect(msg).toContain('GET /persons');
    });

    it('includes component_modified description', () => {
      const msg = formatMessage('component_modified', 'PersonTable');
      expect(msg).toContain('Component modified');
      expect(msg).toContain('PersonTable');
    });
  });

  describe('sendNotification', () => {
    it('logs the notification to console', async () => {
      await sendNotification({
        title: 'API_Project: Change Detected',
        message: "Field 'date_of_birth' added to schema",
        project: 'API_Project',
        changeType: 'field_added',
        fieldName: 'date_of_birth',
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('API_Project: Change Detected')
      );
    });

    it('uses formatTitle/formatMessage when title/message not provided', async () => {
      await sendNotification({
        project: 'UI_Project',
        changeType: 'component_modified',
        fieldName: 'PersonTable',
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('UI_Project')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Component modified')
      );
    });

    it('resolves without throwing', async () => {
      await expect(
        sendNotification({
          title: 'Database_Project: Change Detected',
          message: "Field added: 'age'",
          project: 'Database_Project',
          changeType: 'field_added',
          fieldName: 'age',
        })
      ).resolves.toBeUndefined();
    });
  });
});
