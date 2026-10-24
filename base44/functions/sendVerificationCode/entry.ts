import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createMimeMessage } from 'npm:mimetext@3.0.24';

// Sends the email-verification code via the app's shared Gmail connection.
// Generates the code server-side and returns it so the app can verify it.

function encodeRaw(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { email } = await req.json();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ error: 'Invalid recipient email' }, { status: 400 });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");
    const senderAddr = 'no-reply@daraluloom.app';

    const subject = 'رمز التحقق — دار العلوم | Verification code';

    const plain = [
      'السلام عليكم ورحمة الله وبركاته',
      '',
      'رمز التحقق الخاص بك هو:',
      '',
      code,
      '',
      'الرمز صالح لمدة 10 دقائق. لا تشاركه مع أحد.',
      '',
      '---',
      '',
      'Your verification code is: ' + code,
      'Valid for 10 minutes. Do not share it with anyone.',
      '',
      'دار العلوم | Dar Al Uloom'
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:Tahoma,Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e2d5;">
    <div style="background:linear-gradient(135deg,#1c5c46,#2e7d5b);padding:24px;text-align:center;">
      <h1 style="color:#fdfaf2;margin:0;font-size:20px;">دار العلوم</h1>
      <p style="color:#cfe6d9;margin:6px 0 0;font-size:13px;">رمز التحقق</p>
    </div>
    <div style="padding:28px 24px;color:#24312b;font-size:14px;line-height:2;text-align:center;">
      <p style="margin:0 0 16px;">رمز التحقق الخاص بك هو:</p>
      <div dir="ltr" style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#1c5c46;background:#f7f5f0;border:1px solid #e8e2d5;border-radius:8px;padding:14px 0;margin:0 0 16px;">${code}</div>
      <p style="margin:0 0 8px;color:#4a6357;font-size:13px;">الرمز صالح لمدة 10 دقائق، ولا تشاركه مع أحد.</p>
      <p dir="ltr" style="margin:16px 0 0;color:#7a8a82;font-size:12px;">Your code is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
  </div>
</body>
</html>`;

    const msg = createMimeMessage();
    msg.setSender({ addr: senderAddr, name: 'دار العلوم | Dar Al Uloom' });
    msg.setRecipient(email);
    msg.setSubject(subject);
    msg.addMessage({ contentType: 'text/plain', data: plain });
    msg.addMessage({ contentType: 'text/html', data: html });

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encodeRaw(msg.asRaw()) }),
    });

    if (!res.ok) {
      const details = await res.text().catch(() => '');
      return Response.json({ error: `Gmail send failed (${res.status})`, details }, { status: 502 });
    }
    return Response.json({ sent: true, to: email, code });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}