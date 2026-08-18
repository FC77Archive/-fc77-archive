// FC77 contact lookup — Vercel serverless function.
//
// GET  /api/lookup            -> { config } : property names + FC77 Team options (public, no contact data)
// POST /api/lookup {email}    -> { found: bool, contact: {...} }
//
// The HubSpot private-app token lives ONLY in the HUBSPOT_TOKEN environment variable
// on Vercel. It is never sent to the browser.

const HUBSPOT = 'https://api.hubapi.com';

// Human labels of the two custom form properties. Internal names are resolved
// from the label at runtime so this keeps working even if HubSpot chose an
// unexpected internal name when the property was created.
const PLAY_LABEL = 'Do you currently play for an FC77 team?';
const TEAM_LABEL = 'FC77 Team';

// Standard contact properties shown/edited on the page.
const STANDARD_PROPS = [
  'email', 'firstname', 'lastname', 'phone', 'mobilephone',
  'address', 'city', 'state', 'zip', 'country',
  'company', 'jobtitle', 'website',
];

// ---- tiny in-memory rate limiter (per warm instance) --------------------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 60_000, max = 20;
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}

// ---- HubSpot helpers -----------------------------------------------------
async function hs(path, init = {}) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error('HUBSPOT_TOKEN env var is not set');
  const res = await fetch(HUBSPOT + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

let configCache = { at: 0, value: null };
async function getConfig() {
  if (configCache.value && Date.now() - configCache.at < 10 * 60_000) return configCache.value;

  const data = await hs('/crm/v3/properties/contacts');
  const byLabel = Object.fromEntries(data.results.map(p => [p.label.trim().toLowerCase(), p]));
  const play = byLabel[PLAY_LABEL.toLowerCase()];
  const team = byLabel[TEAM_LABEL.toLowerCase()];
  if (!play || !team) {
    throw new Error(`Could not find custom properties by label. play=${!!play} team=${!!team}`);
  }
  const value = {
    portalId: process.env.HUBSPOT_PORTAL_ID || '40098597',
    formGuid: process.env.HUBSPOT_FORM_GUID || 'ee9352bb-5915-4a2a-9a6b-aac74a2f9491',
    playProp: play.name,
    playOptions: (play.options || []).filter(o => !o.hidden).map(o => ({ label: o.label, value: o.value })),
    teamProp: team.name,
    teamOptions: (team.options || []).filter(o => !o.hidden).map(o => ({ label: o.label, value: o.value })),
    standardProps: STANDARD_PROPS,
  };
  configCache = { at: Date.now(), value };
  return value;
}

async function findContact(email, cfg) {
  const props = [...STANDARD_PROPS, cfg.playProp, cfg.teamProp];
  const body = {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: props,
    limit: 1,
  };
  const data = await hs('/crm/v3/objects/contacts/search', { method: 'POST', body: JSON.stringify(body) });
  const c = data.results && data.results[0];
  if (!c) return null;
  const out = {};
  for (const p of props) out[p] = c.properties[p] ?? '';
  return out;
}

// ---- handler --------------------------------------------------------------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const cfg = await getConfig();

    if (req.method === 'GET') {
      return res.status(200).json({ config: cfg });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests, please wait a minute.' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const email = String((body && body.email) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const contact = await findContact(email, cfg);
    return res.status(200).json({ found: !!contact, contact: contact || { email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Lookup failed. Please try again or contact info@fc77.org.' });
  }
};
