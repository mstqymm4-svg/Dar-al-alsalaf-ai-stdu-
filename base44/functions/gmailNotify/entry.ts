import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createMimeMessage } from 'npm:mimetext@3.0.24';

const CONNECTOR_ID = "6a9f8551f9be8820e93e9e05";

function encodeRaw(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action, subject, body, recipients } = await req.json();

    // Throws when the app user has not connected their Gmail account yet
    const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);

    if (action === 'status') {
      return Response.json({ connected: true });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let to = recipients;
    if (!to || to.length === 0) {
      const users = await base44.asServiceRole.entities.User.list();
      to = users.map((u) => u.email).filter(Boolean);
    }

    const results = [];
    for (const address of to) {
      const msg = createMimeMessage();
      msg.setSender({ addr: user.email, name: user.full_name || 'Dar Al Uloom' });
      msg.setRecipient(address);
      msg.setSubject(subject || 'تحديث جديد في المكتبة');
      msg.addMessage({ contentType: 'text/plain; charset=UTF-8', data: body || '' });

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodeRaw(msg.asRaw()) }),
      });
      results.push({ address, ok: res.ok });
    }

    return Response.json({ sent: results.filter((r) => r.ok).length, total: results.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}