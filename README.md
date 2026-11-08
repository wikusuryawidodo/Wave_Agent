# Meridian AI DLMM

Read-only Solana/Meteora DLMM analytics and paper simulator, with an OpenRouter-first AI analyst and Helius blockchain adapter.

**Default posture: paper-only.** This project has no wallet signer, private-key loader, swap sender, add-liquidity sender, remove-liquidity sender, or transaction submission path.

## Architecture

- Strategy foundation: Meridian's documented wallet-triggered, deterministic screening/position-management architecture is the design reference.
- Helius: Solana JSON-RPC, public wallet log subscription, DAS asset reads and Enhanced Transactions query adapter.
- Meteora: official DLMM SDK adapter for active bin, fee info and surrounding bin state; public Data API adapter for pool discovery and historical data.
- AI: OpenRouter first, optional OpenAI API fallback. AI produces research summaries only; it cannot authorize execution.
- Simulator: bin allocation, inventory mark-to-market, fee approximation, IL-vs-hold and snapshot backtest.

## Important upstream relationship

This is a **companion implementation**, not a direct fork or a copy of the `yunus-0x/meridian` source. The upstream README describes a Solana bot that watches tracked LP wallets, detects liquidity convergence for the same mint, screens Meteora/Jupiter pools, then manages positions with deterministic rules. That original runtime has its own configuration and transaction paths. This project currently implements independent read-only adapters and DLMM analytics; the original wallet-convergence trigger and position manager have not yet been merged here.

Upstream: https://github.com/yunus-0x/meridian

## Quick start (Ubuntu 24.04)

See [docs/DEPLOY-UBUNTU24.md](docs/DEPLOY-UBUNTU24.md).

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/meridian-ai-dlmm.git
cd meridian-ai-dlmm
npm install
cp .env.example .env
chmod 600 .env
# Edit .env and set Helius + OpenRouter credentials.
npm test
npm start
```

## Environment

Required for Helius:
- `HELIUS_API_KEY` or `HELIUS_RPC_URL`

Required for OpenRouter AI:
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (exact active model slug)

Optional OpenAI fallback:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Solana RPC can be derived from the Helius key. For production, use a dedicated Helius endpoint and monitor provider quotas. Never commit `.env`.

## Commands

```bash
npm test
npm start
npm run backtest -- fixtures/sample-snapshots.json
npm run meteora:discover -- 20
npm run meteora:inspect -- <LB_PAIR_ADDRESS> 20
npm run worker
npm run helius:watch
npm run ai:check
```

`npm run ai:check` sends a synthetic sample pool summary to the configured AI provider. Do not use real secrets in fixtures or test snapshots.

## VPS operation

The Meteora worker emits read-only pool snapshots to stdout/journald. A separate Helius wallet watcher can subscribe to logs for a public address. See `deploy/` for systemd service examples.

## Test status

The test suite uses mocked network responses for Helius and OpenRouter. Passing tests do **not** prove live RPC credentials, subscription limits, AI model availability, or current remote schema compatibility. Validate integrations on your VPS before relying on them.

## Security

Read [SECURITY.md](SECURITY.md). Never add a seed phrase or wallet private key. Keep AI output advisory and let deterministic rules own risk decisions.
