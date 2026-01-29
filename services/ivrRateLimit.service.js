const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CALLS = 5;

const callMap = new Map();

function isRateLimited(phone) {
  const now = Date.now();
  const record = callMap.get(phone);

  if (!record) {
    callMap.set(phone, { count: 1, start: now });
    return false;
  }

  // Reset window
  if (now - record.start > WINDOW_MS) {
    callMap.set(phone, { count: 1, start: now });
    return false;
  }

  record.count += 1;

  return record.count > MAX_CALLS;
}

module.exports = { isRateLimited };
