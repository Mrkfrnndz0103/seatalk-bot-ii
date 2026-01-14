// instrument.js
const Sentry = require("@sentry/node");

// Initialize dotenv first in case SENTRY_DSN is in .env locally
require("dotenv").config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,                  // Sentry DSN
  release: process.env.SENTRY_RELEASE,          // Git SHA from Vercel
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 1.0, // performance monitoring
});

console.log("Sentry initialized ✅");
