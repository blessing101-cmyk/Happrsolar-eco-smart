// Login endpoint for the HAPPYSOLAR 50,000 admin dashboard.
// Body: { username, password }
//  - Leave username blank to log in as the super admin (uses ADMIN_PASSWORD env var).
//  - Otherwise, looks up a personal account stored in Netlify Blobs
//    (created via admin-accounts.js or sale-signup.js) and verifies the password.
//
// Returns: { ok, role: 'super'|'support'|'sale', username, level, scopeValue }

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-admins';
const KEY = 'accounts';

async function loadAccounts() {
  const store = getStore(STORE_NAME);
  const list = await store.get(KEY, { type: 'json' });
  return Array.isArray(list) ? list : [];
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
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
    }
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) };
    }
    const username = (body.username || '').trim();
    const password = body.password || '';

    const superPassword = process.env.ADMIN_PASSWORD;

    if (!username) {
      if (superPassword && password === superPassword) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, role: 'super', username: 'admin', level: '', scopeValue: '' })
        };
      }
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    const accounts = await loadAccounts();
    const account = accounts.find(a => (a.username || '').toLowerCase() === username.toLowerCase());

    if (!account || !verifyPassword(password, account.salt, account.passwordHash)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        role: account.role,
        username: account.username,
        level: account.level || '',
        scopeValue: account.scopeValue || ''
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
