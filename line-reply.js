// Lets a logged-in Super/Support Admin send a LINE message to a customer who
// has already linked their phone number via webhook.js.
//
// POST body: { phone: "0812345678", message: "..." }
// Auth: same headers as the other admin-* functions (X-Admin-Username / X-Admin-Password)

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const ACCOUNTS_STORE = 'happysolar-admins';
const ACCOUNTS_KEY = 'accounts';
const LINKS_STORE = 'happysolar-line-links';
const LINKS_KEY = 'links';

function getAccountsStore() {
  return getStore({ name: ACCOUNTS_STORE, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN });
}
function getLinksStore() {
  return getStore({ name: LINKS_STORE, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN });
}

async function loadAccounts() {
  const store = getAccountsStore();
  const list = await store.get(ACCOUNTS_KEY, { type: 'json' });
  return Array.isArray(list) ? list : [];
}

async function loadLinks() {
  const store = getLinksStore();
  const data = await store.get(LINKS_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
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

function extractThaiPhone(text) {
  if (!text) return null;
  const digits = String(text).replace(/[^0-9]/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 11 && digits.startsWith('66')) return '0' + digits.slice(2);
  if (digits.length === 9) return '0' + digits;
  return null;
}

async function isAuthorized(event) {
  const username = (event.headers['x-admin-username'] || event.headers['X-Admin-Username'] || '').trim();
  const password = event.headers['x-admin-password'] || event.headers['X-Admin-Password'] || '';

  // Super admin: no username, password matches the main ADMIN_PASSWORD env var
  if (!username) {
    return password && password === process.env.ADMIN_PASSWORD;
  }

  const accounts = await loadAccounts();
  const account = accounts.find(a => (a.username || '').toLowerCase() === username.toLowerCase());
  if (!account) return false;
  if (account.role !== 'super' && account.role !== 'support') return false;
  return verifyPassword(password, account.salt, account.passwordHash);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
    }

    const authorized = await isAuthorized(event);
    if (!authorized) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'invalid JSON body' }) };
    }

    const phone = extractThaiPhone(body.phone);
    const message = (body.message || '').trim();

    if (!phone) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'เบอร์โทรไม่ถูกต้อง' }) };
    }
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'กรุณาใส่ข้อความ' }) };
    }

    const links = await loadLinks();
    const link = links[phone];
    if (!link || !link.userId) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'ลูกค้าเบอร์นี้ยังไม่ได้แอด LINE OA หรือยังไม่ได้ส่งเบอร์โทรมายืนยัน' }) };
    }

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const resp = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        to: link.userId,
        messages: [{ type: 'text', text: message }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: errText }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
