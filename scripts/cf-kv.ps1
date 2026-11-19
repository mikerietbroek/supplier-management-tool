# Cloudflare KV beheer via REST API (lokale wrangler is op werklaptops geblokkeerd door group policy).
# Token: Cloudflare API-token met "Workers KV Storage: Edit" + "Account Settings: Read",
# eenmalig versleuteld opslaan met:
#   Read-Host "Cloudflare API token" -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:USERPROFILE\cloudflare_token.txt"
#
# Gebruik:
#   .\scripts\cf-kv.ps1 init      -> maakt namespace SNAPSHOT aan (of vindt hem) en toont het id voor wrangler.jsonc
#   .\scripts\cf-kv.ps1 upload    -> zet data\snapshot.json in KV onder key "snapshot"
param([Parameter(Mandatory)][ValidateSet("init", "upload")][string]$Action,
      [string]$File = (Join-Path $PSScriptRoot "..\data\snapshot.json"),
      [string]$Title = "SNAPSHOT")
$ErrorActionPreference = "Stop"

$ss = Get-Content (Join-Path $env:USERPROFILE "cloudflare_token.txt") | ConvertTo-SecureString
$tok = (New-Object System.Management.Automation.PSCredential("cf", $ss)).GetNetworkCredential().Password
$H = @{ Authorization = "Bearer $tok" }
$api = "https://api.cloudflare.com/client/v4"

$acc = (Invoke-RestMethod "$api/accounts" -Headers $H).result
if ($acc.Count -ne 1) { throw "Verwacht 1 account, gevonden: $($acc.Count)" }
$accId = $acc[0].id
$ns = (Invoke-RestMethod "$api/accounts/$accId/storage/kv/namespaces?per_page=100" -Headers $H).result | Where-Object title -eq $Title

if ($Action -eq "init") {
  if (-not $ns) {
    $ns = (Invoke-RestMethod "$api/accounts/$accId/storage/kv/namespaces" -Method Post -Headers $H -ContentType "application/json" -Body (@{ title = $Title } | ConvertTo-Json)).result
    Write-Host "Namespace aangemaakt."
  }
  Write-Host "KV namespace id: $($ns.id)  (invullen in wrangler.jsonc)"
  return
}

if (-not $ns) { throw "Namespace $Title bestaat nog niet; draai eerst: .\scripts\cf-kv.ps1 init" }
# -InFile i.p.v. [IO.File]: werkt ook in PowerShell constrained language mode
$path = (Resolve-Path $File).Path
$r = Invoke-RestMethod "$api/accounts/$accId/storage/kv/namespaces/$($ns.id)/values/snapshot" -Method Put -Headers $H -ContentType "application/json" -InFile $path
if (-not $r.success) { throw ($r.errors | ConvertTo-Json) }
Write-Host ("Snapshot geupload: {0:N0} bytes" -f (Get-Item $path).Length)
