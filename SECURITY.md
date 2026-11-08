# Security policy

- This project is read-only and paper-only.
- Do not add wallet private keys, seed phrases, signing keypairs, or exchange credentials.
- Keep `.env` outside version control and set permissions to `600`.
- Use Helius API keys only in server-side environment variables.
- Restrict VPS SSH, firewall, and monitoring endpoints.
- Treat token metadata, wallet labels, and AI output as untrusted.
- AI recommendations are advisory. Deterministic risk controls are authoritative.
- No AI output may invoke a signer or transaction submission function.
- Report vulnerabilities privately to the repository owner; do not publish credentials or exploit details.
