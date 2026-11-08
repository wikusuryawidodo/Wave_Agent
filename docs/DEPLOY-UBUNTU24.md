# Install Meridian AI DLMM on Ubuntu 24.04

This companion project starts in **read-only + paper** mode. It does not include a wallet signer, swap sender, liquidity transaction builder, or live execution path.

## 0. Provision VPS

Suggested starting point: 4 vCPU, 8 GB RAM, 60+ GB SSD. A 2 vCPU/4 GB machine may work for a single pool and low event volume. Use a provider and region with reliable network access to Solana RPC.

SSH as root:
```bash
ssh root@YOUR_VPS_IP
apt update && apt upgrade -y
apt install -y git curl ca-certificates build-essential
adduser meridian
usermod -aG sudo meridian
su - meridian
```

## 1. Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 2. Clone your GitHub repository

After you create the empty private repository in your GitHub account:
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/meridian-ai-dlmm.git
cd meridian-ai-dlmm
npm install
npm test
```

## 3. Configure secrets

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Set:
- `HELIUS_API_KEY`
- `HELIUS_RPC_URL` (or leave blank to derive it from the API key)
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (exact model slug from OpenRouter)
- `OPENAI_API_KEY` and `OPENAI_MODEL` only if you want OpenAI fallback
- `METEORA_POOL_ADDRESS` for the on-chain pool monitor
- `WATCH_WALLET_ADDRESS` only if monitoring a public wallet

Never add a wallet private key. Do not commit `.env`.

## 4. Verify Helius and Meteora read-only

Check Helius RPC:
```bash
node --env-file=.env --input-type=module -e "import {createHeliusReadOnlyAdapter} from './src/adapters/helius-readonly.js'; const h=createHeliusReadOnlyAdapter(); console.log({slot:await h.getSlot()})"
```

Discover Meteora pools:
```bash
npm run meteora:discover -- 20
```

Inspect one LB Pair:
```bash
npm run meteora:inspect -- YOUR_LB_PAIR_ADDRESS 20
```

Start a wallet log subscription (public address only):
```bash
npm run helius:watch
```

Start Meteora pool snapshots:
```bash
npm run worker
```

## 5. Test the AI provider

```bash
npm run ai:check
```

This sends a sample pool summary to OpenRouter. If OpenRouter fails and both OpenAI fallback key and model are configured, the provider tries OpenAI. The AI is analysis-only; its output is never passed to a transaction sender.

## 6. Install the Meteora worker as a systemd service

As root, copy project to `/opt/meridian` and create service account directories:
```bash
sudo mkdir -p /opt/meridian /etc/meridian /var/log/meridian
sudo cp -a ~/meridian-ai-dlmm/. /opt/meridian/
sudo chown -R meridian:meridian /opt/meridian /var/log/meridian
sudo cp /opt/meridian/.env.example /etc/meridian/meridian.env
sudo chmod 600 /etc/meridian/meridian.env
sudo nano /etc/meridian/meridian.env
sudo cp /opt/meridian/deploy/meridian.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meridian
sudo journalctl -u meridian -f
```

For the separate Helius wallet watcher, install `deploy/meridian-helius-watch.service` as a second service only after setting `WATCH_WALLET_ADDRESS`. It subscribes to logs; it does not sign or submit transactions.

## 7. Updates and rollback

```bash
cd ~/meridian-ai-dlmm
git pull --ff-only
npm install
npm test
```
Restart after validation:
```bash
sudo systemctl restart meridian
sudo systemctl status meridian
```
Keep a backup of `.env`, `/etc/meridian/meridian.env`, and local paper data. Never include secrets in Git backups.

## Important integration status

This repo is a companion implementation using Meridian's documented architecture and the previously built DLMM simulator. It is not a direct copy or automatic fork of `yunus-0x/meridian`, and the original wallet-convergence trigger/position executor is not yet merged into this codebase. The first deployment therefore validates Helius, Meteora reads, AI analysis and paper analytics independently. Do not assume original bot strategies are active here.
