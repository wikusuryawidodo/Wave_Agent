# Meridian AI DLMM / Wave_Agent

Read-only Solana/Meteora DLMM analytics with a deterministic **paper-only** trading engine and an advisory AI analyst.

**Safety posture:** there is no wallet signer, private-key loader, swap sender, add-liquidity sender, remove-liquidity sender, or transaction submission path. The engine simulates paper entries, marks, fees, exits and account equity only.

## Strategy preset

- **Entry: hybrid.** Requires at least two distinct tracked wallet groups to add quote-side liquidity in the prior 120 seconds, a quality pool score, and bullish 30m trend + 5m momentum/volume confirmation.
- **Style: balanced.** Risk budget is 0.5% of current equity per position, aggregate reserved position risk capped at 1%, maximum two positions, and maximum 25% equity allocation per position.
- **Exit: dynamic.** Hard stop at -8% net position return; trailing protection activates at +3% and exits after a 1.5 percentage-point giveback; also exits for a 30-minute out-of-range condition or fee APR below 7% after 60 minutes.

See [docs/PAPER-ENGINE.md](docs/PAPER-ENGINE.md) for risk math, snapshot fields, accounting assumptions and operation instructions.

## Architecture

- Helius: read-only Solana JSON-RPC, public wallet log subscription, DAS asset reads and Enhanced Transactions query adapter.
- Meteora: official DLMM SDK adapter for active bin, fee info and surrounding bin state; public Data API adapter for pool discovery and historical data.
- AI: OpenRouter first, optional OpenAI API fallback. AI runs as an analyst and is advisory only; it cannot authorize, veto, resize or close a position.
- Paper engine: deterministic wallet-convergence and multi-timeframe signal gate, risk-based sizing, persistent paper ledger, fee/mark model, hard stop, trailing stop, out-of-range and low-fee exits.
- Backtest: snapshot-based backtest and DLMM bin simulation helpers.

## Important integration boundary

The engine is implemented and can be driven using the documented JSONL snapshot contract. The current Helius wallet watcher still emits raw subscription notifications; it does **not yet parse verified Meteora add-liquidity events and merge them automatically with pool metrics and 5m/30m candles**. Do not treat token transfers as wallet LP-add signals. A read-only signal adapter is still needed before unattended, continuously-fed paper operation.

The inventory PnL fallback is a simplified concentrated-liquidity approximation, not exact Meteora PositionV2 bin/share accounting. Exact paper PnL requires observed bin inventory, position liquidity shares and fee checkpoints.

## Quick start (Ubuntu 24.04)

```bash
git clone https://github.com/wikusuryawidodo/Wave_Agent.git
cd Wave_Agent
npm install
cp .env.example .env
chmod 600 .env
# Fill a USD equity mark and optional Helius/OpenRouter read-only credentials.
npm test
npm start
```

## Configure the paper equity

The engine uses USD-denominated risk sizing. Set either:

```env
# e.g. 3 SOL starting equity × $150/SOL = $450 USD
STARTING_EQUITY_SOL=3
SOL_PRICE_USD=150

# alternatively, set the paper account directly in USD
# PAPER_STARTING_EQUITY_USD=450
```

The worker fails closed unless one method produces a positive USD equity value. Never use an arbitrary stale SOL price for meaningful paper results.

## Run the paper engine

The worker consumes one JSON snapshot per line:

```bash
npm run paper:worker < fixtures/paper-snapshots.jsonl
```

The fixture is synthetic and demonstrates an entry followed by a deterministic stop; it is not market data. In a live read-only research setup, a separate adapter must construct compliant snapshots from verified data. Use `PAPER_STATE_PATH` to choose the persistent state file.

Other commands:

```bash
npm test
npm run backtest -- fixtures/sample-snapshots.json
npm run meteora:discover -- 20
npm run meteora:inspect -- <LB_PAIR_ADDRESS> 20
npm run worker
npm run helius:watch
npm run ai:check
```

## AI role

The AI analyst is called only after a deterministic paper entry. It can annotate the position with research notes; all entry eligibility, sizing, risk limits and exit decisions remain deterministic. Missing or invalid AI output never changes the trading decision.

## Security

Never add a seed phrase or wallet private key. Keep `.env` private. The worker stores paper account state locally and does not transmit or sign transactions.
