# Wave_Agent — Balanced LP paper strategy

## Strategy intent

This is an experimental **paper-only LP selection and management model**, not a promise or guarantee of positive returns. It seeks pools where fee income has a conservative, measurable chance to exceed estimated inventory drag and entry/exit costs.

Preset:
- Entry: **hybrid** — pool fee economics + 5m/30m market confirmation + two distinct, verified Meteora LP-add wallet groups.
- Style: **balanced LP** — 0.3% equity risk per position, 0.6% aggregate open risk, maximum two positions, maximum 12.5% equity allocation per position.
- Exit: **dynamic LP** — stress-adjusted hard stop; +2.5% trailing activation with 1 percentage-point giveback; persistent out-of-range; two 30m trend-reversal confirmations; two low-fee confirmations; tracked-wallet withdrawal convergence; 8% net take-profit; and seven-day time stop.
- Range: symmetric range whose half-width is derived from ATR and observed 24h volatility. The output is a paper planning range, not a transaction instruction.

## Entry checklist

A pool is eligible only when all hard gates pass:

1. **Pool quality and freshness:** TVL at least $25k, active TVL available, volume at least $10k, pool metrics no older than 90 seconds.
2. **Active liquidity:** active TVL at least 30% of total TVL; volume/active-TVL between 0.20 and 4.5.
3. **Fee persistence:** both 24h and 7d fees must exist. Annualized fee APR on active TVL must be at least 35% for 24h and 40% for 7d. 24h fee pace must not be more than 2.5× the seven-day daily average or below half its baseline.
4. **Net fee edge:** conservative seven-day fee projection uses the lower of 24h and seven-day APR, 65% fee capture, a 30 bps round-trip cost, and a separately modelled seven-day inventory drag. Estimated edge must exceed 0.10 percentage point.
5. **Volatility and liquidity trend:** 24h realized volatility no more than 7%; liquidity outflow no worse than -8%.
6. **Token security:** verified metadata; mint and freeze authorities disabled; explicit honeypot=false and scam=false; security snapshot <=300 seconds; top 10 holder concentration <=35%; top 10 dev-wallet concentration <=15%; at least 200 holders; token age >=7 days; market cap >=$100k.
7. **Market context:** 60 completed candles for both 5m and 30m; data age within configured limits; bullish recursive Supertrend on both timeframes; 30m close above EMA50; 5m MACD bullish; 5m RSI 42–65; 30m ADX 8–30; 5m volume ratio 0.8–3.5; price not excessively extended within the Bollinger envelope.
8. **Wallet confirmation:** at least two distinct wallet groups add quote-side liquidity to the exact pool within 120 seconds. Each event must be marked verified and successful, include the canonical Meteora DLMM program ID, signature, instruction index, and quote-side USD amount >=$25. The engine rejects unverified events; this flag must only be set by a transaction parser that validates the actual instruction and transaction metadata.
9. **Bin-level risk simulation:** an independently verified Meteora bin simulator must supply stress loss <=8%, seven-day inventory drag, and >=90% simulated range coverage. Without these, the engine deliberately refuses entry.

## Position sizing

Position size is computed from the smaller of the 0.3% single-position equity budget and unused 0.6% portfolio risk budget. The loss denominator is the larger of the planned stop and bin stress loss, plus the 30 bps round-trip cost. Final size is also capped at 12.5% equity and available paper cash.

This is an intended risk budget, not a guaranteed maximum loss. Gaps, stale prices, missing bins and model error can exceed it. A live LP would need execution-specific slippage and exit liquidity modelling.

## Exit and position management

- **Hard stop:** net paper position return reaches the stress-adjusted stop (4–7.5%, linked to the bin stress estimate).
- **Profit lock:** peak net return reaches +2.5%, then gives back at least 1 percentage point while still positive.
- **Take profit:** net return reaches +8%.
- **Out of range:** position remains out of range for at least 15 minutes.
- **Trend reversal:** two consecutive 30m Supertrend bearish observations with ADX >=22.
- **Fee decay:** after 45 minutes, current captured APR is below 18% or below 45% of entry APR for two consecutive updates.
- **Tracked-wallet withdrawal:** two distinct verified tracked-wallet groups remove quote-side liquidity from the same pool during the 120-second window.
- **Forward economics:** after 45 minutes, current fee projection net of remaining inventory drag and close cost is <=0.
- **Time stop:** position is closed after seven days if none of the above triggered.
- **Cooldown:** the same pool cannot be re-entered for 30 minutes.

The strategy does not automatically rebalance. It paper-closes on exit conditions and requires a new complete entry evaluation before a later paper entry.

## Snapshot input contract

The stdin worker consumes one JSON object per line. Required fields:

- \`timestamp\`: Unix milliseconds or ISO timestamp.
- \`pool\`: \`poolAddress\`, \`tokenMint\`, \`tvlUsd\`, \`activeTvlUsd\`, \`volume24hUsd\`, \`fees24hUsd\`, \`fees7dUsd\`, \`dataAgeSec\`, \`volatility24hPct\`, \`liquidityTrend24hPct\`, \`symbol\`, and \`chain\`.
- \`security\`: \`verified\`, \`mintAuthorityDisabled\`, \`freezeAuthorityDisabled\`, \`honeypot\`, \`scam\`, \`dataAgeSec\`, \`top10HoldersPct\`, \`top10DevWalletPct\`, \`holders\`, \`tokenAgeDays\`, \`marketCapUsd\`.
- \`marketData\`: \`candles5mAgeSec\`, \`candles30mAgeSec\`.
- \`candles5m\`, \`candles30m\`: at least 60 completed OHLCV candles each.
- \`walletSignals\`: signature, instruction index, wallet or wallet group, exact pool, exact program ID, event type, timestamp, success=true, verified=true, quoteSide=true and quoteAmountUsd.
- \`lpRisk\`: verified=true, source=\`meteora-bin-stress-simulator\`, stressLossPct, expectedInventoryDragPct7d, simulatedRangeCoveragePct.
- For open position marks, prefer \`lpMark.inventoryPnlUsd\`, \`lpMark.feesSinceLastUsd\`, \`lpMark.inRange\` and optional \`lpMark.closeCostUsd\`. Otherwise PnL falls back to a simplified CLMM estimate and is explicitly labelled approximate.

**Integration limitation:** the existing Helius watcher does not yet decode and normalize verified Meteora liquidity instructions, and no completed bin-stress simulator currently generates the required \`lpRisk\` evidence. This engine therefore cannot safely create entries from raw Helius or Meteora snapshots yet. An adapter and bin-level stress simulator are still necessary. Never manufacture \`verified=true\` from an unparsed log or transfer.

## Accounting assumptions

The fee estimate uses the lower of 24h and 7d active-TVL annualizations, then applies 65% capture. During marks, fee accrual uses active TVL and elapsed time only while in range. Cost assumptions default to 30 bps round trip plus any additional closeCostUsd supplied by the simulator. Inventory PnL is exact only when a trusted bin-level mark is supplied; the fallback is not exact Meteora PositionV2 accounting.

The Meteora DLMM position account stores per-bin liquidity shares and fee checkpoints/pending amounts. Use decoded PositionV2 and bin/fee state rather than treating raw pool TVL as a position share. See the official docs linked in the project README.

## Run

Set \`PAPER_STARTING_EQUITY_USD\` or supply \`SOL_PRICE_USD\` to convert \`STARTING_EQUITY_SOL\` to USD. The worker fails closed if there is no positive USD equity mark.

\`\`\`bash
npm run paper:worker < fixtures/paper-snapshots.jsonl
npm test
\`\`\`

The paper worker never loads a signing key, creates transactions, signs, swaps, adds liquidity, removes liquidity, claims fees, or broadcasts transactions. AI is a post-decision analyst only and cannot change any deterministic decision.
