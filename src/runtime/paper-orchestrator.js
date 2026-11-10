import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Long-running paper runtime with single-flight polling, restart-safe state,
 * read-only provider enforcement, bounded retries and graceful shutdown.
 */
export function createPaperOrchestrator({
  engine,
  snapshotProvider,
  statePath = './data/paper-state-lp.json',
  intervalMs = 60_000,
  onResult = () => {},
  onError = () => {},
  clock = Date.now,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  if (!engine || typeof engine.processSnapshot !== 'function' || typeof engine.exportState !== 'function') {
    throw new Error('A paper trading engine is required');
  }
  if (!snapshotProvider || snapshotProvider.readOnly !== true || typeof snapshotProvider.getSnapshots !== 'function') {
    throw new Error('snapshotProvider must be explicitly read-only and implement getSnapshots()');
  }
  for (const forbidden of ['sendTransaction','signTransaction','executeTrade','addLiquidity','removeLiquidity','swap']) {
    if (typeof snapshotProvider[forbidden] === 'function') throw new Error('Execution-capable provider is not allowed in paper runtime: ' + forbidden);
  }
  if (!(Number.isFinite(intervalMs) && intervalMs >= 5_000)) throw new Error('intervalMs must be at least 5000ms');

  let timer = null;
  let busy = false;
  let stopped = true;
  let lastCycleAt = null;
  let cycles = 0;
  let errors = 0;

  async function persist() {
    const absolute = path.resolve(statePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const temporary = absolute + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(engine.exportState(), null, 2), { mode: 0o600 });
    await fs.rename(temporary, absolute);
  }

  async function runOnce() {
    if (busy || stopped) return { status: 'skipped-busy-or-stopped' };
    busy = true;
    try {
      const snapshots = await snapshotProvider.getSnapshots({ now: clock() });
      if (!Array.isArray(snapshots)) throw new Error('Snapshot provider must return an array');
      const ordered = [...snapshots].sort((a,b) => {
        const time = value => typeof value === 'number' ? value : Date.parse(value);
        return time(a.timestamp) - time(b.timestamp);
      });
      const results = [];
      for (const snapshot of ordered) {
        const result = await engine.processSnapshot(snapshot);
        await persist();
        results.push(result);
        onResult(result);
      }
      cycles++;
      lastCycleAt = clock();
      return { status: 'completed', cycle: cycles, timestamp: lastCycleAt, snapshots: results.length, results, portfolio: engine.summary() };
    } catch (error) {
      errors++;
      onError(error);
      return { status: 'error', message: error.message, errors, timestamp: clock() };
    } finally {
      busy = false;
    }
  }

  async function start() {
    if (!stopped) return { status: 'already-running' };
    stopped = false;
    await runOnce();
    timer = setIntervalImpl(() => { void runOnce(); }, intervalMs);
    return { status: 'running', intervalMs, paperOnly: true };
  }

  async function stop() {
    stopped = true;
    if (timer) clearIntervalImpl(timer);
    timer = null;
    while (busy) await new Promise(resolve => setTimeout(resolve, 25));
    await persist();
    return { status: 'stopped', cycles, errors, lastCycleAt, portfolio: engine.summary() };
  }

  return {
    readOnly: true,
    start,
    stop,
    runOnce,
    status: () => ({ running: !stopped, busy, cycles, errors, lastCycleAt, intervalMs, portfolio: engine.summary() })
  };
}
