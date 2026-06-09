$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "Node:"; node -v
Write-Host "npm:"; npm -v
npm install
npm run typecheck
npm run dev
