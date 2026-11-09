# Meridian AI DLMM / Wave_Agent

Read-only Solana/Meteora DLMM analytics with a deterministic **paper-only** trading engine and an advisory AI analyst.

**Safety posture:** there is no wallet signer, private-key loader, swap sender, add-liquidity sender, remove-liquidity sender, or transaction submission path. The engine simulates paper entries, marks, fees, exits and account equity only.

## Strategy preset

- **Entry: hybrid LP.** Requires persistent fee economics, verified token security, an exact mature pair, market confirmation on 5m/30m, two distinct verified Meteora LP-add wallet groups, and bin-level stress evidence.
- **Style: balanced LP.** Planned risk is 0.3% of equity per position, aggregate reserved risk is capped at 0.6%, at most two open positions, and at most 12.5% equity allocated to one position.
- **Exit: dynamic LP.** Stress-adjusted hard stop, profit trailing lock, net take-profit, out-of-range timeout, 30m trend reversal, fee-yield decay, tracked-wallet withdrawals and a seven-day time stop.
- **Fee-farming hurdle:** whole-pool APR is only a sanity check; require simulated proposed-range position APR >=120% (24h) and >=150% (7d), projected 7d net edge >=1.0%, fee coverage >=2× inventory drag + round-trip cost, and 7d inventory drag <=1.0%. Forecast fee capture is haircut 35%.
- **Trending + one-token zap option:** separate paper planner ranks volume/velocity/fee consistency, supports approved quote-asset zap into an in-range range, directional single-sided ranges away from spot, volatility-aware widths (6% / 15% / 30–50%), and five-minute edge/fee/out-of-range monitoring. This option is planner-only; there is no router zap or automatic close transaction.
- **Pair and token safety:** exact pair at least 14 days old; token age at least 14 days; market cap at least $250k; FDV/market-cap at most 2.5; pair liquidity at least $50k and 8% of market cap; minimum 24h sell activity and bounded buy/sell ratio.

See [docs/PAPER-ENGINE.md](docs/PAPER-ENGINE.md) for risk math, snapshot fields, accounting assumptions and operation instructions.

## Architecture

- Helius: read-only Solana JSON-RPC, public wallet log subscription, DAS asset reads and Enhanced Transactions query adapter.
- Meteora: official DLMM SDK adapter for active bin, fee info and surrounding bin state; public Data API adapter for pool discovery and historical data.
- AI: OpenRouter first, optional OpenAI API fallback. AI runs as an analyst and is advisory only; it cannot authorize, veto, resize or close a position.
- GMGN: official CLI read-only adapter for Trending (1m/5m/1h/6h/24h), Trenches, Market Signals and Hot Searches; discovery scorer uses rug ratio, wash trading, smart-money counts, volume, liquidity, market cap and age.
- Pair data: read-only DexScreener enrichment for pair creation time, market cap, FDV, liquidity, price change and 24h buy/sell activity. Exact pair-address + mint matching is required.
- Paper engine: deterministic wallet-convergence, token/pair safety, fee-edge economics, multi-timeframe market gate, stress-based sizing and dynamic LP exits.
- Backtest: snapshot-based backtest and DLMM bin simulation helpers.

## Important integration boundary

The engine is implemented and can be driven using the documented JSONL snapshot contract. The current Helius wallet watcher still emits raw subscription notifications; it does **not yet parse verified Meteora add/remove-liquidity instructions and merge them automatically with pool metrics, exact pair evidence and 5m/30m candles**. The DexScreener adapter supplies pair age/cap/liquidity evidence only; it does not certify token safety. A verified wallet-event parser and a bin-level stress/mark simulator are still required before unattended paper operation. Do not manufacture the `verified` flags from raw logs or transfers.

The inventory PnL fallback is a simplified concentrated-liquidity approximation, not exact Meteora PositionV2 bin/share accounting. Exact paper PnL requires observed bin inventory, position liquidity shares and fee checkpoints.

## Fee farming and inventory-loss filter

The entry engine does not count liquidity-mining reward emissions as trading fees. Rewards are tracked separately because they depend on eligible active bins, claimability and reward-token value. The fee forecast uses position-specific fee APR for the proposed range, not the whole-pool TVL APR, and must clear the net-edge and coverage thresholds documented in [docs/PAPER-ENGINE.md](docs/PAPER-ENGINE.md). Use `npm run paper:fee-analysis` to replay the deterministic fee-vs-inventory-drag sensitivity cases. This is a model sensitivity check, not historic strategy performance.

## Install GMGN CLI for GitHub Actions

The official `gmgn-cli` is pinned as a repository npm dependency. To configure it securely for GitHub Actions, follow [docs/GMGN-INSTALL.md](docs/GMGN-INSTALL.md). The setup requires two GitHub Actions secrets, `GMGN_API_KEY` and the matching `GMGN_KEYPAIR_PEM`. Never commit the generated key-pair file or the CLI's local config.

After the PR is merged into the default branch, run **Actions → GMGN CLI read-only smoke test** to install/configure the CLI on an ephemeral runner and fetch a small Trending response. This is a manual, read-only check; it does not submit trades, swaps or LP transactions.

## GMGN trending and FOMO signal boundary

The exported `gmgnCli` adapter executes only documented read-only GMGN CLI commands. Install/update `gmgn-cli`, configure its API key with the official CLI, and ensure `gmgn-cli config --check` succeeds. Then use `gmgnCli.getTrending('sol', { interval: '5m', orderBy: 'volume', limit: 50 })`, `gmgnCli.getSignals('sol', { signalTypes: [12, 13, 6, 7, 20] })`, `gmgnCli.getTrenches(...)`, or `gmgnCli.getHotSearches(...)`. GMGN Trending is ranked by swap activity; Hot Searches measures visitor/search heat; Market Signals are event notifications such as price spikes, smart-money buys, KOL/platform calls, and Dex trending bar. They are distinct feeds.

The separate Fomo Thesis and Fomo Top chart markers are not exposed as fields in the documented GMGN CLI Market Signal feed. Fomo Thesis is a social post from FOMO; Fomo Top is a FOMO-indexed wallet transfer marker and a transfer-in is not proof of a buy. Do not treat these as confirmed LP adds or entry signals. A future FOMO integration would need its own supported data provider and wallet/event verification.

GMGN token discovery does not identify the exact Meteora LB pair or position-specific fee yield by itself. Resolve token mint to exact Meteora pool(s), then apply pair-age, pair liquidity, token security, bin fee replay, inventory drag and zap quote checks. GMGN's rug/wash/holder fields are an extra research layer, not a substitute for independent safety checks.

## Trending + one-token zap research mode

The separate `rankTrendingPools`, `evaluateTrendingZapCandidate`, and `evaluateZapPositionMark` functions are exported from `src/index.js`. The stable-zap path requires a fresh read-only route quote that converts the single input asset into the range's two-sided in-range composition. The directional single-sided path creates a range fully above/below spot and **does not forecast any fees until price activates the range**. Supported quote mints must be explicitly allowlisted by the caller (for example, a verified USDG or WETH mint); never infer stablecoin status from a symbol.

Paper range presets: stable/quiet/tokenized-stock = ±6% (tokenized stocks require issuer allowlist verification); normal trending = ±15%; high-volatility = ±30–50%. A pair younger than 14 days is still rejected by the existing security policy even where the wide-range preset is selected. The 5-minute monitor returns `hold`, `prepare-close`, or `close-and-rotate`; it never sends a zap or remove-liquidity action.

## Pair-age and market-cap evidence

Pair-age, market-cap, FDV, pair-liquidity, 24h price-change and buy/sell activity filters use the documented [DexScreener pair API](https://docs.dexscreener.com/api/reference). DexScreener describes `pairCreatedAt`, `marketCap`, `fdv`, `liquidity`, `priceChange` and `txns` as available pair fields. These are screening signals, not a guarantee against rugs or manipulation. The engine rejects missing, stale, mismatched or below-floor evidence.

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
npm run paper:fee-analysis
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
