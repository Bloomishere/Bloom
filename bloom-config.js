// ═══════════════════════════════════════════════════════════════════
// bloom-config.js — Shared configuration for Bloom web app + agent
// ═══════════════════════════════════════════════════════════════════
//
// The web app loads this via <script src="bloom-config.js"> in index.html.
// The Telegram bot imports it via require('./bloom-config.js').
//
// Keep this file out of version control if it contains real credentials.
// Add bloom-config.js to your .gitignore.
// ═══════════════════════════════════════════════════════════════════

const BLOOM_CONFIG = {

  // ── Google OAuth (web app) ──────────────────────────────────────
  // Get this from: console.cloud.google.com → APIs & Services → Credentials
  // Authorised JavaScript origins must include your GitHub Pages URL.
  clientId: '314590113960-c2grnm8ar3e88fi3d0ab6eglmrd9qt9o.apps.googleusercontent.com',

  // ── Google Sheets (web app + bot) ──────────────────────────────
  // The name Bloom uses when creating the spreadsheet in Google Drive.
  // Change this if you want a different spreadsheet name.
  sheetTitle: 'Bloom Data',

  // ── Dashboard windows (web app) ────────────────────────────────
  taskWindowDays: 14,   // "upcoming tasks" look-ahead in days
  examWindowDays: 30,   // "upcoming exams" look-ahead in days

  // Your bot's Telegram username WITHOUT the @ symbol.
  // Used by the web app to generate the one-tap connect link.
  // e.g. if your bot is @BloomStudyBot → 'BloomStudyBot'
  telegramBotUsername: 'Bloomasstbot',

  // Allowed Telegram user IDs (integers).
  // Find your own ID by messaging @userinfobot on Telegram.
  // The bot will silently ignore messages from anyone not on this list.
  // Example: telegramWhitelist: [123456789, 987654321]
  telegramWhitelist: [1191093029],

  // ── Agent / Google Sheets API (bot) ────────────────────────────
  // The bot uses a Google Service Account (not OAuth) so it can write
  // to sheets without a browser login flow.
  //
  // How to create a service account:
  //   1. console.cloud.google.com → IAM & Admin → Service Accounts → Create
  //   2. Grant it no project roles (it only needs Sheet-level access)
  //   3. Create a JSON key → download
  //   4. Share each user's Bloom spreadsheet with the service account email
  //      (Editor access)
  //   5. Paste the JSON key contents as a string below, or set the
  //      environment variable GOOGLE_SERVICE_ACCOUNT_JSON on your server.
  //
  // Leave as null if you have not set up the bot yet.
  googleServiceAccountJson: null,

  // ── Anthropic API (bot) ─────────────────────────────────────────
  // Get this from: console.anthropic.com → API Keys
  // Set via environment variable ANTHROPIC_API_KEY on your server
  // rather than hardcoding it here.
  anthropicApiKey: (typeof process !== 'undefined' && process.env?.ANTHROPIC_API_KEY) || 'YOUR_ANTHROPIC_API_KEY',

};

// Export for Node.js (bot) — ignored by browsers
if (typeof module !== 'undefined') module.exports = { BLOOM_CONFIG };
