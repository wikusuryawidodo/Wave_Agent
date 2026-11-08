#!/usr/bin/env bash
set -euo pipefail
REPO_NAME="${1:-meridian-ai-dlmm}"
VISIBILITY="${2:-private}"
if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it from https://cli.github.com/ and run: gh auth login"
  exit 1
fi
gh auth status >/dev/null
OWNER="$(gh api user --jq .login)"
if git remote get-url origin >/dev/null 2>&1; then
  echo "An origin remote already exists. Inspect it with: git remote -v"
  exit 2
fi
git init -b main
git add .
git commit -m "Initial Meridian AI DLMM paper-trading scaffold"
gh repo create "${OWNER}/${REPO_NAME}" "--${VISIBILITY}" --source=. --remote=origin --push
echo "Published: https://github.com/${OWNER}/${REPO_NAME}"
