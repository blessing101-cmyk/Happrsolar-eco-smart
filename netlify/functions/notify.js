// Receives the signup form data from the game and pushes it straight to
// HAPPYSOLAR's LINE automatically -- the customer never has to send anything.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const formSecret = process.env.FORM_SHARED_SECRET;
    const givenSecret = event.headers['x-form-secret'] || event.headers['X-Form-Secret'];
    if (formSecret && givenSecret !== formSecret) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'unauthorized' }) };
    }

    const data = JSON.parse(event.body || '{}');
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const targetUserId = process.env.LINE_TARGET_USER_ID;

    if (!token || !targetUserId) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing server config' }) };
    }

    const lines = [
      '🔔 มีลูกค้าลงทะเบียนใหม่ผ่านเกม HAPPYSOLAR ECO SMART',
      'ชื่อ: ' + (data.name || '-'),
      'เบอร์โทร: ' + (data.phone || '-'),
      'ประเภท: ' + (data.type || '-'),
    ];
    if (data.province) lines.push('จังหวัด: ' + data.province);
    if (data.monthlyKwh) lines.push('ใช้ไฟประมาณ: ' + data.monthlyKwh + ' หน่วย/เดือน');
    if (data.recKw) lines.push('ขนาดระบบที่แนะนำ: ~' + data.recKw + ' kW');
    if (data.estSavings) lines.push('ประหยัดได้ประมาณ: ~' + data.estSavings + ' บาท/เดือน');

    const resp = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        to: targetUserId,
        messages: [{ type: 'text', text: lines.join('\n') }],
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
