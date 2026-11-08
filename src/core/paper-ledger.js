import { randomUUID } from 'node:crypto';

export class PaperLedger {
  constructor(initialEquityUsd = 0) { this.cashUsd = initialEquityUsd; this.positions = new Map(); this.closed = []; }
  open({ pool, allocationUsd, range, feeApr, now = Date.now() }) {
    if (allocationUsd <= 0 || allocationUsd > this.cashUsd) throw new Error('Invalid paper allocation');
    const id = randomUUID();
    this.cashUsd -= allocationUsd;
    const position = { id, pool, allocationUsd, range, feeApr, openedAt: now, feesAccruedUsd: 0, status: 'open' };
    this.positions.set(id, position); return structuredClone(position);
  }
  accrueFees(id, hours) {
    const p = this.positions.get(id); if (!p) throw new Error('Unknown position');
    if (!(hours >= 0)) throw new Error('hours must be non-negative');
    // APR is a rough paper estimate, not an on-chain fee claim simulation.
    p.feesAccruedUsd += p.allocationUsd * (p.feeApr/100) * (hours/(365*24));
    return p.feesAccruedUsd;
  }
  close(id, { inventoryPnlPct = 0, now = Date.now(), reason = 'manual-paper-close' } = {}) {
    const p = this.positions.get(id); if (!p) throw new Error('Unknown position');
    const inventoryPnlUsd = p.allocationUsd * inventoryPnlPct / 100;
    const returned = Math.max(0, p.allocationUsd + inventoryPnlUsd + p.feesAccruedUsd);
    this.cashUsd += returned;
    const closed = { ...p, closedAt: now, reason, inventoryPnlUsd, returnedUsd: returned,
      netPnlUsd: returned - p.allocationUsd };
    this.positions.delete(id); this.closed.push(closed); return structuredClone(closed);
  }
}
