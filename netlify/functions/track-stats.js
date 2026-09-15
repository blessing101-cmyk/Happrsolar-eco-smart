// Simple visit / game-play counter, stored in Netlify Blobs.
// GET  -> returns current counts: { ok:true, visitsIndex, visits50000, gamePlays }
// POST -> body { "type": "visit_index" | "visit_50000" | "gameplay" } increments that counter by 1
//
// This is intentionally separate from admin-leads.js / admin-sale-stats.js so it
// cannot break any existing admin functionality. No password required — these are
// simple public counters (same idea as the "เข้าชมแล้วหลายครั้ง" style social-proof
// text already shown on the pages).

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-stats';
const KEY = 'counters';

function getStatsStore() {
  return getStore({ name: STORE_NAME, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN });
}

async function loadCounters() {
  const store = getStatsStore();
  const data = await store.get(KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : { visitsIndex: 0, visits50000: 0, gamePlays: 0 };
}

async function saveCounters(counters) {
  const store = getStatsStore();
  await store.setJSON(KEY, counters);
}

const ALLOWED_TYPES = {
  visit_index: 'visitsIndex',
  visit_50000: 'visits50000',
  gameplay: 'gamePlays'
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const counters = await loadCounters();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, ...counters })
      };
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) };
      }

      const field = ALLOWED_TYPES[body.type];
      if (!field) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'unknown type; use visit_index, visit_50000, or gameplay' }) };
      }

      const counters = await loadCounters();
      counters[field] = (counters[field] || 0) + 1;
      await saveCounters(counters);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, ...counters })
      };
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
