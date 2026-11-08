# Wave_Agent — Paper entry/exit engine

## Preset

The strategy is fixed to:

- Entry: **hybrid** — at least two distinct wallet groups add liquidity in the preceding 120 seconds, and 5m/30m market confirmation passes.
- Style: **balanced** — 0.5% of current portfolio equity at risk per position, 1.0% aggregate open risk, at most two concurrent positions, and at most 25% of equity allocated to one position.
- Exit: **dynamic** — hard stop at -8% net position return; trailing stop arms at +3% and closes after a 1.5 percentage-point giveback; out-of-range timeout after 30 minutes; close for fee APR below 7% after the first 60 minutes.

The allocation is derived from the risk budget, not a fixed wallet percentage:

`allocation = min(equity × 0.5% ÷ (8% stop + 0.25% round-trip cost), 25% equity, free cash, remaining portfolio risk capacity ÷ (8.25%) )`

Therefore a full-size position reserves no more than 0.5% of equity as planned stop-plus-cost risk. Two positions together may reserve at most 1.0%. A stop is a paper decision and does not guarantee any real-world execution price.

## Input contract

The worker reads one JSON snapshot per line from stdin. Each snapshot must include:

- `timestamp`: Unix milliseconds or ISO-8601 timestamp.
- `pool`: `poolAddress`, `tvlUsd`, `volume24hUsd`, `fees24hUsd`, and `dataAgeSec` (freshness is fail-closed). Optional fields include `chain`, `symbol`, `liquidityTrend24hPct`, `feeVolumeConsistency`, and `audit.critical`.
- `priceUsd`: current price in USD.
- `candles5m` and `candles30m`: at least 50 OHLCV candles each, with `open`, `high`, `low`, `close`, `volume`.
- `walletSignals`: events with `walletAddress` or `walletGroup`, `eventType: "add-liquidity"`, `timestamp`, `quoteAmountUsd`, with `success: true` from a verified successful Meteora LP event and optional `inRange`. Distinct wallet groups are deduplicated; events must be recent and each must contribute at least $10 quote-side liquidity.
- Optional `inventoryPnlPct`: externally calculated inventory-only return percentage for the paper position. If omitted, the engine uses its simplified concentrated-liquidity inventory approximation.

A signal example is available in `fixtures/paper-snapshot.example.json`. Do not populate wallet events from token transfers or unverified parser guesses: the event must represent a successful liquidity add. The current Helius watcher does not yet produce this unified snapshot contract automatically; an upstream adapter still needs to map verified wallet events, pool metrics and candles into this format.

## Exit and accounting

Fees are accrued from observed 24h pool fees × the paper allocation's TVL share × a 70% capture haircut × elapsed time, and only while the simulated range is in range. The model deducts an estimated 25 bps round-trip cost. These are paper assumptions, not measured user fees. If `inventoryPnlPct` is absent, the built-in fallback is a simplified V3-style concentrated-liquidity model; it is not exact Meteora bin/share accounting. Exact simulation requires observed bin inventory, liquidity shares and fee checkpoints.

The AI analyst runs only after a deterministic entry has already been opened. Its recommendation is stored as commentary and cannot veto, approve, resize, or close a position. AI failures do not change the paper decision. All exits are deterministic and AI-independent.

The engine persists balances, open positions, closed trades, high-water mark, cooldown and processed-snapshot timestamps to a JSON state file. Keep that file backed up; do not edit it while the worker is running.

## Run

Set a paper equity mark in USD, or provide the SOL/USD mark used to convert the existing 3 SOL starting equity:

```env
STARTING_EQUITY_SOL=3
SOL_PRICE_USD=150
# or set PAPER_STARTING_EQUITY_USD directly
PAPER_STATE_PATH=./data/paper-state.json
```

Then stream JSONL snapshots into the worker:

```bash
npm run paper:worker < fixtures/paper-snapshots.jsonl
```

The worker is an stdin-driven paper engine, not a live market-data collector. It never loads a wallet secret, signs, sends swaps, adds/removes liquidity, or submits Solana transactions.
