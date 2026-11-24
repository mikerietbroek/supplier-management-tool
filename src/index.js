// Supplier Management Tool - Cloudflare Worker
// - Statische frontend komt uit ./public (assets binding).
// - /api/* loopt eerst door deze Worker: controle Cloudflare Access-JWT, daarna de API.
// - Geen Xurrent-tokens hier: schrijfacties gaan via een n8n-webhook (POST /api/action).
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

    // Schrijfacties: alleen doorgeven aan n8n met geheime sleutel + e-mail uit Cloudflare Access.
    // n8n controleert, voert uit, leest terug en logt.
    if (url.pathname === "/api/action" && request.method === "POST") {
      if (!env.N8N_ACTION_URL || !env.N8N_ACTION_KEY) return json({ error: "Acties zijn niet geconfigureerd" }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Ongeldige JSON" }, 400); }
      const ops = Array.isArray(body?.ops) ? body.ops : null;
      if (!["preview", "execute"].includes(body?.mode) || !ops || !ops.length || ops.length > 50)
        return json({ error: "Verwacht {mode: preview|execute, ops: 1 t/m 50 acties}" }, 400);
      const clean = ops.map(o => ({ op: o?.op, club: String(o?.club ?? ""), sla: Number(o?.sla), account: String(o?.account ?? "") }));
      const r = await fetch(env.N8N_ACTION_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "X-SMT-Action-Key": env.N8N_ACTION_KEY },
        body: JSON.stringify({ mode: body.mode, user: user.email, ops: clean }),
      });
      const text = await r.text();
      return new Response(text, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

    return json({ error: "Onbekend endpoint" }, 404);
  },
};
