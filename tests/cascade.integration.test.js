/**
 * Integration test: full cascade through the generic, config-driven pipeline.
 *
 * Exercises the same end-to-end story as before, but through the new machinery:
 *   1. Schema change → API node reconciles routes/persons.js (goal-driven LLM, verified)
 *   2. API node's deterministic producer regenerates swagger.json
 *   3. UI node detects the swagger change (generic contract diff)
 *   4. UI node reconciles app/page.tsx (goal-driven LLM, verified)
 *
 * The LLM and the verify step are mocked, so no live model is required. What we
 * assert is the wiring: reconcile applies model output, verify gates it, the
 * producer cascades, notifications fire, and a verify failure halts the cascade.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { reconcileNode } = require('../shared/reconcile.js');
const { diffContract, contractsEqual } = require('../shared/contract-diff.js');
const { generateSwaggerFromSchema } = require('../api-project/swagger-generator.js');

// --- Node fixtures mirroring contracts.config.json (absolute paths are fake) ---
const apiNode = {
  id: 'api',
  project: 'API_Project',
  goal: 'Keep routes/persons.js consistent with the Person contract.',
  owns: ['api-project/routes/persons.js'],
  ownsPaths: ['/repo/api-project/routes/persons.js'],
  contractPath: ['fields'],
  verify: 'echo ok',
  maxReconcileAttempts: 2,
};

const uiNode = {
  id: 'ui',
  project: 'UI_Project',
  goal: 'Keep DEFAULT_FIELDS in page.tsx equal to the Person properties.',
  owns: ['ui-project/app/page.tsx'],
  ownsPaths: ['/repo/ui-project/app/page.tsx'],
  contractPath: ['components', 'schemas', 'Person', 'properties'],
  verify: 'echo ok',
  maxReconcileAttempts: 2,
};

const baseSchema = {
  type: 'object',
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
    address: { type: 'string', required: true },
    phone_number: { type: 'string', required: true },
  },
};

const baseRoutes = [
  "const express = require('express');",
  'const router = express.Router();',
  "const { findAll, findById } = require('../../database-project/db');",
  "router.get('/', async (req, res) => { res.json(await findAll()); });",
  'module.exports = router;',
].join('\n');

const basePage = [
  "'use client';",
  "const DEFAULT_FIELDS = ['name', 'email', 'address', 'phone_number'];",
  'export default function Home() { return null; }',
].join('\n');

const NEW_FIELD = 'date_of_birth';

/**
 * In-memory fs + notification capture for reconcile deps.
 */
function fsDeps(initialFiles) {
  const files = new Map(Object.entries(initialFiles));
  const notifications = [];
  return {
    files,
    notifications,
    make: (callLLM, runVerify) => ({
      readFile: (p) => {
        if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return files.get(p);
      },
      writeFile: (p, c) => files.set(p, c),
      callLLM,
      runVerify,
      sendNotification: (n) => { notifications.push(n); return Promise.resolve(); },
    }),
  };
}

describe('Full cascade (generic pipeline)', () => {
  let updatedSchema;

  beforeEach(() => {
    updatedSchema = {
      ...baseSchema,
      fields: { ...baseSchema.fields, [NEW_FIELD]: { type: 'string', required: false } },
    };
  });

  it('propagates a field addition schema → routes → swagger → page', async () => {
    // -- API stage: reconcile routes, then run the deterministic producer --
    const apiFs = fsDeps({ '/repo/api-project/routes/persons.js': baseRoutes });
    const apiLLM = vi.fn().mockResolvedValue(`// Person record includes field: ${NEW_FIELD}\n${baseRoutes}`);
    const apiVerify = vi.fn().mockReturnValue({ success: true, output: '' });

    const apiOk = await reconcileNode(apiNode, baseSchema, updatedSchema, apiFs.make(apiLLM, apiVerify));
    expect(apiOk).toBe(true);
    expect(apiFs.files.get('/repo/api-project/routes/persons.js')).toContain(NEW_FIELD);

    // Producer (deterministic, unchanged) regenerates the downstream contract.
    const baseSwagger = generateSwaggerFromSchema(baseSchema);
    const newSwagger = generateSwaggerFromSchema(updatedSchema);
    expect(newSwagger.components.schemas.Person.properties).toHaveProperty(NEW_FIELD);

    // -- UI stage: detect the swagger change generically, then reconcile page --
    expect(contractsEqual(baseSwagger, newSwagger)).toBe(false);
    const swaggerDiff = diffContract(baseSwagger, newSwagger, uiNode.contractPath);
    expect(swaggerDiff.addedFields).toContain(NEW_FIELD);

    const uiFs = fsDeps({ '/repo/ui-project/app/page.tsx': basePage });
    const uiLLM = vi.fn().mockResolvedValue(
      basePage.replace("'phone_number']", `'phone_number', '${NEW_FIELD}']`)
    );
    const uiVerify = vi.fn().mockReturnValue({ success: true, output: '' });

    const uiOk = await reconcileNode(uiNode, baseSwagger, newSwagger, uiFs.make(uiLLM, uiVerify));
    expect(uiOk).toBe(true);
    expect(uiFs.files.get('/repo/ui-project/app/page.tsx')).toMatch(/DEFAULT_FIELDS.*date_of_birth/);

    // Each stage emitted a success notification.
    expect(apiFs.notifications.at(-1).title).toContain('Reconciled');
    expect(uiFs.notifications.at(-1).title).toContain('Reconciled');
  });

  it('halts the cascade when API verify never passes (routes reverted, swagger untouched)', async () => {
    const apiFs = fsDeps({ '/repo/api-project/routes/persons.js': baseRoutes });
    const apiLLM = vi.fn().mockResolvedValue('BROKEN ROUTES');
    const apiVerify = vi.fn().mockReturnValue({ success: false, output: 'load error' });

    const apiOk = await reconcileNode(apiNode, baseSchema, updatedSchema, apiFs.make(apiLLM, apiVerify));

    expect(apiOk).toBe(false);
    // Owned file reverted to the original — so the producer would never run and
    // swagger.json would never change, meaning the UI node never triggers.
    expect(apiFs.files.get('/repo/api-project/routes/persons.js')).toBe(baseRoutes);
    expect(apiFs.notifications.at(-1).title).toContain('Failed');
  });

  it('completes well within the timing budget', async () => {
    const start = Date.now();
    const apiFs = fsDeps({ '/repo/api-project/routes/persons.js': baseRoutes });
    await reconcileNode(
      apiNode,
      baseSchema,
      updatedSchema,
      apiFs.make(
        vi.fn().mockResolvedValue(baseRoutes),
        vi.fn().mockReturnValue({ success: true, output: '' })
      )
    );
    expect(Date.now() - start).toBeLessThan(120000);
  });
});
