// Super-admin-only endpoint for managing personal admin accounts.
// Requires header X-Admin-Password === ADMIN_PASSWORD (the super admin password).
// Accounts are stored in Netlify Blobs (zero-config, no env vars needed) —
// far more reliable than the old "submit a hidden Netlify Form to ourselves" trick.
//
// GET  -> list all accounts (no password hashes returned)
// POST { action:'create', username, password, role, level, scopeValue } -> create account
// POST { action:'delete', id } -> delete account by id
//
// role: 'support' (approves leads at a level) | 'sale' (referral link + points only)
// level (support only): 'district' | 'region' | 'country'
// scopeValue (support only, optional): e.g. a region name to lock their view to

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-admins';
const KEY = 'accounts';

function getAccountsStore() {
  return getStore({ name: STORE_NAME, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN });
}

async function loadAccounts() {
  const store = getAccountsStore();
  const list = await store.get(KEY, { type: 'json' });
  return Array.isArray(list) ? list : [];
}

async function saveAccounts(list) {
  const store = getAccountsStore();
  await store.setJSON(KEY, list);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

exports.handler = async (event) => {
  try {
    const superPassword = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    const expectedSuper = process.env.ADMIN_PASSWORD;
    if (!expectedSuper || !superPassword || superPassword !== expectedSuper) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized — super admin only' }) };
    }

    if (event.httpMethod === 'GET') {
      const accounts = await loadAccounts();
      const safe = accounts.map(a => ({
        id: a.id,
        username: a.username,
        role: a.role,
        level: a.level || '',
        scopeValue: a.scopeValue || '',
        createdAt: a.createdAt
      }));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, accounts: safe }) };
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) };
      }
      const { action } = body;

      if (action === 'create') {
        const username = (body.username || '').trim();
        const password = body.password || '';
        const role = body.role;
        const level = body.level || '';
        const scopeValue = body.scopeValue || '';

        if (!username || !password || !role) {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'username, password, role required' }) };
        }
        if (!['support', 'sale'].includes(role)) {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'role must be support or sale' }) };
        }
        if (role === 'support' && !['district', 'region', 'country'].includes(level)) {
          return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'support accounts need a valid level' }) };
        }

        const accounts = await loadAccounts();
        const dup = accounts.find(a => (a.username || '').toLowerCase() === username.toLowerCase());
        if (dup) {
          return { statusCode: 409, body: JSON.stringify({ ok: false, error: 'username นี้มีอยู่แล้ว' }) };
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(password, salt);
        accounts.push({
          id: crypto.randomUUID(),
          username, passwordHash, salt, role, level, scopeValue,
          createdAt: new Date().toISOString()
        });
        await saveAccounts(accounts);

        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'delete') {
        const { id } = body;
        if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'id required' }) };
        const accounts = await loadAccounts();
        const filtered = accounts.filter(a => a.id !== id);
        await saveAccounts(filtered);
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'unknown action' }) };
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
