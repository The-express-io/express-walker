// Fíeld Güide test drive API. Simulated passwordless accounts + shared data in a private Vercel Blob store.
// SIMULATED: the 6-digit sign-in code is returned to the browser instead of being emailed.
import { put, get, list } from '@vercel/blob';
import crypto from 'node:crypto';

const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const rd = async p => { try { const r = await get(p, { access: 'private', useCache: false }); if (!r || r.statusCode !== 200) return null; return JSON.parse(await new Response(r.stream).text()); } catch { return null; } };
const wr = (p, o) => put(p, JSON.stringify(o), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
const H = s => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex').slice(0, 24);
const rid = (n = 6) => crypto.randomBytes(n).toString('hex');
const okEmail = e => typeof e === 'string' && e.length < 200 && /^\S+@\S+\.\S+$/.test(e.trim());
const clip = (s, n = 300) => String(s ?? '').slice(0, n);
const EVID = /^CE-[A-F0-9]{6}$/;
const TYPES = ['Restaurant', 'Event Venue', 'Farm', 'Winery', 'Bakery + Desserts', 'Coffee + Espresso', 'Bar + Drinks', 'Rentals', 'Entertainment'];

async function readAll(prefix) {
  const out = []; let cursor;
  do { const r = await list({ prefix, cursor, limit: 1000 }); (await Promise.all(r.blobs.map(b => rd(b.pathname)))).forEach(v => v && out.push(v)); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
  return out;
}
async function who(req) {
  const t = req.headers.get('x-token') || '';
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  const s = await rd(`sessions/${t}.json`);
  return s ? rd(`accounts/${H(s.email)}.json`) : null;
}
const isAdmin = req => !!process.env.FG_ADMIN_CODE && req.headers.get('x-admin-code') === process.env.FG_ADMIN_CODE;
const pubVendor = v => ({ id: v.id, name: v.name, type: v.type, hood: v.hood, blurb: v.blurb, items: v.items || [], inviteIds: v.inviteIds || [], status: v.status });
const vendorItems = (ev, vid) => Object.entries(ev.sel || {}).filter(([k, q]) => q > 0 && k.startsWith(vid + '-'));
const cleanEvent = e => {
  const pick = ['inq', 'picks', 'gems', 'recommend', 'sel', 'staff', 'mat', 'notes', 'booked'];
  const o = {}; pick.forEach(k => { if (e[k] !== undefined) o[k] = e[k]; });
  if (JSON.stringify(o).length > 60000) throw new Error('Event too large');
  o.gems = (o.gems || []).slice(0, 12).map(g => ({ name: clip(g.name, 120), type: TYPES.includes(g.type) ? g.type : 'Restaurant', link: clip(g.link, 200), love: clip(g.love, 200), inviteId: /^[a-f0-9]{12}$/.test(g.inviteId || '') ? g.inviteId : undefined }));
  return o;
};

export async function POST(req) {
  const a = new URL(req.url).searchParams.get('a') || '';
  let b = {}; try { b = await req.json(); } catch {}

  if (a === 'start') {
    if (!okEmail(b.email)) return J({ error: 'Enter a valid email.' }, 400);
    const code = String(crypto.randomInt(100000, 1000000));
    await wr(`pending/${H(b.email)}.json`, { code, name: clip(b.name, 120), role: b.role === 'vendor' ? 'vendor' : 'client', biz: clip(b.biz, 120), type: TYPES.includes(b.type) ? b.type : '', phone: clip(b.phone, 40), inviteId: /^[a-f0-9]{12}$/.test(b.inviteId || '') ? b.inviteId : '', exp: Date.now() + 15 * 60e3 });
    return J({ ok: true, demoCode: code });
  }
  if (a === 'verify') {
    if (!okEmail(b.email)) return J({ error: 'Enter a valid email.' }, 400);
    const p = await rd(`pending/${H(b.email)}.json`);
    if (!p || p.exp < Date.now() || String(b.code).trim() !== p.code) return J({ error: 'That code did not match. Try again.' }, 400);
    const key = `accounts/${H(b.email)}.json`;
    let acct = await rd(key) || { email: b.email.trim().toLowerCase(), name: '', roles: [], events: [], createdAt: Date.now() };
    if (p.name) acct.name = acct.name || p.name;
    if (p.phone) acct.phone = acct.phone || p.phone;
    if (!acct.roles.includes(p.role)) acct.roles.push(p.role);
    if (p.role === 'vendor') {
      if (!acct.vendorId) acct.vendorId = 'v-' + rid(4);
      const vk = `vendors/${acct.vendorId}.json`;
      let v = await rd(vk);
      if (!v) {
        let inv = p.inviteId ? await rd(`invites/${p.inviteId}.json`) : null;
        v = { id: acct.vendorId, ownerEmail: acct.email, name: p.biz || inv?.gemName || 'My business', type: p.type || inv?.type || 'Restaurant', hood: '', blurb: '', items: [], status: 'draft', inviteIds: [], updatedAt: Date.now() };
      }
      if (p.inviteId && !v.inviteIds.includes(p.inviteId)) {
        v.inviteIds.push(p.inviteId);
        const inv = await rd(`invites/${p.inviteId}.json`);
        if (inv) {
          inv.status = 'joined'; inv.vendorId = v.id; await wr(`invites/${inv.id}.json`, inv);
          const ev = inv.eventId ? await rd(`events/${inv.eventId}.json`) : null;
          const k = 'inv-' + inv.id;
          if (ev?.quote?.vendors && k in ev.quote.vendors) { ev.quote.vendors[v.id] = ev.quote.vendors[k]; delete ev.quote.vendors[k]; ev.updatedAt = Date.now(); await wr(`events/${ev.id}.json`, ev); }
        }
      }
      await wr(vk, v);
    }
    await wr(key, acct);
    const token = rid(16);
    await wr(`sessions/${token}.json`, { email: acct.email, at: Date.now() });
    return J({ token, account: acct });
  }

  if (a === 'vendors') return J({ vendors: (await readAll('vendors/')).filter(v => v.status === 'live').map(pubVendor) });
  if (a === 'invite') {
    const inv = /^[a-f0-9]{12}$/.test(b.id || '') ? await rd(`invites/${b.id}.json`) : null;
    if (!inv) return J({ error: 'Invite not found' }, 404);
    const { id, gemName, type, link, eventTitle, date, guests, hood, love, status } = inv;
    return J({ invite: { id, gemName, type, link, eventTitle, date, guests, hood, love, status } });
  }

  if (a.startsWith('admin')) {
    if (!isAdmin(req)) return J({ error: 'Admin code required' }, 401);
    if (a === 'adminCheck') return J({ ok: true });
    if (a === 'adminData') {
      const [events, invites, vendors] = await Promise.all([readAll('events/'), readAll('invites/'), readAll('vendors/')]);
      return J({ events: events.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)), invites, vendors: vendors.map(pubVendor) });
    }
    if (a === 'adminUpdate') {
      if (!EVID.test(b.id || '')) return J({ error: 'Bad id' }, 400);
      const ev = await rd(`events/${b.id}.json`); if (!ev?.quote) return J({ error: 'Not found' }, 404);
      const q = ev.quote;
      if (b.confirm && b.confirm in q.vendors) q.vendors[b.confirm] = 'confirmed';
      if (b.status === 'quoted' && q.status === 'requested' && Object.values(q.vendors).every(s => s === 'confirmed')) q.status = 'quoted';
      if (b.status === 'in_progress' && q.status === 'approved') q.status = 'in_progress';
      if (b.status === 'completed' && q.status === 'in_progress') q.status = 'completed';
      if (typeof b.lead === 'string') ev.lead = clip(b.lead, 80);
      ev.updatedAt = Date.now(); await wr(`events/${ev.id}.json`, ev);
      return J({ event: ev });
    }
    return J({ error: 'Unknown admin action' }, 400);
  }

  const acct = await who(req);
  if (!acct) return J({ error: 'Please sign in again.' }, 401);

  if (a === 'me') {
    const events = (await Promise.all((acct.events || []).map(id => rd(`events/${id}.json`)))).filter(Boolean).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    let vendor = null, orders = [];
    if (acct.vendorId) {
      vendor = await rd(`vendors/${acct.vendorId}.json`);
      if (vendor) {
        const all = await readAll('events/');
        orders = all.filter(ev => ev.quote && vendor.id in ev.quote.vendors).map(ev => ({
          id: ev.id, title: ev.inq?.title, type: ev.inq?.type, date: ev.inq?.date, start: ev.inq?.start, guests: ev.inq?.guaranteed, location: ev.inq?.location,
          items: vendorItems(ev, vendor.id).map(([k, q]) => { const it = (vendor.items || [])[+k.split('-').pop()]; return { n: it ? it.n : 'Item', u: it ? it.u : '', p: it ? it.p : 0, q }; }),
          status: ev.quote.vendors[vendor.id], quoteStatus: ev.quote.status
        }));
      }
    }
    return J({ account: acct, events, vendor, orders });
  }

  if (a === 'saveEvent') {
    const e = b.event || {};
    let id = EVID.test(e.id || '') ? e.id : null;
    const prev = id ? await rd(`events/${id}.json`) : null;
    if (id && !prev) id = null;
    if (prev && prev.owner !== acct.email) return J({ error: 'Not your event' }, 403);
    if (!id) id = 'CE-' + rid(3).toUpperCase();
    let ev; try { ev = cleanEvent(e); } catch (x) { return J({ error: x.message }, 400); }
    ev.id = id; ev.owner = acct.email; ev.ownerName = acct.name; ev.ownerPhone = acct.phone || ''; ev.lead = prev?.lead || 'Matthew'; ev.createdAt = prev?.createdAt || Date.now(); ev.updatedAt = Date.now();
    for (const g of ev.gems) {
      if (!g.name || g.inviteId) continue;
      g.inviteId = rid(6);
      await wr(`invites/${g.inviteId}.json`, { id: g.inviteId, gemName: g.name, type: g.type, link: g.link, love: g.love, eventId: id, eventTitle: clip(ev.inq?.title, 120), date: clip(ev.inq?.date, 20), guests: clip(ev.inq?.guaranteed, 6), hood: clip(ev.inq?.location, 120), status: 'sent', createdAt: Date.now() });
    }
    const pq = prev?.quote || null, cq = e.quote || null;
    if (!pq && cq?.status === 'requested') ev.quote = { status: 'requested', at: Date.now(), vendors: Object.fromEntries(Object.keys(cq.vendors || {}).slice(0, 20).map(k => [clip(k, 40), 'waiting'])) };
    else if (pq && pq.status === 'quoted' && cq?.status === 'approved') ev.quote = { ...pq, status: 'approved', approvedAt: Date.now() };
    else ev.quote = pq;
    if (pq) { ev.sel = prev.sel; ev.staff = prev.staff; ev.mat = prev.mat; ev.picks = prev.picks; }
    await wr(`events/${id}.json`, ev);
    if (!(acct.events || []).includes(id)) { acct.events = [...(acct.events || []), id]; await wr(`accounts/${H(acct.email)}.json`, acct); }
    return J({ event: ev });
  }

  if (a === 'getEvent') {
    const ev = EVID.test(b.id || '') ? await rd(`events/${b.id}.json`) : null;
    if (!ev || ev.owner !== acct.email) return J({ error: 'Not found' }, 404);
    return J({ event: ev });
  }

  if (a === 'saveVendor') {
    if (!acct.vendorId) return J({ error: 'Vendor accounts only' }, 403);
    const v = b.vendor || {}, prev = await rd(`vendors/${acct.vendorId}.json`) || {};
    const out = { ...prev, id: acct.vendorId, ownerEmail: acct.email, name: clip(v.name, 120) || 'My business', type: TYPES.includes(v.type) ? v.type : 'Restaurant', hood: clip(v.hood, 80), blurb: clip(v.blurb, 400),
      items: (v.items || []).slice(0, 60).map(i => ({ n: clip(i.n, 100), d: clip(i.d, 200), p: Math.max(0, Math.min(100000, +i.p || 0)), u: clip(i.u, 40) })).filter(i => i.n),
      status: v.status === 'live' ? 'live' : 'draft', inviteIds: prev.inviteIds || [], updatedAt: Date.now() };
    await wr(`vendors/${out.id}.json`, out);
    return J({ vendor: out });
  }

  if (a === 'vendorRespond') {
    if (!acct.vendorId) return J({ error: 'Vendor accounts only' }, 403);
    const ev = EVID.test(b.id || '') ? await rd(`events/${b.id}.json`) : null;
    if (!ev?.quote || !(acct.vendorId in ev.quote.vendors) || ev.quote.status !== 'requested') return J({ error: 'Not available' }, 404);
    ev.quote.vendors[acct.vendorId] = b.decision === 'decline' ? 'declined' : 'confirmed'; ev.updatedAt = Date.now();
    await wr(`events/${ev.id}.json`, ev);
    return J({ ok: true });
  }

  return J({ error: 'Unknown action' }, 400);
}
