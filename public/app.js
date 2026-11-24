// Supplier Management Tool - frontend
// Data komt van de Worker (/api/data), die de snapshot uit Cloudflare KV leest.
async function loadData() {
  const r = await fetch("/api/data", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`Data laden mislukt (${r.status}): ${await r.text()}`);
  return r.json();
}
let D;
try {
  D = await loadData();
} catch (e) {
  document.getElementById("boot").textContent = e.message;
  throw e;
}
document.getElementById("boot").remove();

const RENO = new Set(["branding & signage","ceiling","flooring","mirror","stairs","walls","windows and window frames","lighting (outdoor)","showers"]);
const KIND = {std:"", reno:"Refreshment", warranty:"Warranty", ppm:"PPM", urgent:"Spoed"};
const LANDN = {NL:"Nederland",BE:"België",LU:"Luxemburg",FR:"Frankrijk",ES:"Spanje",DE:"Duitsland"};
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const accName = i => D.accounts[i].split("|")[1], accId = i => D.accounts[i].split("|")[0];
const svcName = i => D.services[i];
const club = {}; D.clubs.forEach(c => club[c[0]] = {code:c[0], name:c[1], land:c[2], status:c[3], reno:!!c[4], fin:c[5], reg:c[6], rm:c[7], cm:c[8], area:c[9]});
// regio-filters (Financial organization code, Regional code, regiomanager, clustermanager) - herbruikbaar per scherm
function regioFilter(host, landSel, onChange){
  host.innerHTML = `<select data-k="fin" aria-label="Financial organization code"></select><select data-k="reg" aria-label="Regional code"></select>
    <select data-k="rm" aria-label="Regiomanager"></select><select data-k="cm" aria-label="Clustermanager"></select>`;
  const sel = k => host.querySelector(`[data-k="${k}"]`);
  const LBL = {fin:"Alle fin. org.-codes", reg:"Alle regio's", rm:"Alle regiomanagers", cm:"Alle clustermanagers"};
  const val = () => ({fin:sel("fin").value, reg:sel("reg").value, rm:sel("rm").value, cm:sel("cm").value});
  const match = (c, v, skip) => ["fin","reg","rm","cm"].every(k => k===skip || !v[k] || c[k]===v[k]);
  function fill(){
    const v = val(), l = landSel ? landSel.value : "";
    const base = Object.values(club).filter(c => !l || c.land===l);
    for (const k of ["fin","reg","rm","cm"]){
      const opts = [...new Set(base.filter(c => match(c, v, k)).map(c => c[k]).filter(Boolean))].sort((a,b) => k==="reg" ? (+a)-(+b) || a.localeCompare(b) : a.localeCompare(b));
      const keep = opts.includes(v[k]) ? v[k] : "";
      sel(k).innerHTML = `<option value="">${LBL[k]}</option>` + opts.map(o => `<option${o===keep?" selected":""}>${esc(o)}</option>`).join("");
    }
  }
  host.addEventListener("input", () => { fill(); onChange(); });
  if (landSel) landSel.addEventListener("input", fill);
  fill();
  return c => match(c, val(), null);
}
const inactive = c => c.status === "In Progress" || c.status === "Closed";
$("#stamp").textContent = `Stand Xurrent PRD basic-fit-fm, ${D.date} · ${D.clubs.length} clubs · ${D.slas.length} SLA's · ${D.accounts.length} leveranciersaccounts`;

// afgeleide structuren
const slaClubs = D.slas.map(() => []);
for (const [c, ks] of Object.entries(D.cov)) for (const k of ks) slaClubs[k].push(c);
function clubServices(code){
  const per = new Map();
  for (const k of (D.cov[code] || [])){
    const s = D.slas[k]; const key = s[2];
    if (!per.has(key)) per.set(key, []);
    per.get(key).push(k);
  }
  return [...per.entries()].map(([svc, ks]) => {
    const std = ks.filter(k => D.slas[k][6] === "std");
    const accs = [...new Set(std.map(k => D.slas[k][3]))];
    return {svc, ks, accs, dup: accs.length > 1 && !/yanga/i.test(svcName(svc))};
  }).sort((a,b) => svcName(a.svc).localeCompare(svcName(b.svc)));
}
const dupClubs = new Set(Object.keys(D.cov).filter(c => clubServices(c).some(r => r.dup)));

// ---------- Clubs ----------
const lands = [...new Set(D.clubs.map(c => c[2]))];
lands.forEach(l => $("#cl").insertAdjacentHTML("beforeend", `<option value="${l}">${LANDN[l]||l}</option>`));
let curClub = null;
const cRegio = regioFilter($("#cregio"), $("#cl"), () => renderClubList());
function renderClubList(){
  const q = $("#cq").value.trim().toLowerCase(), l = $("#cl").value, f = $("#cf").value;
  const rows = D.clubs.map(c => club[c[0]]).filter(c =>
    (!l || c.land === l) && cRegio(c) && (!q || c.code.includes(q) || c.name.toLowerCase().includes(q)) &&
    (!f || (f==="reno" && c.reno) || (f==="dup" && dupClubs.has(c.code)) || (f==="prog" && inactive(c))));
  $("#clist").innerHTML = rows.slice(0, 400).map(c => `<button data-c="${c.code}" class="${c.code===curClub?"on":""}" role="option">
    <span class="code">${c.code}</span><span class="nm">${esc(c.name)}</span>
    ${c.reno?'<span class="chip reno">Renovatie</span>':""}${dupClubs.has(c.code)?'<span class="chip warn">Dubbel</span>':""}${inactive(c)?`<span class="chip">${esc(c.status)}</span>`:""}</button>`).join("") || '<div class="empty">Geen clubs gevonden</div>';
  $("#ccount").textContent = rows.length > 400 ? `${rows.length} clubs, eerste 400 getoond. Zoek om te verfijnen.` : `${rows.length} clubs`;
}
$("#clist").addEventListener("click", e => { const b = e.target.closest("button[data-c]"); if (b){ curClub = b.dataset.c; renderClubList(); renderClub(); }});
["#cq","#cl","#cf"].forEach(s => $(s).addEventListener("input", renderClubList));

function renderClub(){
  const c = club[curClub]; if (!c){ $("#cdetail").innerHTML = '<div class="empty">Kies een club</div>'; return; }
  const rows = clubServices(c.code);
  const nStd = rows.filter(r => r.accs.length).length, nDup = rows.filter(r => r.dup).length;
  $("#cdetail").innerHTML = `
    <div class="dhead"><span class="code" style="font-size:15px">${c.code}</span><h2>${esc(c.name)}</h2>
      <span class="chip">${LANDN[c.land]||c.land}</span>${c.status?`<span class="chip">${esc(c.status)}</span>`:""}
      ${c.fin?`<span class="chip" title="Financial organization code / Regional code">${esc(c.fin)}${c.reg?" · regio "+esc(c.reg):""}</span>`:""}
      ${c.reno?'<span class="chip reno">Renovatie: 9 renovatie-diensten bewust leeg</span>':""}</div>
    ${c.rm||c.cm?`<div class="note">Regiomanager: ${esc(c.rm||"–")} · Clustermanager: ${esc(c.cm||"–")}${c.area?" · "+esc(c.area):""}</div>`:""}
    <div class="kpis"><span><b>${nStd}</b> diensten met leverancier</span><span><b>${rows.reduce((a,r)=>a+r.ks.length,0)}</b> SLA-koppelingen</span>
      <span><b>${nDup}</b> dubbel</span></div>
    <div id="cpanel"></div>
    <div class="tbl"><table><thead><tr><th>Dienst</th><th>Leverancier</th><th>Instances (SLA)</th><th></th></tr></thead><tbody>
    ${rows.map(r => {
      const byAcc = new Map(); r.ks.forEach(k => { const a = D.slas[k][3]; if(!byAcc.has(a)) byAcc.set(a, []); byAcc.get(a).push(k); });
      return [...byAcc.entries()].map(([a, ks], i) => `<tr class="${r.dup?"dup":""}">
        ${i===0?`<td rowspan="${byAcc.size}"><b>${esc(svcName(r.svc))}</b>${r.dup?' <span class="chip warn">Dubbel</span>':""}${RENO.has(svcName(r.svc).toLowerCase())?' <span class="chip reno">renovatie-dienst</span>':""}</td>`:""}
        <td><span class="acc">${esc(accName(a))}</span><span class="accid">${esc(accId(a))}</span></td>
        <td>${ks.map(k => { const s = D.slas[k]; return `<span class="sla"><span class="id">${s[0]}</span>${esc(s[4])}${s[6]!=="std"?` <span class="chip">${KIND[s[6]]}</span>`:""}${s[5]==="org"?' <span class="chip" title="Gedekt via land- of club-organisatie, niet per site">org</span>':""}</span>`; }).join("")}</td>
        <td><div class="acts"><button class="btn" data-act="move" data-s="${r.svc}" data-a="${a}">Verhuizen</button><button class="btn" data-act="del" data-s="${r.svc}" data-a="${a}">Verwijderen</button></div></td></tr>`).join("");
    }).join("")}</tbody></table></div>
    <div class="acts"><button class="btn" data-act="add">Dienst toevoegen</button></div>`;
}
$("#cdetail").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const c = club[curClub], act = b.dataset.act;
  if (act === "add") return addPanel(c);
  const svc = +b.dataset.s, a = +b.dataset.a;
  const ks = (D.cov[c.code]||[]).filter(k => D.slas[k][2]===svc && D.slas[k][3]===a);
  if (act === "del") return delPanel(c, svc, a, ks);
  movePanel(c, svc, a, ks);
});
// doel-SLA's van leverancier a voor dienst svc in land: SLA's die >=50% van het max aantal clubs in dat land dekken
function targetSlas(svc, a, land){
  const cand = D.slas.map((s,k) => [s,k]).filter(([s]) => s[2]===svc && s[3]===a && s[6]==="std" && s[5]==="sites")
    .map(([s,k]) => [k, slaClubs[k].filter(c => club[c] && club[c].land===land).length]).filter(x => x[1] > 0);
  const mx = Math.max(0, ...cand.map(x => x[1]));
  return cand.filter(x => x[1] >= mx*0.5).map(x => x[0]);
}
function suppliersFor(svc, land){
  const m = new Map();
  D.slas.forEach((s,k) => { if (s[2]===svc && s[6]==="std" && s[5]==="sites"){ const n = slaClubs[k].filter(c => club[c] && club[c].land===land).length; if (n) m.set(s[3], Math.max(m.get(s[3])||0, n)); }});
  return [...m.entries()].sort((x,y) => y[1]-x[1]);
}
const renoSvc = (c, svc) => c.reno && RENO.has(svcName(svc).toLowerCase());
function checks(c, svc){
  const w = [];
  if (inactive(c)) w.push(`Club heeft status ${c.status}.`);
  return w;
}
const orgNote = ks => ks.filter(k => D.slas[k][5]==="org").map(k => `SLA ${D.slas[k][0]} (${D.slas[k][4]}) dekt via een organisatie, niet per site: niet via de tool aan te passen.`);

// ---------- Acties via n8n (Worker /api/action) ----------
async function apiAction(mode, ops){
  const r = await fetch("/api/action", {method:"POST", credentials:"same-origin", headers:{"content-type":"application/json"},
    body: JSON.stringify({mode, ops: ops.map(({op, club, sla, account}) => ({op, club, sla, account}))})});
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j && j.error ? [].concat(j.error).join("; ") : `HTTP ${r.status}: ${t.slice(0, 200)}`);
  if (!Array.isArray(j)) throw new Error("Onverwacht antwoord van n8n");
  return j;
}
const mkOp = (op, k, c) => ({op, club:c.code, sla:D.slas[k][0], account:accId(D.slas[k][3]), k});
const PLAN = {add:"toevoegen", remove:"verwijderen", none:"niets te doen", blocked:"geblokkeerd", error:"fout"};
function resultTable(res, ops){
  return `<div class="tbl"><table><thead><tr><th>Actie</th><th>SLA</th><th>Leverancier</th><th>Stond erop</th><th>Uitkomst</th></tr></thead><tbody>${res.map(r => {
    const o = ops[r.idx] || {}; const a = o.k !== undefined ? accName(D.slas[o.k][3]) : r.account;
    const cls = r.result==="ok" ? "ok" : (r.result==="fout"||r.result==="geblokkeerd") ? "bad" : "";
    return `<tr><td>${r.op==="add"?"Toevoegen":"Verwijderen"}</td><td><span class="id">${r.sla}</span> ${esc(r.sla_name||"")}</td><td>${esc(a)}</td>
      <td>${r.before===true?"ja":r.before===false?"nee":"–"}</td>
      <td><span class="chip ${cls}">${esc(r.result==="voorbeeld" ? PLAN[r.plan] : r.result)}</span> ${esc(r.message||"")}</td></tr>`; }).join("")}</tbody></table></div>`;
}
// lokale data bijwerken na geslaagde wijzigingen (snapshot ververst 's nachts)
function applyLocal(res, ops){
  let n = 0;
  for (const r of res){ if (r.result !== "ok") continue; const o = ops[r.idx]; if (!o) continue;
    const cov = (D.cov[o.club] ??= []);
    if (r.op === "add" && !cov.includes(o.k)){ cov.push(o.k); slaClubs[o.k].push(o.club); n++; }
    if (r.op === "remove" && cov.includes(o.k)){ cov.splice(cov.indexOf(o.k), 1); slaClubs[o.k] = slaClubs[o.k].filter(x => x !== o.club); n++; }
  }
  return n;
}
// paneel: opts = {title, warns, html, after(invalidate), ops() -> [...], confirmText (verplicht vinkje of null)}
function showPanel(opts){
  const confirmHtml = () => opts.confirmText && opts.confirmText() ? `<label class="note"><input type="checkbox" id="pconf"> ${esc(opts.confirmText())}</label>` : "";
  $("#cpanel").innerHTML = `<div class="panel"><h3>${esc(opts.title)}</h3>
    ${opts.warns && opts.warns.length ? `<div class="note">${opts.warns.map(esc).join("<br>")}</div>` : ""}
    ${opts.html || ""}
    <div id="pconfw"></div>
    <div id="pres"></div>
    <div class="acts"><button class="btn" id="pchk">Controleren</button><button class="btn primary" id="pgo" disabled>Uitvoeren in Xurrent</button><button class="btn" id="pcl">Sluiten</button></div>
    <div class="note" id="pmsg" role="status">Eerst controleren: n8n leest de actuele stand in Xurrent PRD en toont wat er zou veranderen.</div></div>`;
  let ops = [], checked = null;
  const invalidate = () => { checked = null; $("#pgo").disabled = true; $("#pres").innerHTML = ""; $("#pconfw").innerHTML = confirmHtml(); $("#pmsg").textContent = "Eerst controleren."; };
  $("#pcl").onclick = () => $("#cpanel").innerHTML = "";
  $("#pchk").onclick = async () => {
    ops = opts.ops(); if (!ops.length){ $("#pmsg").textContent = "Geen wijzigingen voor deze keuze."; return; }
    $("#pchk").disabled = true; $("#pmsg").textContent = "Controleren in Xurrent…";
    try {
      checked = await apiAction("preview", ops);
      $("#pres").innerHTML = resultTable(checked, ops);
      const todo = checked.filter(r => r.plan==="add" || r.plan==="remove").length;
      $("#pgo").disabled = !todo;
      $("#pmsg").textContent = todo ? `${todo} wijziging${todo>1?"en":""} klaar om uit te voeren.` : "Niets uit te voeren.";
    } catch (e) { $("#pmsg").textContent = "Controle mislukt: " + e.message; }
    $("#pchk").disabled = false;
  };
  $("#pgo").onclick = async () => {
    if (!checked) return;
    if ($("#pconf") && !$("#pconf").checked){ $("#pmsg").textContent = "Vink eerst de bevestiging aan."; return; }
    const todo = checked.filter(r => r.plan==="add" || r.plan==="remove").length;
    if (!confirm(`${todo} wijziging${todo>1?"en":""} uitvoeren in Xurrent PRD?`)) return;
    $("#pgo").disabled = $("#pchk").disabled = true; $("#pmsg").textContent = "Uitvoeren…";
    try {
      const res = await apiAction("execute", ops);
      const ok = res.filter(r => r.result==="ok").length, bad = res.filter(r => r.result==="fout"||r.result==="geblokkeerd").length;
      applyLocal(res, ops);
      const html = resultTable(res, ops), title = opts.title;
      renderClubList(); renderClub();
      $("#cpanel").innerHTML = `<div class="panel"><h3>Uitgevoerd: ${esc(title)}</h3>${html}
        <div class="note">${ok} gelukt${bad?`, ${bad} mislukt of geblokkeerd`:""}. Gelogd in n8n. De tabel hieronder is bijgewerkt; de volledige snapshot ververst vannacht.</div>
        <div class="acts"><button class="btn" id="pcl2">Sluiten</button></div></div>`;
      $("#pcl2").onclick = () => $("#cpanel").innerHTML = "";
    } catch (e) { $("#pmsg").textContent = "Uitvoeren mislukt: " + e.message + " Controleer opnieuw voordat je het nog eens probeert."; checked = null; $("#pchk").disabled = false; }
  };
  if (opts.after) opts.after(invalidate);
  $("#pconfw").innerHTML = confirmHtml();
  $("#cpanel").scrollIntoView({block:"nearest"});
}
function delPanel(c, svc, a, ks){
  showPanel({title: `Verwijderen: ${svcName(svc)} bij ${accName(a)} (club ${c.code})`,
    warns: [...checks(c, svc), ...orgNote(ks)],
    ops: () => ks.filter(k => D.slas[k][5]==="sites").map(k => mkOp("remove", k, c))});
}
function movePanel(c, svc, a, ks){
  const opts = suppliersFor(svc, c.land).filter(([x]) => x!==a);
  showPanel({title: `Verhuizen: ${svcName(svc)} van ${accName(a)} (club ${c.code})`,
    warns: [...checks(c, svc), ...orgNote(ks)],
    html: opts.length ? `<label class="note" for="mvto">Naar leverancier (met deze dienst in ${LANDN[c.land]}):</label>
      <select id="mvto">${opts.map(([x,n]) => `<option value="${x}">${esc(accName(x))} · ${n} clubs</option>`).join("")}</select>
      <div class="note">Eerst worden de nieuwe koppelingen toegevoegd, daarna de oude verwijderd.</div>`
      : `<div class="note">Geen andere leverancier met deze dienst in dit land.</div>`,
    confirmText: () => renoSvc(c, svc) ? "Renovatieclub: deze dienst hoort leeg te blijven. Ik weet dit en wil toch koppelen." : null,
    after: inv => { if (opts.length) $("#mvto").addEventListener("input", inv); },
    ops: () => { if (!opts.length) return []; const t = +$("#mvto").value;
      const adds = targetSlas(svc, t, c.land).filter(k => !(D.cov[c.code]||[]).includes(k)).map(k => mkOp("add", k, c));
      const dels = ks.filter(k => D.slas[k][5]==="sites").map(k => mkOp("remove", k, c));
      return adds.length ? [...adds, ...dels] : []; }});
}
function addPanel(c){
  const have = new Set(clubServices(c.code).filter(r => r.accs.length).map(r => r.svc));
  const svcs = D.services.map((n,i) => i).filter(i => !have.has(i) && suppliersFor(i, c.land).length).sort((x,y) => svcName(x).localeCompare(svcName(y)));
  showPanel({title: `Dienst toevoegen aan club ${c.code}`,
    warns: checks(c, null),
    html: svcs.length ? `<div class="ctrl"><select id="adsvc">${svcs.map(i => `<option value="${i}">${esc(svcName(i))}</option>`).join("")}</select><select id="adacc"></select></div>
      <div class="note">Alleen diensten die deze club nog bij geen enkele leverancier heeft (per club en dienst 1 leverancier).</div>`
      : `<div class="note">Deze club heeft alle diensten die in dit land bij een leverancier beschikbaar zijn.</div>`,
    confirmText: () => svcs.length && renoSvc(c, +$("#adsvc").value) ? "Renovatieclub: deze dienst hoort leeg te blijven. Ik weet dit en wil toch koppelen." : null,
    after: inv => { if (!svcs.length) return;
      const fillAcc = () => { const s = +$("#adsvc").value; $("#adacc").innerHTML = suppliersFor(s, c.land).map(([x,n]) => `<option value="${x}">${esc(accName(x))} · ${n} clubs</option>`).join(""); inv(); };
      $("#adsvc").addEventListener("input", fillAcc); $("#adacc").addEventListener("input", inv); fillAcc(); },
    ops: () => { if (!svcs.length) return []; const s = +$("#adsvc").value, a = +$("#adacc").value;
      return targetSlas(s, a, c.land).map(k => mkOp("add", k, c)); }});
}

// ---------- Bulk wijzigen (nog alleen voorbeeld) ----------
const siteOf = c => `{site ${c.code}}`;
const delLine = (k, c) => `DELETE /v1/slas/${D.slas[k][0]}/sites/${siteOf(c)}   x-4me-account: ${accId(D.slas[k][3])}   # ${D.slas[k][4]}`;
const addLine = (k, c) => `POST   /v1/slas/${D.slas[k][0]}/sites/${siteOf(c)}   x-4me-account: ${accId(D.slas[k][3])}   # ${D.slas[k][4]}`;
const norm = s => String(s).toLowerCase().replace(/\s+for\s+.*$/, "").replace(/\s*-+\s*(uc)?\s*$/, "").replace(/\s+/g, " ").trim();
lands.forEach(l => $("#bl").insertAdjacentHTML("beforeend", `<option value="${l}">${LANDN[l]||l}</option>`));
const bSel = new Set(); const bSvc = new Map(); const bTgt = new Map();
const bRegio = regioFilter($("#bregio"), $("#bl"), () => bClubs());
function pasted(){
  const t = $("#bpaste").value; const codes = (t.match(/\b\d{4}\b/g) || []);
  const known = codes.filter(c => club[c]), unknown = codes.filter(c => !club[c]);
  $("#bpastemsg").textContent = codes.length ? `${known.length} herkend${unknown.length ? `, niet gevonden: ${unknown.join(", ")}` : ""}` : "";
  return codes.length ? new Set(known) : null;
}
function bVisible(){
  const l = $("#bl").value, st = $("#bst").value, p = pasted();
  return Object.values(club).filter(c => (!l || c.land===l) && (!st || !inactive(c)) && bRegio(c) && (!p || p.has(c.code))).sort((a,b) => a.code.localeCompare(b.code));
}
function bClubs(){
  const rows = bVisible();
  $("#bclubs").innerHTML = rows.slice(0, 600).map(c => `<label><input type="checkbox" data-c="${c.code}"${bSel.has(c.code)?" checked":""}>
    <span class="code">${c.code}</span><span class="nm">${esc(c.name)}</span>${c.reno?'<span class="chip reno">Renovatie</span>':""}</label>`).join("") || '<div class="empty">Geen clubs met deze filters</div>';
  $("#bcount").textContent = `${bSel.size} geselecteerd · ${rows.length} zichtbaar${rows.length>600?" (eerste 600 getoond)":""}`;
  bSvcs();
}
$("#bclubs").addEventListener("change", e => { const c = e.target.dataset.c; if (!c) return; e.target.checked ? bSel.add(c) : bSel.delete(c); $("#bcount").textContent = `${bSel.size} geselecteerd`; bSvcs(); });
$("#ball").onclick = () => { bVisible().forEach(c => bSel.add(c.code)); bClubs(); };
$("#bnone").onclick = () => { bSel.clear(); bClubs(); };
["#bl","#bst"].forEach(s => $(s).addEventListener("input", bClubs));
$("#bpaste").addEventListener("input", () => { const p = pasted(); if (p){ bSel.clear(); p.forEach(c => bSel.add(c)); } bClubs(); });
const selLands = () => [...new Set([...bSel].map(c => club[c].land))];
function bSvcs(){
  const q = $("#bsq").value.trim().toLowerCase(), ls = selLands();
  // diensten die bij de gekozen clubs voorkomen of in hun land bij een leverancier beschikbaar zijn
  const info = new Map();
  const touch = (s) => { if (!info.has(s)) info.set(s, {clubs:new Set(), inst:new Map()}); return info.get(s); };
  bSel.forEach(c => (D.cov[c]||[]).forEach(k => { const s = D.slas[k]; if (s[6]!=="std") return; const e = touch(s[2]); e.clubs.add(c); const n = norm(s[4]); e.inst.set(n, (e.inst.get(n)||0)+1); }));
  D.slas.forEach((s,k) => { if (s[6]!=="std" || s[5]!=="sites") return; if (slaClubs[k].some(c => club[c] && ls.includes(club[c].land))){ const e = touch(s[2]); const n = norm(s[4]); if (!e.inst.has(n)) e.inst.set(n, 0); } });
  const svcs = [...info.keys()].filter(s => !q || svcName(s).toLowerCase().includes(q)).sort((a,b) => svcName(a).localeCompare(svcName(b)));
  $("#bsvcs").innerHTML = bSel.size ? svcs.map(s => { const e = info.get(s), sel = bSvc.get(s);
    return `<details${sel && sel!=="ALL" ? " open" : ""}><summary><label><input type="checkbox" data-s="${s}"${sel?" checked":""}><span class="nm"><b>${esc(svcName(s))}</b></span><span class="count">${e.clubs.size}/${bSel.size} clubs</span></label></summary>
      ${[...e.inst.entries()].sort().map(([n, cnt]) => `<label class="sub"><input type="checkbox" data-s="${s}" data-i="${esc(n)}"${sel && (sel==="ALL" || sel.has(n)) ? " checked" : ""}><span class="nm">${esc(n)}</span><span class="count">${cnt}</span></label>`).join("")}</details>`; }).join("")
    : '<div class="empty">Kies eerst clubs</div>';
  bTargets();
}
$("#bsq").addEventListener("input", bSvcs);
$("#bsvcs").addEventListener("change", e => {
  const s = +e.target.dataset.s; if (isNaN(s)) return; const i = e.target.dataset.i;
  if (i === undefined){ e.target.checked ? bSvc.set(s, "ALL") : bSvc.delete(s); }
  else {
    let sel = bSvc.get(s); const all = [...e.target.closest("details").querySelectorAll("input[data-i]")].map(x => x.dataset.i);
    if (sel === "ALL") sel = new Set(all); if (!sel) sel = new Set();
    e.target.checked ? sel.add(i) : sel.delete(i);
    if (!sel.size) bSvc.delete(s); else bSvc.set(s, sel.size===all.length ? "ALL" : sel);
  }
  bSvcs();
});
function bTargets(){
  const mode = $("#bmode").value, ls = selLands();
  if (mode === "del" || !bSvc.size){ $("#btargets").innerHTML = mode==="del" ? '<div class="note">De gekozen instances worden bij de huidige leverancier verwijderd.</div>' : '<div class="note">Kies diensten om een leverancier te kiezen.</div>'; return bPreview(); }
  $("#btargets").innerHTML = [...bSvc.keys()].sort((a,b) => svcName(a).localeCompare(svcName(b))).map(s => {
    const m = new Map(); ls.forEach(l => suppliersFor(s, l).forEach(([a,n]) => m.set(a, (m.get(a)||0)+n)));
    const opts = [...m.entries()].sort((x,y) => y[1]-x[1]); const cur = bTgt.get(s);
    return `<div class="tgt"><span class="note"><b>${esc(svcName(s))}</b> naar:</span><select data-s="${s}">${opts.map(([a,n]) => `<option value="${a}"${a===cur?" selected":""}>${esc(accName(a))} · ${n} clubs</option>`).join("") || '<option value="">Geen leverancier met deze dienst</option>'}</select></div>`; }).join("");
  $("#btargets").querySelectorAll("select").forEach(x => { if (x.value) bTgt.set(+x.dataset.s, +x.value); });
  bPreview();
}
$("#bmode").addEventListener("input", bTargets);
$("#btargets").addEventListener("input", e => { const s = +e.target.dataset.s; if (!isNaN(s)){ bTgt.set(s, +e.target.value); bPreview(); } });
let bCallText = "";
function bPreview(){
  const mode = $("#bmode").value; const rows = [], calls = [], warn = new Map(); let nDel = 0, nAdd = 0, nRem = 0;
  const w = (k, c) => { if (!warn.has(k)) warn.set(k, new Set()); warn.get(k).add(c); };
  [...bSel].sort().forEach(code => { const c = club[code];
    if (inactive(c)) w(`Status ${c.status}`, code);
    bSvc.forEach((sel, s) => {
      const inSel = n => sel === "ALL" || sel.has(norm(n));
      const tgt = mode==="del" ? null : bTgt.get(s);
      const cur = (D.cov[code]||[]).filter(k => D.slas[k][2]===s && D.slas[k][6]==="std" && inSel(D.slas[k][4]));
      const dels = mode==="add" ? [] : cur.filter(k => mode==="del" || D.slas[k][3]!==tgt);
      let adds = [];
      const renoBlock = c.reno && RENO.has(svcName(s).toLowerCase());
      if (mode !== "del" && tgt !== undefined && tgt !== null){
        const tk = targetSlas(s, tgt, c.land).filter(k => inSel(D.slas[k][4]));
        if (!tk.length) w(`${accName(tgt)} heeft ${svcName(s)} (gekozen instances) niet in ${LANDN[c.land]}: eerst aanmaken met het update-script`, code);
        adds = tk.filter(k => !(D.cov[code]||[]).includes(k));
      }
      if (renoBlock && adds.length){ w(`Renovatieclub: ${svcName(s)} wordt niet gekoppeld, SLA-ID's gaan naar remarks`, code); nRem++; }
      if (!dels.length && !adds.length) return;
      dels.forEach(k => calls.push(delLine(k, c)));
      if (!renoBlock) adds.forEach(k => calls.push(addLine(k, c)));
      if (renoBlock && adds.length) calls.push(`PATCH  /v1/sites/${siteOf(c)}   x-4me-account: basic-fit   # remarks += ${adds.map(k => D.slas[k][0]).join(",")}`);
      nDel += dels.length; nAdd += renoBlock ? 0 : adds.length;
      rows.push(`<tr><td><span class="code">${code}</span> ${esc(c.name)}</td><td>${esc(svcName(s))}</td>
        <td>${[...new Set(dels.map(k => accName(D.slas[k][3])))].map(esc).join(", ") || '<span class="note">–</span>'}</td>
        <td>${adds.length ? esc(accName(tgt)) : '<span class="note">–</span>'}</td>
        <td class="num">−${dels.length} / +${renoBlock ? 0 : adds.length}</td><td>${renoBlock && adds.length ? '<span class="chip reno">remarks</span>' : ""}</td></tr>`);
    });
  });
  $("#bsum").innerHTML = `<span><b>${bSel.size}</b> clubs</span><span><b>${bSvc.size}</b> diensten</span><span><b>${nDel}</b> koppelingen eraf</span><span><b>${nAdd}</b> erbij</span>${nRem?`<span><b>${nRem}</b> naar remarks</span>`:""}<span><b>${calls.length}</b> Xurrent-calls</span>`;
  $("#bwarn").innerHTML = warn.size ? `<div class="wlist">${[...warn.entries()].map(([k, cs]) => `<div>${esc(k)} · ${cs.size} club${cs.size>1?"s":""}: ${[...cs].slice(0,25).join(", ")}${cs.size>25?" …":""}</div>`).join("")}</div>` : "";
  $("#bprev").innerHTML = rows.length ? `<thead><tr><th>Club</th><th>Dienst</th><th>Van</th><th>Naar</th><th class="num">Koppelingen</th><th></th></tr></thead><tbody>${rows.slice(0,400).join("")}</tbody>`
    : `<tbody><tr><td class="empty">${bSel.size && bSvc.size ? "Geen wijzigingen: de gekozen clubs staan al zo." : "Kies clubs en diensten om een voorbeeld te zien."}</td></tr></tbody>`;
  if (rows.length > 400) $("#bprev").insertAdjacentHTML("beforeend", `<tbody><tr><td colspan="6" class="note">${rows.length - 400} regels meer, zie alle calls hieronder.</td></tr></tbody>`);
  bCallText = calls.join("\n"); $("#bcalls").textContent = bCallText || "Geen calls";
  $("#bmsg").textContent = "";
}
$("#bgo").onclick = () => $("#bmsg").textContent = "Bulk uitvoeren volgt in een volgende stap. Losse wijzigingen per club kunnen nu al via het tabblad Clubs.";
$("#bcopy").onclick = () => { navigator.clipboard.writeText(bCallText).then(() => $("#bmsg").textContent = "Calls gekopieerd", () => { const r = document.createRange(); r.selectNodeContents($("#bcalls")); getSelection().removeAllRanges(); getSelection().addRange(r); $("#bmsg").textContent = "Kopiëren lukte niet, de calls zijn geselecteerd: gebruik Ctrl+C"; }); };

// ---------- Leveranciers ----------
const accClubs = D.accounts.map(() => new Set()), accSvc = D.accounts.map(() => new Map());
D.slas.forEach((s,k) => { if (s[6]!=="std") return; slaClubs[k].forEach(c => accClubs[s[3]].add(c));
  const m = accSvc[s[3]]; if (!m.has(s[2])) m.set(s[2], {slas:[], clubs:new Set()}); const e = m.get(s[2]); e.slas.push(k); slaClubs[k].forEach(c => e.clubs.add(c)); });
let curAcc = null;
function renderAccList(){
  const q = $("#aq").value.trim().toLowerCase();
  const rows = D.accounts.map((x,i) => i).filter(i => accClubs[i].size && (!q || D.accounts[i].toLowerCase().includes(q))).sort((x,y) => accName(x).localeCompare(accName(y)));
  $("#alist").innerHTML = rows.map(i => `<button data-a="${i}" class="${i===curAcc?"on":""}"><span class="nm">${esc(accName(i))}<span class="accid">${esc(accId(i))}</span></span><span class="count">${accClubs[i].size}</span></button>`).join("") || '<div class="empty">Geen leveranciers gevonden</div>';
}
$("#aq").addEventListener("input", renderAccList);
$("#alist").addEventListener("click", e => { const b = e.target.closest("button[data-a]"); if (b){ curAcc = +b.dataset.a; renderAccList(); renderAcc(); }});
function renderAcc(){
  const i = curAcc; const m = accSvc[i];
  const perLand = {}; accClubs[i].forEach(c => { const l = club[c] ? club[c].land : "?"; perLand[l] = (perLand[l]||0)+1; });
  $("#adetail").innerHTML = `<div class="dhead"><h2>${esc(accName(i))}</h2><span class="chip">${esc(accId(i))}</span></div>
    <div class="kpis"><span><b>${accClubs[i].size}</b> clubs</span><span><b>${m.size}</b> diensten</span>${Object.entries(perLand).map(([l,n]) => `<span>${LANDN[l]||l} <b>${n}</b></span>`).join("")}</div>
    <div class="tbl"><table><thead><tr><th>Dienst</th><th class="num">Instances</th><th class="num">Clubs</th><th>Clubs (kostenplaatsen)</th></tr></thead><tbody>
    ${[...m.entries()].sort((x,y) => svcName(x[0]).localeCompare(svcName(y[0]))).map(([s,e]) => {
      const cl = [...e.clubs].sort();
      return `<tr><td><b>${esc(svcName(s))}</b></td><td class="num">${e.slas.length}</td><td class="num">${cl.length}</td>
        <td><details><summary class="note">Toon ${cl.length} clubs</summary><div class="note" style="font-family:var(--f-mono);margin-top:6px">${cl.join(", ")}</div></details></td></tr>`; }).join("")}
    </tbody></table></div>`;
}

// ---------- Catalogus ----------
const CLANDS = [["NL",["NL"]],["BELUX",["BE","LU"]],["FR",["FR"]],["ES",["ES"]],["DE",["DE"]]];
function catalog(){
  const q = $("#sq").value.trim().toLowerCase();
  const act = D.clubs.map(c => club[c[0]]).filter(c => !inactive(c));
  const tot = {}, cnt = {};
  CLANDS.forEach(([L, ls]) => { tot[L] = act.filter(c => ls.includes(c.land)).length; });
  act.forEach(c => { const L = CLANDS.find(([,ls]) => ls.includes(c.land))[0];
    new Set((D.cov[c.code]||[]).filter(k => D.slas[k][6]==="std").map(k => D.slas[k][2])).forEach(s => { cnt[s] = cnt[s]||{}; cnt[s][L] = (cnt[s][L]||0)+1; }); });
  // renovatieclubs tellen voor renovatie-diensten niet mee in de noemer
  const renoTot = {}; CLANDS.forEach(([L, ls]) => renoTot[L] = act.filter(c => ls.includes(c.land) && c.reno).length);
  const svcs = Object.keys(cnt).map(Number).filter(s => !q || svcName(s).toLowerCase().includes(q))
    .sort((x,y) => Math.max(...CLANDS.map(([L]) => (cnt[y][L]||0)/tot[L])) - Math.max(...CLANDS.map(([L]) => (cnt[x][L]||0)/tot[L])) || svcName(x).localeCompare(svcName(y)));
  $("#cat").innerHTML = `<thead><tr><th>Dienst</th>${CLANDS.map(([L]) => `<th class="num">${L} (${tot[L]})</th>`).join("")}</tr></thead><tbody>${svcs.map(s => {
    const reno = RENO.has(svcName(s).toLowerCase());
    return `<tr><td>${esc(svcName(s))}${reno?' <span class="chip reno">renovatie</span>':""}</td>${CLANDS.map(([L]) => {
      const den = tot[L] - (reno ? renoTot[L] : 0); const n = cnt[s][L]||0; if (!n) return '<td class="num note">–</td>';
      const p = Math.min(100, 100*n/den); const cls = p < 85 ? "low" : p < 99 ? "mid" : "";
      return `<td class="num pct ${cls}" title="${n} van ${den} clubs">${p.toFixed(p>=99.95||p<10?0:1)}%</td>`; }).join("")}</tr>`; }).join("")}</tbody>`;
}
$("#sq").addEventListener("input", catalog);

// ---------- routing ----------
const VIEWS = ["clubs","bulk","leveranciers","catalogus"]; let catDone = false, bulkDone = false;
function route(){
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "clubs";
  VIEWS.forEach(x => $("#v-"+x).hidden = x!==v);
  document.querySelectorAll("nav.tabs a").forEach(a => a.classList.toggle("on", a.dataset.v===v));
  if (v==="catalogus" && !catDone){ catalog(); catDone = true; }
  if (v==="bulk" && !bulkDone){ // voorbeeld: 3 Spaanse hf-services-clubs, Mounting verhuizen
    ["5019","5021","5023"].forEach(c => club[c] && bSel.add(c));
    const m = D.services.findIndex(n => n.toLowerCase()==="mounting"); if (m >= 0) bSvc.set(m, "ALL");
    $("#bl").value = "ES"; $("#bl").dispatchEvent(new Event("input")); bulkDone = true; }
  if (v==="leveranciers" && curAcc===null){ curAcc = D.accounts.findIndex(x => x.startsWith("aressgroup|")); renderAccList(); renderAcc(); }
}
addEventListener("hashchange", route);
curClub = "5077"; renderClubList(); renderClub(); renderAccList(); route();
