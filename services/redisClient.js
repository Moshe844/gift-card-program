const { createClient } = require("redis");

const memory = new Map();
let client = null;
let ready = false;

function getMemory(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

if (process.env.REDIS_URL) {
  client = createClient({ url: process.env.REDIS_URL });
  client.on("error", error => console.error("Redis error:", error.message));
  client.connect()
    .then(() => {
      ready = true;
      console.log("Redis connected");
    })
    .catch(error => console.error("Redis unavailable; using local lockout storage:", error.message));
}

module.exports = {
  async get(key) {
    return ready ? client.get(key) : getMemory(key);
  },
  async set(key, value) {
    if (ready) return client.set(key, String(value));
    memory.set(key, { value: String(value), expiresAt: null });
    return "OK";
  },
  async del(...keys) {
    if (ready) return client.del(keys);
    let deleted = 0;
    for (const key of keys) deleted += memory.delete(key) ? 1 : 0;
    return deleted;
  },
  async incr(key) {
    if (ready) return client.incr(key);
    const count = Number(getMemory(key) || 0) + 1;
    const expiresAt = memory.get(key)?.expiresAt || null;
    memory.set(key, { value: String(count), expiresAt });
    return count;
  },
  async expire(key, seconds) {
    if (ready) return client.expire(key, seconds);
    const value = getMemory(key);
    if (value === null) return 0;
    memory.set(key, { value, expiresAt: Date.now() + Number(seconds) * 1000 });
    return 1;
  }
};
