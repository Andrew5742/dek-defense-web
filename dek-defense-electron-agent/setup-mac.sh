#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
xattr -cr . || true
npm install
npm run dev
