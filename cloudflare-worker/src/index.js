import PostalMime from 'postal-mime';

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    }
  });
}

function textResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' }
  });
}

function getAllowedDomains(env) {
  return String(env.ALLOWED_DOMAINS || 'pakasir.dev')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function getCorsOrigin(env) {
  return env.CORS_ORIGIN || '*';
}

function randomLocalPart(length = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i += 1) {
    value += chars[bytes[i] % chars.length];
  }
  return value;
}

function normalizeEmailAddress(input) {
  return String(input || '').trim().toLowerCase();
}

function isAllowedEmail(email, env) {
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1);
  return getAllowedDomains(env).includes(domain);
}

async function ensureCapacity(recipient, env) {
  const maxEmails = Number(env.MAX_EMAILS_PER_ADDRESS || 50);
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM emails WHERE recipient = ?1'
  ).bind(recipient).first();

  const count = Number(countRow?.count || 0);
  if (count < maxEmails) return;

  const overBy = count - maxEmails + 1;
  const oldestRows = await env.DB.prepare(
    'SELECT id FROM emails WHERE recipient = ?1 ORDER BY received_at ASC LIMIT ?2'
  ).bind(recipient, overBy).all();

  for (const row of oldestRows.results || []) {
    await deleteEmailById(row.id, env);
  }
}

async function deleteEmailById(id, env) {
  await env.DB.prepare('DELETE FROM attachments WHERE email_id = ?1').bind(id).run();
  await env.DB.prepare('DELETE FROM emails WHERE id = ?1').bind(id).run();
}

async function listEmails(recipient, env) {
  const result = await env.DB.prepare(`
    SELECT id AS email_id, recipient, sender, subject, body_text, body_html, received_at, is_read
    FROM emails
    WHERE recipient = ?1
    ORDER BY received_at DESC
  `).bind(recipient).all();
  return result.results || [];
}

async function getEmail(recipient, id, env) {
  const email = await env.DB.prepare(`
    SELECT id AS email_id, recipient, sender, subject, body_text, body_html, received_at, is_read
    FROM emails
    WHERE recipient = ?1 AND id = ?2
    LIMIT 1
  `).bind(recipient, id).first();

  if (!email) return null;

  const attachments = await env.DB.prepare(`
    SELECT id, filename, content_type, size
    FROM attachments
    WHERE email_id = ?1
    ORDER BY filename ASC
  `).bind(id).all();

  await env.DB.prepare('UPDATE emails SET is_read = 1 WHERE id = ?1').bind(id).run();
  email.is_read = 1;
  email.attachments = attachments.results || [];
  return email;
}

async function getStats(recipient, env) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total_emails,
           SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_emails
    FROM emails
    WHERE recipient = ?1
  `).bind(recipient).first();

  return {
    total_emails: Number(row?.total_emails || 0),
    unread_emails: Number(row?.unread_emails || 0)
  };
}

async function cleanupExpired(env) {
  const expirationHours = Number(env.EMAIL_EXPIRATION_HOURS || 24);
  const cutoff = new Date(Date.now() - expirationHours * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare('SELECT id FROM emails WHERE received_at < ?1').bind(cutoff).all();
  for (const row of rows.results || []) {
    await deleteEmailById(row.id, env);
  }
  return (rows.results || []).length;
}

async function parseIncomingEmail(message) {
  const parser = new PostalMime();
  const parsed = await parser.parse(await new Response(message.raw).arrayBuffer());
  return parsed;
}

export default {
  async email(message, env, ctx) {
    const recipient = normalizeEmailAddress(message.to);
    if (!isAllowedEmail(recipient, env)) {
      message.setReject('Mailbox not allowed for this domain.');
      return;
    }

    const parsed = await parseIncomingEmail(message);
    await ensureCapacity(recipient, env);

    const emailId = crypto.randomUUID();
    const subject = parsed.subject || message.headers.get('subject') || '';
    const bodyText = parsed.text || '';
    const bodyHtml = parsed.html || '';
    const sender = parsed.from?.address || message.from || '';
    const receivedAt = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO emails (id, recipient, sender, subject, body_text, body_html, received_at, is_read, raw_headers)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)
    `).bind(
      emailId,
      recipient,
      sender,
      subject,
      bodyText,
      bodyHtml,
      receivedAt,
      JSON.stringify(Object.fromEntries(message.headers))
    ).run();

    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
    for (const attachment of attachments) {
      await env.DB.prepare(`
        INSERT INTO attachments (id, email_id, filename, content_type, size)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(
        crypto.randomUUID(),
        emailId,
        attachment.filename || 'attachment',
        attachment.mimeType || 'application/octet-stream',
        Number(attachment.content?.byteLength || attachment.size || 0)
      ).run();
    }
  },

  async fetch(request, env, ctx) {
    const origin = getCorsOrigin(env);
    if (request.method === 'OPTIONS') {
      return json({ ok: true }, 200, origin);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/health') {
      return textResponse('ok');
    }

    if (path === '/api/domains' && request.method === 'GET') {
      return json({ success: true, domains: getAllowedDomains(env) }, 200, origin);
    }

    if (path === '/api/email/generate' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const domain = String(body.domain || '').trim().toLowerCase();
      if (!getAllowedDomains(env).includes(domain)) {
        return json({ success: false, error: 'Invalid domain' }, 400, origin);
      }

      const email = `${randomLocalPart(12)}@${domain}`;
      const expiresAt = new Date(Date.now() + Number(env.EMAIL_EXPIRATION_HOURS || 24) * 60 * 60 * 1000).toISOString();
      return json({ success: true, email, expires_at: expiresAt }, 200, origin);
    }

    const emailsMatch = path.match(/^\/api\/emails\/(.+)$/);
    if (emailsMatch && request.method === 'GET') {
      const recipient = normalizeEmailAddress(decodeURIComponent(emailsMatch[1]));
      if (!isAllowedEmail(recipient, env)) {
        return json({ success: false, error: 'Invalid email address' }, 400, origin);
      }
      const emails = await listEmails(recipient, env);
      return json({ success: true, emails }, 200, origin);
    }

    const emailDetailMatch = path.match(/^\/api\/email\/([^/]+)\/([^/]+)$/);
    if (emailDetailMatch && request.method === 'GET') {
      const recipient = normalizeEmailAddress(decodeURIComponent(emailDetailMatch[1]));
      const id = decodeURIComponent(emailDetailMatch[2]);
      if (!isAllowedEmail(recipient, env)) {
        return json({ success: false, error: 'Invalid email address' }, 400, origin);
      }
      const email = await getEmail(recipient, id, env);
      if (!email) {
        return json({ success: false, error: 'Email not found' }, 404, origin);
      }
      return json({ success: true, email }, 200, origin);
    }

    if (emailDetailMatch && request.method === 'DELETE') {
      const recipient = normalizeEmailAddress(decodeURIComponent(emailDetailMatch[1]));
      const id = decodeURIComponent(emailDetailMatch[2]);
      if (!isAllowedEmail(recipient, env)) {
        return json({ success: false, error: 'Invalid email address' }, 400, origin);
      }
      const email = await getEmail(recipient, id, env);
      if (!email) {
        return json({ success: false, error: 'Email not found' }, 404, origin);
      }
      await deleteEmailById(id, env);
      return json({ success: true }, 200, origin);
    }

    const statsMatch = path.match(/^\/api\/stats\/(.+)$/);
    if (statsMatch && request.method === 'GET') {
      const recipient = normalizeEmailAddress(decodeURIComponent(statsMatch[1]));
      if (!isAllowedEmail(recipient, env)) {
        return json({ success: false, error: 'Invalid email address' }, 400, origin);
      }
      const stats = await getStats(recipient, env);
      return json({ success: true, stats }, 200, origin);
    }

    return json({ success: false, error: 'Not found' }, 404, origin);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupExpired(env));
  }
};
