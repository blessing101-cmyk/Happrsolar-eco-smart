// TEMPORARY HELPER FUNCTION
// Purpose: find your own LINE User ID (a one-time setup step).
// How to use:
//   1. Deploy this file to your site.
//   2. In manager.line.biz -> Messaging API, paste this function's URL into
//      "Webhook URL" and click Save, then enable "Use webhook".
//   3. From your phone, open your OA in LINE and send it any message (e.g. "hi").
//   4. The bot will reply with your LINE User ID. Copy it and send it back
//      to Claude so it can be saved as the notification target.
// You can delete this file after you have your User ID.

const crypto = require('crypto');

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

    await Promise.all(events.map(async (e) => {
      if (e.type === 'message' && e.replyToken) {
        const userId = (e.source && e.source.userId) ? e.source.userId : 'ไม่พบ userId (โปรดลองอีกครั้ง)';
        await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({
            replyToken: e.replyToken,
            messages: [{ type: 'text', text: 'User ID ของคุณคือ:\n' + userId + '\n\nคัดลอกแล้วส่งให้ Claude เพื่อตั้งค่าต่อได้เลย' }],
          }),
        });
      }
    }));

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    return { statusCode: 200, body: 'OK' };
  }
};
