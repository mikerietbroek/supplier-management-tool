# Supplier Management Tool

Beheer per club welke leverancier (Xurrent SLA-coverage) welke dienst levert: clubs, bulk wijzigen, leveranciers en catalogus per land.

## Architectuur

```
Browser ─► Cloudflare Access (login + 2FA authenticator-app)
        ─► Worker (workers.dev)
             ├─ /               statische frontend (public/)
             ├─ GET /api/data   snapshot uit Cloudflare KV
             └─ (fase 3) POST /api/preview|execute ─► n8n-webhook ─► Xurrent API
n8n (fase 2) ─► nachtelijke snapshot ─► KV
```

- De Worker bevat geen Xurrent-tokens. Alle Xurrent-calls lopen via n8n.
- De snapshot (`data/`) staat bewust niet in git (namen van managers).
- Zonder geldige Cloudflare Access-login geeft `/api/*` een 401 (fail closed).

## Deployen

Cloudflare Workers Builds bouwt en deployt automatisch bij elke push naar `main`.
Lokaal `wrangler dev`/`deploy` werkt niet op de werklaptop: group policy blokkeert `workerd.exe`.

## Eenmalige inrichting

1. GitHub: lege privé-repo `supplier-management-tool` aanmaken en deze map pushen.
2. Cloudflare API-token aanmaken (Workers KV Storage: Edit + Account Settings: Read) en versleuteld opslaan:
   `Read-Host "Cloudflare API token" -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:USERPROFILE\cloudflare_token.txt"`
3. `.\scripts\cf-kv.ps1 init`, het id invullen in `wrangler.jsonc`, committen en pushen. Daarna `.\scripts\cf-kv.ps1 upload`.
4. Cloudflare-dashboard > Workers & Pages > Create > **Import a repository** > deze repo.
   Deploy command `npx wrangler deploy`, branch `main`.
5. Worker > Settings > Domains & Routes > workers.dev > **Enable Cloudflare Access**. Via **Manage Cloudflare Access** de policy beperken tot je eigen e-mailadres(sen).
6. Zero Trust > Settings > Authentication: **Independent MFA** aan (TOTP / authenticator-app), verplicht voor deze applicatie.
7. Uit de Access-applicatie de **AUD tag** en het team-domein (`https://<team>.cloudflareaccess.com`) invullen bij `vars` in `wrangler.jsonc`, dan committen en pushen.

Gebruikers toevoegen = e-mailadres toevoegen aan de Access-policy. Bij de eerste login koppelen ze hun authenticator-app.

## Lokale frontend-test

Python-server die `public/` serveert plus `/api/data` uit `data/snapshot.json`, zie `scripts/local_server.py`:
`python scripts\local_server.py` en dan naar http://127.0.0.1:8799.
