// ═══════════════════════════════════════════════════════════════════
// bloom-telegram-connect.js — One-tap Telegram onboarding for Bloom
// ═══════════════════════════════════════════════════════════════════
//
// SETUP — one thing to configure
// ────────────────────────────────
// In bloom-config.js, add your bot username to BLOOM_CONFIG:
//
//   telegramBotUsername: 'YourBloomBot',   // without the @
//
// Everything else is automatic.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── Read bot username from bloom-config.js ───────────────────────
// BLOOM_CONFIG is defined in bloom-config.js which loads before this file.
const TG_BOT_USERNAME = (typeof BLOOM_CONFIG !== 'undefined' && BLOOM_CONFIG.telegramBotUsername)
  ? BLOOM_CONFIG.telegramBotUsername
  : null;

// Link code expiry — 15 minutes
const CODE_EXPIRY_MS = 15 * 60 * 1000;

// ── Module state ──────────────────────────────────────────────────
let _tgDeepLink = null;   // pre-generated t.me URL; null until ready
let _tgIsLinked = false;  // flips to true once bot confirms connection
let _tgInitDone = false;  // prevents double-init


// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * Called automatically by loadApp() in bloom-app.js after the Sheet
 * is ready. Renders the UI immediately, then generates the deep link
 * in the background so the first tap is near-instant.
 */
async function tgInit() {
  // Guard: need a spreadsheet and a bot username to do anything
  if (_tgInitDone) return;
  if (!S.spreadsheetId) {
    console.log('[TG] tgInit skipped — no spreadsheetId yet');
    return;
  }
  if (!TG_BOT_USERNAME) {
    console.warn('[TG] telegramBotUsername not set in bloom-config.js — Telegram connect disabled');
    return;
  }

  _tgInitDone = true;
  console.log('[TG] tgInit starting, spreadsheetId:', S.spreadsheetId);

  // Check if already linked
  _tgIsLinked = (await _readMeta('telegramLinked')) === 'true';
  console.log('[TG] linked:', _tgIsLinked);

  if (_tgIsLinked) {
    _renderLinkedState();
    return;
  }

  // Render the UI immediately — the button is always visible.
  // The deep link generates in the background; tgConnect() handles
  // the case where it isn't ready yet.
  _renderUnlinkedState();

  // Generate deep link in background — non-blocking
  _generateDeepLink().then(link => {
    _tgDeepLink = link;
    console.log('[TG] deep link ready:', !!link);
  }).catch(e => {
    console.warn('[TG] deep link generation failed (non-fatal):', e.message);
  });

  // Poll every 8s for up to 10 minutes for bot confirmation
  _pollForLinkCompletion();
}

/**
 * Called when the user taps the banner or sidebar button.
 * If the deep link is ready, opens Telegram immediately.
 * If not ready yet, generates one first (rare — very slow connection).
 */
async function tgConnect() {
  if (_tgDeepLink) {
    window.open(_tgDeepLink, '_blank');
    return;
  }
  // Deep link not ready yet — generate now and open
  toast('Opening Telegram…');
  try {
    const link = await _generateDeepLink();
    _tgDeepLink = link;
    if (link) {
      window.open(link, '_blank');
    } else {
      toast('Could not generate link — please try again.', true);
    }
  } catch (e) {
    console.error('[TG] tgConnect error:', e);
    toast('Something went wrong — please try again.', true);
  }
}

/**
 * Called from the Disconnect button in the linked state UI.
 */
async function tgDisconnect() {
  await _writeMeta('telegramLinked', 'false');
  _tgIsLinked = false;
  _tgInitDone = false;
  _tgDeepLink = null;
  _renderUnlinkedState();
  // Re-generate link in background for next tap
  _generateDeepLink().then(link => { _tgDeepLink = link; });
  toast('Telegram disconnected.');
}


// ═══════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ═══════════════════════════════════════════════════════════════════

const TG_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
  xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64
    6.8l-1.7 8c-.12.56-.46.7-.92.43l-2.56-1.88-1.23 1.19c-.14.14-.26.26-.52.26l.18-2.6
    4.72-4.27c.2-.18-.05-.28-.31-.1L7.66 14.6l-2.52-.78c-.55-.17-.56-.54.11-.8l9.84-3.8
    c.46-.17.86.11.55.58z" fill="currentColor"/>
</svg>`;

/**
 * Renders the "connect Telegram" UI into both slots.
 * Always shows the button — does NOT wait for the deep link.
 */
function _renderUnlinkedState() {
  // ── Dashboard banner ─────────────────────────────────────────
  const bannerSlot = document.getElementById('tg-banner-slot');
  if (bannerSlot) {
    bannerSlot.innerHTML = `
      <div id="tg-banner" onclick="tgConnect()" style="
        display:flex; align-items:center; gap:12px;
        background:linear-gradient(135deg,#e8f4fd,#d4ecf7);
        border:1.5px solid #b3d9f0; border-radius:var(--radius);
        padding:14px 16px; margin-bottom:20px; cursor:pointer;
        transition:opacity 0.15s;
      " onmouseover="this.style.opacity='.85'"
         onmouseout="this.style.opacity='1'">
        <div style="
          width:38px; height:38px; border-radius:50%;
          background:#2CA5E0; color:white;
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0;
        ">${TG_ICON}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;color:#1a6fa0;">
            Log faster — connect Telegram
          </div>
          <div style="font-size:12px;color:#4a90ba;margin-top:2px;">
            Message the bot to add tasks without opening the app.
          </div>
        </div>
        <div style="
          background:#2CA5E0; color:white;
          font-size:12px; font-weight:700;
          padding:7px 14px; border-radius:20px; white-space:nowrap;
        ">Connect ›</div>
      </div>`;
    console.log('[TG] banner rendered');
  } else {
    console.warn('[TG] tg-banner-slot not found in DOM');
  }

  // ── Sidebar button ────────────────────────────────────────────
  const sidebarSlot = document.getElementById('tg-sidebar-slot');
  if (sidebarSlot) {
    sidebarSlot.innerHTML = `
      <div style="padding:6px 10px 2px;">
        <button onclick="tgConnect()" style="
          width:100%; display:flex; align-items:center; gap:8px;
          padding:8px 11px; border-radius:var(--radius-sm);
          background:none; border:1.5px solid #b3d9f0;
          color:#1a6fa0; font-size:12px; font-weight:600;
          cursor:pointer; transition:background 0.15s;
        " onmouseover="this.style.background='#e8f4fd'"
           onmouseout="this.style.background='none'">
          ${TG_ICON} Connect Telegram
        </button>
      </div>`;
    console.log('[TG] sidebar button rendered');
  } else {
    console.warn('[TG] tg-sidebar-slot not found in DOM');
  }
}

function _renderLinkedState() {
  // ── Dashboard — small connected badge ────────────────────────
  const bannerSlot = document.getElementById('tg-banner-slot');
  if (bannerSlot) {
    bannerSlot.innerHTML = `
      <div style="
        display:flex; align-items:center; gap:8px;
        font-size:12px; color:#4a90ba;
        margin-bottom:16px; padding:0 2px;
      ">
        ${TG_ICON}
        <span>Telegram connected — log tasks by messaging your bot</span>
        <button onclick="tgDisconnect()" style="
          margin-left:auto; background:none; border:none;
          font-size:11px; color:var(--text-soft); cursor:pointer;
          padding:2px 6px; border-radius:4px;
        ">Disconnect</button>
      </div>`;
  }

  // ── Sidebar — connected badge ─────────────────────────────────
  const sidebarSlot = document.getElementById('tg-sidebar-slot');
  if (sidebarSlot) {
    sidebarSlot.innerHTML = `
      <div style="
        display:flex; align-items:center; gap:8px;
        padding:8px 11px; font-size:12px; color:#4a90ba;
      ">
        ${TG_ICON}
        <span style="flex:1;">Telegram connected</span>
        <button onclick="tgDisconnect()" style="
          background:none; border:none; font-size:10px;
          color:var(--text-soft); cursor:pointer;
        ">✕</button>
      </div>`;
  }
}


// ═══════════════════════════════════════════════════════════════════
// LINK CODE GENERATION
// ═══════════════════════════════════════════════════════════════════

async function _generateDeepLink() {
  if (!S.spreadsheetId) return null;
  // 8-character uppercase code
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code  = Array.from(bytes, b => b.toString(36).padStart(2, '0'))
    .join('').slice(0, 8).toUpperCase();
  const expiry = new Date(Date.now() + CODE_EXPIRY_MS).toISOString();
  await _writeMeta(`telegramLinkCode:${code}`, expiry);
  return `https://t.me/${TG_BOT_USERNAME}?start=${code}`;
}


// ═══════════════════════════════════════════════════════════════════
// POLLING — detects when the bot writes back telegramLinked:true
// ═══════════════════════════════════════════════════════════════════

function _pollForLinkCompletion() {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts++;
    if (attempts > 75) { clearInterval(timer); return; } // 10 min max

    try {
      const val = await _readMeta('telegramLinked');
      if (val === 'true') {
        clearInterval(timer);
        _tgIsLinked = true;
        _renderLinkedState();

        // Show the confirmation modal
        const body = document.getElementById('tg-connected-body');
        const names = (S.children || []).map(c => c.name);
        if (body) {
          body.textContent = names.length
            ? `I can see ${names.join(' and ')} in your Bloom account. Just message the bot anything to log.`
            : 'Your Bloom account is now linked. Message the bot anything to log tasks and events.';
        }
        const modal = document.getElementById('modal-tg-connected');
        if (modal) modal.classList.remove('hidden');
      }
    } catch (_) { /* non-fatal — keep polling */ }
  }, 8000);
}


// ═══════════════════════════════════════════════════════════════════
// _META SHEET HELPERS
// ═══════════════════════════════════════════════════════════════════
// Uses sheetsReq() from bloom-app.js (already loaded before this file).

async function _readMeta(key) {
  if (!S.spreadsheetId || !S.accessToken) return null;
  try {
    const res  = await sheetsReq(
      `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/_meta!A:B`
    );
    const rows = (res.values || []);
    // Walk backwards — last written value wins
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === key) return rows[i][1] || null;
    }
    return null;
  } catch (_) { return null; }
}

async function _writeMeta(key, value) {
  if (!S.spreadsheetId || !S.accessToken) return;
  await sheetsReq(
    `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/_meta!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    { values: [[key, String(value)]] }
  );
}
