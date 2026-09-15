// Public self-signup endpoint — anyone with the link can create a "sale" role
// account for themselves. Role is hard-coded to 'sale' here; this endpoint
// can NEVER create 'support' or 'super' accounts, so it's safe to expose
// without a password. Sale accounts only get their own referral link + stats
// (admin-sale-stats.js) — they cannot see other customers' data or approve leads.

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

    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    const siteUrl = process.env.URL || process.env.DEPLOY_URL;
    if (!apiToken || !siteId || !siteUrl) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'server not configured' }) };
    }

    const existing = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_admins');
    const dup = existing.submissions.find(s => (s.data.username || '').toLowerCase() === username.toLowerCase());
    if (dup) {
      return { statusCode: 409, body: JSON.stringify({ ok: false, error: 'username นี้มีคนใช้แล้ว กรุณาเลือกชื่ออื่น' }) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);

    await submitToForm(siteUrl, 'happysolar50k_admins', {
      username,
      passwordHash,
      salt,
      role: 'sale',
      level: '',
      scopeValue: ''
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, username })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
