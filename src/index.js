// Supplier Management Tool - Cloudflare Worker
// - Statische frontend komt uit ./public (assets binding).
// - /api/* loopt eerst door deze Worker: controle Cloudflare Access-JWT, daarna de API.
// - Geen Xurrent-tokens hier: schrijfacties gaan later via een n8n-webhook.
import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks; // cache per isolate

async function accessUser(request, env) {
  if (env.DEV_BYPASS_ACCESS === "1") return { email: "dev@localhost" };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null; // fail closed zolang Access niet is ingesteld
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  jwks ??= createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD });
    return { email: payload.email };
  } catch {
    return null;
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const user = await accessUser(request, env);
    if (!user) return json({ error: "Niet geautoriseerd" }, 401);

    if (url.pathname === "/api/me" && request.method === "GET") return json(user);

    if (url.pathname === "/api/data" && request.method === "GET") {
      const snap = await env.SNAPSHOT.get("snapshot", "stream");
      if (!snap) return json({ error: "Nog geen snapshot in KV" }, 404);
      return new Response(snap, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

    return json({ error: "Onbekend endpoint" }, 404);
  },
};
