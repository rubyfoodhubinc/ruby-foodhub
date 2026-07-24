const { applyCors } = require('./_lib/cors');
const { supabase } = require('./_lib/supabase');
const { requireSession, logAudit, blockViewerWrites } = require('./_lib/admin-auth');

const VIEWER_READ_ACTIONS = new Set(['sources', 'history', 'template-list']);
const {
  resend,
  getOrCreateAudienceIdByName,
  isValidEmail,
  FROM_ADDRESS,
  SUBSCRIBERS_AUDIENCE,
  CUSTOMERS_AUDIENCE,
} = require('./_lib/resend');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Appended to EVERY broadcast automatically — the composer can't forget it.
// {{{RESEND_UNSUBSCRIBE_URL}}} is Resend's per-recipient unsubscribe link;
// Resend records the click and excludes that contact from future broadcasts.
const BROADCAST_FOOTER = `
<hr style="border:none;border-top:1px solid #e5e0dc;margin:32px 0 16px">
<p style="font-size:12px;color:#8a837d;font-family:sans-serif;line-height:1.6">
  Ruby FoodHub Inc. · Texas, USA<br>
  You're receiving this because you subscribed to Ruby FoodHub updates or shopped with us.<br>
  <a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>
</p>`;

// Broadcasts-only variable doesn't work in one-off emails, so individual
// sends get a functional mailto opt-out instead (CAN-SPAM accepts this).
const INDIVIDUAL_FOOTER = `
<hr style="border:none;border-top:1px solid #e5e0dc;margin:32px 0 16px">
<p style="font-size:12px;color:#8a837d;font-family:sans-serif;line-height:1.6">
  Ruby FoodHub Inc. · Texas, USA<br>
  To stop receiving promotional emails, reply to this email with "unsubscribe" or write to
  <a href="mailto:sales@rubyfoodhub.com?subject=Unsubscribe">sales@rubyfoodhub.com</a>.
</p>`;

async function listContacts(audienceId) {
  const { data, error } = await resend.contacts.list({ audienceId });
  if (error) throw new Error(error.message || 'Failed to list contacts');
  return (data && data.data) || [];
}

async function subscribedCount(audienceId) {
  const contacts = await listContacts(audienceId);
  return contacts.filter((c) => !c.unsubscribed).length;
}

async function distinctCustomerEmails() {
  const { data, error } = await supabase.from('orders').select('email');
  if (error) throw new Error(JSON.stringify(error));
  const set = new Set();
  for (const row of data || []) {
    if (isValidEmail(row.email)) set.add(row.email.trim().toLowerCase());
  }
  return [...set];
}

// Add-only sync: creates contacts that aren't in the audience yet and never
// touches existing ones, so an unsubscribed customer stays unsubscribed.
// Throttled under Resend's 10 req/s team rate limit.
async function syncCustomersAudience() {
  const audienceId = await getOrCreateAudienceIdByName(CUSTOMERS_AUDIENCE);
  const existing = new Set((await listContacts(audienceId)).map((c) => String(c.email || '').toLowerCase()));
  const missing = (await distinctCustomerEmails()).filter((e) => !existing.has(e));

  for (let i = 0; i < missing.length; i++) {
    const { error } = await resend.contacts.create({ audienceId, email: missing[i] });
    if (error && !/already exists/i.test(error.message || '')) {
      console.error(`[campaigns] failed to add customer contact ${missing[i]}:`, error.message);
    }
    if ((i + 1) % 8 === 0) await sleep(1000);
  }
  return audienceId;
}

async function sendBroadcast(audienceId, subject, html, name) {
  const { data: created, error: createError } = await resend.broadcasts.create({
    audienceId,
    from: FROM_ADDRESS,
    subject,
    html: html + BROADCAST_FOOTER,
    name,
  });
  if (createError) throw new Error(createError.message || 'Failed to create broadcast');

  const { error: sendError } = await resend.broadcasts.send(created.id);
  if (sendError) throw new Error(sendError.message || 'Failed to send broadcast');
  return created.id;
}

async function handler(req, res) {
  // Native app (Capacitor) requests are cross-origin; answer preflight.
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action } = req.body || {};
  const actor = await requireSession(token);
  if (!actor) return res.status(401).json({ error: 'Session expired — please sign in again.' });
  if (blockViewerWrites(actor, res, action, VIEWER_READ_ACTIONS)) return;

  try {
    if (action === 'sources') {
      const subsId = await getOrCreateAudienceIdByName(SUBSCRIBERS_AUDIENCE);
      const [subscribers, customers] = await Promise.all([
        subscribedCount(subsId),
        distinctCustomerEmails().then((l) => l.length),
      ]);
      return res.status(200).json({ subscribers, customers });
    }

    if (action === 'send-individual') {
      const { email, subject, html } = req.body;
      if (!isValidEmail(email)) return res.status(400).json({ error: 'A valid recipient email is required.' });
      if (!String(subject || '').trim() || !String(html || '').trim()) {
        return res.status(400).json({ error: 'Subject and body are required.' });
      }

      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: email.trim(),
        subject: subject.trim(),
        html: html + INDIVIDUAL_FOOTER,
      });
      if (error) throw new Error(error.message || 'Send failed');

      await supabase.from('email_campaigns').insert({
        subject: subject.trim(), html, source: 'individual', recipient_count: 1, sent_by: actor.id,
      });
      await logAudit(actor.id, 'individual_email_sent', { to: email.trim(), subject: subject.trim() });
      return res.status(200).json({ success: true, sent: 1 });
    }

    if (action === 'send-campaign') {
      const { source, subject, html, manualEmails } = req.body;
      if (!String(subject || '').trim() || !String(html || '').trim()) {
        return res.status(400).json({ error: 'Subject and body are required.' });
      }
      if (!['subscribers', 'customers', 'both', 'manual'].includes(source)) {
        return res.status(400).json({ error: 'Unknown recipient source.' });
      }

      const targets = []; // { audienceId, label }

      if (source === 'subscribers' || source === 'both') {
        targets.push({ audienceId: await getOrCreateAudienceIdByName(SUBSCRIBERS_AUDIENCE), label: 'subscribers' });
      }
      if (source === 'customers' || source === 'both') {
        targets.push({ audienceId: await syncCustomersAudience(), label: 'customers' });
      }
      if (source === 'manual') {
        const emails = [...new Set(String(manualEmails || '')
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(isValidEmail))];
        if (!emails.length) return res.status(400).json({ error: 'No valid emails in the manual list.' });
        if (emails.length > 500) return res.status(400).json({ error: 'Manual lists are capped at 500 emails.' });

        const audienceName = `Manual — ${subject.trim().slice(0, 40)} — ${new Date().toISOString().slice(0, 16)}`;
        const { data: created, error: audErr } = await resend.audiences.create({ name: audienceName });
        if (audErr) throw new Error(audErr.message || 'Failed to create manual audience');
        for (let i = 0; i < emails.length; i++) {
          const { error } = await resend.contacts.create({ audienceId: created.id, email: emails[i] });
          if (error) console.error(`[campaigns] manual contact add failed ${emails[i]}:`, error.message);
          if ((i + 1) % 8 === 0) await sleep(1000);
        }
        targets.push({ audienceId: created.id, label: 'manual (' + emails.length + ')' });
      }

      const broadcastIds = [];
      let recipientCount = 0;
      for (const target of targets) {
        recipientCount += await subscribedCount(target.audienceId);
        const id = await sendBroadcast(
          target.audienceId,
          subject.trim(),
          html,
          `${subject.trim()} [${target.label}] ${new Date().toISOString().slice(0, 10)}`
        );
        broadcastIds.push(id);
      }

      await supabase.from('email_campaigns').insert({
        subject: subject.trim(), html, source, recipient_count: recipientCount,
        resend_broadcast_ids: broadcastIds, sent_by: actor.id,
      });
      await logAudit(actor.id, 'campaign_sent', {
        subject: subject.trim(), source, recipient_count: recipientCount, broadcast_ids: broadcastIds,
      });

      return res.status(200).json({ success: true, recipients: recipientCount, broadcasts: broadcastIds.length });
    }

    if (action === 'history') {
      const { data, error } = await supabase
        .from('email_campaigns')
        .select('id, subject, source, recipient_count, resend_broadcast_ids, created_at, admin_users(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ campaigns: data });
    }

    if (action === 'template-list') {
      const { data, error } = await supabase
        .from('email_templates')
        .select('id, name, subject, html, created_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ templates: data });
    }

    if (action === 'template-save') {
      const { name, subject, html } = req.body;
      if (!String(name || '').trim()) return res.status(400).json({ error: 'A template name is required.' });
      const { data, error } = await supabase
        .from('email_templates')
        .insert({ name: name.trim(), subject: subject || '', html: html || '', created_by: actor.id })
        .select('id, name')
        .single();
      if (error) throw new Error(JSON.stringify(error));
      await logAudit(actor.id, 'email_template_saved', { template_id: data.id, name: data.name });
      return res.status(200).json({ success: true, template: data });
    }

    if (action === 'template-delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Template id required.' });
      const { error } = await supabase.from('email_templates').delete().eq('id', id);
      if (error) throw new Error(JSON.stringify(error));
      return res.status(200).json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-campaigns error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// The throttled audience sync (8 contacts/sec) can exceed the default 10s
// function timeout on bigger customer lists.
handler.config = { maxDuration: 60 };

module.exports = handler;
