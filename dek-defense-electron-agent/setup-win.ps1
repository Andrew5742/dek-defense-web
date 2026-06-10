$ErrorActionPreference = "Stop"
function Run($Command) {
  Write-Host "> $Command"
  cmd /c $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Command" }
}
Write-Host "DEK Defense Electron Agent - Windows setup"
Run "npm install"
Run "npm run dev"
