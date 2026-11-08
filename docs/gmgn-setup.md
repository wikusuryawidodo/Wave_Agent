# GMGN read-only setup (API key not yet configured)

## What is and is not available

GMGN's current Agent API documentation says market/token/portfolio query skills require an API key; swap skill requires API key plus private key. The bot must use query skills only. GMGN's FAQ separately says its general Data API is not openly available and may require a data-crawling whitelist.

Official docs:
- Agent API: https://docs.gmgn.ai/index/gmgn-agent-api
- Apply for API key: https://gmgn.ai/ai
- FAQ: https://docs.gmgn.ai/index/q-a

## Safe setup

1. Open https://gmgn.ai/ai from a trusted browser.
2. Follow the official API-key application flow. Their docs ask you to generate a public/private key pair and upload the public key. For this project, query-only access is enough; do not add a trading private key to the VPS or project.
3. Confirm with GMGN which query skills and chains your key is allowed to use.
4. Install the official `GMGNAI/gmgn-skills` only in a compatible trusted agent runtime if you want to use their documented skill/MCP interface:
   `npx skills add GMGNAI/gmgn-skills`
5. Connect that runtime to the app through a local, authenticated MCP bridge that exposes only `gmgn-token` and `gmgn-market`. Do not expose `gmgn-swap`.
6. Provide the bridge's `invokeSkill(skill,args)` callback to `createGmgnReadOnlyProvider`.

## Security rules

- Do not put a private key in `.env`, systemd environment, chat, shell history, or logs.
- Never expose the local MCP bridge to the public internet.
- Bind it to localhost or a private network and require authentication.
- Allowlist only read/query skills.
- API key is a secret: set it in `/etc/meridian/meridian.env` with mode 600, not in Git.
- GMGN Agent API documentation currently lists SOL, BSC and Base; it says ETH and other new chains are still in progress. Verify current chain coverage before relying on it for any other chain.

## Current integration status

The Node adapter is implemented as a read-only skill bridge interface and fails closed without an API key and an injected trusted bridge. It does not guess undocumented GMGN REST URLs. The bridge transport must be configured after you obtain the key and confirm the supported MCP/Skills runtime.
