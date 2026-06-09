#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "Node:" && node -v
echo "npm:" && npm -v
npm install
npm run typecheck
npm run dev
