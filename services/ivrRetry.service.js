const ivrRetries = new Map();

const MAX_PHONE_RETRIES = 3;
const MAX_SECURITY_RETRIES = 2;

function getRetry(callSid, type) {
  return ivrRetries.get(`${callSid}:${type}`) || 0;
}

function incrementRetry(callSid, type) {
  const key = `${callSid}:${type}`;
  const count = getRetry(callSid, type) + 1;
  ivrRetries.set(key, count);
  return count;
}

function clearRetries(callSid) {
  for (const key of ivrRetries.keys()) {
    if (key.startsWith(callSid)) ivrRetries.delete(key);
  }
}

module.exports = {
  getRetry,
  incrementRetry,
  clearRetries,
  MAX_PHONE_RETRIES,
  MAX_SECURITY_RETRIES
};
