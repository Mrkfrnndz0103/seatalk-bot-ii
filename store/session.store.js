class SessionStore {
  constructor(options = {}) {
    const ttlMs = Number(options.ttlMs);
    const maxItems = Number(options.maxItems);
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 30 * 60 * 1000;
    this.maxItems = Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 500;
    this.sessions = new Map();
  }

  get(key) {
    if (!key) {
      return null;
    }
    const entry = this.sessions.get(key);
    if (!entry) {
      return null;
    }
    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.sessions.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    if (!key) {
      return null;
    }
    const now = Date.now();
    const entry = {
      data: data || {},
      updatedAt: now,
      expiresAt: now + this.ttlMs
    };
    this.sessions.set(key, entry);
    this.prune();
    return entry.data;
  }

  update(key, patch) {
    if (!key) {
      return null;
    }
    const current = this.get(key) || {};
    const next = { ...current, ...(patch || {}) };
    return this.set(key, next);
  }

  delete(key) {
    if (key) {
      this.sessions.delete(key);
    }
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.sessions.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }

    if (this.sessions.size <= this.maxItems) {
      return;
    }

    const sorted = Array.from(this.sessions.entries()).sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt
    );
    const overflow = this.sessions.size - this.maxItems;
    for (let i = 0; i < overflow; i += 1) {
      this.sessions.delete(sorted[i][0]);
    }
  }
}

module.exports = {
  SessionStore
};
