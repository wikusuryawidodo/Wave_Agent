import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPaperOrchestrator } from '../src/runtime/paper-orchestrator.js';

test('paper orchestrator polls, sorts snapshots, and persists state', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wave-paper-'));
  const statePath = path.join(dir, 'state.json');
  const processed = [];
  const engine = {
    processSnapshot: async snapshot => { processed.push(snapshot.timestamp); return { timestamp: snapshot.timestamp }; },
    exportState: () => ({ version: 1, processed }),
    summary: () => ({ processed: processed.length })
  };
  const provider = {
    readOnly: true,
    getSnapshots: async () => [{ timestamp: 2 }, { timestamp: 1 }]
  };
  let timerCallback;
  const runtime = createPaperOrchestrator({
    engine, snapshotProvider: provider, statePath,
    intervalMs: 5_000,
    setIntervalImpl: callback => { timerCallback = callback; return 1; },
    clearIntervalImpl: () => {}
  });
  assert.equal((await runtime.start()).status, 'running');
  assert.deepEqual(processed, [1, 2]);
  assert.deepEqual(JSON.parse(await fs.readFile(statePath, 'utf8')).processed, [1, 2]);
  assert.equal(runtime.status().running, true);
  const stopped = await runtime.stop();
  assert.equal(stopped.status, 'stopped');
  await fs.rm(dir, { recursive: true, force: true });
});

test('paper orchestrator rejects an execution-capable or non-read-only provider', () => {
  const engine = { processSnapshot: async () => ({}), exportState: () => ({}), summary: () => ({}) };
  assert.throws(() => createPaperOrchestrator({
    engine, snapshotProvider: { readOnly: false, getSnapshots: async () => [] }
  }), /explicitly read-only/);
  assert.throws(() => createPaperOrchestrator({
    engine, snapshotProvider: { readOnly: true, getSnapshots: async () => [], sendTransaction() {} }
  }), /Execution-capable provider/);
});
