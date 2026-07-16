const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = 'Ruby FoodHub <noreply@rubyfoodhub.com>';
const AUDIENCE_NAME = 'Ruby FoodHub Subscribers';

// Cached per warm serverless instance only — a cold start just re-derives it
// via list-or-create, which is cheap and idempotent.
let cachedAudienceId = null;

async function getOrCreateAudienceId() {
  if (cachedAudienceId) return cachedAudienceId;

  const { data: list, error: listError } = await resend.audiences.list();
  if (listError) throw new Error(listError.message || 'Failed to list Resend audiences');

  const existing = (list?.data || []).find((a) => a.name === AUDIENCE_NAME);
  if (existing) {
    cachedAudienceId = existing.id;
    return cachedAudienceId;
  }

  const { data: created, error: createError } = await resend.audiences.create({ name: AUDIENCE_NAME });
  if (createError) throw new Error(createError.message || 'Failed to create Resend audience');

  cachedAudienceId = created.id;
  return cachedAudienceId;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = { resend, getOrCreateAudienceId, isValidEmail, FROM_ADDRESS };
