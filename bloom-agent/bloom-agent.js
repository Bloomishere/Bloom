// ═══════════════════════════════════════════════════════════════════
// bloom-agent.js — Bloom Telegram Bot (Phase 1)
// ═══════════════════════════════════════════════════════════════════
//
// WHO THIS IS FOR
// ───────────────
// Parents of Primary school children (P1–P6, roughly ages 7–12).
// At this age, children do not yet have their own phones, so the
// parent is the appropriate user of this bot. The bot helps the
// parent capture the schedule effortlessly — the Bloom web app and
// the weekly digest then help the parent guide, not administer.
//
// When children reach Secondary school and have their own devices,
// a child-facing interface becomes appropriate (Phase 3). This bot
// should not be extended in that direction until then.
//
// WHAT THIS DOES
// ──────────────
// • Accepts free-text messages from whitelisted parents
// • Parses intent with Claude → writes to the family's Bloom Sheet
// • Confirms with progress-aware messages (not data-entry receipts)
// • /week generates an on-demand progress narrative per child
//
// WHAT IT DOES NOT DO (Phase 2+)
// ──────────────────────────────
// • Scheduled Sunday digest (Phase 2 — add a cron job using /week)
// • Voice note transcription (Phase 2 — add Whisper API call)
// • Email parsing (Phase 3)
// • Child-facing interface (Phase 3)
//
// DEPENDENCIES  (npm install)
// ───────────────────────────
//   node-telegram-bot-api   Telegram long-polling
//   @anthropic-ai/sdk       Claude API
//   googleapis              Google Sheets + Drive API
//   dotenv                  load .env in development
//
// ENVIRONMENT VARIABLES
// ──────────────────────
//   TELEGRAM_BOT_TOKEN          from @BotFather on Telegram
//   ANTHROPIC_API_KEY           from console.anthropic.com
//   GOOGLE_SERVICE_ACCOUNT_JSON full JSON string of service account key
//   BLOOM_WHITELIST             comma-separated Telegram user IDs
//   NODE_ENV                    set to "development" for verbose errors
// ═══════════════════════════════════════════════════════════════════

'use strict';

// Load .env before anything else.
// dotenv looks for .env in process.cwd() — the folder you run npm from.
// If your terminal is not inside the bloom-agent folder, this silently
// does nothing and all env vars will be missing.
const dotenvResult = require('dotenv').config();

// ── Startup diagnostic ────────────────────────────────────────────
// Printed every time the bot starts. Shows exactly what was loaded
// and where it looked. Helps diagnose missing-variable errors fast.
console.log('\n── Bloom Agent startup ─────────────────────────────');
console.log('Working directory :', process.cwd());
if (dotenvResult.error) {
  console.log('.env file         : NOT FOUND —', dotenvResult.error.message);
  console.log('                    Make sure .env is in the same folder as bloom-agent.js');
  console.log('                    and that you ran npm run dev from inside that folder.');
} else {
  console.log('.env file         : loaded ✓');
}
const _check = (label, val) =>
  console.log(label.padEnd(28), val ? '✓ set' : '✗ MISSING');
_check('TELEGRAM_BOT_TOKEN',          process.env.TELEGRAM_BOT_TOKEN);
_check('ANTHROPIC_API_KEY',           process.env.ANTHROPIC_API_KEY);
_check('BLOOM_WHITELIST',             process.env.BLOOM_WHITELIST);
_check('GOOGLE_APPLICATION_CREDENTIALS', process.env.GOOGLE_APPLICATION_CREDENTIALS);
_check('GOOGLE_SERVICE_ACCOUNT_JSON', process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
console.log('────────────────────────────────────────────────────\n');

const TelegramBot = require('node-telegram-bot-api');
const Anthropic   = require('@anthropic-ai/sdk');
const { google }  = require('googleapis');
const {
  buildSystemPrompt,
  buildDigestPrompt,
  buildConfirmation,
  buildRevisionOffer,
  buildWeekData,
} = require('./bloom-agent-prompts');


// ═══════════════════════════════════════════════════════════════════
// 1. CONFIG
// ═══════════════════════════════════════════════════════════════════

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const WHITELIST     = (process.env.BLOOM_WHITELIST || '')
  .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0);

if (!BOT_TOKEN)     throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!ANTHROPIC_KEY) throw new Error('Missing ANTHROPIC_API_KEY');

// Must match sheetTitle in bloom-config.js
const SHEET_TITLE = 'Bloom Data';

// Must exactly match SHEET_HEADERS in bloom-app.js
const SHEET_HEADERS = {
  tasks:  ['id', 'childId', 'title', 'subject', 'priority', 'due', 'notes', 'done', 'isRevision'],
  events: ['id', 'childId', 'title', 'date', 'category', 'subject', 'notes'],
};


// ═══════════════════════════════════════════════════════════════════
// 2. CLIENTS
// ═══════════════════════════════════════════════════════════════════

const bot       = new TelegramBot(BOT_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });


// ═══════════════════════════════════════════════════════════════════
// 3. GOOGLE AUTH (Service Account)
// ═══════════════════════════════════════════════════════════════════
// Uses a service account — not OAuth — so the bot runs headlessly
// without a browser login flow. Each user's Bloom Sheet must be
// shared with the service account email (Editor access).

function getGoogleAuth() {
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly',
  ];

  // ── Option A: point to the key file directly (easiest on Windows locally)
  // Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
  // in your .env file. The Google SDK picks it up automatically.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({ scopes: SCOPES });
  }

  // ── Option B: paste the full JSON string into GOOGLE_SERVICE_ACCOUNT_JSON
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'Missing credentials. Set GOOGLE_APPLICATION_CREDENTIALS to the path of ' +
      'your service account JSON file, or set GOOGLE_SERVICE_ACCOUNT_JSON to ' +
      'its full contents.'
    );
  }

  // Sanitise common Windows copy-paste problems before parsing:
  //  - Smart/curly quotes introduced by some text editors
  //  - BOM character at start of string
  //  - Literal \n instead of real newlines in private_key
  let cleaned = raw
    .trim()
    .replace(/^\uFEFF/, '')            // strip BOM
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes → straight
    .replace(/[\u2018\u2019]/g, "'");  // curly single quotes → straight

  let credentials;
  try {
    credentials = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.\n\n' +
      'The easiest fix on Windows: instead of pasting the JSON into .env, ' +
      'download the key file and set:\n' +
      '  GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\key.json\n\n' +
      'Original parse error: ' + e.message
    );
  }

  // Restore real newlines in private_key if they were escaped as \\n
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
}


// ═══════════════════════════════════════════════════════════════════
// 4. PER-USER IN-MEMORY STATE
// ═══════════════════════════════════════════════════════════════════
// Resets on bot restart — acceptable for Phase 1.
// Each entry: { spreadsheetId, children, history (Claude turns) }

const userState = new Map();

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, { spreadsheetId: null, children: [], history: [] });
  }
  return userState.get(userId);
}


// ═══════════════════════════════════════════════════════════════════
// 5. UTILITIES
// ═══════════════════════════════════════════════════════════════════

/** Random row ID — matches the uid() pattern in bloom-app.js */
const uid = () =>
  'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Today as YYYY-MM-DD — uses local time, never toISOString() (SGT-safe) */
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Days ago as YYYY-MM-DD */
const daysAgo = n => {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isWhitelisted = userId =>
  WHITELIST.length === 0 || WHITELIST.includes(userId);


// ═══════════════════════════════════════════════════════════════════
// 6. GOOGLE SHEETS HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Read a sheet range and return an array of objects keyed by header row */
async function readSheet(auth, spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows   = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

const readChildren = (auth, id) => readSheet(auth, id, 'children!A:E');
const readTasks    = (auth, id) => readSheet(auth, id, 'tasks!A:I');
const readEvents   = (auth, id) => readSheet(auth, id, 'events!A:G');

/** Append one row to a named sheet */
async function appendSheetRow(auth, spreadsheetId, sheetName, headers, obj) {
  const sheets = google.sheets({ version: 'v4', auth });
  const row    = headers.map(h => (obj[h] !== undefined ? String(obj[h]) : ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:           `${sheetName}!A1`,
    valueInputOption:'RAW',
    insertDataOption:'INSERT_ROWS',
    requestBody:     { values: [row] },
  });
}


// ═══════════════════════════════════════════════════════════════════
// 7. LINK-CODE RESOLUTION
// ═══════════════════════════════════════════════════════════════════
// The web app (bloom-telegram-connect.js) writes a link code to _meta.
// When the user taps the Telegram deep link, the bot reads that code,
// finds the right Sheet, and stores the userId → spreadsheetId mapping.

async function resolveLinkedSheet(auth, linkCode) {
  const drive = google.drive({ version: 'v3', auth });
  const q     = `name='${SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res   = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const file of (res.data.files || [])) {
    try {
      const meta = await sheets.spreadsheets.values.get({
        spreadsheetId: file.id,
        range: '_meta!A:B',
      });
      const rows = meta.data.values || [];
      if (rows.find(r => r[0] === `telegramLinkCode:${linkCode}`)) {
        return file.id;
      }
    } catch (_) { /* sheet may not have _meta yet */ }
  }
  return null;
}

async function markCodeUsed(auth, spreadsheetId, telegramUserId) {
  // Write the userId → sheet mapping so future messages can find the right sheet
  await appendSheetRow(auth, spreadsheetId, '_meta', ['key', 'value'], {
    key:   `linkedSheetFor:${telegramUserId}`,
    value: spreadsheetId,
  });
  // Write the flag the web app polls for — triggers the "connected!" confirmation
  // in bloom-telegram-connect.js _pollForLinkCompletion()
  await appendSheetRow(auth, spreadsheetId, '_meta', ['key', 'value'], {
    key:   'telegramLinked',
    value: 'true',
  });
}

async function findSheetForUser(auth, telegramUserId) {
  const drive  = google.drive({ version: 'v3', auth });
  const q      = `name='${SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res    = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
  const sheets = google.sheets({ version: 'v4', auth });

  for (const file of (res.data.files || [])) {
    try {
      const meta = await sheets.spreadsheets.values.get({
        spreadsheetId: file.id,
        range: '_meta!A:B',
      });
      const rows = meta.data.values || [];
      if (rows.find(r => r[0] === `linkedSheetFor:${telegramUserId}`)) {
        return file.id;
      }
    } catch (_) {}
  }
  return null;
}

/** Ensure the user's Sheet is found and children are loaded. Returns false if not linked. */
async function ensureUserReady(auth, userId) {
  const state = getState(userId);
  if (!state.spreadsheetId) {
    state.spreadsheetId = await findSheetForUser(auth, userId);
  }
  if (!state.spreadsheetId) return false;
  // Always refresh children — Sheet may have been updated via the web app
  state.children = await readChildren(auth, state.spreadsheetId);
  return true;
}


// ═══════════════════════════════════════════════════════════════════
// 8. PROGRESS CONTEXT
// ═══════════════════════════════════════════════════════════════════
// Lightweight snapshot used to add one-line progress notes to
// confirmation messages. Non-fatal — confirmations work without it.

async function buildProgressCtx(auth, spreadsheetId, childId) {
  try {
    const [tasks, events] = await Promise.all([
      readTasks(auth, spreadsheetId),
      readEvents(auth, spreadsheetId),
    ]);

    const today      = todayStr();
    const weekAgo    = daysAgo(7);
    const childTasks = tasks.filter(t => !childId || t.childId === childId);
    const childEvts  = events.filter(e => !childId || e.childId === childId);

    const weekTasks  = childTasks.filter(t => t.due >= weekAgo && t.due <= today);
    const completed  = weekTasks.filter(t => t.done === 'true');
    const pending    = childTasks.filter(t => t.done !== 'true' && t.due);

    // Nearest upcoming exam
    const nextExam   = childEvts
      .filter(e => e.category === 'exam' && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;

    const revisionScheduled = nextExam
      ? childTasks.some(t =>
          t.isRevision === 'true' &&
          t.subject && nextExam.subject &&
          t.subject.toLowerCase() === nextExam.subject.toLowerCase() &&
          t.due >= today && t.due <= nextExam.date
        )
      : false;

    // Average days between a revision task's due date and its exam
    const leads = childTasks
      .filter(t => t.isRevision === 'true' && t.due)
      .flatMap(t => {
        const exam = childEvts.find(e =>
          e.category === 'exam' && e.subject && t.subject &&
          e.subject.toLowerCase() === t.subject.toLowerCase() &&
          e.date >= t.due
        );
        if (!exam) return [];
        const d = Math.round(
          (new Date(exam.date + 'T00:00:00') - new Date(t.due + 'T00:00:00')) / 86400000
        );
        return d > 0 ? [d] : [];
      });

    return {
      completionRate:    weekTasks.length > 0 ? completed.length / weekTasks.length : null,
      totalPending:      pending.length,
      revisionScheduled,
      revisionLeadDays:  leads.length
        ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length)
        : 0,
    };
  } catch (_) {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════
// 9. CLAUDE INTENT PARSING
// ═══════════════════════════════════════════════════════════════════

async function parseIntent(userId, userMessage, children) {
  const state = getState(userId);

  // Add user message to rolling conversation history
  state.history.push({ role: 'user', content: userMessage });
  const recentHistory = state.history.slice(-10); // last 10 turns

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system:     buildSystemPrompt({
      childrenNames: children.map(c => c.name),
      todayStr:      todayStr(),
    }),
    messages: recentHistory,
  });

  const raw = response.content[0]?.text || '{}';
  state.history.push({ role: 'assistant', content: raw });

  // Parse JSON — Claude occasionally wraps in code fences despite instructions
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
    console.error(`[${userId}] Claude parse failure:`, raw.slice(0, 200));
    return { intent: 'unknown', reply: "I didn't quite catch that — could you try rephrasing?" };
  }
}


// ═══════════════════════════════════════════════════════════════════
// 10. INTENT EXECUTION — writes to Google Sheets
// ═══════════════════════════════════════════════════════════════════

async function executeIntent(auth, spreadsheetId, intent, children) {
  const resolveChildId = name => {
    if (!name) return children.length === 1 ? children[0].id : null;
    const match = children.find(c =>
      c.name.toLowerCase().includes(name.toLowerCase())
    );
    return match ? match.id : null;
  };

  switch (intent.intent) {

    case 'log_task':
      await appendSheetRow(auth, spreadsheetId, 'tasks', SHEET_HEADERS.tasks, {
        id:         uid(),
        childId:    resolveChildId(intent.childName) || '',
        title:      intent.title,
        subject:    intent.subject    || '',
        priority:   intent.priority   || 'medium',
        due:        intent.due        || '',
        notes:      intent.notes      || '',
        done:       'false',
        isRevision: intent.isRevision ? 'true' : '',
      });
      return { ok: true };

    case 'log_event':
      await appendSheetRow(auth, spreadsheetId, 'events', SHEET_HEADERS.events, {
        id:       uid(),
        childId:  resolveChildId(intent.childName) || '',
        title:    intent.title,
        date:     intent.date,
        category: intent.category || 'personal',
        subject:  intent.subject  || '',
        notes:    intent.notes    || '',
      });
      return { ok: true };

    case 'log_multiple':
      for (const item of (intent.items || [])) {
        const sub = { ...item };
        // Infer intent from shape if missing
        if (!sub.intent) {
          sub.intent = ('date' in sub && !('due' in sub)) ? 'log_event' : 'log_task';
        }
        // Inherit childName from parent intent if not set
        if (!sub.childName) sub.childName = intent.childName || null;
        await executeIntent(auth, spreadsheetId, sub, children);
      }
      return { ok: true };

    case 'schedule_revision': {
      const childId = resolveChildId(intent.childName) || '';
      for (const date of buildRevisionDates(intent.startDate, intent.recur, intent.untilDate)) {
        await appendSheetRow(auth, spreadsheetId, 'tasks', SHEET_HEADERS.tasks, {
          id:         uid(),
          childId,
          title:      `Revision — ${intent.subject}`,
          subject:    intent.subject,
          priority:   'medium',
          due:        date,
          notes:      intent.notes || '',
          done:       'false',
          isRevision: 'true',
        });
      }
      return { ok: true };
    }

    default:
      return { ok: false };
  }
}

/** Build date array for recurring revision tasks */
function buildRevisionDates(startDate, recur, untilDate) {
  if (recur === 'once' || !recur) return [startDate];
  const cur = new Date(startDate + 'T00:00:00');
  const end = untilDate
    ? new Date(untilDate + 'T00:00:00')
    : new Date(cur.getTime() + 30 * 86400000); // default 1 month
  const local = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dates = [];
  while (cur <= end && dates.length < 200) {
    dates.push(local(cur));
    cur.setDate(cur.getDate() + (recur === 'weekly' ? 7 : 14));
  }
  return dates;
}


// ═══════════════════════════════════════════════════════════════════
// 11. WEEKLY DIGEST GENERATOR
// ═══════════════════════════════════════════════════════════════════
// Called by /week. In Phase 2, a Sunday cron job calls this too.

async function generateWeekDigest(auth, spreadsheetId, child) {
  const [tasks, events] = await Promise.all([
    readTasks(auth, spreadsheetId),
    readEvents(auth, spreadsheetId),
  ]);

  const childTasks  = tasks.filter(t => t.childId === child.id);
  const childEvents = events.filter(e => e.childId === child.id);

  // Previous week tasks for completion rate trend
  const twoWeeksAgo = daysAgo(14);
  const oneWeekAgo  = daysAgo(7);
  const previousTasks = childTasks.filter(t => t.due >= twoWeeksAgo && t.due < oneWeekAgo);

  const weekData = buildWeekData({
    tasks:         childTasks,
    events:        childEvents,
    previousTasks,
  });

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role:    'user',
      content: buildDigestPrompt({
        childName: child.name,
        todayStr:  todayStr(),
        weekData,
      }),
    }],
  });

  return response.content[0]?.text?.trim() || 'No summary available.';
}


// ═══════════════════════════════════════════════════════════════════
// 12. AUTH + STATE HELPER (used by every command handler)
// ═══════════════════════════════════════════════════════════════════

async function getAuthAndState(userId, chatId) {
  let auth;
  try {
    auth = await getGoogleAuth().getClient();
  } catch (e) {
    console.error('[auth] Google auth error:', e.message);
    await bot.sendMessage(chatId, '⚠️ Google auth error: ' + e.message);
    return null;
  }
  try {
    const ready = await ensureUserReady(auth, userId);
    if (!ready) {
      await bot.sendMessage(chatId,
        '❌ Your Bloom account isn\'t linked yet.\n\n' +
        'Open the *Bloom web app*, go to the sidebar, and tap *Connect Telegram*.',
        { parse_mode: 'Markdown' }
      );
      return null;
    }
  } catch (e) {
    console.error('[auth] ensureUserReady error:', e.message);
    console.error(e.stack);
    await bot.sendMessage(chatId, '⚠️ Sheet lookup error: ' + e.message);
    return null;
  }
  return auth;
}


// ═══════════════════════════════════════════════════════════════════
// 13. TELEGRAM COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════

// ── /start [linkCode] ─────────────────────────────────────────────

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const userId   = msg.from.id;
  const chatId   = msg.chat.id;
  const linkCode = (match[1] || '').trim();

  if (!isWhitelisted(userId)) {
    await bot.sendMessage(chatId,
      '🔒 This bot is private. Ask the Bloom owner to add your Telegram ID to the whitelist.'
    );
    return;
  }

  let auth;
  try { auth = await getGoogleAuth().getClient(); }
  catch (e) { await bot.sendMessage(chatId, '⚠️ Config error: ' + e.message); return; }

  // ── Deep link: user arrived from "Connect Telegram" in the web app
  if (linkCode) {
    await bot.sendMessage(chatId, '🔍 Linking your Bloom account…');
    try {
      const spreadsheetId = await resolveLinkedSheet(auth, linkCode);
      if (!spreadsheetId) {
        await bot.sendMessage(chatId,
          '❌ That link code wasn\'t found or has already been used.\n\n' +
          'Go back to Bloom → sidebar → *Connect Telegram* to generate a fresh one.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      await markCodeUsed(auth, spreadsheetId, userId);
      const state         = getState(userId);
      state.spreadsheetId = spreadsheetId;
      state.children      = await readChildren(auth, spreadsheetId);

      // Personalise the welcome using the child's name if there's only one
      const firstName   = state.children.length === 1 ? state.children[0].name : null;
      const childRef    = firstName
        ? `I can see *${firstName}* in your Bloom account`
        : state.children.length > 1
          ? `I can see ${state.children.map(c => `*${c.name}*`).join(' and ')} in your account`
          : `Your account is linked — add a child in the Bloom web app to get started`;
      const exampleName = firstName || 'Emma';

      await bot.sendMessage(chatId,
        `🌱 *You're all set!*\n\n` +
        `${childRef}.\n\n` +
        `Just message me anything to log — plain English, no buttons:\n\n` +
        `_"${exampleName} has Maths homework due Thursday"_\n` +
        `_"Science test next Friday"_\n` +
        `_"Schedule weekly revision for English from Monday"_\n\n` +
        `I'll confirm everything I log. Use /week anytime to see how the week is shaping up. 🌱`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Link error:', e);
      await bot.sendMessage(chatId, '⚠️ Something went wrong: ' + e.message);
    }
    return;
  }

  // ── No link code — check if already connected
  try {
    const ready = await ensureUserReady(auth, userId);
    if (ready) {
      const state = getState(userId);
      await bot.sendMessage(chatId,
        `👋 Welcome back!\n\n` +
        `Just message me anything to log. ` +
        `Use /week for a progress update on how the week is going.\n\n` +
        `Children: ${state.children.map(c => c.name).join(', ') || '(none yet)'}`
      );
    } else {
      await bot.sendMessage(chatId,
        `👋 Hi! I\'m the Bloom assistant.\n\n` +
        `To get started, open the *Bloom web app*, go to the sidebar, ` +
        `and tap *Connect Telegram*. I\'ll link your account automatically.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (e) {
    await bot.sendMessage(chatId, '⚠️ Something went wrong. Please try again in a moment.');
  }
});

// ── /help ─────────────────────────────────────────────────────────

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `*Bloom Assistant*\n\n` +
    `Tell me what to log in plain English — no commands needed:\n\n` +
    `📝 *Tests & exams*\n_"Emma has a Science test on 23 May"_\n\n` +
    `✅ *Homework & tasks*\n_"Maths homework due this Thursday"_\n\n` +
    `📚 *Revision scheduling*\n_"Weekly revision for English starting Monday"_\n\n` +
    `📦 *Multiple items at once*\n_"Emma has Maths homework Tuesday AND Science test Friday"_\n\n` +
    `📊 *Progress update*\n/week — how is this week shaping up?\n\n` +
    `Everything goes straight into your Bloom Google Sheet.`,
    { parse_mode: 'Markdown' }
  );
});

// ── /week — on-demand progress digest ────────────────────────────
// Sends one narrative per child. This is also what the Phase 2
// Sunday cron job will call directly.

bot.onText(/\/week/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isWhitelisted(userId)) return;

  const auth = await getAuthAndState(userId, chatId);
  if (!auth) return;

  const state = getState(userId);
  if (!state.children.length) {
    await bot.sendMessage(chatId,
      'No children in your Bloom account yet. Add one in the web app first.'
    );
    return;
  }

  await bot.sendChatAction(chatId, 'typing');

  for (const child of state.children) {
    try {
      const digest = await generateWeekDigest(auth, state.spreadsheetId, child);
      await bot.sendMessage(chatId,
        `*🌱 ${child.name} — week update*\n\n${digest}`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error(`Digest error for ${child.name}:`, e);
      await bot.sendMessage(chatId,
        `⚠️ Could not generate update for ${child.name}: ${e.message}`
      );
    }
  }
});

// ── /children ─────────────────────────────────────────────────────

bot.onText(/\/children/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isWhitelisted(userId)) return;
  const auth = await getAuthAndState(userId, chatId);
  if (!auth) return;
  const { children } = getState(userId);
  const list = children.map(c => `  • ${c.name} (${c.level})`).join('\n');
  await bot.sendMessage(chatId, `Children in your Bloom account:\n${list || '(none yet)'}`);
});

// ── /status ───────────────────────────────────────────────────────

bot.onText(/\/status/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isWhitelisted(userId)) return;
  const auth = await getAuthAndState(userId, chatId);
  if (!auth) return;
  const state = getState(userId);
  await bot.sendMessage(chatId,
    `✅ Bloom is connected.\n` +
    `Sheet: https://docs.google.com/spreadsheets/d/${state.spreadsheetId}\n` +
    `Children: ${state.children.map(c => c.name).join(', ')}`
  );
});


// ═══════════════════════════════════════════════════════════════════
// 14. MAIN MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════════

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text   = msg.text || '';

  if (text.startsWith('/')) return; // handled by onText above
  if (!isWhitelisted(userId)) return;

  await bot.sendChatAction(chatId, 'typing');

  const auth = await getAuthAndState(userId, chatId);
  if (!auth) return;

  const state = getState(userId);

  try {
    // 1. Parse intent with Claude
    const intent = await parseIntent(userId, text, state.children);
    console.log(`[${userId}] intent:${intent.intent}`, JSON.stringify(intent).slice(0, 120));

    switch (intent.intent) {

      case 'clarify':
        await bot.sendMessage(chatId, intent.question);
        break;

      case 'unknown':
        await bot.sendMessage(
          chatId,
          intent.reply || "I didn't quite catch that — could you rephrase? Use /help to see what I can do."
        );
        break;

      case 'log_task':
      case 'log_event':
      case 'log_multiple':
      case 'schedule_revision': {
        await bot.sendChatAction(chatId, 'typing');

        // Resolve childId for the progress context lookup
        const childId = (() => {
          if (state.children.length === 1) return state.children[0].id;
          const name = intent.childName || null;
          if (!name) return null;
          return state.children.find(c =>
            c.name.toLowerCase().includes(name.toLowerCase())
          )?.id || null;
        })();

        // Execute write + fetch progress context in parallel
        const [result, progressCtx] = await Promise.all([
          executeIntent(auth, state.spreadsheetId, intent, state.children),
          buildProgressCtx(auth, state.spreadsheetId, childId),
        ]);

        if (!result.ok) {
          await bot.sendMessage(chatId,
            '⚠️ Something went wrong writing to your sheet. Please try again.'
          );
          break;
        }

        // Build progress-aware confirmation
        const confirmation = buildConfirmation(intent, state.children, progressCtx);

        // For exam events with a subject and no revision yet: offer guidance
        const shouldOfferRevision = (
          intent.intent === 'log_event' &&
          intent.category === 'exam' &&
          intent.subject &&
          progressCtx &&
          !progressCtx.revisionScheduled
        );

        const message = (confirmation || '✅ Logged!')
          + (shouldOfferRevision ? buildRevisionOffer(intent.subject, intent.childName) : '');

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        break;
      }

      default:
        await bot.sendMessage(chatId,
          "I'm not sure how to handle that. Try rephrasing or use /help."
        );
    }

  } catch (e) {
    // Always print the full stack to PowerShell so nothing is hidden locally
    console.error('\n[' + userId + '] ── Handler error ──────────────────');
    console.error('Message :', e.message);
    console.error('Stack   :', e.stack);
    console.error('─────────────────────────────────────\n');

    // Send the real error to Telegram so you can see it without switching windows.
    // Remove the e.message line before going to production.
    await bot.sendMessage(chatId,
      '⚠️ Error: ' + e.message + '\n\nCheck your PowerShell window for the full stack trace.'
    );
  }
});


// ═══════════════════════════════════════════════════════════════════
// 15. ERROR HANDLING & STARTUP
// ═══════════════════════════════════════════════════════════════════

bot.on('polling_error', err => console.error('Telegram polling error:', err.message));

process.on('unhandledRejection', reason => console.error('Unhandled rejection:', reason));

console.log('🌱 Bloom Telegram Agent started');
console.log(`   Whitelist : ${WHITELIST.length > 0 ? WHITELIST.join(', ') : '(open — set BLOOM_WHITELIST to restrict)'}`);
console.log(`   Commands  : /start  /help  /week  /children  /status`);
console.log(`   Sheet name: ${SHEET_TITLE}`);
