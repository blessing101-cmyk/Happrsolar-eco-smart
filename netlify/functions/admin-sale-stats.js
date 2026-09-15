// Endpoint for "sale" role accounts — no lead-management access, just their own
// referral stats. Auth via headers X-Admin-Username + X-Admin-Password, must be
// an account with role === 'sale' stored in Netlify Blobs.
//
// Points are awarded only for leads where:
//   - lead.data.ref === this account's username (they came from this sale's link)
//   - that lead has been approved at the "country" (final) level
// This is computed live from the leads + approvals data, not stored separately,
// so it can never drift out of sync.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-admins';
const KEY = 'accounts';

async function loadAccounts() {
  const store = getStore(STORE_NAME);
  const list = await store.get(KEY, { type: 'json' });
  return Array.isArray(list) ? list : [];
}

async function fetchFormSubmissions(siteId, apiToken, formName) {
  const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
    headers: { Authorization: 'Bearer ' + apiToken }
  });
  if (!formsRes.ok) return { submissions: [], found: false };
  const forms = await formsRes.json();
  const form = Array.isArray(forms) ? forms.find(f => f.name === formName) : null;
  if (!form) return { submissions: [], found: false };
  const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions`, {
    headers: { Authorization: 'Bearer ' + apiToken }
  });
  if (!subsRes.ok) return { submissions: [], found: false };
  const subs = await subsRes.json();
  return {
    submissions: (Array.isArray(subs) ? subs : []).map(s => ({ id: s.id, created_at: s.created_at, data: s.data || {} })),
    found: true
  };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    if (!password || !salt || !expectedHash) return false;
    const hash = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    if (hash.length !== expected.length) return false;
    return crypto.timingSafeEqual(hash, expected);
  } catch (e) {
    return false;
  }
}

exports.handler = async (event) => {
  try {
    const username = (event.headers['x-admin-username'] || event.headers['X-Admin-Username'] || '').trim();
    const password = event.headers['x-admin-password'] || event.headers['X-Admin-Password'] || '';
    if (!username) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    const accounts = await loadAccounts();
    const account = accounts.find(
      a => (a.username || '').toLowerCase() === username.toLowerCase()
    );
    if (!account || account.role !== 'sale' || !verifyPassword(password, account.salt, account.passwordHash)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    if (!apiToken || !siteId) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server not configured' }) };
    }

    const leadsResult = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k');
    let approvalsResult = { submissions: [] };
    try {
      approvalsResult = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_approvals');
    } catch (e) {}

    const approvedCountry = new Set();
    approvalsResult.submissions.forEach(a => {
      if (a.data.level === 'country' && a.data.appId) approvedCountry.add(a.data.appId);
    });

    const myLeads = leadsResult.submissions.filter(
      l => (l.data.ref || '').toLowerCase() === username.toLowerCase()
    );
    const referred = myLeads.length;
    const points = myLeads.filter(l => approvedCountry.has(l.data.appId)).length;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        username,
        referred,
        points,
        leads: myLeads
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .map(l => ({
            appId: l.data.appId || '',
            name: l.data.name || '',
            created_at: l.created_at,
            approved: approvedCountry.has(l.data.appId)
          }))
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
