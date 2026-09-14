// Login endpoint for the HAPPYSOLAR 50,000 admin dashboard.
// Body: { username, password }
//  - Leave username blank to log in as the super admin (uses ADMIN_PASSWORD env var).
//  - Otherwise, looks up a personal account stored in the "happysolar50k_admins" form
//    (created via admin-accounts.js) and verifies the password against its stored hash.
//
// Returns: { ok, role: 'super'|'support'|'sale', username, level, scopeValue }

const crypto = require('crypto');

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

    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    if (!apiToken || !siteId) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server not configured' }) };
    }

    const result = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_admins');
    const account = result.submissions.find(
      s => (s.data.username || '').toLowerCase() === username.toLowerCase()
    );

    if (!account || !verifyPassword(password, account.data.salt, account.data.passwordHash)) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        role: account.data.role,
        username: account.data.username,
        level: account.data.level || '',
        scopeValue: account.data.scopeValue || ''
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
