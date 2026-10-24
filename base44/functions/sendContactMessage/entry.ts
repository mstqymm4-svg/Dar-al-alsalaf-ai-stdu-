import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createMimeMessage } from 'npm:mimetext@3.0.24';

function encodeRaw(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const { name, email, message } = await req.json();

    if (!name || !email || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return Response.json({ error: 'Invalid input' }, { status: 400 });
    }

    // Recipient comes from app settings (server-side) — never from the client
    const rows = await base44.asServiceRole.entities.AppSettings.filter({ setting_key: 'contact_email' });
    let to = rows[0]?.setting_value;
    if (!to) {
      // Fallback: the app's admin
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      to = admins[0]?.email;
    }
    if (!to) return Response.json({ error: 'Contact email not configured' }, { status: 500 });

    const safeName = String(name).slice(0, 100);
    const body =
      `رسالة جديدة من صفحة «تواصل معنا»\n\n` +
      `الاسم: ${safeName}\n` +
      `البريد الإلكتروني: ${email}\n\n` +
      `الرسالة:\n${String(message).slice(0, 5000)}`;

    // Send via the Dar Al Uloom Gmail connection (builder's shared account)
    const { accessToken } = await base44.asServiceRole.connectors.getConnection("gmail");

    const msg = createMimeMessage();
    msg.setSender({ addr: 'no-reply@daraluloom.app', name: 'دار العلوم — تواصل معنا' });
    msg.setRecipient(to);
    msg.setSubject(`تواصل معنا — ${safeName}`);
    msg.addMessage({ contentType: 'text/plain', data: body });

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encodeRaw(msg.asRaw()) }),
    });
    if (!res.ok) {
      return Response.json({ error: `Gmail send failed (${res.status})` }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}