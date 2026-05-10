// ═══════════════════════════════════════════════════════════════════
// bloom-telegram-connect.js
// Adds "Connect Telegram" functionality to the Bloom web app.
//
// HOW TO USE
// ──────────
// 1. Add this file to your repo alongside index.html.
// 2. Add this line at the bottom of index.html (before </body>):
//      <script src="bloom-telegram-connect.js"></script>
// 3. Add the sidebar button HTML (see below) to your index.html
//    inside .sidebar-bottom, just above the closing </div>.
//
// SIDEBAR BUTTON HTML to add to index.html:
// ──────────────────────────────────────────
//   <div style="padding:8px 10px;">
//     <button class="btn btn-secondary btn-sm"
//             style="width:100%;justify-content:flex-start;gap:8px;"
//             onclick="openTelegramConnect()">
//       <span>✈️</span> Connect Telegram
//     </button>
//   </div>
//
// MODAL HTML to add to index.html (before </body>):
// ──────────────────────────────────────────────────
//   <!-- Telegram Connect Modal -->
//   <div class="modal-overlay hidden" id="modal-telegram-connect">
//     <div class="modal" style="max-width:400px;">
//       <div class="modal-title">Connect Telegram</div>
//       <div id="tg-connect-body"></div>
//       <div class="modal-actions">
//         <button class="btn btn-secondary" onclick="closeModal('modal-telegram-connect')">Close</button>
//       </div>
//     </div>
//   </div>
// ═══════════════════════════════════════════════════════════════════

// ── Config — set your bot username here ──────────────────────────
// e.g. if your bot is @BloomStudyBot, set this to 'BloomStudyBot'
const TELEGRAM_BOT_USERNAME = 'vrowniez';

// ── Generate and display a one-time link code ─────────────────────

async function openTelegramConnect() {
  openModal('modal-telegram-connect');
  const body = $('tg-connect-body');

  // Check if already linked
  const existingCode = await _readMetaValue('telegramLinked');
  if (existingCode === 'true') {
    body.innerHTML = `
      <div style="text-align:center;padding:16px 0;">
        <div style="font-size:36px;margin-bottom:12px;">✅</div>
        <div style="font-size:15px;font-weight:600;color:var(--sage-dark);margin-bottom:8px;">Telegram is connected</div>
        <div style="font-size:13px;color:var(--text-soft);line-height:1.6;">
          Your Bloom account is linked to Telegram.<br>
          You can log tasks and events by messaging your bot directly.
        </div>
        <button class="btn btn-secondary btn-sm" style="margin-top:16px;" onclick="_unlinkTelegram()">Unlink Telegram</button>
      </div>`;
    return;
  }

  // Generate a new link code
  body.innerHTML = `<div style="text-align:center;padding:16px 0;color:var(--text-soft);">Generating link code…</div>`;

  const code = await _generateLinkCode();
  if (!code) {
    body.innerHTML = `<div style="color:var(--red-soft);padding:12px;">Could not generate a link code. Make sure you are signed in.</div>`;
    return;
  }

  const deepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`;

  body.innerHTML = `
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-soft);line-height:1.6;">
      Tap the button below to open Telegram and link your Bloom account.
      The link expires in <strong>15 minutes</strong> and works once only.
    </div>

    <a href="${deepLink}" target="_blank" rel="noopener"
       style="display:flex;align-items:center;justify-content:center;gap:10px;
              padding:14px 20px;border-radius:var(--radius-sm);
              background:#2CA5E0;color:white;text-decoration:none;
              font-weight:600;font-size:14px;margin-bottom:16px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8c-.12.56-.46.7-.92.43l-2.56-1.88-1.23 1.19c-.14.14-.26.26-.52.26l.18-2.6 4.72-4.27c.2-.18-.05-.28-.31-.1L7.66 14.6l-2.52-.78c-.55-.17-.56-.54.11-.8l9.84-3.8c.46-.17.86.11.55.58z" fill="white"/>
      </svg>
      Open in Telegram
    </a>

    <div style="background:var(--stone-pale);border-radius:var(--radius-sm);padding:12px 14px;">
      <div style="font-size:11px;color:var(--text-soft);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">
        Or copy this link manually
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input id="tg-link-input" type="text" value="${deepLink}" readonly
               style="flex:1;font-size:12px;padding:7px 10px;
                      border:1.5px solid var(--stone-light);border-radius:6px;
                      background:var(--cream);color:var(--text);font-family:var(--sans);">
        <button class="btn btn-secondary btn-sm" onclick="_copyTgLink()">Copy</button>
      </div>
    </div>

    <div style="font-size:12px;color:var(--text-soft);margin-top:14px;line-height:1.6;">
      Once linked, you can message your bot things like:<br>
      <em>"Emma has Maths homework due Thursday"</em><br>
      <em>"Science test next Friday"</em>
    </div>`;
}

// ── Read / write to the _meta sheet ──────────────────────────────

async function _readMetaValue(key) {
  if (!S.spreadsheetId || !S.accessToken) return null;
  try {
    const res = await sheetsReq(
      `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/_meta!A:B`
    );
    const rows = res.values || [];
    const row = rows.find(r => r[0] === key);
    return row ? row[1] : null;
  } catch (_) { return null; }
}

async function _writeMetaValue(key, value) {
  if (!S.spreadsheetId || !S.accessToken) return;
  // Append a new row — simple for Phase 1 (doesn't deduplicate)
  await sheetsReq(
    `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/_meta!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    'POST',
    { values: [[key, value]] }
  );
}

// ── Generate a one-time link code ─────────────────────────────────

async function _generateLinkCode() {
  if (!S.spreadsheetId) return null;
  // 8-character alphanumeric code
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
  const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
  try {
    await _writeMetaValue(`telegramLinkCode:${code}`, expiry);
    return code;
  } catch (_) { return null; }
}

// ── Copy link to clipboard ────────────────────────────────────────

function _copyTgLink() {
  const input = document.getElementById('tg-link-input');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    toast('Link copied!');
  }).catch(() => {
    document.execCommand('copy');
    toast('Link copied!');
  });
}

// ── Unlink Telegram ───────────────────────────────────────────────

async function _unlinkTelegram() {
  await _writeMetaValue('telegramLinked', 'false');
  const body = $('tg-connect-body');
  body.innerHTML = `<div style="text-align:center;padding:16px;color:var(--sage-dark);">✅ Telegram unlinked. You can reconnect anytime.</div>`;
  setTimeout(() => closeModal('modal-telegram-connect'), 1500);
}
