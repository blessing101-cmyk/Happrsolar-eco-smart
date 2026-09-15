// Public self-signup endpoint — anyone with the link can create a "sale" role
// account for themselves. Role is hard-coded to 'sale' here; this endpoint
// can NEVER create 'support' or 'super' accounts, so it's safe to expose
// without a password. Sale accounts only get their own referral link + stats
// (admin-sale-stats.js) — they cannot see other customers' data or approve leads.
//
// Accounts are stored in Netlify Blobs (zero-config) — same store used by
// admin-accounts.js, admin-login.js, admin-leads.js and admin-sale-stats.js.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-admins';
const KEY = 'accounts';

function getAccountsStore() {
  return getStore(STORE_NAME);
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

// Only allow safe characters in a username so it works cleanly as a ?ref= URL param
function isValidUsername(u) {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(u);
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

    if (!isValidUsername(username)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'username ต้องเป็นตัวอักษร/ตัวเลข 3-32 ตัว (a-z, 0-9, _ . -)' }) };
    }
    if (password.length < 6) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' }) };
    }

    const accounts = await loadAccounts();
    const dup = accounts.find(a => (a.username || '').toLowerCase() === username.toLowerCase());
    if (dup) {
      return { statusCode: 409, body: JSON.stringify({ ok: false, error: 'username นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น' }) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    accounts.push({
      id: crypto.randomUUID(),
      username, passwordHash, salt,
      role: 'sale', level: '', scopeValue: '',
      createdAt: new Date().toISOString()
    });
    await saveAccounts(accounts);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, username })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
