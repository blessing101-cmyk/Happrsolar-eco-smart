// LINE webhook — links a customer's phone number to their LINE userId so staff
// can message them back later via line-reply.js.
//
// How it works for the customer:
//   1. Customer adds the HAPPYSOLAR LINE OA as a friend.
//   2. Customer sends any message containing their phone number (e.g. "0812345678"
//      or "081-234-5678") to the OA chat.
//   3. This webhook extracts the digits, normalizes to a 10-digit Thai mobile
//      format, and saves { phone -> userId } in Netlify Blobs.
//   4. The bot replies confirming the link, so the customer knows it worked.
//
// If the message doesn't contain a recognizable phone number, the bot replies
// asking them to send their phone number.
//
// Staff never need to touch this file directly — sending messages back to a
// linked customer is done through line-reply.js from the admin dashboard.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'happysolar-line-links';
const KEY = 'links'; // { [normalizedPhone]: { userId, linkedAt } }

function getLinksStore() {
  return getStore({ name: STORE_NAME, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN });
}

async function loadLinks() {
  const store = getLinksStore();
  const data = await store.get(KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

async function saveLinks(links) {
  const store = getLinksStore();
  await store.setJSON(KEY, links);
}

// Normalizes any Thai phone-like input to a bare 10-digit string starting with 0.
// Returns null if the text doesn't contain something that looks like a Thai mobile number.
function extractThaiPhone(text) {
  if (!text) return null;
  const digits = String(text).replace(/[^0-9]/g, '');
  // Common cases: "0812345678" (10), "66812345678" (11, country code without +)
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 11 && digits.startsWith('66')) return '0' + digits.slice(2);
  if (digits.length === 9) return '0' + digits; // someone typed without the leading 0
  return null;
}

async function replyText(token, replyToken, text) {
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
    });
  } catch (e) { /* non-critical */ }
}

exports.handler = async (event) => {
  try {
    const signature = event.headers['x-line-signature'] || event.headers['X-Line-Signature'];
    const secret = process.env.LINE_CHANNEL_SECRET;

    if (secret && signature) {
      const hash = crypto.createHmac('sha256', secret).update(event.body || '', 'utf8').digest('base64');
      if (hash !== signature) {
        return { statusCode: 401, body: 'Invalid signature' };
      }
    }

    const body = JSON.parse(event.body || '{}');
    const events = body.events || [];
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const links = await loadLinks();
    let changed = false;

    await Promise.all(events.map(async (e) => {
      if (e.type !== 'message' || e.message?.type !== 'text' || !e.replyToken) return;
      const userId = e.source && e.source.userId;
      if (!userId) return;

      const phone = extractThaiPhone(e.message.text);

      if (phone) {
        links[phone] = { userId, linkedAt: new Date().toISOString() };
        changed = true;
        await replyText(token, e.replyToken,
          '✅ เชื่อมต่อสำเร็จ! เจ้าหน้าที่ HAPPYSOLAR จะสามารถทักแชทกลับหาคุณผ่านเบอร์ ' + phone + ' ได้แล้วครับ');
      } else {
        await replyText(token, e.replyToken,
          'สวัสดีครับ 🙏 กรุณาพิมพ์เบอร์โทรศัพท์ที่ใช้ลงทะเบียนไว้ ส่งมาในแชทนี้ เพื่อให้เจ้าหน้าที่ HAPPYSOLAR สามารถทักกลับหาคุณทาง LINE ได้ครับ');
      }
    }));

    if (changed) await saveLinks(links);

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    return { statusCode: 200, body: 'OK' };
  }
};
