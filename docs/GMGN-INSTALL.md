# Install GMGN CLI in Wave_Agent

This repository pins the official \`gmgn-cli\` package as an npm dependency. GitHub Actions installs it on the runner and runs a read-only Trending smoke test.

## 1. Generate a GMGN key pair

After the pull request containing the GMGN install is merged into the repository's default branch, clone or pull the project and run:

\`\`\`bash
npm install
npx gmgn-cli config
\`\`\`

The CLI generates an Ed25519 key pair at:

\`\`\`text
~/.config/gmgn/keypair.pem
\`\`\`

It also prints a personalized GMGN API-key creation link containing the matching public key. Open that link, sign in to GMGN and create an API key using the pre-filled public key. Keep the generated \`keypair.pem\`; an API key created for a different public key will not match it.

The key pair is for GMGN API request signing. It is not a Solana/EVM wallet private key and does not authorize on-chain LP or swap transactions. Still treat its private half as a credential.

## 2. Add GitHub Actions secrets

In the GitHub repository:

1. Open **Settings → Secrets and variables → Actions**.
2. Choose **New repository secret**.
3. Add these two secrets:

| Secret name | Value |
|---|---|
| \`GMGN_API_KEY\` | The API key created from the personalized link above |
| \`GMGN_KEYPAIR_PEM\` | The complete contents of \`~/.config/gmgn/keypair.pem\`, including both PEM sections |

Do not paste either value into an issue, pull-request comment, workflow file, \`.env.example\`, commit, or chat. Do not commit \`keypair.pem\` or \`~/.config/gmgn/.env\`.

## 3. Run the GitHub smoke test

After the GMGN install PR is merged, open:

**Actions → GMGN CLI read-only smoke test → Run workflow**

Choose chain, interval and result limit, then run it. The workflow:

1. Installs repository dependencies, including the pinned GMGN CLI version.
2. Reconstructs the GMGN CLI config under the runner home directory with restrictive file permissions.
3. Runs \`gmgn-cli config --apply\` and \`gmgn-cli config --check\`.
4. Fetches a small read-only GMGN Trending response.
5. Validates that the response is JSON and uploads it as a one-day artifact.

The workflow does not call GMGN \`swap\`, \`order\`, \`cooking\`, \`copytrade\`, or any wallet transaction command. It does not build, sign or submit Solana transactions.

## 4. Run locally

Once the key pair and API key have been configured by the CLI:

\`\`\`bash
npm run gmgn:check
npm run gmgn:trending
\`\`\`

For interactive use of the provider exported from \`src/index.js\`, invoke it from a Node.js process launched through an npm script so that the local \`node_modules/.bin\` directory is on \`PATH\`.

## Troubleshooting

- **Configuration check fails:** make sure the API key was created using the public key belonging to the exact \`keypair.pem\` stored in \`GMGN_KEYPAIR_PEM\`.
- **401/403:** re-check the pair and API key. GMGN's CLI documentation notes that its API service does not support outbound IPv6; the GitHub-hosted Ubuntu runner normally uses its supported outbound networking path, but account/API restrictions may still apply.
- **429:** respect GMGN rate limits and retry after the provider's reset window; do not add rapid polling loops.
- **No workflow in Actions:** \`workflow_dispatch\` workflows must exist on the repository's default branch before they appear in the Actions UI. Merge this PR first.
- **No automatic bot polling:** this smoke-test workflow is manual. A separate scheduled collector should be added only after the API key works and rate limits/data freshness requirements are known.

Official references:
- [GMGN CLI on npm](https://www.npmjs.com/package/gmgn-cli)
- [GMGN CLI command reference](https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md)
- [GMGN CLI configuration implementation](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/config.ts)
