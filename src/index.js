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

// Tijd in hetzelfde formaat als snapshot.date ("YYYY-MM-DD HH:MM", Europe/Amsterdam)
const amsNow = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 16);

// Geslaagde tool-wijzigingen bewaren in KV "changes" zodat de frontend ze over de snapshot heen legt
// tot de nachtelijke snapshot ze bevat. Ouder dan 3 dagen wordt opgeruimd.
async function saveChanges(env, add) {
  const cutoff = new Date(Date.now() - 3 * 864e5).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).slice(0, 16);
  const cur = ((await env.SNAPSHOT.get("changes", "json")) || []).filter(c => c.ts >= cutoff);
  const seen = new Set(cur.map(c => c.key).filter(Boolean));
  const fresh = add.filter(c => !c.key || !seen.has(c.key));
  if (fresh.length) await env.SNAPSHOT.put("changes", JSON.stringify([...cur, ...fresh]));
}

const cleanOps = ops => ops.map(o => ({ op: o?.op, club: String(o?.club ?? ""), sla: Number(o?.sla), account: String(o?.account ?? "") }));
const n8nBase = env => env.N8N_ACTION_URL.replace(/\/action$/, "");

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
      const clean = cleanOps(ops);
      const r = await fetch(env.N8N_ACTION_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "X-SMT-Action-Key": env.N8N_ACTION_KEY },
        body: JSON.stringify({ mode: body.mode, user: user.email, ops: clean }),
      });
      const text = await r.text();
      if (body.mode === "execute" && r.ok) {
        try {
          const ok = JSON.parse(text).filter(x => x.result === "ok").map(x => ({ club: x.club, sla: x.sla, op: x.op, ts: amsNow() }));
          if (ok.length) await saveChanges(env, ok);
        } catch (e) { console.log("changes bijwerken mislukt", e); }
      }
      return new Response(text, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

    // Bulk: n8n verwerkt op de achtergrond (1,5 s per call). Maximaal 1 run tegelijk (rate limit routing-token).
    if (url.pathname === "/api/bulk" && request.method === "POST") {
      if (!env.N8N_ACTION_URL || !env.N8N_ACTION_KEY) return json({ error: "Acties zijn niet geconfigureerd" }, 503);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Ongeldige JSON" }, 400); }
      const ops = Array.isArray(body?.ops) ? body.ops : null;
      if (!ops || !ops.length || ops.length > 300) return json({ error: "Bulk: 1 t/m 300 acties per keer" }, 400);
      const lock = await env.SNAPSHOT.get("bulk_lock", "json");
      if (lock) return json({ error: `Er loopt al een bulk-run (${lock.total} acties, gestart ${lock.ts} door ${lock.user}). Wacht tot die klaar is.`, lock }, 409);
      const run_id = "b" + amsNow().replace(/\D/g, "") + "-" + crypto.randomUUID().slice(0, 6);
      const info = { run_id, total: ops.length, ts: amsNow(), user: user.email };
      await env.SNAPSHOT.put("bulk_lock", JSON.stringify(info), { expirationTtl: 4 * 3600 });
      const r = await fetch(n8nBase(env) + "/bulk", {
        method: "POST",
        headers: { "content-type": "application/json", "X-SMT-Action-Key": env.N8N_ACTION_KEY },
        body: JSON.stringify({ run_id, user: user.email, ops: cleanOps(ops) }),
      });
      if (!r.ok) { await env.SNAPSHOT.delete("bulk_lock"); return json({ error: `n8n weigerde de bulk-run (HTTP ${r.status})` }, 502); }
      return json(info);
    }

    if (url.pathname === "/api/bulk/current" && request.method === "GET") {
      return json((await env.SNAPSHOT.get("bulk_lock", "json")) || null);
    }

    if (url.pathname === "/api/bulk/status" && request.method === "GET") {
      const run_id = (url.searchParams.get("run_id") || "").replace(/[^\w-]/g, "");
      if (!run_id) return json({ error: "run_id ontbreekt" }, 400);
      const r = await fetch(n8nBase(env) + "/status?run_id=" + run_id, { headers: { "X-SMT-Action-Key": env.N8N_ACTION_KEY } });
      if (!r.ok) return json({ error: `Status ophalen mislukt (HTTP ${r.status})` }, 502);
      const rows = (await r.json()).rows || [];
      const ok = rows.filter(x => x.result === "ok").map(x => ({ club: x.club, sla: x.sla, op: x.op, ts: amsNow(), key: run_id + ":" + x.idx }));
      if (ok.length) await saveChanges(env, ok);
      const lock = await env.SNAPSHOT.get("bulk_lock", "json");
      const total = lock && lock.run_id === run_id ? lock.total : null;
      if (total !== null && rows.length >= total) await env.SNAPSHOT.delete("bulk_lock");
      return json({ run_id, total: total ?? rows.length, done: total === null || rows.length >= total, rows });
    }

    if (url.pathname === "/api/changes" && request.method === "GET") {
      return json((await env.SNAPSHOT.get("changes", "json")) || []);
    }

    return json({ error: "Onbekend endpoint" }, 404);
  },
};
