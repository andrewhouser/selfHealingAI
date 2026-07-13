import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendNotification, formatTitle, formatMessage, CHANGE_TYPE_DESCRIPTIONS } from './notifier.js';

describe('shared/notifier', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
    it('calls node-notifier with formatted title and message', async () => {
      const mockNotify = vi.fn((opts, cb) => cb(null));
      const mockNotifier = { notify: mockNotify };

      await sendNotification(
        {
          title: 'API_Project: Change Detected',
          message: "Field 'date_of_birth' added to schema",
          project: 'API_Project',
          changeType: 'field_added',
          fieldName: 'date_of_birth',
        },
        { notifierInstance: mockNotifier }
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'API_Project: Change Detected',
          message: expect.stringContaining('date_of_birth'),
        }),
        expect.any(Function)
      );
    });

    it('logs to console when notification fails via callback error', async () => {
      const mockNotify = vi.fn((opts, cb) => cb(new Error('Notification center unavailable')));
      const mockNotifier = { notify: mockNotify };

      await sendNotification(
        {
          title: 'API_Project: Change Detected',
          message: "Field 'date_of_birth' added",
          project: 'API_Project',
          changeType: 'field_added',
          fieldName: 'date_of_birth',
        },
        { notifierInstance: mockNotifier }
      );

      expect(console.error).toHaveBeenCalledWith('[Notification Failed]', 'Notification center unavailable');
      expect(console.error).toHaveBeenCalledWith(
        '[Intended Notification]',
        expect.objectContaining({
          title: 'API_Project: Change Detected',
          project: 'API_Project',
          changeType: 'field_added',
          fieldName: 'date_of_birth',
        })
      );
    });

    it('logs to console when node-notifier throws synchronously', async () => {
      const mockNotify = vi.fn(() => {
        throw new Error('System error');
      });
      const mockNotifier = { notify: mockNotify };

      await sendNotification(
        {
          title: 'UI_Project: Change Detected',
          message: "Component modified: 'PersonTable'",
          project: 'UI_Project',
          changeType: 'component_modified',
          fieldName: 'PersonTable',
        },
        { notifierInstance: mockNotifier }
      );

      expect(console.error).toHaveBeenCalledWith('[Notification Failed]', 'System error');
      expect(console.error).toHaveBeenCalledWith(
        '[Intended Notification]',
        expect.objectContaining({
          title: 'UI_Project: Change Detected',
          project: 'UI_Project',
          changeType: 'component_modified',
          fieldName: 'PersonTable',
        })
      );
    });

    it('does not throw when notification succeeds', async () => {
      const mockNotify = vi.fn((opts, cb) => cb(null));
      const mockNotifier = { notify: mockNotify };

      await expect(
        sendNotification(
          {
            title: 'Database_Project: Change Detected',
            message: "Field added: 'age'",
            project: 'Database_Project',
            changeType: 'field_added',
            fieldName: 'age',
          },
          { notifierInstance: mockNotifier }
        )
      ).resolves.toBeUndefined();

      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
