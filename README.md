# Wave_Agent — Meridian AI DLMM

This repository currently hosts the Meridian AI DLMM companion project: read-only Solana/Meteora analytics, a Helius adapter, OpenRouter-first AI analyst, and paper simulator.

**Default mode is read-only + paper trading.** No wallet signer, private-key loader, swap sender, liquidity transaction sender, or transaction submission path is included.

See `docs/DEPLOY-UBUNTU24.md` for VPS installation.

## Stack
- Node.js 22+
- Helius Solana RPC / WebSocket
- Meteora DLMM SDK and Data API
- OpenRouter-first AI with optional OpenAI API fallback
- DLMM bin simulator and snapshot backtest

## Safety
Never add wallet seed phrases or private keys. AI output is research-only; deterministic risk controls remain authoritative.

## Project status
This is a companion implementation inspired by the documented architecture of https://github.com/yunus-0x/meridian. It is not a direct fork. Original wallet-convergence monitoring and position-management flow remain a separate integration milestone.
