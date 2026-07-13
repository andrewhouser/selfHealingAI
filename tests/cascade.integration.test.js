/**
 * Integration test: Full cascade flow
 *
 * Simulates the end-to-end cascade:
 *   1. Schema change detected by API agentic loop
 *   2. API loop sends notification, auto-approves, performs self-healing update
 *   3. Swagger.json is regenerated with new field
 *   4. UI agentic loop detects swagger change
 *   5. UI loop sends notification, auto-approves, performs self-healing update
 *   6. page.tsx updated with new column
 *
 * Uses direct function calls with mocked dependencies (no file watchers)
 * to avoid timing flakiness while still validating the full cascade logic.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);

const { diffSchema, diffSwagger } = require('../shared/diff-schema.js');
const { performSelfHealingUpdate: apiSelfHeal } = require('../api-project/self-heal.js');
const { performSelfHealingUpdate: uiSelfHeal } = require('../ui-project/self-heal.js');
const { generateSwaggerFromSchema } = require('../api-project/swagger-generator.js');
const { addFieldToEndpoint } = require('../api-project/code-updater.js');
const { addColumnToPage } = require('../ui-project/component-updater.js');

describe('Full cascade integration test', () => {
  // Base schema (before the change)
  const baseSchema = {
    type: 'object',
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      address: { type: 'string', required: true },
      phone_number: { type: 'string', required: true },
    },
  };

  // Base routes code
  const baseRoutesCode = [
    "const express = require('express');",
    'const router = express.Router();',
    "const { findAll, findById } = require('../../database-project/db');",
    '',
    'router.get("/", async (req, res) => {',
    '  const persons = await findAll();',
    '  res.json(persons);',
    '});',
    '',
    'router.get("/:id", async (req, res) => {',
    '  const person = await findById(req.params.id);',
    '  res.json(person);',
    '});',
    '',
    'module.exports = router;',
  ].join('\n');

  // Base page.tsx code
  const basePageCode = [
    "'use client';",
    '',
    "import { useEffect, useState } from 'react';",
    "import PersonTable from '@/components/PersonTable';",
    '',
    "const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';",
    "const DEFAULT_FIELDS = ['name', 'email', 'address', 'phone_number'];",
    '',
    'export default function Home() {',
    '  return <PersonTable fields={DEFAULT_FIELDS} data={[]} />;',
    '}',
  ].join('\n');

  const NEW_FIELD = 'date_of_birth';

  let notifications;

  beforeEach(() => {
    notifications = [];
  });

  /**
   * Mock notification sender that tracks all calls.
   */
  function mockSendNotification(payload) {
    notifications.push(payload);
    return Promise.resolve();
  }

  it('should propagate a schema field addition through API and UI with 4 notifications', async () => {
    // ============================================================
    // STEP 1: Add a field to the schema
    // ============================================================
    const updatedSchema = {
      ...baseSchema,
      fields: {
        ...baseSchema.fields,
        [NEW_FIELD]: { type: 'string', required: false },
      },
    };

    // ============================================================
    // STEP 2: API agentic loop detects the change
    // ============================================================
    const schemaDiff = diffSchema(baseSchema, updatedSchema);
    expect(schemaDiff.addedFields).toContain(NEW_FIELD);

    // Simulate API loop sending "change detected" notification
    await mockSendNotification({
      title: 'API_Project: Change Detected',
      message: `New field(s) added to schema: ${NEW_FIELD}`,
      project: 'API_Project',
      changeType: 'field_added',
      fieldName: NEW_FIELD,
    });

    // ============================================================
    // STEP 3: Auto-approve and perform API self-healing update
    // ============================================================
    let updatedRoutesCode = baseRoutesCode;
    let swaggerDoc = null;

    const apiResult = await apiSelfHeal(schemaDiff.addedFields, {
      readFile: () => baseRoutesCode,
      writeFile: (_path, content) => {
        updatedRoutesCode = content;
      },
      addFieldToEndpoint,
      generateSwagger: () => {
        // Regenerate swagger from updated schema
        swaggerDoc = generateSwaggerFromSchema(updatedSchema);
      },
      sendNotification: mockSendNotification,
      routesPath: '/fake/routes/persons.js',
    });

    // API self-healing should succeed
    expect(apiResult).toBe(true);

    // Routes code should now include the new field
    expect(updatedRoutesCode).toContain(NEW_FIELD);

    // Swagger should have been regenerated
    expect(swaggerDoc).not.toBeNull();
    expect(swaggerDoc.components.schemas.Person.properties).toHaveProperty(NEW_FIELD);

    // ============================================================
    // STEP 4: UI agentic loop detects swagger change
    // ============================================================
    const baseSwagger = generateSwaggerFromSchema(baseSchema);
    const swaggerDiff = diffSwagger(baseSwagger, swaggerDoc);
    expect(swaggerDiff.addedFields).toContain(NEW_FIELD);

    // Simulate UI loop sending "change detected" notification
    await mockSendNotification({
      title: 'UI_Project: Change Detected',
      message: `Swagger changes detected: Added: ${NEW_FIELD}`,
      project: 'UI_Project',
      changeType: 'endpoint_updated',
      fieldName: NEW_FIELD,
    });

    // ============================================================
    // STEP 5: Auto-approve and perform UI self-healing update
    // ============================================================
    let updatedPageCode = basePageCode;
    const generatedTestFiles = [];

    const uiResult = await uiSelfHeal(swaggerDiff.addedFields, {
      readFile: () => basePageCode,
      writeFile: (filePath, content) => {
        if (filePath.endsWith('page.tsx')) {
          updatedPageCode = content;
        } else {
          generatedTestFiles.push({ path: filePath, content });
        }
      },
      deleteFile: vi.fn(),
      addColumnToPage,
      generateFieldTest: (fieldName) => {
        return `// test for ${fieldName}\nexpect('${fieldName}').toBeDefined();`;
      },
      runTests: () => ({ success: true, output: 'All tests passed' }),
      sendNotification: mockSendNotification,
      pagePath: '/fake/app/page.tsx',
      testsDir: '/fake/__tests__',
    });

    // UI self-healing should succeed
    expect(uiResult).toBe(true);

    // ============================================================
    // STEP 6: Verify final state
    // ============================================================

    // page.tsx should include the new field in DEFAULT_FIELDS
    expect(updatedPageCode).toContain(NEW_FIELD);
    expect(updatedPageCode).toMatch(/DEFAULT_FIELDS.*date_of_birth/);

    // swagger.json should include the new field
    expect(swaggerDoc.components.schemas.Person.properties[NEW_FIELD]).toEqual({
      type: 'string',
    });

    // At least 1 test file should have been generated
    expect(generatedTestFiles.length).toBeGreaterThanOrEqual(1);
    expect(generatedTestFiles[0].content).toContain(NEW_FIELD);

    // ============================================================
    // STEP 7: Verify 4 notifications sent
    // ============================================================
    // 1. API detection notification
    // 2. API success notification (from apiSelfHeal)
    // 3. UI detection notification
    // 4. UI success notification (from uiSelfHeal)
    expect(notifications.length).toBe(4);

    // Verify notification contents
    const apiDetectionNotif = notifications[0];
    expect(apiDetectionNotif.project).toBe('API_Project');
    expect(apiDetectionNotif.title).toContain('API_Project');
    expect(apiDetectionNotif.fieldName).toContain(NEW_FIELD);

    const apiSuccessNotif = notifications[1];
    expect(apiSuccessNotif.project).toBe('API_Project');
    expect(apiSuccessNotif.title).toContain('Update Complete');
    expect(apiSuccessNotif.fieldName).toContain(NEW_FIELD);

    const uiDetectionNotif = notifications[2];
    expect(uiDetectionNotif.project).toBe('UI_Project');
    expect(uiDetectionNotif.title).toContain('UI_Project');
    expect(uiDetectionNotif.fieldName).toContain(NEW_FIELD);

    const uiSuccessNotif = notifications[3];
    expect(uiSuccessNotif.project).toBe('UI_Project');
    expect(uiSuccessNotif.title).toContain('Update Complete');
    expect(uiSuccessNotif.fieldName).toContain(NEW_FIELD);
  });

  it('should halt cascade if API self-healing fails', async () => {
    // Schema change
    const updatedSchema = {
      ...baseSchema,
      fields: {
        ...baseSchema.fields,
        [NEW_FIELD]: { type: 'string', required: false },
      },
    };

    const schemaDiff = diffSchema(baseSchema, updatedSchema);

    // Simulate API detection notification
    await mockSendNotification({
      title: 'API_Project: Change Detected',
      message: `New field(s) added to schema: ${NEW_FIELD}`,
      project: 'API_Project',
      changeType: 'field_added',
      fieldName: NEW_FIELD,
    });

    // API self-healing FAILS (e.g., can't write to routes file)
    const apiResult = await apiSelfHeal(schemaDiff.addedFields, {
      readFile: () => baseRoutesCode,
      writeFile: () => {
        throw new Error('Permission denied');
      },
      addFieldToEndpoint,
      generateSwagger: vi.fn(),
      sendNotification: mockSendNotification,
      routesPath: '/fake/routes/persons.js',
    });

    expect(apiResult).toBe(false);

    // Since API failed, swagger.json would not be updated.
    // The UI loop would never trigger because swagger.json is unchanged.
    // Verify cascade halted: only 2 notifications (detection + failure), no UI notifications.
    expect(notifications.length).toBe(2);

    const apiDetection = notifications[0];
    expect(apiDetection.project).toBe('API_Project');

    const apiFailure = notifications[1];
    expect(apiFailure.project).toBe('API_Project');
    expect(apiFailure.title).toContain('Failed');
  });

  it('should halt cascade if API update is rejected (swagger unchanged)', async () => {
    // Schema change
    const updatedSchema = {
      ...baseSchema,
      fields: {
        ...baseSchema.fields,
        [NEW_FIELD]: { type: 'string', required: false },
      },
    };

    const schemaDiff = diffSchema(baseSchema, updatedSchema);
    expect(schemaDiff.addedFields).toContain(NEW_FIELD);

    // Generate base swagger for comparison
    const baseSwagger = generateSwaggerFromSchema(baseSchema);

    // Developer REJECTS the API update — no self-healing runs.
    // Swagger stays unchanged, so UI loop would find no diff.
    const swaggerDiff = diffSwagger(baseSwagger, baseSwagger);

    // No changes means the UI loop would not trigger
    expect(swaggerDiff.addedFields).toHaveLength(0);
    expect(swaggerDiff.removedFields).toHaveLength(0);
    expect(swaggerDiff.modifiedFields).toHaveLength(0);
  });

  it('should complete within 120 seconds requirement (validates timing budget)', async () => {
    const startTime = Date.now();

    const updatedSchema = {
      ...baseSchema,
      fields: {
        ...baseSchema.fields,
        [NEW_FIELD]: { type: 'string', required: false },
      },
    };

    const schemaDiff = diffSchema(baseSchema, updatedSchema);

    // API self-healing
    let swaggerDoc = null;
    await apiSelfHeal(schemaDiff.addedFields, {
      readFile: () => baseRoutesCode,
      writeFile: vi.fn(),
      addFieldToEndpoint,
      generateSwagger: () => {
        swaggerDoc = generateSwaggerFromSchema(updatedSchema);
      },
      sendNotification: mockSendNotification,
      routesPath: '/fake/routes/persons.js',
    });

    // UI self-healing
    const baseSwagger = generateSwaggerFromSchema(baseSchema);
    const swaggerDiff = diffSwagger(baseSwagger, swaggerDoc);

    await uiSelfHeal(swaggerDiff.addedFields, {
      readFile: () => basePageCode,
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      addColumnToPage,
      generateFieldTest: (fieldName) => `// test for ${fieldName}`,
      runTests: () => ({ success: true, output: 'ok' }),
      sendNotification: mockSendNotification,
      pagePath: '/fake/app/page.tsx',
      testsDir: '/fake/__tests__',
    });

    const elapsed = Date.now() - startTime;

    // Full cascade should complete well within 120 seconds (requirement 8.1)
    expect(elapsed).toBeLessThan(120000);
  });

  it('should require only approval prompts and no manual code edits (requirement 8.2)', async () => {
    // This test validates that the cascade works end-to-end with only
    // auto-approval — no manual code edits needed between stages.

    const updatedSchema = {
      ...baseSchema,
      fields: {
        ...baseSchema.fields,
        [NEW_FIELD]: { type: 'string', required: false },
      },
    };

    const schemaDiff = diffSchema(baseSchema, updatedSchema);

    // Track whether any manual intervention happened
    let manualEditsRequired = false;

    // API stage — auto-approved
    let swaggerDoc = null;
    const apiResult = await apiSelfHeal(schemaDiff.addedFields, {
      readFile: () => baseRoutesCode,
      writeFile: vi.fn(),
      addFieldToEndpoint,
      generateSwagger: () => {
        swaggerDoc = generateSwaggerFromSchema(updatedSchema);
      },
      sendNotification: mockSendNotification,
      routesPath: '/fake/routes/persons.js',
    });

    if (!apiResult) manualEditsRequired = true;

    // UI stage — auto-approved
    const baseSwagger = generateSwaggerFromSchema(baseSchema);
    const swaggerDiff = diffSwagger(baseSwagger, swaggerDoc);

    const uiResult = await uiSelfHeal(swaggerDiff.addedFields, {
      readFile: () => basePageCode,
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      addColumnToPage,
      generateFieldTest: (fieldName) => `// test for ${fieldName}`,
      runTests: () => ({ success: true, output: 'ok' }),
      sendNotification: mockSendNotification,
      pagePath: '/fake/app/page.tsx',
      testsDir: '/fake/__tests__',
    });

    if (!uiResult) manualEditsRequired = true;

    // Both stages succeeded without manual intervention
    expect(manualEditsRequired).toBe(false);
    expect(apiResult).toBe(true);
    expect(uiResult).toBe(true);
  });
});
