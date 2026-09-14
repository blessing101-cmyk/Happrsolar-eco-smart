// Admin-only endpoint: fetches "happysolar50k" (leads) and "happysolar50k_approvals"
// form submissions via the Netlify API. Requires NETLIFY_API_TOKEN + NETLIFY_SITE_ID +
// ADMIN_PASSWORD to be set as environment variables on this site.
//
// Auth modes:
//  1) Super admin: header X-Admin-Password === ADMIN_PASSWORD, no X-Admin-Username.
//  2) Support admin (district/region/country level): X-Admin-Username + X-Admin-Password
//     matching a record stored in the "happysolar50k_admins" form, with role !== 'sale'.
//     Sale-role accounts are rejected here — they use admin-sale-stats.js instead.

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
  const simplified = (Array.isArray(subs) ? subs : []).map(s => ({
    id: s.id,
    created_at: s.created_at,
    data: s.data || {}
  })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { submissions: simplified, found: true };
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
    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
    const expectedPassword = process.env.ADMIN_PASSWORD;

    const givenPassword = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    const givenUsername = (event.headers['x-admin-username'] || event.headers['X-Admin-Username'] || '').trim();

    let authedRole = null, authedLevel = '', authedScope = '';

    if (!givenUsername) {
      if (!expectedPassword) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD not configured' }) };
      }
      if (givenPassword && givenPassword === expectedPassword) {
        authedRole = 'super';
      }
    } else {
      if (!apiToken || !siteId) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID' }) };
      }
      const accountsResult = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_admins');
      const account = accountsResult.submissions.find(
        s => (s.data.username || '').toLowerCase() === givenUsername.toLowerCase()
      );
      if (account && account.data.role !== 'sale' && verifyPassword(givenPassword, account.data.salt, account.data.passwordHash)) {
        authedRole = account.data.role;
        authedLevel = account.data.level || '';
        authedScope = account.data.scopeValue || '';
      }
    }

    if (!authedRole) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    if (!apiToken || !siteId) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing NETLIFY_API_TOKEN or NETLIFY_SITE_ID' }) };
    }

    const leadsResult = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k');
    let approvalsResult = { submissions: [], found: false };
    try {
      approvalsResult = await fetchFormSubmissions(siteId, apiToken, 'happysolar50k_approvals');
    } catch (err) {
      // approvals form may not exist yet on first deploy — not fatal, just returns empty
    }

    const note = !leadsResult.found
      ? 'no form found yet — submit the registration form at least once first'
      : undefined;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        role: authedRole,
        level: authedLevel,
        scopeValue: authedScope,
        submissions: leadsResult.submissions,
        approvals: approvalsResult.submissions,
        note
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
