import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createMimeMessage } from 'npm:mimetext@3.0.24';

// SHARED Gmail connection — the app builder's account (platform OAuth)

function encodeRaw(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { email, full_name } = await req.json();
    if (!email) return Response.json({ error: 'Missing recipient email' }, { status: 400 });

    // Builder's shared Gmail connection (platform OAuth)
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");
    const senderAddr = 'no-reply@daraluloom.app';
    const name = full_name || 'صديقنا الكريم';
    const verifyUrl = 'https://daraluloom.base44.app/settings';

    const subject = 'مرحبًا بك في دار العلوم — أكمل تفعيل بريدك | Verify your email';

    const plain = [
      'السلام عليكم ورحمة الله وبركاته',
      '',
      `مرحبًا ${name} 🌙`,
      '',
      'شكرًا لتسجيلك في مكتبة دار العلوم الرقمية.',
      '',
      'لإكمال تفعيل حسابك والاستفادة من جميع المزايا (المفضلة، متابعة القراءة، والنسخ الاحتياطي السحابي)،',
      'يرجى تأكيد بريدك الإلكتروني من داخل التطبيق:',
      'الإعدادات ← الملف الشخصي ← تأكيد البريد الإلكتروني',
      '',
      verifyUrl,
      '',
      '---',
      '',
      'Welcome to Dar Al Uloom!',
      '',
      'Thank you for registering. To complete your account setup and unlock favorites,',
      'reading progress and cloud backup, please verify your email from within the app:',
      'Settings → Profile → Verify email',
      '',
      verifyUrl,
      '',
      'مع خالص التحية،',
      'فريق دار العلوم | Dar Al Uloom Team'
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:Tahoma,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e2d5;">
    <div style="background:linear-gradient(135deg,#1c5c46,#2e7d5b);padding:28px 24px;text-align:center;">
      <h1 style="color:#fdfaf2;margin:0;font-size:22px;">دار العلوم</h1>
      <p style="color:#cfe6d9;margin:6px 0 0;font-size:13px;">Dar Al Uloom — مكتبة إسلامية رقمية</p>
    </div>
    <div style="padding:28px 24px;color:#24312b;font-size:14px;line-height:2;">
      <p style="margin:0 0 12px;">السلام عليكم ورحمة الله وبركاته،</p>
      <p style="margin:0 0 12px;">مرحبًا <strong>${name}</strong> 🌙</p>
      <p style="margin:0 0 12px;">شكرًا لتسجيلك في مكتبة دار العلوم الرقمية. لإكمال تفعيل حسابك والاستفادة من جميع المزايا (المفضلة، متابعة القراءة، والنسخ الاحتياطي السحابي)، يرجى تأكيد بريدك الإلكتروني من داخل التطبيق:</p>
      <p style="margin:0 0 20px;color:#4a6357;font-size:13px;">الإعدادات ← الملف الشخصي ← تأكيد البريد الإلكتروني</p>
      <div style="text-align:center;">
        <a href="${verifyUrl}" style="display:inline-block;background:#1c5c46;color:#fdfaf2;text-decoration:none;padding:12px 32px;border-radius:4px 20px 4px 20px;font-weight:bold;font-size:14px;">فتح التطبيق وتفعيل البريد</a>
      </div>
      <hr style="border:none;border-top:1px solid #e8e2d5;margin:24px 0;" />
      <p dir="ltr" style="margin:0 0 8px;color:#4a6357;font-size:13px;line-height:1.7;text-align:left;">Welcome to Dar Al Uloom!<br/>Thank you for registering. Please verify your email from within the app: Settings → Profile → Verify email.</p>
      <p style="margin:8px 0 0;color:#7a8a82;font-size:12px;">مع خالص التحية، فريق دار العلوم</p>
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
    return Response.json({ sent: true, to: email });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}