const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = 'Ruby FoodHub <noreply@rubyfoodhub.com>';
const SUBSCRIBERS_AUDIENCE = 'Ruby FoodHub Subscribers';
const CUSTOMERS_AUDIENCE = 'Ruby FoodHub Customers';

// Cached per warm serverless instance only — a cold start just re-derives it
// via list-or-create, which is cheap and idempotent.
const cachedAudienceIds = new Map();

async function getOrCreateAudienceIdByName(name) {
  if (cachedAudienceIds.has(name)) return cachedAudienceIds.get(name);

  const { data: list, error: listError } = await resend.audiences.list();
  if (listError) throw new Error(listError.message || 'Failed to list Resend audiences');

  const existing = (list?.data || []).find((a) => a.name === name);
  if (existing) {
    cachedAudienceIds.set(name, existing.id);
    return existing.id;
  }

  const { data: created, error: createError } = await resend.audiences.create({ name });
  if (createError) throw new Error(createError.message || 'Failed to create Resend audience');

  cachedAudienceIds.set(name, created.id);
  return created.id;
}

// Kept for the newsletter signup endpoint.
async function getOrCreateAudienceId() {
  return getOrCreateAudienceIdByName(SUBSCRIBERS_AUDIENCE);
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  resend,
  getOrCreateAudienceId,
  getOrCreateAudienceIdByName,
  isValidEmail,
  FROM_ADDRESS,
  SUBSCRIBERS_AUDIENCE,
  CUSTOMERS_AUDIENCE,
};
