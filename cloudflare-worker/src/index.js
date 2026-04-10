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

function toSafeString(value) {
  return typeof value === 'string' ? value : '';
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function makeSnippet(text = '', html = '') {
  const source = toSafeString(text).trim() || stripHtml(html);
  return source.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function extractOtpCode(subject = '', text = '', html = '') {
  const combined = [subject, text, stripHtml(html)].filter(Boolean).join('\n');
  const patterns = [
    /\b(\d{6})\b/,
    /\b(\d{5})\b/,
    /\b(\d{4})\b/,
    /\b([A-Z0-9]{6,8})\b/
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) return match[1];
  }
  return '';
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function headerValue(headers, name) {
  try {
    return headers.get(name) || '';
  } catch {
    return '';
  }
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
    SELECT id AS email_id,
           recipient,
           sender,
           sender_name,
           subject,
           snippet,
           otp_code,
           body_text,
           body_html,
           received_at,
           is_read
    FROM emails
    WHERE recipient = ?1
    ORDER BY received_at DESC
  `).bind(recipient).all();
  return result.results || [];
}

async function getEmail(recipient, id, env) {
  const email = await env.DB.prepare(`
    SELECT id AS email_id,
           recipient,
           sender,
           sender_name,
           subject,
           snippet,
           otp_code,
           body_text,
           body_html,
           received_at,
           is_read
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

async function storeIncomingEmail(message, env) {
  const recipient = normalizeEmailAddress(message.to);
  if (!isAllowedEmail(recipient, env)) {
    message.setReject('Mailbox not allowed for this domain.');
    return { stored: false, reason: 'not_allowed' };
  }

  const parsed = await parseIncomingEmail(message);
  await ensureCapacity(recipient, env);

  const subject = toSafeString(parsed.subject || headerValue(message.headers, 'subject')).trim();
  const bodyText = toSafeString(parsed.text).trim();
  const bodyHtml = toSafeString(parsed.html).trim();
  const sender = normalizeEmailAddress(parsed.from?.address || message.from || headerValue(message.headers, 'reply-to'));
  const senderName = toSafeString(parsed.from?.name || '').trim();
  const receivedAt = new Date().toISOString();
  const rawHeaders = JSON.stringify(Object.fromEntries(message.headers));
  const snippet = makeSnippet(bodyText, bodyHtml);
  const otpCode = extractOtpCode(subject, bodyText, bodyHtml);
  const upstreamMessageId = headerValue(message.headers, 'message-id').trim();
  const dedupeHash = await sha256Hex([
    recipient,
    sender,
    upstreamMessageId,
    subject,
    snippet,
    bodyText.slice(0, 400),
    bodyHtml.slice(0, 400)
  ].join('|'));

  const existing = await env.DB.prepare(
    'SELECT id FROM emails WHERE dedupe_hash = ?1 LIMIT 1'
  ).bind(dedupeHash).first();

  if (existing?.id) {
    return { stored: false, reason: 'duplicate', id: existing.id };
  }

  const emailId = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO emails (
      id, recipient, sender, sender_name, subject, snippet, otp_code,
      body_text, body_html, received_at, is_read, raw_headers,
      upstream_message_id, dedupe_hash
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?11, ?12, ?13)
  `).bind(
    emailId,
    recipient,
    sender,
    senderName,
    subject,
    snippet,
    otpCode,
    bodyText,
    bodyHtml,
    receivedAt,
    rawHeaders,
    upstreamMessageId,
    dedupeHash
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

  return { stored: true, id: emailId };
}

export default {
  async email(message, env, ctx) {
    try {
      const result = await storeIncomingEmail(message, env);
      console.log('incoming_email', JSON.stringify({
        to: normalizeEmailAddress(message.to),
        from: normalizeEmailAddress(message.from),
        result
      }));
    } catch (error) {
      console.error('email_handler_failed', error?.stack || String(error));
      throw error;
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
