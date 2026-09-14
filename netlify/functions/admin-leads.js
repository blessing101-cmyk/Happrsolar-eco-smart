// Admin-only endpoint: fetches "happysolar50k" (leads) and "happysolar50k_approvals"
// form submissions via the Netlify API. Requires NETLIFY_API_TOKEN + NETLIFY_SITE_ID +
// ADMIN_PASSWORD to be set as environment variables on this site.

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

exports.handler = async (event) => {
  try {
    const givenPassword = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
    const expectedPassword = process.env.ADMIN_PASSWORD;

    if (!expectedPassword) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD not configured' }) };
    }
    if (!givenPassword || givenPassword !== expectedPassword) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    const apiToken = process.env.NETLIFY_API_TOKEN;
    const siteId = process.env.NETLIFY_SITE_ID;
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
        submissions: leadsResult.submissions,
        approvals: approvalsResult.submissions,
        note
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
