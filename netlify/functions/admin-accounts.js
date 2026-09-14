// Super-admin-only endpoint for managing personal admin accounts.
// Requires header X-Admin-Password === ADMIN_PASSWORD (the super admin password).
//
// GET  -> list all accounts (no password hashes returned)
// POST { action:'create', username, password, role, level, scopeValue } -> create account
// POST { action:'delete', id } -> delete account by submission id
//
// role: 'support' (approves leads at a level) | 'sale' (referral link + points only)
// level (support only): 'district' | 'region' | 'country'
// scopeValue (support only, optional): e.g. a region name to lock their view to

const crypto = require('crypto');

async function fetchFormSubmissions(siteId, apiToken, formName) {
  const formsRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/forms`, {
    headers: { Authorization: 'Bearer ' + apiToken }
  });
  if (!formsRes.ok) {
    const errText = await formsRes.text();
    throw new Error('forms lookup failed: ' + errText);
  }
  const forms = await formsRes.json();
  const form = Array.isArray(forms) ? forms.find(f => f.name === formName) : null;
  if (!form) return { submissions: [], found: false };

  const subsRes = await fetch(`https://api.netlify.com/api/v1/forms/${form.id}/submissions`, {
    headers: { Authorization: 'Bearer ' + apiToken }
  });
  if (!subsRes.ok) {
    const errText = await subsRes.text();
    throw new Error('submissions lookup failed for ' + formName + ': ' + errText);
  }
  const subs = await subsRes.json();
  return {
    submissions: (Array.isArray(subs) ? subs : []).map(s => ({ id: s.id, created_at: s.created_at, data: s.data || {} })),
    found: true
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

async function submitToForm(siteUrl, formName, fields) {
  const payload = Object.assign({ 'form-name': formName }, fields);
  const body = Object.keys(payload)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k] == null ? '' : payload[k]))
    .join('&');
  const res = await fetch(siteUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('form submit failed: ' + t);
  }
}

exports.handler = async (event) => {
  try {
    const superPassword = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    const expectedSuper = process.env.ADMIN_PASSWORD;
    if (!expectedSuper || !superPassword || superPassword !== expectedSuper) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized — super admin only' }) };
    }

    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    const siteUrl = process.env.URL || process.env.DEPLOY_URL;
    if (!apiToken || !siteId) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID' }) };
    }

    if (event.httpMethod === 'GET') {
      const result = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_admins');
      const accounts = result.submissions.map(s => ({
        id: s.id,
        username: s.data.username,
        role: s.data.role,
        level: s.data.level || '',
        scopeValue: s.data.scopeValue || '',
        createdAt: s.created_at
      }));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, accounts }) };
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

        const existing = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_admins');
        const dup = existing.submissions.find(s => (s.data.username || '').toLowerCase() === username.toLowerCase());
        if (dup) {
          return { statusCode: 409, body: JSON.stringify({ ok: false, error: 'username นี้มีอยู่แล้ว' }) };
        }
        if (!siteUrl) {
          return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing site URL for form submit' }) };
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(password, salt);

        await submitToForm(siteUrl, 'happysolar50k_admins', {
          username, passwordHash, salt, role, level, scopeValue
        });

        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (action === 'delete') {
        const { id } = body;
        if (!id) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'id required' }) };
        const delRes = await fetch(`https://api.netlify.com/api/v1/submissions/${id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + apiToken }
        });
        if (!delRes.ok) {
          const t = await delRes.text();
          throw new Error('delete failed: ' + t);
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'unknown action' }) };
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
