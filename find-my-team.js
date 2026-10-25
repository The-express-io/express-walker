/* =====================================================================
   Find my team · a separate module for Walk Tracker
   ---------------------------------------------------------------------
   An event coordinator adds themselves, the staff and the client's on-site
   contact. Each person opens their own link on their phone. When they check
   in, their location is shared with the team (only until they check out).
   Anyone can then tap a teammate to get live walking directions to them,
   using Walk Tracker's own map and router, or jump to WhatsApp to message them.

   How it plugs in
   - Loaded after index.html's main script, so it uses Walk Tracker's map,
     tracking (start/last/lastAcc), router (followPerson) and relay helpers
     (relayPost/relayListen/seal/unseal) without changing them.
   - The switch at the top of the panel toggles Find Matt / Find my team.
     Find Matt keeps working exactly as before.

   Privacy and data
   - The event link carries the setup and a random event key. Locations are
     encrypted with that key (AES-GCM) before they go through the relay
     (ntfy.sh), so only people holding an event link can read them.
   - Location is only sent while checked in. Check out sends "off" and stops.
   - The relay keeps messages for about 12 hours; nothing else is stored
     anywhere except on each phone.
   ===================================================================== */
(() => {
const FT = {
  prefix: "cwteam-",                 // relay topic: cwteam-<event id>
  sendEveryMs: 10000,                // at most one location every 10 s…
  heartbeatMs: 60000,                // …and at least one a minute while checked in
  minMoveM: 8,                       // or sooner after moving this far
  staleMs: 3 * 60000,                // older than this shows "last seen"
  goneMs: 45 * 60000,                // older than this is dropped from the map
  history: "30m"                     // on opening, catch up on the last 30 minutes
};
const ROLES = ["Coordinator", "Lead Planner", "Server", "Bartender", "Sommelier", "Attendant", "Cook", "Driver", "Cleaner", "Client contact"];
const ROLE_COLOR = { "Coordinator": "#c1272d", "Lead Planner": "#14202b", "Server": "#2d5ba8", "Bartender": "#7a3fb0", "Sommelier": "#8e1c21",
  "Attendant": "#1a9e5c", "Cook": "#b26a00", "Driver": "#4a5560", "Cleaner": "#2f7f86", "Client contact": "#c97a00" };
const DEFAULT_ZONES = ["Entrance", "Main room", "Bar", "Kitchen", "Patio"];

/* ---------- styles (scoped to this module) ---------- */
document.head.append(el("style", {}, `
  :root{--team:#0f7a5c;--team-bg:#e9f6f1}
  @media (prefers-color-scheme:dark){:root{--team:#3ccf9a;--team-bg:#132a24}}
  .modes.two{grid-template-columns:1fr 1fr}
  .modes.two button[aria-pressed="true"][data-find="matt"]{background:var(--matt)}
  .modes.two button[aria-pressed="true"][data-find="team"]{background:var(--team)}
  body.ft-on #findBtn, body.ft-on #fmCard, body.ft-on #mattCard{display:none!important}
  body:not(.ft-on) #ftCard{display:none!important}
  #ftCard{border-color:var(--team);background:var(--team-bg)}
  #ftCard button:not(.ghost){background:var(--team)}
  #ftCard button.wa, #ftCard a.wa{background:#1da851;color:#fff}
  #ftCard a.btn{display:inline-flex;align-items:center;justify-content:center;font-weight:600;border-radius:8px;padding:10px 14px;text-decoration:none}
  #ftCard a.btn.ghost{border:1px solid var(--line);color:var(--fg)}
  #ftCard input,#ftCard select{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;min-width:0;width:100%}
  #ftCard label.f{display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
  #ftCard .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  #ftCard .tm{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
  #ftCard .tm .acts{grid-column:1/-1;display:flex;gap:8px}
  #ftCard .tm .acts>*{flex:1}
  #ftCard .av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px}
  #ftCard .av.off{opacity:.35}
  #ftCard .nm{font-weight:700}
  #ftCard .dd{font:600 15px var(--mono);text-align:right;white-space:nowrap}
  #ftCard .dd small{display:block;font:12px var(--mono);color:var(--muted)}
  #ftCard .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:5px;vertical-align:1px}
  #ftCard .dot.on{background:var(--good)}
  #ftCard .pill{font:700 11px var(--font);letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1.5px solid currentColor;justify-self:end}
  #ftCard .pill.on{color:var(--good)} #ftCard .pill.off{color:var(--muted)}
  #ftCard .chips{display:flex;flex-wrap:wrap;gap:6px}
  #ftCard .chips span{display:inline-flex;gap:4px;align-items:center;font-size:13px;padding:3px 4px 3px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel)}
  #ftCard .chips button{background:transparent!important;color:var(--muted);padding:0 6px;font-size:16px}
  #ftCard .link{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
  #ftCard .link button{white-space:nowrap}
  #ftCard .arrive{display:grid;gap:6px;padding:12px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}
  #ftCard .arrive .k{font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--team)}
  #ftCard .arrive .note{font-size:14px;line-height:1.4}
  #ftCard .arrive .where{font-size:12px;color:var(--muted)}
  #ftCard .sec{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}
  .ftpin{background:none;border:0;display:flex;flex-direction:column;align-items:center;cursor:pointer}
  .ftpin .ini{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 13px var(--font);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)}
  .ftpin .tag{font:600 12px var(--font);background:var(--team);color:#fff;border-radius:6px;padding:2px 7px;white-space:nowrap;margin-top:2px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
`));

/* ---------- small helpers ---------- */
const uid = (n = 9) => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));
const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const digits = p => String(p || "").replace(/\D/g, "");
const jget = k => { try { return JSON.parse(load(k) || "null"); } catch (_) { return null; } };
const jset = (k, v) => store(k, v == null ? null : JSON.stringify(v));
const color = r => ROLE_COLOR[r] || "#14202b";
const msgLink = (p, ev) => digits(p?.phone) ? "https://wa.me/" + digits(p.phone) : (ev?.group || "https://wa.me/18326939729?text=Hi%20C%C3%BClinary%20Expr%C3%A9ss%21%20I%27m%20at%20the%20event%20and%20would%20like%20assistance.");
const encCfg = cfg => b64u.enc(te.encode(JSON.stringify(cfg)));
const decCfg = s => JSON.parse(td.decode(b64u.dec(s)));
// Dates and times: the event has a date and a start/end time; each person has their own shift.
const fmtT = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
const fmtD = d => d ? new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
const range = (a, b) => a && b ? `${fmtT(a)}–${fmtT(b)}${b <= a ? " (next day)" : ""}` : a ? "from " + fmtT(a) : b ? "until " + fmtT(b) : "";
const shiftWord = p => p?.role === "Client contact" ? "On site" : "Shift";
function shiftWindow(e, p) {                 // real start/end times for a person's shift, or null
  if (!e?.date || !p?.start) return null;
  const s = new Date(`${e.date}T${p.start}`);
  let t = p.end ? new Date(`${e.date}T${p.end}`) : null;
  if (t && t <= s) t = new Date(t.getTime() + 86400000);
  return { s, t };
}
function shiftNote(e, p) {                   // "starts in 1 h 20 min", "shift over", or ""
  const w = shiftWindow(e, p); if (!w) return "";
  const now = Date.now(), mins = Math.round((w.s - now) / 60000);
  if (mins > 0) return mins < 60 ? `starts in ${mins} min` : mins < 24 * 60 ? `starts in ${Math.floor(mins / 60)} h${mins % 60 ? " " + (mins % 60) + " min" : ""}` : "starts " + fmtD(e.date);
  if (w.t && now > w.t) return (p.role === "Client contact" ? "time" : "shift") + " over";
  return "";
}
const isCoord = p => ["Coordinator", "Lead Planner"].includes(p?.role);
const linkFor = (cfg, pid) => location.origin + location.pathname + "#team=" + encCfg(cfg) + "." + pid;

/* ---------- state ---------- */
let mode = load("findMode") === "team" ? "team" : "matt";
let ev = jget("ftEvent");          // joined event: { id, k, name, venue, group, zones[], people[], rv }
let meId = load("ftMe");
let draft = jget("ftDraft");       // coordinator's editable copy (same shape as ev)
let view = "live";                 // "live" | "setup" | "links"
let key = null, es = null;
let pos = {};                      // person id -> { lat, lng, acc, zone, ts }
let on = load("ftOn") === "1", zone = load("ftZone") || "";
let sentAt = 0, sentPos = null;
let guide = null, track = {}, pins = {};

const person = id => ev?.people.find(p => p.id === id);
const me = () => person(meId);

/* ---------- switch: Find Matt / Find my team ---------- */
const sw = el("div", { class: "modes two", role: "group", "aria-label": "Find" },
  el("button", { type: "button", "data-find": "matt", onclick: () => setMode("matt") }, "📍 Find Matt"),
  el("button", { type: "button", "data-find": "team", onclick: () => setMode("team") }, "👥 Find my team"));
const card = el("div", { class: "card", id: "ftCard", "aria-live": "polite" });
const setCard = (...kids) => card.replaceChildren(...kids.filter(k => k != null && k !== false));
$("findBtn").before(sw);
$("mattCard").after(card);

function setMode(m) {
  mode = m; store("findMode", m);
  document.body.classList.toggle("ft-on", m === "team");
  sw.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.find === m));
  if (m !== "team") { clearPins(); if (guide) stopFind(); }
  render();
}

/* ---------- relay: encrypted messages on the event topic ---------- */
async function connect() {
  es?.close(); es = null; key = null; pos = {};
  if (!ev) return;
  try { key = await crypto.subtle.importKey("raw", b64u.dec(ev.k), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
  catch (_) { key = null; return; }
  es = relayListen(FT.prefix + ev.id, m => { if (m.event === "message") onMessage(m.message); }, FT.history);
  es.onerror = () => { if (es?.readyState === 2) setTimeout(connect, 5000); };
  if (on) send(true);
}
async function post(obj) {
  if (!key || !ev) return false;
  try { await relayPost(FT.prefix + ev.id, await seal(key, obj)); return true; } catch (_) { return false; }
}
async function onMessage(raw) {
  let m; try { m = JSON.parse(raw); } catch (_) { return; }
  if (m.t !== "enc" || !key) return;
  let p; try { p = await unseal(key, m); } catch (_) { return; }     // not from this event: ignore
  if (p.t === "loc" && p.id && p.id !== meId) {
    if (!pos[p.id] || p.ts >= pos[p.id].ts) pos[p.id] = { lat: p.lat, lng: p.lng, acc: p.acc, zone: p.zone || "", ts: p.ts };
    if (guide === p.id) follow();
  } else if (p.t === "off" && p.id && p.id !== meId) {
    if (!pos[p.id] || (p.ts || 0) >= pos[p.id].ts) delete pos[p.id];
  } else if (p.t === "roster" && p.cfg && (p.cfg.rv || 0) > (ev.rv || 0) && p.cfg.cpub === ev.cpub && await verifyCfg(ev.cpub, p.cfg, p.sig)) {
    // the coordinator changed the team: take the new list, keep this event's id and key
    ev = { ...p.cfg, id: ev.id, k: ev.k }; jset("ftEvent", ev); remember();
    if (!me()) { leave(true); return; }
  }
  liveRefresh();
}

/* ---------- sharing my location (only while checked in) ---------- */
async function send(force) {
  if (!on || !last || !key) return;
  const now = Date.now();
  if (!force && (now - sentAt < FT.sendEveryMs || (sentPos && distance(sentPos, last) < FT.minMoveM && now - sentAt < FT.heartbeatMs))) return;
  sentAt = now; sentPos = { ...last };
  if (!await post({ t: "loc", id: meId, lat: last.lat, lng: last.lng, acc: Math.round(lastAcc || 0), zone, ts: now })) sentAt = 0;
}
function checkIn() {
  on = true; store("ftOn", "1");
  if (watchId == null) start();
  sentAt = 0; send(true);
  setStatus(me()?.role === "Client contact" ? "Sharing your location with the team." : "Checked in · sharing your location with the team.", "ok");
  render();
}
function checkOut() {
  on = false; store("ftOn", null);
  post({ t: "off", id: meId, ts: Date.now() });
  if (watchId != null && !guide) stop();
  setStatus(me()?.role === "Client contact" ? "Stopped sharing your location." : "Checked out · your location is no longer shared.", "ok");
  render();
}
setInterval(() => { if (ev && on) send(false); if (mode === "team" && ev && view === "live") liveRefresh(); }, 4000);

/* ---------- finding a teammate: Walk Tracker's own directions ---------- */
function find(id) {
  const p = person(id), at = pos[id];
  if (!p || !at) return;
  guide = id; track = {};
  followPerson(p.name, at, track, true);
  setStatus(`Directions to ${p.name} (${p.role}). They update as ${p.name.split(" ")[0]} moves.`, "ok");
  liveRefresh();
}
function follow() {
  const p = person(guide), at = pos[guide];
  if (p && at) followPerson(p.name, at, track, true);
}
function stopFind() {
  const p = person(guide);
  guide = null; destMarker.setOpacity(1);
  if (dest.person && p) dest.name = p.name + "'s last location";
  liveRefresh();
}

/* ---------- map pins ---------- */
function clearPins() { for (const id in pins) map.removeLayer(pins[id]); pins = {}; }
function drawPins() {
  if (mode !== "team" || !ev) return clearPins();
  const now = Date.now();
  for (const p of ev.people) {
    const at = pos[p.id];
    if (p.id === meId || !at || now - at.ts > FT.goneMs) { if (pins[p.id]) { map.removeLayer(pins[p.id]); delete pins[p.id]; } continue; }
    if (pins[p.id]) { pins[p.id].setLatLng([at.lat, at.lng]); continue; }
    const html = el("div", { class: "ftpin", title: `Directions to ${p.name}` },
      el("span", { class: "ini", style: `background:${color(p.role)}` }, initials(p.name)), el("span", { class: "tag" }, p.name.split(" ")[0]));
    pins[p.id] = L.marker([at.lat, at.lng], { icon: L.divIcon({ className: "", html, iconSize: [60, 60], iconAnchor: [30, 20] }),
      keyboard: true, title: `${p.name}, ${p.role}`, zIndexOffset: 900 }).addTo(map).on("click", () => find(p.id));
  }
}

/* ---------- saved events and profile (header bar) ----------
   Every event this phone has joined is kept on this phone, so you can switch
   between them from the event button in the header. Nothing is stored anywhere else. */
const savedList = () => (jget("ftSaved") || []).filter(s => s?.cfg?.id && s.pid);
function remember() {
  if (!ev || !meId) return updateTop();
  const l = savedList().filter(s => s.cfg.id !== ev.id);
  l.unshift({ cfg: ev, pid: meId, at: Date.now() });
  jset("ftSaved", l.slice(0, 20)); updateTop();
}
function forget(id) { jset("ftSaved", savedList().filter(s => s.cfg.id !== id)); updateTop(); }
const evWhen = e => [e.date ? fmtD(e.date) : "", e.start ? fmtT(e.start) : ""].filter(Boolean).join(" · ");
const isToday = d => d && d === new Date().toLocaleDateString("en-CA");
const topEv = $("ceEvent"), topMenu = $("ceMenu"), topMe = $("ceMe"), topProfile = $("ceProfile");
function updateTop() {
  if (!topEv) return;
  const n = savedList().length;
  $("ceEventLabel").textContent = ev ? (isToday(ev.date) ? "Today’s event" : ev.date ? fmtD(ev.date) : "Your event") : (n ? "Your events" : "Events");
  $("ceEventName").textContent = ev ? [ev.name || "Unnamed event", ev.venue].filter(Boolean).join(" · ") : (n ? `${n} saved · choose one` : "No event yet");
  const nm = load("fmName");
  $("ceMeTxt").textContent = nm ? initials(nm) : "Me";
  topMe.setAttribute("aria-label", nm ? `Your profile: ${nm}` : "Your profile");
}
function closePops() {
  for (const [b, p] of [[topEv, topMenu], [topMe, topProfile]]) { p.hidden = true; b.setAttribute("aria-expanded", "false"); }
}
function openPop(b, p, fill) {
  const wasOpen = !p.hidden; closePops(); if (wasOpen) return;
  fill(); p.hidden = false; b.setAttribute("aria-expanded", "true");
  p.querySelector("button,input")?.focus();
}
function fillMenu() {
  const l = savedList();
  const rows = l.map(s => {
    const cur = ev?.id === s.cfg.id, who = s.cfg.people?.find(p => p.id === s.pid);
    return el("button", { type: "button", class: "ev", "aria-current": cur ? "true" : "false", onclick: () => {
        closePops(); if (cur) { setMode("team"); return; }
        join(s.cfg, s.pid); setStatus(`Switched to ${s.cfg.name || "this event"}.`, "ok");
      } },
      el("b", {}, s.cfg.name || "Unnamed event"),
      el("span", {}, [s.cfg.venue, evWhen(s.cfg), who ? who.role : ""].filter(Boolean).join(" · ")),
      cur ? el("em", {}, "Current") : null);
  });
  const kids = [el("h2", {}, "Your events"),
    el("span", { class: "muted" }, l.length ? "Events you’ve joined on this phone. Tap one to switch; your check-in for the current event ends first." : "No saved events yet. Open the link your coordinator sends you and the event is saved here."),
    ...rows,
    el("div", { class: "row" },
      el("button", { type: "button", onclick: () => { closePops(); setMode("team"); draft ??= newDraft(); view = "setup"; render(); } }, "Set up a new event")),
    ev ? el("button", { type: "button", class: "forget", onclick: () => { if (confirm("Remove the current event from this phone?")) { closePops(); leave(); } } }, "Remove the current event from this phone") : null];
  topMenu.replaceChildren(...kids.filter(Boolean));
}
function fillProfile() {
  const nameIn = el("input", { type: "text", autocomplete: "name", maxlength: "40", placeholder: "Your name" });
  const phoneIn = el("input", { type: "tel", autocomplete: "tel", inputmode: "tel", maxlength: "20", placeholder: "Your phone number" });
  nameIn.value = load("fmName") || ""; phoneIn.value = load("fmPhone") || "";
  const saved = !!load("fmName");
  topProfile.replaceChildren(
    el("h2", {}, saved ? "Hi, " + (load("fmName").split(" ")[0]) : "Sign in on this phone"),
    el("span", { class: "muted" }, "Saved on this phone only. It fills in your details when you ask to find someone or join an event."),
    el("label", {}, "Name", nameIn), el("label", {}, "Phone", phoneIn),
    el("div", { class: "row" },
      el("button", { type: "button", onclick: () => {
          const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return; }
          store("fmName", n); store("fmPhone", phoneIn.value.trim() || null); updateTop(); closePops(); setStatus("Profile saved on this phone.", "ok");
        } }, "Save"),
      saved ? el("button", { type: "button", class: "ghost", onclick: () => { store("fmName", null); store("fmPhone", null); updateTop(); closePops(); setStatus("Signed out on this phone.", "ok"); } }, "Sign out") : null));
}
if (topEv) {
  topEv.onclick = () => openPop(topEv, topMenu, fillMenu);
  topMe.onclick = () => openPop(topMe, topProfile, fillProfile);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && (!topMenu.hidden || !topProfile.hidden)) { closePops(); topEv.focus(); } });
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".ce-top")) closePops(); });
}

/* ---------- finding the event itself ----------
   The coordinator pins the exact door guests should use (by standing there, or from the
   address) and adds arrival notes. Guests get Expréss Walker's own turn-by-turn directions
   to that spot, with the note shown, before they look for the team. */
function findEvent(e) {
  if (!e?.spot) return;
  if (guide) stopFind();
  if (fromPlace) { fromPlace = null; $("fromInput").value = ""; map.removeLayer(startMarker); }
  const name = (e.name || "The event") + " · entrance", { lat, lng } = e.spot;
  dest = { lat, lng, name };
  destMarker.setLatLng([lat, lng]).bindPopup(el("div", {}, el("b", {}, name), e.arrive ? el("div", {}, e.arrive) : null)).setOpacity(1);
  $("destInput").value = name;
  arrived = false; route = null; routeLine.setLatLngs([]); stepIdx = 0;
  map.fitBounds(last ? [[last.lat, last.lng], [lat, lng]] : [[lat, lng], [lat, lng]], { padding: [60, 40], maxZoom: 17 });
  if (watchId == null) start(); else if (last) fetchRoute();
  setStatus(`Walking you to ${e.name || "the event"}.` + (e.arrive ? " " + e.arrive : ""), "ok");
}
async function findVenueByAddress(e) {
  setStatus("Looking up " + e.venue + "…");
  try { const g = await geocode(e.venue); if (!g) return setStatus("Couldn't find “" + e.venue + "” on the map.", "err");
        findEvent({ ...e, spot: { lat: g.lat, lng: g.lng } }); }
  catch (_) { setStatus("Search failed. Check your connection.", "err"); }
}
function eventSpotBlock(e) {
  if (!e?.spot && !e?.venue) return null;
  return el("div", { class: "arrive" },
    el("span", { class: "k" }, "Find the event"),
    e.arrive ? el("span", { class: "note" }, e.arrive) : null,
    e.venue ? el("span", { class: "where" }, e.venue + (e.spot ? " · entrance pinned by the coordinator" : "")) : null,
    e.spot ? el("button", { type: "button", onclick: () => findEvent(e) }, "Walk me to the entrance")
           : el("button", { type: "button", onclick: () => findVenueByAddress(e) }, "Directions to the venue"));
}
const roundSpot = (lat, lng, acc, how) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), acc: acc == null ? null : Math.round(acc), how });

/* ---------- joining from a link ---------- */
function join(cfg, pid) {
  if (ev?.id !== cfg.id) { if (on) checkOut(); pos = {}; }
  if (ev?.id === cfg.id && (ev.rv || 0) > (cfg.rv || 0)) cfg = { ...ev };   // keep a newer roster we already have
  ev = cfg; meId = pid; jset("ftEvent", ev); store("ftMe", pid); remember();
  view = "live"; connect(); setMode("team");
  startJoinListener();
}
function leave(removed) {
  if (ev) forget(ev.id);
  if (on) checkOut();
  if (guide) stopFind();
  es?.close(); es = null; ev = null; meId = null; pos = {};
  jset("ftEvent", null); store("ftMe", null); clearPins();
  if (removed) setStatus("You've been removed from this event's team.", "err");
  render(); updateTop();
}
function handleTeamLink() {
  const j = location.hash.match(/^#teamjoin=([\w-]+)$/);
  if (j) {
    history.replaceState(null, "", location.pathname + location.search);
    let info; try { info = decCfg(j[1]); } catch (_) { info = null; }
    if (!info?.id || !info.jpub) return notice("Couldn't open this event link", "Ask the coordinator to send the event link again.");
    if (ev?.id === info.id && me()) { setMode("team"); return notice("You're already on this team", "You're in as " + me().name + "."); }
    if (asking?.info?.id === info.id && asking.state === "waiting") { view = "join"; return setMode("team"); }
    asking = { info, state: "form" }; view = "join"; return setMode("team");
  }
  const m = location.hash.match(/^#team=([\w-]+)\.([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  let cfg; try { cfg = decCfg(m[1]); } catch (_) { cfg = null; }
  if (!cfg?.id || !cfg.k || !cfg.people?.some(p => p.id === m[2])) return notice("Couldn't open this team link", "Ask your coordinator to send your personal link again, and open it exactly as sent.");
  join(cfg, m[2]);
}
addEventListener("hashchange", handleTeamLink);

/* ---------- coordinator setup ---------- */
// Team updates are signed by the coordinator's phone. Its private key never leaves that phone;
// the public key rides in every link, so other phones accept changes only from the coordinator.
async function ensureSigner(d) {
  if (d.cpub && d.jpub && load("ftSign:" + d.id) && load("ftJoinKey:" + d.id)) return;
  const kp = await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  store("ftSign:" + d.id, JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey)));
  d.cpub = b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
  // A second key pair for join requests: people asking to join encrypt their details to it
  const jk = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
  store("ftJoinKey:" + d.id, JSON.stringify(await crypto.subtle.exportKey("jwk", jk.privateKey)));
  d.jpub = b64u.enc(await crypto.subtle.exportKey("raw", jk.publicKey)); saveDraft();
}
async function signCfg(id, cfg) {
  const jwk = JSON.parse(load("ftSign:" + id) || "null"); if (!jwk) return null;
  const k = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, ECDSA, false, ["sign"]);
  return b64u.enc(await crypto.subtle.sign(SIG, k, te.encode(JSON.stringify(cfg))));
}
async function verifyCfg(cpub, cfg, sig) {
  if (!cpub || !sig) return false;
  try { const k = await crypto.subtle.importKey("raw", b64u.dec(cpub), ECDSA, false, ["verify"]);
        return await crypto.subtle.verify(SIG, k, b64u.dec(sig), te.encode(JSON.stringify(cfg))); } catch (_) { return false; }
}
function newDraft() { return { id: uid(), k: b64u.enc(crypto.getRandomValues(new Uint8Array(32))), name: "", venue: "", date: "", start: "", end: "", group: "", zones: [...DEFAULT_ZONES], people: [], rv: 0 }; }
function saveDraft() { jset("ftDraft", draft); }
async function publishDraft() {
  await ensureSigner(draft);
  draft.rv = Date.now(); saveDraft();
  const { k, ...cfg } = draft;                    // the event key never travels through the relay
  const msg = { t: "roster", cfg, sig: await signCfg(draft.id, cfg) };
  if (ev?.id === draft.id) { ev = { ...draft }; jset("ftEvent", ev); remember(); }
  try {                                           // push the new team to every phone on the event
    const dk = await crypto.subtle.importKey("raw", b64u.dec(draft.k), { name: "AES-GCM" }, false, ["encrypt"]);
    await relayPost(FT.prefix + draft.id, await seal(dk, msg));
  } catch (_) {}
  if (ev?.id === draft.id && !me()) leave(true);
  startJoinListener();
}

/* ---------- self-join with coordinator approval ----------
   The coordinator shares one event join link. It carries the event details and the coordinator's
   public join key, but not the event key, so it shows nobody's location. The person asking types
   their name; the request is encrypted to the coordinator's phone. Approve adds them to the team
   and sends their personal access back, encrypted so only their phone can read it. */
const joinTopic = id => FT.prefix + id + "-join";
const replyTopic = (id, rid) => FT.prefix + id + "-j-" + rid;
const JOIN_TTL = 12 * 3600000;
const joinLinkFor = d => location.origin + location.pathname + "#teamjoin=" +
  encCfg({ id: d.id, name: d.name, venue: d.venue, date: d.date, start: d.start, end: d.end, spot: d.spot, arrive: d.arrive, jpub: d.jpub });

// --- the person asking ---
let asking = jget("ftJoinPending");     // { info, rid, jwk, name, role, phone, at, state }
let askEs = null;
async function resumeAsk() {
  askEs?.close(); askEs = null;
  if (!asking || asking.state !== "waiting") return;
  if (Date.now() - asking.at > JOIN_TTL) { asking.state = "timeout"; jset("ftJoinPending", asking); return render(); }
  try {
    const priv = await crypto.subtle.importKey("jwk", { ...asking.jwk, key_ops: ["deriveKey"] }, ECDH, false, ["deriveKey"]);
    const k = await aesKey(priv, asking.info.jpub);
    const rid = asking.rid;
    askEs = relayListen(replyTopic(asking.info.id, rid), async m => {
      if (m.event !== "message" || asking?.rid !== rid) return;
      let r; try { r = JSON.parse(m.message); } catch (_) { return; }
      if (r.t === "deny") { asking.state = "denied"; jset("ftJoinPending", asking); askEs?.close(); return render(); }
      if (r.t !== "enc") return;
      let ok; try { ok = await unseal(k, r); } catch (_) { return; }        // only the coordinator can write this
      if (ok.t !== "ok" || !ok.cfg?.k || !ok.cfg.people?.some(p => p.id === ok.pid)) return;
      askEs?.close(); asking = null; jset("ftJoinPending", null);
      if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
      join(ok.cfg, ok.pid);
      notice("You're in", `The coordinator approved you for ${ok.cfg.name || "the event"}. Tap ${me()?.role === "Client contact" ? "Share my location" : "Check in"} when you arrive so the team can find you.`);
    }, "12h");
  } catch (_) { asking.state = "error"; jset("ftJoinPending", asking); render(); }
}
async function sendAsk(info, name, role, phone) {
  asking = { info, name, role, phone, state: "sending" }; render();
  try {
    const kp = await crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
    const pub = b64u.enc(await crypto.subtle.exportKey("raw", kp.publicKey));
    const k = await aesKey(kp.privateKey, info.jpub);
    asking = { ...asking, rid: uid(), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey), at: Date.now(), state: "waiting" };
    jset("ftJoinPending", asking);
    await resumeAsk();
    const sealed = await seal(k, { name, role, phone });
    await relayPost(joinTopic(info.id), { t: "join", rid: asking.rid, pub, iv: sealed.iv, ct: sealed.ct, at: asking.at });
    render();
  } catch (_) { if (asking) { asking.state = "error"; jset("ftJoinPending", asking); } render(); }
}
function cancelAsk() { askEs?.close(); askEs = null; asking = null; jset("ftJoinPending", null); view = "live"; render(); }
function renderAsk() {
  const a = asking, info = a.info;
  const when = [fmtD(info.date), range(info.start, info.end)].filter(Boolean).join(" · ");
  const head = [el("b", {}, "Join " + (info.name || "this event")), when ? el("span", { class: "muted" }, when) : null, eventSpotBlock(info)];
  const close = label => el("button", { type: "button", class: "ghost", onclick: cancelAsk }, label);
  if (a.state === "form") {
    const nameIn = el("input", { type: "text", placeholder: "Your name", "aria-label": "Your name", autocomplete: "name", maxlength: "40" });
    const roleIn = el("select", { "aria-label": "You are" }, ...["Client contact", ...ROLES.filter(r => !["Client contact", "Lead Planner", "Coordinator"].includes(r))].map(r => el("option", {}, r)));
    const phoneIn = el("input", { type: "tel", inputmode: "tel", placeholder: "WhatsApp number (optional)", "aria-label": "WhatsApp number", autocomplete: "tel", maxlength: "20" });
    nameIn.value = load("fmName") || ""; phoneIn.value = load("fmPhone") || "";
    const hint = el("span", { class: "hint", hidden: "" });
    setTimeout(() => nameIn.focus(), 0);
    return setCard(...head,
      el("span", { class: "muted" }, "The coordinator gets your request and approves it. Then you can share your location so the team can find you, and find them."),
      el("form", { class: "fmform", onsubmit: e => {
          e.preventDefault();
          const n = nameIn.value.trim(); if (!n) { hint.textContent = "Enter your name."; hint.hidden = false; return nameIn.focus(); }
          store("fmName", n); if (phoneIn.value.trim()) store("fmPhone", phoneIn.value.trim());
          sendAsk(info, n.slice(0, 40), roleIn.value, phoneIn.value.trim().slice(0, 20)); } },
        nameIn, el("label", { class: "f" }, "I'm the", roleIn), phoneIn, hint,
        el("button", { type: "submit" }, "Ask to join")),
      close("Cancel"));
  }
  const msg = { sending: ["Sending your request…", ""],
    waiting: ["Waiting for the coordinator to approve…", "Keep this page open, or come back to it later; it picks up where you left off."],
    denied: ["The coordinator declined your request.", "If that's a mistake, contact them directly."],
    timeout: ["Your request expired.", "Open the event link again to send a new one."],
    error: ["Couldn't send your request.", "Check your connection and open the event link again."] }[a.state];
  setCard(...head, el("b", {}, msg[0]), msg[1] ? el("span", { class: "muted" }, msg[1]) : null,
    close(a.state === "waiting" || a.state === "sending" ? "Cancel request" : "Close"));
}

// --- the coordinator's phone ---
let joinEs = null, joinPriv = null, joinFor = null;
const joinReqs = new Map();
const doneKey = id => "ftJoinDone:" + id;
const isDone = (id, rid) => (jget(doneKey(id)) || []).includes(rid);
const markDone = (id, rid) => jset(doneKey(id), [...(jget(doneKey(id)) || []), rid].slice(-200));
async function startJoinListener() {
  if (!draft?.jpub || !draft.rv || joinFor === draft.id) return;
  const jwk = jget("ftJoinKey:" + draft.id); if (!jwk) return;
  try { joinPriv = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["deriveKey"] }, ECDH, false, ["deriveKey"]); } catch (_) { return; }
  joinEs?.close(); joinReqs.clear(); joinFor = draft.id;
  const id = draft.id;
  joinEs = relayListen(joinTopic(id), async m => {
    if (m.event !== "message" || joinFor !== id) return;
    let r; try { r = JSON.parse(m.message); } catch (_) { return; }
    if (r.t !== "join" || !r.rid || !r.pub || joinReqs.has(r.rid) || isDone(id, r.rid) || Date.now() - (r.at || 0) > JOIN_TTL) return;
    let k, who; try { k = await aesKey(joinPriv, r.pub); who = await unseal(k, r); } catch (_) { return; }
    joinReqs.set(r.rid, { rid: r.rid, key: k, at: r.at, name: String(who.name || "Someone").slice(0, 40), role: ROLES.includes(who.role) ? who.role : "Client contact", phone: String(who.phone || "").slice(0, 20) });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setStatus(`${who.name || "Someone"} asked to join ${draft.name || "the team"}.`, "ok");
    if (view !== "setup") render();
  }, "12h");
}
async function approveJoin(rid, role) {
  const r = joinReqs.get(rid); if (!r || !draft) return;
  const p = { id: uid(6), name: r.name, role, phone: r.phone, start: draft.start || "", end: draft.end || "" };
  draft.people.push(p); saveDraft();
  await publishDraft();
  try { await relayPost(replyTopic(draft.id, rid), await seal(r.key, { t: "ok", cfg: { ...draft }, pid: p.id })); } catch (_) {}
  markDone(draft.id, rid); joinReqs.delete(rid);
  setStatus(`${r.name} joined the team.`, "ok"); render();
}
async function denyJoin(rid) {
  const r = joinReqs.get(rid); if (!r || !draft) return;
  try { await relayPost(replyTopic(draft.id, rid), { t: "deny" }); } catch (_) {}
  markDone(draft.id, rid); joinReqs.delete(rid); render();
}
function joinRequestsBlock() {
  if (!joinReqs.size || draft?.id !== joinFor) return null;
  return el("div", { class: "consent" }, el("div", { class: "sec" }, `Asking to join (${joinReqs.size})`),
    ...[...joinReqs.values()].map(r => {
      const roleSel = el("select", { "aria-label": `Role for ${r.name}` }, ...ROLES.map(x => el("option", {}, x)));
      roleSel.value = r.role;
      return el("div", { class: "tm" },
        el("span", { class: "av", style: `background:${color(r.role)}` }, initials(r.name)),
        el("div", {}, el("div", { class: "nm" }, r.name), el("span", { class: "muted" }, (r.phone ? r.phone + " · " : "") + "asked " + ago(r.at))),
        el("span", {}),
        el("div", { class: "acts" }, roleSel,
          el("button", { type: "button", onclick: () => approveJoin(r.rid, roleSel.value) }, "Approve"),
          el("button", { type: "button", class: "ghost", onclick: () => denyJoin(r.rid) }, "Deny")));
    }));
}

/* ---------- rendering ---------- */
function render() {
  if (mode !== "team") return;
  if (view === "setup") return renderSetup();
  if (view === "join" && asking) return renderAsk();
  if (view === "links") renderLinks();
  else if (!ev || !me()) renderIntro();
  else renderLive();
  const jr = joinRequestsBlock(); if (jr) card.prepend(jr);
}
function renderIntro() {
  setCard(
    el("b", {}, "Find my team"),
    el("span", { class: "muted" }, "Find the event, then the team. The coordinator pins the exact entrance and adds arrival notes, so guests are walked to the right door, not just the address. Everyone who checks in can then find each other on the map, with walking directions and a WhatsApp button."),
    el("button", { type: "button", onclick: () => { draft ??= newDraft(); view = "setup"; render(); } }, draft?.people.length ? "Continue setting up the team" : "Set up a team"),
    el("span", { class: "muted" }, "Got a link from your coordinator? Open it on this phone and you're in."));
}
function renderSetup() {
  const d = draft;
  const f = (label, input) => el("label", { class: "f" }, label, input);
  const inp = (k, ph, type = "text") => { const i = el("input", { type, placeholder: ph }); i.value = d[k] || ""; i.oninput = () => { d[k] = i.value.trim(); saveDraft(); }; return i; };
  const zoneIn = el("input", { type: "text", placeholder: "Add a zone, e.g. Coat check", "aria-label": "New zone" });
  const addZone = () => { const v = zoneIn.value.trim(); if (!v) return; d.zones.push(v); saveDraft(); renderSetup(); card.querySelector("[aria-label='New zone']")?.focus(); };
  zoneIn.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); addZone(); } };
  const nameIn = el("input", { type: "text", placeholder: "Name", "aria-label": "Name", autocomplete: "off" });
  const roleIn = el("select", { "aria-label": "Role" }, ...ROLES.map(r => el("option", {}, r)));
  roleIn.value = d.people.length ? "Server" : "Coordinator";
  const phoneIn = el("input", { type: "tel", inputmode: "tel", placeholder: "WhatsApp number, e.g. +1 202 555 0134 (optional)", "aria-label": "WhatsApp number" });
  const sIn = el("input", { type: "time", "aria-label": "Shift starts" }), eIn = el("input", { type: "time", "aria-label": "Shift ends" });
  sIn.value = d.start || ""; eIn.value = d.end || "";
  const hint = el("span", { class: "hint", hidden: "" });
  const spotHint = el("span", { class: "hint", hidden: "" });
  const addPerson = e => {
    e.preventDefault();
    const n = nameIn.value.trim();
    if (!n) { hint.textContent = "Enter a name."; hint.hidden = false; return nameIn.focus(); }
    d.people.push({ id: uid(6), name: n.slice(0, 40), role: roleIn.value, phone: phoneIn.value.trim().slice(0, 20), start: sIn.value || d.start || "", end: eIn.value || d.end || "" });
    saveDraft(); renderSetup(); card.querySelector("[aria-label='Name']")?.focus();
  };
  setCard(
    el("b", {}, "Set up the team"),
    f("Event name", inp("name", "Hart wedding · Saturday")),
    f("Venue", inp("venue", "The Foundry, 1055 Thomas Jefferson St NW")),
    el("div", { class: "sec" }, "Where guests should go"),
    d.spot ? el("span", { class: "muted" }, (d.spot.how === "here" ? "Entrance pinned where you stood" : "Pinned from the address") + (d.spot.acc ? ` (±${d.spot.acc} m)` : "") + ".") 
           : el("span", { class: "muted" }, "Not pinned yet. Guests will get directions to the address only."),
    el("div", { class: "row" },
      el("button", { type: "button", class: "ghost", onclick: () => {
          if (!navigator.geolocation) { spotHint.textContent = "This phone can't share its location."; spotHint.hidden = false; return; }
          spotHint.textContent = "Getting your exact spot…"; spotHint.hidden = false;
          navigator.geolocation.getCurrentPosition(p => { d.spot = roundSpot(p.coords.latitude, p.coords.longitude, p.coords.accuracy, "here"); saveDraft(); renderSetup(); },
            () => { spotHint.textContent = "Couldn't get your location. Allow location for this page and try again."; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        } }, "Pin where I’m standing"),
      el("button", { type: "button", class: "ghost", onclick: async () => {
          if (!d.venue) { spotHint.textContent = "Type the venue address first."; spotHint.hidden = false; return; }
          spotHint.textContent = "Looking up the address…"; spotHint.hidden = false;
          try { const g = await geocode(d.venue); if (!g) { spotHint.textContent = "Couldn't find that address. Try adding the city."; return; }
                d.spot = roundSpot(g.lat, g.lng, null, "address"); saveDraft(); renderSetup(); }
          catch (_) { spotHint.textContent = "Search failed. Check your connection."; }
        } }, "Pin from the address")),
    spotHint,
    f("Arrival notes for guests", inp("arrive", "Side door on 21st St · look for the black Expréss flag")),
    el("span", { class: "muted" }, "Hard-to-find venue? Stand at the door guests should use and tap “Pin where I’m standing”; it’s more exact than an address."),
    f("Date", inp("date", "", "date")),
    el("div", { class: "grid2" }, f("Event starts", inp("start", "", "time")), f("Event ends", inp("end", "", "time"))),
    f("WhatsApp group link", inp("group", "https://chat.whatsapp.com/…", "url")),
    el("span", { class: "muted" }, "In WhatsApp: group info → Invite via link → Copy link."),
    el("div", { class: "sec" }, "Venue zones"),
    el("div", { class: "chips" }, ...d.zones.map((z, i) => el("span", {}, z,
      el("button", { type: "button", "aria-label": "Remove " + z, onclick: () => { d.zones.splice(i, 1); saveDraft(); renderSetup(); } }, "×")))),
    el("div", { class: "row" }, zoneIn, el("button", { type: "button", class: "ghost", onclick: addZone, style: "flex:0 0 auto" }, "Add zone")),
    el("span", { class: "muted" }, "Zones help indoors, where phone GPS can be 10–30 m off."),
    el("div", { class: "sec" }, `Team (${d.people.length})`),
    ...d.people.map((p, i) => {
      const ts = el("input", { type: "time", "aria-label": `${p.name}: ${shiftWord(p).toLowerCase()} starts` }), te_ = el("input", { type: "time", "aria-label": `${p.name}: ${shiftWord(p).toLowerCase()} ends` });
      ts.value = p.start || ""; te_.value = p.end || "";
      ts.onchange = () => { p.start = ts.value; saveDraft(); };
      te_.onchange = () => { p.end = te_.value; saveDraft(); };
      return el("div", { class: "tm" },
        el("span", { class: "av", style: `background:${color(p.role)}` }, initials(p.name)),
        el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role + (p.phone ? " · " + p.phone : ""))),
        el("button", { type: "button", class: "ghost", "aria-label": "Remove " + p.name, onclick: () => { d.people.splice(i, 1); saveDraft(); renderSetup(); } }, "Remove"),
        el("div", { class: "acts" }, el("label", { class: "f" }, shiftWord(p) + " from", ts), el("label", { class: "f" }, "to", te_)));
    }),
    d.people.length ? el("span", { class: "muted" }, "Only you, the coordinator, can set and change these times. Saving sends them to everyone's phone.") : null,
    el("form", { class: "fmform", onsubmit: addPerson },
      el("div", { class: "grid2" }, nameIn, roleIn), phoneIn,
      el("div", { class: "grid2" }, el("label", { class: "f" }, "Shift starts", sIn), el("label", { class: "f" }, "Shift ends", eIn)), hint,
      el("button", { type: "submit", class: "ghost" }, d.people.length ? "Add another person" : "Add yourself first")),
    el("div", { class: "row" },
      el("button", { type: "button", onclick: async () => {
        if (!d.people.length) { hint.textContent = "Add at least one person."; hint.hidden = false; return; }
        await publishDraft(); view = "links"; render(); } }, "Save and get links"),
      el("button", { type: "button", class: "ghost", onclick: () => { view = "live"; render(); } }, "Back")));
}
function renderLinks() {
  const d = draft;
  const copy = async (url, btn) => {
    try { await navigator.clipboard.writeText(url); if (btn) { const t = btn.textContent; btn.textContent = "Copied"; setTimeout(() => btn.textContent = t, 1500); } }
    catch (_) { prompt("Copy this link", url); }
  };
  const share = async (p, url) => {
    const when = [fmtD(d.date), range(p.start, p.end) ? `${shiftWord(p) === "Shift" ? "your shift" : "on site"} ${range(p.start, p.end)}` : ""].filter(Boolean).join(", ");
    const text = `${p.name}, here's your link for ${d.name || "the event"}${d.venue ? " at " + d.venue : ""}${when ? " (" + when + ")" : ""}. Open it on your phone and tap Check in when you arrive.`;
    try { await navigator.share({ title: "Find my team", text, url }); } catch (_) { copy(url, null); }
  };
  setCard(
    el("b", {}, "Event join link"),
    el("span", { class: "muted" }, "Share one link with the client, or anyone else who should be on the team. They type their name and you approve them here. Keep this page open on your phone to see requests."),
    (() => { const u = joinLinkFor(d); const b = el("button", { type: "button", class: "ghost", onclick: e => copy(u, e.currentTarget) }, "Copy join link");
      return el("div", { class: "row" }, navigator.share ? el("button", { type: "button", onclick: () => navigator.share({ title: d.name || "Event", text: `Join ${d.name || "the event"} on Find my team${d.venue ? " at " + d.venue : ""}.`, url: u }).catch(() => {}) }, "Send join link") : null, b); })(),
    el("b", {}, "Or send each person their own link"),
    el("span", { class: "muted" }, "Each link opens Walk Tracker as that person. If you change the team later, phones already on the event update automatically."),
    ...d.people.map(p => {
      const url = linkFor(d, p.id);
      const cp = el("button", { type: "button", class: "ghost", onclick: e => copy(url, e.currentTarget) }, "Copy");
      return el("div", { class: "link" },
        el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role + (range(p.start, p.end) ? " · " + range(p.start, p.end) : ""))),
        el("div", { class: "row", style: "flex-wrap:nowrap" },
          navigator.share ? el("button", { type: "button", class: "ghost", onclick: () => share(p, url) }, "Send") : cp,
          navigator.share ? cp : null,
          el("button", { type: "button", onclick: () => join({ ...d }, p.id) }, "This is me")));
    }),
    el("div", { class: "row" },
      el("button", { type: "button", class: "ghost", onclick: () => { view = "setup"; render(); } }, "Edit team"),
      el("button", { type: "button", class: "ghost", onclick: () => { view = "live"; render(); } }, "Done")));
}
function renderLive() {
  const m = me(), isClient = m.role === "Client contact";
  const zoneSel = el("select", { "aria-label": "Where I am" }, el("option", { value: "" }, "I'm at… (optional)"), ...ev.zones.map(z => el("option", {}, z)));
  zoneSel.value = zone;
  zoneSel.onchange = () => { zone = zoneSel.value; store("ftZone", zone); send(true); };
  const canEdit = draft?.id === ev.id && isCoord(m);       // the team, times and shifts are the coordinator's to change
  const evWhen = [fmtD(ev.date), range(ev.start, ev.end)].filter(Boolean).join(" · ");
  const myShift = range(m.start, m.end), myNote = shiftNote(ev, m);
  setCard(
    el("div", { class: "row", style: "align-items:center;justify-content:space-between" },
      el("div", {}, el("b", {}, ev.name || "Event"), el("div", { class: "muted" }, ev.venue || ""), evWhen ? el("div", { class: "muted" }, evWhen) : null),
      el("span", { class: "pill " + (on ? "on" : "off") }, on ? "Sharing" : "Not sharing")),
    eventSpotBlock(ev),
    el("div", { class: "tm", style: "border-top:0;padding-top:0" },
      el("span", { class: "av", style: `background:${color(m.role)}` }, initials(m.name)),
      el("div", {}, el("div", { class: "nm" }, m.name + " (you)"), el("span", { class: "muted" }, m.role + (myShift ? ` · ${shiftWord(m)} ${myShift}` : "") + (myNote ? ` · ${myNote}` : ""))),
      el("span", {}),
      el("div", { class: "acts" },
        on ? el("button", { type: "button", class: "ghost", onclick: checkOut }, isClient ? "Stop sharing" : "Check out")
           : el("button", { type: "button", onclick: checkIn }, isClient ? "Share my location" : "Check in"),
        ev.group ? el("a", { class: "btn wa", href: ev.group, target: "_blank", rel: "noopener" }, "Team chat") : null)),
    zoneSel,
    el("span", { class: "muted" }, on ? "Your location is shared with this team until you " + (isClient ? "stop sharing." : "check out.") + " Keep this page open; locking the phone pauses it."
                                      : "Your location is shared only while you're " + (isClient ? "sharing." : "checked in.")),
    el("div", { class: "sec" }, "Team"),
    el("div", { id: "ftList" }),
    el("div", { class: "row" },
      canEdit ? el("button", { type: "button", class: "ghost", onclick: () => { view = "setup"; render(); } }, "Edit team") : null,
      canEdit ? el("button", { type: "button", class: "ghost", onclick: () => { view = "links"; render(); } }, "Links") : null,
      el("button", { type: "button", class: "ghost", onclick: () => { if (confirm("Leave this event on this phone?")) leave(); } }, "Leave event")));
  liveRefresh();
}
function liveRefresh() {
  drawPins();
  const list = $("ftList");
  if (!list || !ev || mode !== "team" || view !== "live") return;
  const now = Date.now();
  const others = ev.people.filter(p => p.id !== meId).sort((a, b) => {
    const ca = a.role === "Coordinator" ? 0 : 1, cb = b.role === "Coordinator" ? 0 : 1; if (ca !== cb) return ca - cb;
    const oa = pos[a.id] ? 0 : 1, ob = pos[b.id] ? 0 : 1; if (oa !== ob) return oa - ob;
    if (last && pos[a.id] && pos[b.id]) return distance(last, pos[a.id]) - distance(last, pos[b.id]);
    return a.name.localeCompare(b.name);
  });
  const rows = others.map(p => {
    const at = pos[p.id], live = at && now - at.ts < FT.goneMs, stale = live && now - at.ts > FT.staleMs;
    const d = live && last ? distance(last, at) : null;
    const b = live && last ? bearing(last, at) : null;
    const status = !live ? [el("span", { class: "dot" }), "Not checked in"]
      : [el("span", { class: "dot on" }), at.zone || "On site", stale ? " · seen " + ago(at.ts) : ""];
    const msg = msgLink(p, ev);
    const sh = range(p.start, p.end), note = shiftNote(ev, p);
    return el("div", { class: "tm" },
      el("span", { class: "av" + (live ? "" : " off"), style: `background:${color(p.role)}` }, initials(p.name)),
      el("div", {}, el("div", { class: "nm" }, p.name), el("span", { class: "muted" }, p.role + " · ", ...status),
        sh ? el("div", { class: "muted" }, `${shiftWord(p)} ${sh}${note ? " · " + note : ""}`) : null),
      el("div", { class: "dd" }, d != null ? el("span", { style: `display:inline-block;transform:rotate(${heading != null ? b - heading : b}deg)`, "aria-hidden": "true" }, "↑") : "",
        d != null ? " " + fmtDist(d) : "", d != null ? el("small", {}, "±" + Math.round(at.acc || 0) + " m") : ""),
      el("div", { class: "acts" },
        guide === p.id ? el("button", { type: "button", class: "ghost", onclick: stopFind }, "Stop directions")
          : el("button", { type: "button", ...(live ? {} : { disabled: "" }), onclick: () => find(p.id) }, live ? "Find " + p.name.split(" ")[0] : "Find"),
        msg ? el("a", { class: "btn wa", href: msg, target: "_blank", rel: "noopener" }, digits(p.phone) ? "WhatsApp" : "WhatsApp group")
            : el("button", { type: "button", class: "ghost", disabled: "" }, "WhatsApp unavailable")));
  });
  const tip = !last && others.some(p => pos[p.id]) ? el("span", { class: "muted" }, "Check in or tap Start tracking to see how far away each person is.") : null;
  list.replaceChildren(...(tip ? [tip] : []), ...(rows.length ? rows : [el("span", { class: "muted" }, "No one else on this team yet.")]));
}

/* ---------- start ---------- */
if (ev && !me()) { ev = null; meId = null; jset("ftEvent", null); }
if (ev) remember(); else updateTop();
setMode(mode);
connect();
if (ev && on && watchId == null) start();      // still checked in after a reload: pick tracking back up
if (asking?.state === "waiting" && !ev) { view = "join"; resumeAsk(); render(); }
startJoinListener();
handleTeamLink();
// A teammate stays the destination only while you're following them
setInterval(() => { if (guide && !(dest.person && dest.name === person(guide)?.name)) { guide = null; liveRefresh(); } }, 3000);
})();
