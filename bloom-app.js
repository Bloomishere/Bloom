// ═══════════════════════════════════════════════════════════════════
// bloom-app.js — Bloom Student Growth & Academic Manager
// ═══════════════════════════════════════════════════════════════════
//
// MODULE MAP
// ─────────────────────────────────────────────────────────────────
//   §1  Config & constants
//   §2  App state
//   §3  Core utilities        uid, $, esc, date helpers
//   §4  UI utilities          toast, sync indicator, modal, toggle
//   §5  Mobile sidebar
//   §6  Google auth           sign-in, sign-out, silent refresh
//   §7  Sheets API layer      sheetsReq, appendRow, deleteRow, updateRow
//   §8  Data loading          findOrCreate, loadAll, parse, migrate
//   §9  App init
//  §10  Shared CRUD           confirmDelete + open/save/delete per entity
//  §11  Navigation
//  §12  Sidebar render
//  §13  Children module
//  §14  Grades module
//  §15  Tasks module
//  §16  Calendar module
//  §17  Reflection module
//  §18  Milestones module
//  §19  Dashboard
//  §20  Boot
// ═══════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────
// §1  CONFIG & CONSTANTS
// ───────────────────────────────────────────────────────────────────

const CLIENT_ID   = (typeof BLOOM_CONFIG !== 'undefined') ? BLOOM_CONFIG.clientId        : '';
const SHEET_TITLE = (typeof BLOOM_CONFIG !== 'undefined') ? BLOOM_CONFIG.sheetTitle       : 'Bloom Data';
const TASK_DAYS   = (typeof BLOOM_CONFIG !== 'undefined') ? BLOOM_CONFIG.taskWindowDays   : 14;
const EXAM_DAYS   = (typeof BLOOM_CONFIG !== 'undefined') ? BLOOM_CONFIG.examWindowDays   : 30;

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'openid email profile'
].join(' ');

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3/files';

const SHEET_NAMES = ['children','subjects','grades','tasks','events','journal','milestones','_meta'];
const SHEET_HEADERS = {
  children:   ['id','name','level','yearStart','yearEnd'],
  subjects:   ['id','childId','name','target','type'],
  grades:     ['id','childId','subjectId','term','paper','scored','max','weight'],
  tasks:      ['id','childId','title','subject','priority','due','notes','done','isRevision'],
  events:     ['id','childId','title','date','category','subject','notes'],
  journal:    ['id','childId','period','year','subject','highlights','teacherComments','improvements','targets'],
  milestones: ['id','childId','title','desc','date','category'],
  _meta:      ['key','value']
};

// Singapore school level progression
const LEVEL_ORDER = [
  'Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6',
  'Secondary 1','Secondary 2','Secondary 3','Secondary 4','JC 1','JC 2'
];

// Child avatar colours cycled by index
const AVATAR_COLORS = ['#7a9e7e','#d4955a','#7aa3b8','#9c7bb8','#c97a6a','#b87a45'];

// Category look-up maps shared by Calendar and Dashboard
const CAT_EMOJI = { exam:'📝', holiday:'🏖️', cca:'🎯', school:'🏫', personal:'⭐' };
const CAT_ICONS = { academic:'📚', cca:'🎯', character:'💛', social:'🤝' };

const PERIOD_LABELS = {
  term1:'Term 1', term2:'Term 2', term3:'Term 3', term4:'Term 4', year:'Full Year'
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// Google SVG icon — defined once, reused by sign-in and sign-out button resets
const GOOGLE_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
</svg>`;


// ───────────────────────────────────────────────────────────────────
// §2  APP STATE
// ───────────────────────────────────────────────────────────────────

const S = {
  user:          null,   // { name, email, picture, sub }
  accessToken:   null,
  spreadsheetId: null,
  children:      [],
  subjects:      {}, grades: {}, tasks: {}, events: {}, journal: {}, milestones: {},
  activeChildId: null,
  calYear:       new Date().getFullYear(),
  calMonth:      new Date().getMonth(),
  syncing:       false
};


// ───────────────────────────────────────────────────────────────────
// §3  CORE UTILITIES
// ───────────────────────────────────────────────────────────────────

/** Cryptographically random ID — not sequential or guessable */
const uid = () => {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return 'id_' + Array.from(arr, b => b.toString(36).padStart(2,'0')).join('');
};

/** getElementById shorthand */
const $ = id => document.getElementById(id);

/** HTML-escape a value — prevents XSS when rendering into innerHTML */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/** Currently active child object, or null */
const child = () => S.children.find(c => c.id === S.activeChildId) || null;

/** Ensure every data bucket exists for a child id */
const initChild = id => {
  ['subjects','grades','tasks','events','journal','milestones']
    .forEach(k => { if (!S[k][id]) S[k][id] = []; });
};

/**
 * Format a Date as YYYY-MM-DD using *local* time.
 * Never use toISOString() for dates — the UTC conversion shifts SGT (+8)
 * dates back by one day, causing calendar and task-due bugs.
 */
const localDateStr = d => {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};

/** Today as a local YYYY-MM-DD string (timezone-safe) */
const todayStr = () => localDateStr(new Date());

/** Format a YYYY-MM-DD string for display, e.g. "4 May 2025" */
const fmtDate = d => {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', {
    day:'numeric', month:'short', year:'numeric'
  });
};


// ───────────────────────────────────────────────────────────────────
// §4  UI UTILITIES
// ───────────────────────────────────────────────────────────────────

// ── Toast ────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className   = 'show' + (isError ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.className = '', 3000);
}

// ── Sync indicator ───────────────────────────────────────────────
function setSyncStatus(status, label) {
  $('sync-dot').className    = 'sync-dot ' + status;
  $('sync-label').textContent = label;
}

// ── Modals ───────────────────────────────────────────────────────
const closeModal = id => $(id).classList.add('hidden');
const openModal  = id => $(id).classList.remove('hidden');

/**
 * Set the visual state of a circular checkbox-style toggle element.
 * Replaces the repeated 4-line pattern that was scattered across all task toggles.
 *
 * @param {string}  elId   - element id
 * @param {boolean} active - whether the toggle is "on"
 * @param {string}  color  - CSS colour for the active state, e.g. 'var(--sky)'
 */
function setToggleUI(elId, active, color) {
  const el = $(elId);
  el.style.background  = active ? color : '';
  el.style.borderColor = color;
  el.style.color       = active ? 'white' : '';
  el.textContent       = active ? '✓' : '';
}

// ── Re-render whichever page is currently shown ──────────────────
function _rerenderActivePage() {
  const ap = document.querySelector('.page.active');
  if (ap) renderPage(ap.id.replace('page-',''));
}

/**
 * Shared empty-state HTML block.
 * @param {string}      icon       - emoji
 * @param {string|null} title      - bold title (pass null to omit)
 * @param {string}      sub        - subtitle text
 * @param {string}      [style=''] - optional extra inline style on the wrapper
 */
function _emptyState(icon, title, sub, style = '') {
  return `<div class="empty-state" style="${style}">
    <div class="empty-icon" style="${style ? 'font-size:28px;' : ''}">${icon}</div>
    ${title ? `<div class="empty-title">${title}</div>` : ''}
    <div class="empty-sub">${sub}</div>
  </div>`;
}


// ───────────────────────────────────────────────────────────────────
// §5  MOBILE SIDEBAR
// ───────────────────────────────────────────────────────────────────

function toggleSidebar() {
  const sb   = document.querySelector('.sidebar');
  const ov   = $('sidebar-overlay');
  const open = sb.classList.toggle('open');
  ov.classList.toggle('open', open);
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
}

// Auto-close sidebar when any nav item is tapped on mobile
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', () => { if (window.innerWidth <= 700) closeSidebar(); })
  );
});


// ───────────────────────────────────────────────────────────────────
// §6  GOOGLE AUTH
// ───────────────────────────────────────────────────────────────────

let tokenClient;

function initGoogleAuth() {
  if (!CLIENT_ID) { showAuth(); return; }

  const savedUser = sessionStorage.getItem('bs_user');
  if (!savedUser) { showAuth(); return; }

  // Previous session found — attempt silent re-auth (no popup, no consent screen)
  $('loading-screen').classList.remove('hidden');
  $('loading-msg').textContent = 'Signing you back in…';
  $('auth-screen').classList.add('hidden');
  S.user = JSON.parse(savedUser);

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    prompt:    '',   // empty = silent, no popup
    callback:  async tokenResponse => {
      if (tokenResponse.error || !tokenResponse.access_token) {
        // Silent auth failed (e.g. no active Google session) — show login
        sessionStorage.clear();
        showAuth();
        return;
      }
      S.accessToken = tokenResponse.access_token;
      loadApp();
    }
  });
  tokenClient.requestAccessToken({ prompt: '' });
}

function showAuth() {
  $('loading-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('app').classList.remove('visible');
  $('app').style.display = 'none';
}

function signInWithGoogle() {
  if (!CLIENT_ID) {
    toast('⚠️ Please add your Google Client ID in bloom-config.js', true);
    return;
  }
  const btn = $('google-signin-btn');
  btn.classList.add('loading');
  btn.innerHTML = `<span style="font-size:18px">⏳</span> Signing in…`;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope:     SCOPES,
    prompt:    'consent',
    callback:  async tokenResponse => {
      if (tokenResponse.error) {
        _resetSignInButton();
        toast('Sign-in failed. Please try again.', true);
        return;
      }
      S.accessToken = tokenResponse.access_token;
      // Never store the token — only store the non-sensitive user profile
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${S.accessToken}` }
        });
        S.user = await res.json();
        sessionStorage.setItem('bs_user', JSON.stringify(S.user));
        loadApp();
      } catch (e) {
        toast('Could not fetch user info', true);
        showAuth();
      }
    }
  });
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function signOut() {
  if (S.accessToken) google.accounts.oauth2.revoke(S.accessToken, () => {});
  sessionStorage.clear();
  S.accessToken    = null;
  S.user           = null;
  S.spreadsheetId  = null;
  S.children       = [];
  S.activeChildId  = null;
  ['subjects','grades','tasks','events','journal','milestones'].forEach(k => S[k] = {});
  $('app').style.display = 'none';
  $('app').classList.remove('visible');
  showAuth();
  _resetSignInButton();
}

function _resetSignInButton() {
  const btn = $('google-signin-btn');
  btn.classList.remove('loading');
  btn.innerHTML = `${GOOGLE_SVG} Continue with Google`;
}

// ── Silent token refresh ─────────────────────────────────────────
// Called by sheetsReq when it receives a 401 mid-session.
let _tokenRefreshResolve = null;

async function _silentRefreshToken() {
  return new Promise((resolve, reject) => {
    _tokenRefreshResolve = resolve;
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope:     SCOPES,
      prompt:    '',
      callback:  tr => {
        if (tr.error || !tr.access_token) {
          _tokenRefreshResolve = null;
          reject(new Error('Token refresh failed'));
        } else {
          S.accessToken = tr.access_token;
          if (_tokenRefreshResolve) { _tokenRefreshResolve(); _tokenRefreshResolve = null; }
        }
      }
    });
    tc.requestAccessToken({ prompt: '' });
    // Safety: reject if GSI doesn't respond within 8 s
    setTimeout(() => {
      if (_tokenRefreshResolve) {
        _tokenRefreshResolve = null;
        reject(new Error('Token refresh timed out'));
      }
    }, 8000);
  });
}


// ───────────────────────────────────────────────────────────────────
// §7  SHEETS API LAYER
// ───────────────────────────────────────────────────────────────────

/**
 * Authenticated fetch wrapper for Sheets / Drive.
 * Silently refreshes the token once on 401 before giving up.
 */
async function sheetsReq(url, method = 'GET', body = null, _retry = false) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${S.accessToken}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);

  if (res.status === 401 && !_retry) {
    try {
      setSyncStatus('syncing', 'Refreshing session…');
      await _silentRefreshToken();
      return sheetsReq(url, method, body, true);
    } catch (e) {
      toast('Your session has expired. Please sign in again.', true);
      setTimeout(() => signOut(), 2000);
      throw new Error('Session expired');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Append one row to a named sheet */
async function appendRow(sheetName, headers, obj) {
  const row = headers.map(h => obj[h] !== undefined ? String(obj[h]) : '');
  setSyncStatus('syncing', 'Saving…');
  try {
    await sheetsReq(
      `${SHEETS_API}/${S.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      'POST', { values: [row] }
    );
    setSyncStatus('synced', 'All saved');
    return true;
  } catch (e) {
    setSyncStatus('error', 'Save failed');
    toast('Could not save to Google Sheets — please check your connection and try again.', true);
    return false;
  }
}

/** Delete a row by matching its id in column A */
async function deleteRow(sheetName, id) {
  setSyncStatus('syncing', 'Saving…');
  try {
    const res    = await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:A`);
    const rowIdx = (res.values || []).findIndex(r => r[0] === id);
    if (rowIdx < 1) { setSyncStatus('synced', 'All saved'); return; }

    const meta  = await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}?fields=sheets.properties`);
    const sheet = meta.sheets.find(s => s.properties.title === sheetName);
    if (!sheet)  { setSyncStatus('synced', 'All saved'); return; }

    await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}:batchUpdate`, 'POST', {
      requests: [{ deleteDimension: { range: {
        sheetId:    sheet.properties.sheetId,
        dimension:  'ROWS',
        startIndex: rowIdx,
        endIndex:   rowIdx + 1
      }}}]
    });
    setSyncStatus('synced', 'All saved');
  } catch (e) {
    setSyncStatus('error', 'Delete failed');
    toast('Delete failed: ' + e.message, true);
  }
}

/**
 * Update multiple fields in one batched API call.
 * fields = plain object, e.g. { title: 'new', done: true }
 *
 * This replaced the old sequential per-cell updateCell loop that caused
 * timeouts when ~12 API calls were made for a single task save.
 */
async function updateRow(sheetName, id, fields) {
  setSyncStatus('syncing', 'Saving…');
  try {
    const headers = SHEET_HEADERS[sheetName];

    // Step 1 — one read to locate the row
    const res    = await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:A`);
    const rowIdx = (res.values || []).findIndex(r => r[0] === id);
    if (rowIdx < 1) { setSyncStatus('error', 'Row not found'); return; }

    // Step 2 — one batchUpdate with one range per changed field
    const data = Object.entries(fields).map(([col, val]) => {
      const colIdx = headers.indexOf(col);
      if (colIdx < 0) return null;
      return {
        range:  `${sheetName}!${String.fromCharCode(65 + colIdx)}${rowIdx + 1}`,
        values: [[String(val ?? '')]]
      };
    }).filter(Boolean);

    if (!data.length) { setSyncStatus('synced', 'All saved'); return; }
    await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}/values:batchUpdate`, 'POST',
      { valueInputOption: 'RAW', data });
    setSyncStatus('synced', 'All saved');
  } catch (e) {
    setSyncStatus('error', 'Save failed');
    toast('Could not save changes — please try again.', true);
  }
}

/** Single-cell convenience wrapper — kept for toggleTask compatibility */
const updateCell = (sheet, id, col, val) => updateRow(sheet, id, { [col]: val });


// ───────────────────────────────────────────────────────────────────
// §8  DATA LOADING
// ───────────────────────────────────────────────────────────────────

async function findOrCreateSpreadsheet() {
  setSyncStatus('syncing', 'Looking for your data…');
  try {
    const q   = encodeURIComponent(`name='${SHEET_TITLE}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
    const res = await sheetsReq(`${DRIVE_API}?q=${q}&fields=files(id,name)&spaces=drive`);
    if (res.files && res.files.length > 0) {
      S.spreadsheetId = res.files[0].id;
      setSyncStatus('syncing', 'Loading your data…');
      await loadAllData();
    } else {
      setSyncStatus('syncing', 'Creating your spreadsheet…');
      await createSpreadsheet();
    }
  } catch (e) {
    setSyncStatus('error', 'Connection error');
    toast('Could not connect to Google Sheets: ' + e.message, true);
  }
}

async function createSpreadsheet() {
  const res = await sheetsReq(SHEETS_API, 'POST', {
    properties: { title: SHEET_TITLE },
    sheets:     SHEET_NAMES.map(name => ({ properties: { title: name } }))
  });
  S.spreadsheetId = res.spreadsheetId;

  // Write all header rows in a single batch call
  await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}/values:batchUpdate`, 'POST', {
    valueInputOption: 'RAW',
    data: SHEET_NAMES.map(name => ({ range: `${name}!A1`, values: [SHEET_HEADERS[name]] }))
  });

  toast('✅ Bloom spreadsheet created in your Google Drive!');
  showSheetBanner();
  setSyncStatus('synced', 'All saved');
}

function showSheetBanner() {
  if (!S.spreadsheetId) return;
  const url = `https://docs.google.com/spreadsheets/d/${S.spreadsheetId}`;
  $('sheet-banner-area').innerHTML =
    `<div class="sheet-banner">📊 Your data is saved to <a href="${url}" target="_blank">this Google Sheet</a>. You can view it anytime.</div>`;
  $('sheet-link-small').innerHTML =
    `<a href="${url}" target="_blank" style="color:var(--sky);font-size:11px;">Open spreadsheet ↗</a>`;
}

async function loadAllData() {
  try {
    const ranges = SHEET_NAMES.filter(n => n !== '_meta').map(n => `${n}!A:Z`);
    const res    = await sheetsReq(
      `${SHEETS_API}/${S.spreadsheetId}/values:batchGet?ranges=${ranges.map(encodeURIComponent).join('&ranges=')}`
    );
    (res.valueRanges || []).forEach((vr, i) => {
      const rows = vr.values || [];
      if (rows.length < 2) return;  // header-only or empty
      parseSheetData(SHEET_NAMES[i], rows[0], rows.slice(1));
    });
    showSheetBanner();
    setSyncStatus('synced', 'All saved');
    await migrateSheetHeaders();  // non-fatal — silently upgrades old sheets
  } catch (e) {
    setSyncStatus('error', 'Load failed');
    toast('Error loading data: ' + e.message, true);
  }
}

/**
 * Parse raw sheet rows into the correct S[sheetName] bucket.
 * Merges the sheet's actual headers with SHEET_HEADERS so columns added
 * in newer schema versions are gracefully defaulted to ''.
 */
function parseSheetData(sheetName, headers, rows) {
  const canonical = SHEET_HEADERS[sheetName] || [];
  const toObj = row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
    canonical.forEach(h => { if (!(h in obj)) obj[h] = ''; });
    return obj;
  };

  if (sheetName === 'children') {
    S.children = rows.map(r => {
      const o    = toObj(r);
      o.yearStart = o.yearStart || '';
      o.yearEnd   = o.yearEnd   || '';
      initChild(o.id);
      return o;
    });
    autoAdvanceLevels();
    if (S.children.length && !S.activeChildId) S.activeChildId = S.children[0].id;

  } else if (sheetName === 'subjects') {
    rows.forEach(r => {
      const o  = toObj(r);
      o.target = parseInt(o.target) || 75;
      if (S.subjects[o.childId]) S.subjects[o.childId].push(o);
    });

  } else if (sheetName === 'grades') {
    rows.forEach(r => {
      const o  = toObj(r);
      o.scored = parseFloat(o.scored) || 0;
      o.max    = parseFloat(o.max)    || 100;
      o.weight = o.weight ? parseFloat(o.weight) : null;
      if (S.grades[o.childId]) S.grades[o.childId].push(o);
    });

  } else if (sheetName === 'tasks') {
    rows.forEach(r => {
      const o      = toObj(r);
      o.done       = o.done === 'true';
      o.isRevision = o.isRevision || '';
      if (S.tasks[o.childId]) S.tasks[o.childId].push(o);
    });

  } else if (sheetName === 'events') {
    rows.forEach(r => {
      const o   = toObj(r);
      o.subject = o.subject || '';  // backward compat
      if (S.events[o.childId]) S.events[o.childId].push(o);
    });

  } else if (sheetName === 'journal') {
    rows.forEach(r => {
      const o = toObj(r);
      // Backward compat: old rows had date/text/mood/tag fields
      if (o.date && o.text && !o.period) {
        o.period = 'term1';
        o.year   = o.date ? o.date.slice(0,4) : '';
        o.highlights = o.text; o.teacherComments = ''; o.improvements = ''; o.targets = '';
        o.subject = o.tag || '';
      }
      if (S.journal[o.childId]) S.journal[o.childId].push(o);
    });

  } else if (sheetName === 'milestones') {
    rows.forEach(r => {
      const o = toObj(r);
      if (S.milestones[o.childId]) S.milestones[o.childId].push(o);
    });
  }
}

/**
 * Silently append any missing columns to existing sheets.
 * Non-fatal — runs after data is already loaded so the app is always usable.
 * Required when the SHEET_HEADERS schema gains a new field.
 */
async function migrateSheetHeaders() {
  try {
    for (const name of SHEET_NAMES.filter(n => n !== '_meta')) {
      const canonical = SHEET_HEADERS[name];
      if (!canonical) continue;
      const res      = await sheetsReq(`${SHEETS_API}/${S.spreadsheetId}/values/${encodeURIComponent(name)}!1:1`);
      const existing = (res.values && res.values[0]) || [];
      const missing  = canonical.filter(col => !existing.includes(col));
      if (!missing.length) continue;
      const startCol = String.fromCharCode(65 + existing.length);
      const endCol   = String.fromCharCode(65 + existing.length + missing.length - 1);
      await sheetsReq(
        `${SHEETS_API}/${S.spreadsheetId}/values/${encodeURIComponent(name)}!${startCol}1:${endCol}1?valueInputOption=RAW`,
        'PUT', { values: [missing] }
      );
      console.log(`Migrated ${name}: added ${missing.join(', ')}`);
    }
  } catch (e) {
    console.warn('Sheet migration failed (non-fatal):', e.message);
  }
}


// ───────────────────────────────────────────────────────────────────
// §9  APP INIT
// ───────────────────────────────────────────────────────────────────

async function loadApp() {
  $('loading-screen').classList.remove('hidden');
  $('loading-msg').textContent    = 'Connecting to your Google Sheet…';
  $('auth-screen').style.display  = 'none';

  // Populate sidebar user chip
  $('user-name-display').textContent  = S.user.name || S.user.email;
  $('user-email-display').textContent = S.user.email;
  const avatarWrap = $('user-avatar-wrap');
  if (S.user.picture) {
    avatarWrap.innerHTML = `<img src="${S.user.picture}" class="user-avatar" onerror="this.style.display='none'">`;
  } else {
    const initial = (S.user.name || S.user.email || '?')[0].toUpperCase();
    avatarWrap.innerHTML = `<div class="user-avatar-fallback">${initial}</div>`;
  }

  await findOrCreateSpreadsheet();

  $('loading-screen').classList.add('hidden');
  $('auth-screen').classList.add('hidden');
  $('app').style.display = 'flex';
  $('app').classList.add('visible');

  renderSidebar();
  renderDashboard();
  renderCalendar();

  // Initialise Telegram onboarding silently in the background.
  // tgInit() is defined in bloom-telegram-connect.js — no-ops gracefully
  // if that file isn't loaded or the Sheet isn't ready yet.
  if (typeof tgInit === 'function') tgInit();
}


// ───────────────────────────────────────────────────────────────────
// §10  SHARED CRUD UTILITIES
// ───────────────────────────────────────────────────────────────────

/**
 * Show the shared confirm-delete modal, then call onConfirm() if confirmed.
 * Usage: confirmDelete('Entry label', async () => { ... delete logic ... })
 */
function confirmDelete(label, onConfirm) {
  $('confirm-delete-title').textContent = 'Delete this entry?';
  $('confirm-delete-msg').textContent   = `"${label}" will be permanently removed. This cannot be undone.`;
  // Clone the button to wipe any stale listeners from a previous call
  const btn    = $('confirm-delete-btn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.onclick = async () => { closeModal('modal-confirm-delete'); await onConfirm(); };
  openModal('modal-confirm-delete');
}

// ── Child ─────────────────────────────────────────────────────────
let _editingChildId = null;

function openEditChild(cid) {
  const c = S.children.find(c => c.id === cid);
  if (!c) return;
  _editingChildId          = cid;
  $('ec-name').value       = c.name      || '';
  $('ec-level').value      = c.level     || 'Primary 1';
  $('ec-year-start').value = c.yearStart || '';
  $('ec-year-end').value   = c.yearEnd   || '';
  openModal('modal-edit-child');
  setTimeout(() => $('ec-name').focus(), 100);
}

async function saveEditChild() {
  const c = S.children.find(c => c.id === _editingChildId);
  if (!c) return;
  const name = $('ec-name').value.trim();
  if (!name) { $('ec-name').focus(); return; }
  c.name      = name;
  c.level     = $('ec-level').value;
  c.yearStart = $('ec-year-start').value;
  c.yearEnd   = $('ec-year-end').value;
  closeModal('modal-edit-child');
  renderSidebar();
  _rerenderActivePage();
  toast('Child profile updated!');
  await updateRow('children', _editingChildId, { name:c.name, level:c.level, yearStart:c.yearStart, yearEnd:c.yearEnd });
  _editingChildId = null;
}

function deleteChild(cid) {
  const c = S.children.find(c => c.id === cid);
  if (!c) return;
  confirmDelete(c.name, async () => {
    S.children = S.children.filter(x => x.id !== cid);
    if (S.activeChildId === cid) S.activeChildId = S.children[0]?.id || null;
    renderSidebar();
    _rerenderActivePage();
    toast('Child removed.');
    await deleteRow('children', cid);
    // Delete every piece of data belonging to this child
    for (const key of ['subjects','grades','tasks','events','journal','milestones']) {
      for (const row of (S[key][cid] || [])) await deleteRow(key, row.id);
      delete S[key][cid];
    }
  });
}

// ── Subject ───────────────────────────────────────────────────────
let _editingSubjectId = null;

function openEditSubject(sid) {
  const s = (S.subjects[S.activeChildId] || []).find(s => s.id === sid);
  if (!s) return;
  _editingSubjectId    = sid;
  $('es-name').value   = s.name   || '';
  $('es-target').value = s.target || 75;
  $('es-type').value   = s.type   || 'standard';
  openModal('modal-edit-subject');
  setTimeout(() => $('es-name').focus(), 100);
}

async function saveEditSubject() {
  const s = (S.subjects[S.activeChildId] || []).find(s => s.id === _editingSubjectId);
  if (!s) return;
  const name = $('es-name').value.trim();
  if (!name) { $('es-name').focus(); return; }
  s.name   = name;
  s.target = parseInt($('es-target').value) || 75;
  s.type   = $('es-type').value;
  closeModal('modal-edit-subject');
  renderGrades();
  toast('Subject updated!');
  await updateRow('subjects', _editingSubjectId, { name:s.name, target:s.target, type:s.type });
  _editingSubjectId = null;
}

// ── Grade ─────────────────────────────────────────────────────────
let _editingGradeId = null;

function openEditGrade(gid) {
  const g = (S.grades[S.activeChildId] || []).find(g => g.id === gid);
  if (!g) return;
  _editingGradeId      = gid;
  $('eg-term').value   = g.term   || 'Term 1';
  $('eg-paper').value  = g.paper  || '';
  $('eg-scored').value = g.scored !== undefined ? g.scored : '';
  $('eg-max').value    = g.max    || 100;
  $('eg-weight').value = g.weight || '';
  openModal('modal-edit-grade');
  setTimeout(() => $('eg-scored').focus(), 100);
}

async function saveEditGrade() {
  const g = (S.grades[S.activeChildId] || []).find(g => g.id === _editingGradeId);
  if (!g) return;
  const scored = parseFloat($('eg-scored').value);
  const max    = parseFloat($('eg-max').value);
  if (isNaN(scored) || isNaN(max) || max <= 0) { toast('Enter valid scores'); return; }
  g.term   = $('eg-term').value;
  g.paper  = $('eg-paper').value.trim();
  g.scored = scored;
  g.max    = max;
  g.weight = parseFloat($('eg-weight').value) || '';
  closeModal('modal-edit-grade');
  renderGrades();
  toast('Grade updated!');
  await updateRow('grades', _editingGradeId, { term:g.term, paper:g.paper, scored:g.scored, max:g.max, weight:g.weight });
  _editingGradeId = null;
}

// ── Reflection ────────────────────────────────────────────────────
let _editingReflectionId = null;

function openEditReflection(rid) {
  const r = (S.journal[S.activeChildId] || []).find(r => r.id === rid);
  if (!r) return;
  _editingReflectionId     = rid;
  $('er-period').value     = r.period          || 'term1';
  $('er-year').value       = r.year            || new Date().getFullYear();
  $('er-subject').value    = r.subject         || '';
  $('er-highlights').value = r.highlights      || '';
  $('er-teacher').value    = r.teacherComments || '';
  $('er-improve').value    = r.improvements    || '';
  $('er-targets').value    = r.targets         || '';
  openModal('modal-edit-reflection');
  setTimeout(() => $('er-highlights').focus(), 100);
}

async function saveEditReflection() {
  const r = (S.journal[S.activeChildId] || []).find(r => r.id === _editingReflectionId);
  if (!r) return;
  r.period          = $('er-period').value;
  r.year            = $('er-year').value;
  r.subject         = $('er-subject').value.trim();
  r.highlights      = $('er-highlights').value.trim();
  r.teacherComments = $('er-teacher').value.trim();
  r.improvements    = $('er-improve').value.trim();
  r.targets         = $('er-targets').value.trim();
  closeModal('modal-edit-reflection');
  renderJournal();
  toast('Reflection updated!');
  await updateRow('journal', _editingReflectionId, {
    period:r.period, year:r.year, subject:r.subject,
    highlights:r.highlights, teacherComments:r.teacherComments,
    improvements:r.improvements, targets:r.targets
  });
  _editingReflectionId = null;
}

// ── Milestone ─────────────────────────────────────────────────────
let _editingMilestoneId = null;

function openEditMilestone(mid) {
  const m = (S.milestones[S.activeChildId] || []).find(m => m.id === mid);
  if (!m) return;
  _editingMilestoneId    = mid;
  $('em-title').value    = m.title    || '';
  $('em-desc').value     = m.desc     || '';
  $('em-date').value     = m.date     || '';
  $('em-category').value = m.category || 'academic';
  openModal('modal-edit-milestone');
  setTimeout(() => $('em-title').focus(), 100);
}

async function saveEditMilestone() {
  const m = (S.milestones[S.activeChildId] || []).find(m => m.id === _editingMilestoneId);
  if (!m) return;
  const title = $('em-title').value.trim();
  if (!title) { $('em-title').focus(); return; }
  m.title    = title;
  m.desc     = $('em-desc').value.trim();
  m.date     = $('em-date').value;
  m.category = $('em-category').value;
  closeModal('modal-edit-milestone');
  renderMilestones();
  renderDashboard();
  toast('Milestone updated!');
  await updateRow('milestones', _editingMilestoneId, { title:m.title, desc:m.desc, date:m.date, category:m.category });
  _editingMilestoneId = null;
}


// ───────────────────────────────────────────────────────────────────
// §11  NAVIGATION
// ───────────────────────────────────────────────────────────────────

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`).classList.add('active');
  renderPage(name);
}

function renderPage(name) {
  const map = {
    dashboard:  renderDashboard,
    grades:     renderGrades,
    tasks:      renderTasks,
    calendar:   renderCalendar,
    journal:    renderJournal,
    milestones: renderMilestones
  };
  if (map[name]) map[name]();
}


// ───────────────────────────────────────────────────────────────────
// §12  SIDEBAR RENDER
// ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  $('child-list-sidebar').innerHTML = S.children.map((c, i) => {
    const yearLabel = c.yearEnd
      ? `${c.level} · until ${c.yearEnd.slice(0,4)}`
      : c.level;
    return `
      <div class="child-chip ${c.id === S.activeChildId ? 'active' : ''}" onclick="selectChild('${c.id}')">
        <div class="child-avatar-small" style="background:${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${c.name[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div class="child-chip-name">${esc(c.name)}</div>
          <div class="child-chip-grade">${yearLabel}</div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0;">
          <button class="del-btn" style="font-size:12px;" onclick="event.stopPropagation();openEditChild('${c.id}')" title="Edit">✎</button>
          <button class="del-btn" onclick="event.stopPropagation();deleteChild('${c.id}')" title="Delete">✕</button>
        </div>
      </div>`;
  }).join('');
}

function selectChild(id) {
  S.activeChildId = id;
  renderSidebar();
  _rerenderActivePage();
}


// ───────────────────────────────────────────────────────────────────
// §13  CHILDREN MODULE
// ───────────────────────────────────────────────────────────────────

function advanceLevel(level, steps) {
  const idx = LEVEL_ORDER.indexOf(level);
  if (idx < 0) return level;
  return LEVEL_ORDER[Math.min(idx + steps, LEVEL_ORDER.length - 1)];
}

/** Auto-advance a child's level when their academic year has ended */
async function autoAdvanceLevels() {
  const today = todayStr();
  let anyChanged = false;
  for (const c of S.children) {
    if (!c.yearEnd || today <= c.yearEnd) continue;
    const endDate      = new Date(c.yearEnd + 'T00:00:00');
    const todayDate    = new Date(today      + 'T00:00:00');
    const yearsElapsed = Math.floor((todayDate - endDate) / (365.25 * 24 * 60 * 60 * 1000)) + 1;
    const newLevel     = advanceLevel(c.level, yearsElapsed);
    if (newLevel === c.level) continue;
    c.level = newLevel;
    // Roll the year window forward by the same number of years
    const ys = new Date(c.yearStart + 'T00:00:00');
    const ye = new Date(c.yearEnd   + 'T00:00:00');
    ys.setFullYear(ys.getFullYear() + yearsElapsed);
    ye.setFullYear(ye.getFullYear() + yearsElapsed);
    c.yearStart  = localDateStr(ys);
    c.yearEnd    = localDateStr(ye);
    anyChanged   = true;
    await updateRow('children', c.id, { level:c.level, yearStart:c.yearStart, yearEnd:c.yearEnd });
  }
  if (anyChanged) { renderSidebar(); toast('🎉 Level updated for the new academic year!'); }
}

function openAddChild() {
  openModal('modal-add-child');
  $('child-name').value = '';
  // Singapore school year defaults: 1 Jan – 14 Nov of current year
  const yr = new Date().getFullYear();
  $('child-year-start').value = `${yr}-01-01`;
  $('child-year-end').value   = `${yr}-11-14`;
  setTimeout(() => $('child-name').focus(), 100);
}

async function saveChild() {
  const name      = $('child-name').value.trim();
  if (!name) { $('child-name').focus(); return; }
  const yearStart = $('child-year-start').value;
  const yearEnd   = $('child-year-end').value;
  if (!yearStart || !yearEnd)  { toast('Please set the academic year dates'); return; }
  if (yearEnd <= yearStart)    { toast('Year end must be after year start');  return; }
  const obj = { id:uid(), name, level:$('child-level').value, yearStart, yearEnd };
  S.children.push(obj);
  initChild(obj.id);
  if (!S.activeChildId) S.activeChildId = obj.id;
  closeModal('modal-add-child');
  renderSidebar();
  _rerenderActivePage();
  toast(esc(name) + ' added! 🌱');
  await appendRow('children', SHEET_HEADERS.children, obj);
}


// ───────────────────────────────────────────────────────────────────
// §14  GRADES MODULE
// ───────────────────────────────────────────────────────────────────

function openAddSubject() {
  if (!child()) { toast('Select a child first'); return; }
  openModal('modal-add-subject');
  $('subj-name').value   = '';
  $('subj-target').value = '75';
  setTimeout(() => $('subj-name').focus(), 100);
}

async function saveSubject() {
  const name = $('subj-name').value.trim();
  if (!name) { $('subj-name').focus(); return; }
  const obj  = { id:uid(), childId:S.activeChildId, name, target:parseInt($('subj-target').value)||75, type:$('subj-type').value };
  S.subjects[S.activeChildId].push(obj);
  closeModal('modal-add-subject');
  renderGrades();
  toast('Subject added!');
  await appendRow('subjects', SHEET_HEADERS.subjects, obj);
}

/** Switch the grade modal between single-paper and multi-component mode */
function onGradeSubjectChange() {
  const subs   = S.subjects[S.activeChildId] || [];
  const subj   = subs.find(s => s.id === $('grade-subject').value);
  const isLang = subj && subj.type === 'language';
  $('grade-single-mode').style.display = isLang ? 'none'  : 'block';
  $('grade-multi-mode').style.display  = isLang ? 'block' : 'none';
  if (isLang && $('grade-components-list').children.length === 0) addComponentRow();
}

let _compRowId = 0;
function addComponentRow(name='', scored='', max='', weight='') {
  const id  = 'cr_' + (_compRowId++);
  const div = document.createElement('div');
  div.className = 'component-row';
  div.id = id;
  div.innerHTML = `
    <input type="text"   placeholder="e.g. P1 Composition" value="${name}"   oninput="updateMultiTotal()">
    <input type="number" placeholder="72"  min="0"          value="${scored}" oninput="updateMultiTotal()">
    <input type="number" placeholder="100" min="1"          value="${max}"    oninput="updateMultiTotal()">
    <input type="number" placeholder="—"  min="0" max="100" value="${weight}" oninput="updateMultiTotal()">
    <button class="del-btn" onclick="removeComponentRow('${id}')" title="Remove">✕</button>`;
  $('grade-components-list').appendChild(div);
  updateMultiTotal();
}

function removeComponentRow(id) { const el=$(id); if(el) el.remove(); updateMultiTotal(); }

function updateMultiTotal() {
  const rows = $('grade-components-list').querySelectorAll('.component-row');
  let ts = 0, tm = 0, valid = false;
  rows.forEach(row => {
    const inp = row.querySelectorAll('input');
    const s = parseFloat(inp[1].value), m = parseFloat(inp[2].value);
    if (!isNaN(s) && !isNaN(m) && m > 0) { ts += s; tm += m; valid = true; }
  });
  const tot = $('grade-multi-total');
  if (valid) { tot.style.display = 'block'; $('grade-multi-total-val').textContent = `${ts}/${tm} = ${(ts/tm*100).toFixed(1)}%`; }
  else       { tot.style.display = 'none'; }
}

function openAddGrade() {
  if (!child()) { toast('Select a child first'); return; }
  const subs = S.subjects[S.activeChildId] || [];
  if (!subs.length) { toast('Add a subject first'); return; }
  $('grade-subject').innerHTML     = subs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('grade-paper').value           = '';
  $('grade-scored').value          = '';
  $('grade-max').value             = '100';
  $('grade-weight').value          = '';
  $('grade-components-list').innerHTML = '';
  $('grade-multi-total').style.display = 'none';
  $('grade-modal-title').textContent   = 'Add Grade Entry';
  onGradeSubjectChange();
  openModal('modal-add-grade');
}

async function saveGrade() {
  const subs   = S.subjects[S.activeChildId] || [];
  const sid    = $('grade-subject').value;
  const subj   = subs.find(s => s.id === sid);
  const isLang = subj && subj.type === 'language';
  const term   = $('grade-term').value;

  if (!isLang) {
    // Standard subject — one row
    const scored = parseFloat($('grade-scored').value);
    const max    = parseFloat($('grade-max').value);
    if (isNaN(scored) || isNaN(max) || max <= 0) { toast('Enter valid scores'); return; }
    const obj = { id:uid(), childId:S.activeChildId, subjectId:sid, term, paper:$('grade-paper').value.trim(), scored, max, weight:parseFloat($('grade-weight').value)||'' };
    S.grades[S.activeChildId].push(obj);
    closeModal('modal-add-grade');
    renderGrades();
    toast('Grade saved!');
    await appendRow('grades', SHEET_HEADERS.grades, obj);
  } else {
    // Language subject — one row per component
    const rows = $('grade-components-list').querySelectorAll('.component-row');
    if (!rows.length) { toast('Add at least one component'); return; }
    const toSave = []; let valid = true;
    rows.forEach(row => {
      const inp    = row.querySelectorAll('input');
      const scored = parseFloat(inp[1].value), max = parseFloat(inp[2].value);
      if (isNaN(scored) || isNaN(max) || max <= 0) { valid = false; return; }
      toSave.push({ id:uid(), childId:S.activeChildId, subjectId:sid, term, paper:inp[0].value.trim(), scored, max, weight:parseFloat(inp[3].value)||'' });
    });
    if (!valid) { toast('Fill in score and max score for each component'); return; }
    closeModal('modal-add-grade');
    for (const obj of toSave) { S.grades[S.activeChildId].push(obj); await appendRow('grades', SHEET_HEADERS.grades, obj); }
    renderGrades();
    toast(`${toSave.length} component${toSave.length>1?'s':''} saved!`);
  }
}

async function deleteGrade(gid) {
  S.grades[S.activeChildId] = S.grades[S.activeChildId].filter(g => g.id !== gid);
  renderGrades();
  await deleteRow('grades', gid);
}

async function deleteSubject(sid) {
  const id       = S.activeChildId;
  const gradeIds = (S.grades[id]||[]).filter(g => g.subjectId === sid).map(g => g.id);
  S.subjects[id] = S.subjects[id].filter(s => s.id !== sid);
  S.grades[id]   = S.grades[id].filter(g => g.subjectId !== sid);
  renderGrades();
  await deleteRow('subjects', sid);
  for (const gid of gradeIds) await deleteRow('grades', gid);
}

function renderGrades() {
  const c    = child();
  $('grades-no-child').classList.toggle('show', !c);
  const cont = $('grades-content');
  if (!c) { cont.innerHTML = ''; return; }

  const subs   = S.subjects[c.id] || [];
  const grades = S.grades[c.id]   || [];
  if (!subs.length) { cont.innerHTML = _emptyState('📚','No subjects yet','Click "＋ Subject" to add your first subject.'); return; }

  cont.innerHTML = subs.map(s => {
    const sg      = grades.filter(g => g.subjectId === s.id);
    const ts      = sg.reduce((a,g) => a + g.scored, 0);
    const tm      = sg.reduce((a,g) => a + g.max, 0);
    const overall = sg.length && tm > 0 ? ts/tm*100 : null;
    let badge = '';
    if (overall !== null) {
      const d = overall - s.target;
      badge = d >= 0   ? '<span class="status-bloom">🌸 Blooming</span>'
            : d >= -5  ? '<span class="status-almost">🌼 Almost there</span>'
            :            '<span class="status-room">🌱 Room to bloom</span>';
    }
    const gradesHtml = sg.length
      ? `<table class="grade-table">
           <thead><tr><th>Term</th><th>Paper</th><th>Score</th><th>%</th><th>Weightage</th><th></th></tr></thead>
           <tbody>${sg.map(g => `
             <tr>
               <td>${g.term}</td>
               <td>${g.paper||'—'}</td>
               <td>${g.scored}/${g.max}</td>
               <td class="score-pct">${(g.scored/g.max*100).toFixed(1)}%</td>
               <td>${g.weight ? g.weight+'%' : '—'}</td>
               <td style="white-space:nowrap;">
                 <button class="del-btn" style="font-size:12px;" onclick="openEditGrade('${g.id}')">✎</button>
                 <button class="del-btn" onclick="confirmDelete('${esc(g.term)} grade',()=>deleteGrade('${g.id}'))">✕</button>
               </td>
             </tr>`).join('')}
           </tbody>
         </table>`
      : '<div style="font-size:13px;color:var(--text-soft);text-align:center;padding:12px 0;">No grades yet. Click "＋ Grade" to add.</div>';

    return `
      <div class="subject-card">
        <div class="subject-header">
          <div>
            <div class="subject-name">${esc(s.name)}</div>
            <div style="font-size:12px;color:var(--text-soft);margin-top:2px;">Target: ${s.target}%${overall!==null?` · Current: <b>${overall.toFixed(1)}%</b>`:''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${badge}
            <button class="del-btn" style="font-size:12px;" onclick="openEditSubject('${s.id}')" title="Edit subject">✎</button>
            <button class="del-btn" onclick="confirmDelete('${esc(s.name)}',()=>deleteSubject('${s.id}'))" title="Remove subject">🗑</button>
          </div>
        </div>
        ${gradesHtml}
      </div>`;
  }).join('');
}


// ───────────────────────────────────────────────────────────────────
// §15  TASKS MODULE
// ───────────────────────────────────────────────────────────────────

// Module-level state
let _addTaskIsRevision     = false;
let _editingTaskId         = null;
let _editTaskDoneState     = false;
let _editTaskRevisionState = false;
let _pendingMilestoneTask  = null;  // held while early-completion modal is open

// ── Toggle helpers ───────────────────────────────────────────────
function toggleAddTaskRevision()  { _addTaskIsRevision     = !_addTaskIsRevision;     setToggleUI('add-task-revision-check',  _addTaskIsRevision,     'var(--sky)');  }
function toggleEditTaskRevision() { _editTaskRevisionState = !_editTaskRevisionState; setToggleUI('edit-task-revision-check', _editTaskRevisionState, 'var(--sky)');  }
function toggleEditTaskDone()     { _editTaskDoneState     = !_editTaskDoneState;     setToggleUI('edit-task-done-check',     _editTaskDoneState,     'var(--sage)'); }

// ── Add task ─────────────────────────────────────────────────────
function openAddTask() {
  if (!child()) { toast('Select a child first'); return; }
  $('task-title-input').value = '';
  $('task-subject').value     = '';
  $('task-due').value         = todayStr();
  $('task-notes').value       = '';
  _addTaskIsRevision          = false;
  setToggleUI('add-task-revision-check', false, 'var(--sky)');
  openModal('modal-add-task');
  setTimeout(() => $('task-title-input').focus(), 100);
}

async function saveTask() {
  const title = $('task-title-input').value.trim();
  if (!title) { $('task-title-input').focus(); return; }
  const obj = {
    id:uid(), childId:S.activeChildId, title,
    subject:    $('task-subject').value.trim(),
    priority:   $('task-priority').value,
    due:        $('task-due').value,
    notes:      $('task-notes').value.trim(),
    done:       false,
    isRevision: _addTaskIsRevision ? 'true' : ''
  };
  S.tasks[S.activeChildId].push(obj);
  closeModal('modal-add-task');
  renderTasks();
  renderDashboard();
  const ok = await appendRow('tasks', SHEET_HEADERS.tasks, obj);
  if (ok !== false) toast('Task added!');
}

// ── Toggle task done (from task list checkmark) ──────────────────
async function toggleTask(tid) {
  const t = S.tasks[S.activeChildId].find(t => t.id === tid);
  if (!t) return;
  t.done = !t.done;
  renderTasks();
  renderDashboard();
  await updateCell('tasks', tid, 'done', t.done);
  if (t.done && t.due) _offerEarlyMilestone(t);
}

// ── Edit task modal ───────────────────────────────────────────────
function openEditTask(tid) {
  const t = (S.tasks[S.activeChildId]||[]).find(t => t.id === tid);
  if (!t) return;
  _editingTaskId         = tid;
  _editTaskDoneState     = t.done || false;
  _editTaskRevisionState = t.isRevision === 'true';
  $('edit-task-title').value    = t.title    || '';
  $('edit-task-subject').value  = t.subject  || '';
  $('edit-task-priority').value = t.priority || 'medium';
  $('edit-task-due').value      = t.due      || '';
  $('edit-task-notes').value    = t.notes    || '';
  setToggleUI('edit-task-revision-check', _editTaskRevisionState, 'var(--sky)');
  setToggleUI('edit-task-done-check',     _editTaskDoneState,     'var(--sage)');
  openModal('modal-edit-task');
  setTimeout(() => $('edit-task-title').focus(), 100);
}

async function saveEditTask() {
  const t = (S.tasks[S.activeChildId]||[]).find(t => t.id === _editingTaskId);
  if (!t) return;
  const title = $('edit-task-title').value.trim();
  if (!title) { $('edit-task-title').focus(); return; }
  const wasNotDone = !t.done;
  t.title      = title;
  t.subject    = $('edit-task-subject').value.trim();
  t.priority   = $('edit-task-priority').value;
  t.due        = $('edit-task-due').value;
  t.notes      = $('edit-task-notes').value.trim();
  t.done       = _editTaskDoneState;
  t.isRevision = _editTaskRevisionState ? 'true' : '';
  closeModal('modal-edit-task');
  renderTasks();
  renderDashboard();
  toast('Task updated!');
  await updateRow('tasks', _editingTaskId, { title:t.title, subject:t.subject, priority:t.priority, due:t.due, notes:t.notes, done:t.done, isRevision:t.isRevision });
  if (wasNotDone && t.done && t.due) _offerEarlyMilestone(t);
  _editingTaskId = null;
}

async function deleteTask(tid) {
  S.tasks[S.activeChildId] = S.tasks[S.activeChildId].filter(t => t.id !== tid);
  renderTasks();
  renderDashboard();
  await deleteRow('tasks', tid);
}

// ── Early-completion milestone prompt ────────────────────────────
function _offerEarlyMilestone(t) {
  const daysEarly = Math.round(
    (new Date(t.due + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000
  );
  if (daysEarly < 1) return;
  _pendingMilestoneTask = t;
  $('milestone-prompt-msg').textContent =
    `"${t.title}" was completed ${daysEarly === 1 ? '1 day' : daysEarly + ' days'} early! Would you like to log this as a milestone?`;
  const suggested = t.title.length > 40 ? t.title.substring(0,40) + '…' : t.title;
  $('mp-title').value    = `Completed "${suggested}" ahead of schedule!`;
  $('mp-category').value = 'academic';
  openModal('modal-milestone-prompt');
}

async function saveMilestoneFromPrompt() {
  const t = _pendingMilestoneTask;
  if (!t) return;
  const obj = {
    id:uid(), childId:S.activeChildId,
    title:    $('mp-title').value.trim() || `Completed "${t.title}" early!`,
    desc:     t.subject ? `Subject: ${t.subject}` : '',
    date:     todayStr(),
    category: $('mp-category').value
  };
  S.milestones[S.activeChildId].push(obj);
  closeModal('modal-milestone-prompt');
  _pendingMilestoneTask = null;
  renderMilestones();
  renderDashboard();
  toast('Milestone logged! 🏆');
  await appendRow('milestones', SHEET_HEADERS.milestones, obj);
}

// ── Revision scheduling (also feeds dashboard warnings) ──────────
function openAddRevision(subjectName) {
  if (!child()) { toast('Select a child first'); return; }
  const subs = S.subjects[S.activeChildId] || [];
  if (!subs.length) { toast('Add a subject first'); return; }
  $('rev-subject-sel').innerHTML = subs.map(s =>
    `<option value="${esc(s.name)}" ${s.name===subjectName?'selected':''}>${esc(s.name)}</option>`
  ).join('');
  const startD = new Date(); startD.setDate(startD.getDate()+1);
  const untilD = new Date(); untilD.setDate(untilD.getDate()+28);
  $('rev-start-date').value          = localDateStr(startD);
  $('rev-until-date').value          = localDateStr(untilD);
  $('rev-recur').value               = 'weekly';
  $('rev-until-group').style.display = 'block';
  $('rev-notes').value               = '';
  openModal('modal-add-revision');
}

async function saveRevisionTask() {
  const subject   = $('rev-subject-sel').value;
  const startDate = $('rev-start-date').value;
  const recur     = $('rev-recur').value;
  const until     = $('rev-until-date').value;
  const notes     = $('rev-notes').value.trim();
  if (!startDate) { toast('Please pick a start date'); return; }

  const dates = _buildDates(startDate, recur, until, { type:'revision' });
  closeModal('modal-add-revision');
  for (const date of dates) {
    const obj = { id:uid(), childId:S.activeChildId, title:'Revision — '+subject, subject, priority:'medium', due:date, notes, done:false, isRevision:'true' };
    S.tasks[S.activeChildId].push(obj);
    await appendRow('tasks', SHEET_HEADERS.tasks, obj);
  }
  renderTasks();
  renderDashboard();
  toast(`${dates.length} revision session${dates.length>1?'s':''} scheduled for ${subject}! 📚`);
}

// ── Render ────────────────────────────────────────────────────────
function renderTasks() {
  const c    = child();
  $('tasks-no-child').classList.toggle('show', !c);
  const cont = $('tasks-content');
  if (!c) { cont.innerHTML = ''; return; }

  const tasks = S.tasks[c.id] || [];
  if (!tasks.length) { cont.innerHTML = _emptyState('✅','No tasks yet','Click "＋ Add Task" to add homework or assignments.'); return; }

  const row = t => `
    <div class="task-item ${t.done?'done':''}">
      <div class="task-check ${t.done?'checked':''}" onclick="toggleTask('${t.id}')">${t.done?'✓':''}</div>
      <div style="flex:1;cursor:pointer;" onclick="openEditTask('${t.id}')">
        <div class="task-title-text">${esc(t.title)}${t.isRevision==='true'?' <span class="revision-badge">📚 Revision</span>':''}</div>
        <div class="task-meta">${t.subject?esc(t.subject)+' · ':''}${t.due?'Due '+fmtDate(t.due):'No due date'} <span class="edit-hint">✎ tap to edit</span></div>
      </div>
      <span class="priority-${t.priority==='high'?'high':t.priority==='medium'?'med':'low'}">${t.priority}</span>
      <button class="del-btn" onclick="confirmDelete('${esc(t.title)}',()=>deleteTask('${t.id}'))">✕</button>
    </div>`;

  const pending = tasks.filter(t => !t.done);
  const done    = tasks.filter(t =>  t.done);
  cont.innerHTML =
    (pending.length ? `<div class="list-section-label">Pending (${pending.length})</div>${pending.map(row).join('')}` : '') +
    (done.length    ? `<div class="list-section-label" style="margin-top:18px;">Completed (${done.length})</div>${done.map(row).join('')}` : '');
}


// ───────────────────────────────────────────────────────────────────
// §16  CALENDAR MODULE
// ───────────────────────────────────────────────────────────────────

// ── Recurring date builder (shared by events and revision tasks) ──
/**
 * Build an array of YYYY-MM-DD strings for a recurring schedule.
 * Always uses localDateStr() — never toISOString() — to avoid SGT drift.
 */
function _buildDates(startDate, recur, endDate, opts = {}) {
  const isRevision = opts.type === 'revision';
  if (recur === 'none' || recur === 'once') return [startDate];
  const cur  = new Date(startDate + 'T00:00:00');
  const end  = endDate
    ? new Date(endDate + 'T00:00:00')
    : (() => { const d = new Date(cur); d.setMonth(d.getMonth() + (isRevision ? 1 : 3)); return d; })();
  const dates = [];
  while (cur <= end && dates.length < 200) {
    dates.push(localDateStr(cur));
    if      (recur === 'weekly')    cur.setDate(cur.getDate() + 7);
    else if (recur === 'biweekly')  cur.setDate(cur.getDate() + 14);
    else if (recur === 'monthly')   cur.setMonth(cur.getMonth() + 1);
    else                            cur.setDate(cur.getDate() + 14); // fallback
  }
  return dates;
}

// ── Form helpers ──────────────────────────────────────────────────
function toggleRecurEnd() {
  const val = $('event-recur').value;
  $('recur-end-group').style.display = val === 'none' ? 'none' : 'block';
  if (val !== 'none' && !$('event-recur-end').value) {
    const d = new Date($('event-date').value || todayStr());
    d.setMonth(d.getMonth() + 3);
    $('event-recur-end').value = localDateStr(d);
  }
}
function toggleEventSubject()     { $('event-subject-group').style.display      = $('event-category').value      === 'exam' ? 'block' : 'none'; }
function toggleEditEventSubject() { $('edit-event-subject-group').style.display = $('edit-event-category').value === 'exam' ? 'block' : 'none'; }

// ── Add / save event ──────────────────────────────────────────────
function openAddEvent(dateStr) {
  if (!child()) { toast('Select a child first'); return; }
  $('event-title').value             = '';
  $('event-date').value              = dateStr || todayStr();
  $('event-notes').value             = '';
  $('event-subject').value           = '';
  $('event-category').value          = 'exam';
  $('event-recur').value             = 'none';
  $('recur-end-group').style.display = 'none';
  $('event-recur-end').value         = '';
  toggleEventSubject();
  openModal('modal-add-event');
  setTimeout(() => $('event-title').focus(), 100);
}

async function saveEvent() {
  const title = $('event-title').value.trim();
  if (!title) { $('event-title').focus(); return; }
  const startDate = $('event-date').value;
  if (!startDate) { toast('Please pick a date'); return; }
  const recur    = $('event-recur').value;
  const category = $('event-category').value;
  const subject  = category === 'exam' ? $('event-subject').value.trim() : '';
  const notes    = $('event-notes').value.trim();
  const dates    = _buildDates(startDate, recur, $('event-recur-end').value);
  closeModal('modal-add-event');
  for (const date of dates) {
    const obj = { id:uid(), childId:S.activeChildId, title, date, category, subject, notes };
    S.events[S.activeChildId].push(obj);
    await appendRow('events', SHEET_HEADERS.events, obj);
  }
  renderCalendar();
  toast(dates.length > 1 ? `${dates.length} events added! 📅` : 'Event added!');
}

async function deleteEvent(eid) {
  S.events[S.activeChildId] = S.events[S.activeChildId].filter(e => e.id !== eid);
  renderCalendar();
  renderDashboard();
  await deleteRow('events', eid);
}

// ── Edit event modal ──────────────────────────────────────────────
let _editingEventId = null;

function openEditEvent(eid) {
  const e = (S.events[S.activeChildId]||[]).find(e => e.id === eid);
  if (!e) return;
  _editingEventId                    = eid;
  $('edit-event-title').value        = e.title    || '';
  $('edit-event-date').value         = e.date     || '';
  $('edit-event-category').value     = e.category || 'personal';
  $('edit-event-subject').value      = e.subject  || '';
  $('edit-event-notes').value        = e.notes    || '';
  toggleEditEventSubject();
  openModal('modal-edit-event');
  setTimeout(() => $('edit-event-title').focus(), 100);
}

async function saveEditEvent() {
  const e = (S.events[S.activeChildId]||[]).find(e => e.id === _editingEventId);
  if (!e) return;
  const title = $('edit-event-title').value.trim();
  if (!title) { $('edit-event-title').focus(); return; }
  e.title    = title;
  e.date     = $('edit-event-date').value;
  e.category = $('edit-event-category').value;
  e.subject  = e.category === 'exam' ? $('edit-event-subject').value.trim() : '';
  e.notes    = $('edit-event-notes').value.trim();
  closeModal('modal-edit-event');
  renderCalendar();
  renderDashboard();
  toast('Event updated!');
  await updateRow('events', _editingEventId, { title:e.title, date:e.date, category:e.category, subject:e.subject, notes:e.notes });
  _editingEventId = null;
}

// ── Calendar navigation ───────────────────────────────────────────
function calPrev() { if (--S.calMonth < 0)  { S.calMonth = 11; S.calYear--; } renderCalendar(); }
function calNext() { if (++S.calMonth > 11) { S.calMonth =  0; S.calYear++; } renderCalendar(); }

// ── Render ────────────────────────────────────────────────────────
function renderCalendar() {
  const c = child();
  $('cal-no-child').classList.toggle('show', !c);
  const { calYear:y, calMonth:m } = S;
  $('cal-month-title').textContent = `${MONTH_NAMES[m]} ${y}`;

  const events      = c ? (S.events[c.id]||[]) : [];
  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const daysInPrev  = new Date(y, m,   0).getDate();
  const ts          = todayStr();

  // Build the grid cells including prev/next-month padding
  const days = [];
  for (let i=firstDay-1; i>=0; i--)   days.push({ day:daysInPrev-i, cur:false });
  for (let d=1; d<=daysInMonth; d++)   days.push({ day:d,            cur:true  });
  while (days.length % 7 !== 0)        days.push({ day:days.length-daysInMonth-firstDay+1, cur:false });

  $('cal-grid').innerHTML =
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(h => `<div class="cal-header-cell">${h}</div>`).join('') +
    days.map(({ day, cur }) => {
      const ds      = cur ? `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
      const isToday = ds === ts;
      const de      = ds ? events.filter(e => e.date === ds) : [];
      const visible = de.slice(0, 2);
      const more    = de.length - visible.length;
      return `<div class="cal-cell ${isToday?'today':''} ${!cur?'other-month':''}" ${cur?`onclick="openAddEvent('${ds}')"`:''}><div class="cal-day-num">${day}</div>
        <div class="cal-events-wrap">
          ${visible.map(e => `<div class="cal-event-dot" onclick="event.stopPropagation();openEditEvent('${e.id}')" title="Tap to edit">${CAT_EMOJI[e.category]||'•'} ${esc(e.title)}</div>`).join('')}
          ${more > 0 ? `<div style="font-size:10px;color:var(--text-soft);padding:1px 4px;">+${more} more</div>` : ''}
        </div>
      </div>`;
    }).join('');

  // Events list below the grid
  const list = $('events-list');
  if (!c || !events.length) {
    list.innerHTML = _emptyState('📅','No events','Click "＋ Add Event" or any date on the calendar.','padding:24px 0;');
    return;
  }
  list.innerHTML = [...events].sort((a,b) => a.date.localeCompare(b.date)).map(e => `
    <div class="task-item">
      <div style="font-size:22px;">${CAT_EMOJI[e.category]||'⭐'}</div>
      <div style="flex:1;cursor:pointer;" onclick="openEditEvent('${e.id}')">
        <div class="task-title-text">${esc(e.title)}</div>
        <div class="task-meta">${fmtDate(e.date)} · ${e.category}${e.notes?' · '+esc(e.notes):''} <span class="edit-hint">✎ tap to edit</span></div>
      </div>
      <button class="del-btn" onclick="confirmDelete('${esc(e.title)}',()=>deleteEvent('${e.id}'))">✕</button>
    </div>`).join('');
}


// ───────────────────────────────────────────────────────────────────
// §17  REFLECTION MODULE
// ───────────────────────────────────────────────────────────────────

function openAddReflection() {
  if (!child()) { toast('Select a child first'); return; }
  $('ref-period').value             = 'term1';
  $('ref-year').value               = new Date().getFullYear();
  $('ref-subject').value            = '';
  $('ref-highlights').value         = '';
  $('ref-teacher').value            = '';
  $('ref-improve').value            = '';
  $('ref-targets').value            = '';
  $('reflection-modal-title').textContent = 'Add Reflection';
  openModal('modal-add-journal');
  setTimeout(() => $('ref-highlights').focus(), 100);
}
// Alias kept for backward compat
const openAddJournal = openAddReflection;

async function saveReflection() {
  const highlights   = $('ref-highlights').value.trim();
  const improvements = $('ref-improve').value.trim();
  const targets      = $('ref-targets').value.trim();
  if (!highlights && !improvements && !targets) { toast('Please fill in at least one section'); return; }
  const obj = {
    id:uid(), childId:S.activeChildId,
    period:          $('ref-period').value,
    year:            $('ref-year').value || new Date().getFullYear(),
    subject:         $('ref-subject').value.trim(),
    highlights,
    teacherComments: $('ref-teacher').value.trim(),
    improvements,
    targets
  };
  S.journal[S.activeChildId].push(obj);
  closeModal('modal-add-journal');
  renderJournal();
  toast('Reflection saved! 📓');
  await appendRow('journal', SHEET_HEADERS.journal, obj);
}
// Alias kept for backward compat
const saveJournal = saveReflection;

async function deleteJournal(jid) {
  S.journal[S.activeChildId] = S.journal[S.activeChildId].filter(j => j.id !== jid);
  renderJournal();
  await deleteRow('journal', jid);
}

function renderJournal() {
  const c    = child();
  $('journal-no-child').classList.toggle('show', !c);
  const cont = $('journal-content');
  if (!c) { cont.innerHTML = ''; return; }

  const entries = S.journal[c.id] || [];
  if (!entries.length) {
    cont.innerHTML = _emptyState('📓','No reflections yet','After each term or year, add a reflection to capture what went well, teacher feedback, and targets for next time.');
    return;
  }

  const periodOrder = { year:0, term4:1, term3:2, term2:3, term1:4 };
  const sorted = [...entries].sort((a,b) => {
    const yDiff = (parseInt(b.year)||0) - (parseInt(a.year)||0);
    return yDiff !== 0 ? yDiff : (periodOrder[a.period]||5) - (periodOrder[b.period]||5);
  });

  cont.innerHTML = sorted.map(r => {
    const pLabel   = PERIOD_LABELS[r.period] || r.period;
    const sections = [
      { label:'✨ Highlights',          body:r.highlights },
      { label:"💬 Teacher's comments",  body:r.teacherComments },
      { label:'🔧 Areas to improve',    body:r.improvements }
    ].filter(s => s.body);
    return `
      <div class="reflection-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
          <div>
            <span class="reflection-period">📅 ${pLabel} ${r.year||''}</span>
            ${r.subject
              ? `<span class="reflection-subject">📚 ${esc(r.subject)}</span>`
              : `<span class="reflection-subject" style="background:var(--stone-pale);color:var(--text-soft);">General</span>`}
          </div>
          <div>
            <button class="del-btn" style="font-size:12px;" onclick="openEditReflection('${r.id}')" title="Edit">✎</button>
            <button class="del-btn" onclick="confirmDelete('${esc(pLabel)} ${esc(r.year||'')} reflection',()=>deleteJournal('${r.id}'))">✕</button>
          </div>
        </div>
        ${sections.map(s => `
          <div class="reflection-section">
            <div class="reflection-section-label">${s.label}</div>
            <div class="reflection-section-body">${esc(s.body)}</div>
          </div>`).join('')}
        ${r.targets ? `
          <div class="reflection-section">
            <div class="reflection-section-label">🎯 Targets for next period</div>
            <div class="reflection-target">${esc(r.targets)}</div>
          </div>` : ''}
      </div>`;
  }).join('');
}


// ───────────────────────────────────────────────────────────────────
// §18  MILESTONES MODULE
// ───────────────────────────────────────────────────────────────────

function openAddMilestone() {
  if (!child()) { toast('Select a child first'); return; }
  $('ms-title').value = ''; $('ms-desc').value = ''; $('ms-date').value = todayStr();
  openModal('modal-add-milestone');
  setTimeout(() => $('ms-title').focus(), 100);
}

async function saveMilestone() {
  const title = $('ms-title').value.trim();
  if (!title) { $('ms-title').focus(); return; }
  const obj = { id:uid(), childId:S.activeChildId, title, desc:$('ms-desc').value.trim(), date:$('ms-date').value, category:$('ms-category').value };
  S.milestones[S.activeChildId].push(obj);
  closeModal('modal-add-milestone');
  renderMilestones();
  renderDashboard();
  toast('Milestone logged! 🏆');
  await appendRow('milestones', SHEET_HEADERS.milestones, obj);
}

async function deleteMilestone(mid) {
  S.milestones[S.activeChildId] = S.milestones[S.activeChildId].filter(m => m.id !== mid);
  renderMilestones();
  await deleteRow('milestones', mid);
}

function renderMilestones() {
  const c    = child();
  $('milestones-no-child').classList.toggle('show', !c);
  const cont = $('milestones-content');
  if (!c) { cont.innerHTML = ''; return; }
  const items = S.milestones[c.id] || [];
  if (!items.length) { cont.innerHTML = _emptyState('🏆','No milestones yet','Celebrate achievements by clicking "＋ Add Milestone".'); return; }
  cont.innerHTML = [...items].sort((a,b) => b.date.localeCompare(a.date)).map(m => `
    <div class="milestone-item">
      <div class="milestone-icon-wrap">${CAT_ICONS[m.category]||'⭐'}</div>
      <div style="flex:1;">
        <div class="milestone-title-text">${esc(m.title)}</div>
        ${m.desc ? `<div class="milestone-meta">${esc(m.desc)}</div>` : ''}
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <span class="milestone-category cat-${m.category}">${m.category}</span>
          <span class="milestone-meta">${fmtDate(m.date)}</span>
        </div>
      </div>
      <button class="del-btn" style="font-size:12px;" onclick="openEditMilestone('${m.id}')" title="Edit">✎</button>
      <button class="del-btn" onclick="confirmDelete('${esc(m.title)}',()=>deleteMilestone('${m.id}'))">✕</button>
    </div>`).join('');
}


// ───────────────────────────────────────────────────────────────────
// §19  DASHBOARD
// ───────────────────────────────────────────────────────────────────

function renderDashboard() {
  const c = child();
  $('dash-no-child').classList.toggle('show', !c);

  if (!c) {
    $('sum-subjects').textContent   = '0';
    $('sum-tasks').textContent      = '0';
    $('sum-events').textContent     = '0';
    $('sum-milestones').textContent = '0';
    $('dash-sub').textContent       = 'Add a child to get started';
    $('dash-upcoming-tasks').innerHTML = _emptyState('✅',null,'No tasks yet','padding:16px 0;');
    $('dash-upcoming-exams').innerHTML = _emptyState('📝',null,'No exams yet','padding:16px 0;');
    $('recent-activity').innerHTML     = _emptyState('🌱',null,'Add a child to see activity here.');
    return;
  }

  $('dash-sub').textContent = 'Overview for ' + esc(c.name);

  // ── Summary counters ─────────────────────────────────────────
  const now = new Date();
  const ym  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  $('sum-subjects').textContent   = (S.subjects[c.id]  ||[]).length;
  $('sum-tasks').textContent      = (S.tasks[c.id]     ||[]).filter(t => !t.done).length;
  $('sum-events').textContent     = (S.events[c.id]    ||[]).filter(e => e.date && e.date.startsWith(ym)).length;
  $('sum-milestones').textContent = (S.milestones[c.id]||[]).length;

  const ts   = todayStr();
  const in14 = localDateStr(new Date(Date.now() + TASK_DAYS * 86400000));
  const in30 = localDateStr(new Date(Date.now() + EXAM_DAYS * 86400000));

  // ── Upcoming tasks ────────────────────────────────────────────
  const upcomingTasks = (S.tasks[c.id]||[])
    .filter(t => !t.done && t.due && t.due <= in14)
    .sort((a,b) => a.due.localeCompare(b.due));

  $('dash-upcoming-tasks').innerHTML = upcomingTasks.length
    ? upcomingTasks.map(t => {
        const daysUntil = Math.round((new Date(t.due+'T00:00:00') - new Date(ts+'T00:00:00')) / 86400000);
        const { badge, cls } = _dueBadge(daysUntil, t.due < ts);
        return `
          <div class="upcoming-item ${t.due<ts?'overdue':''}" style="cursor:pointer;" onclick="openEditTask('${t.id}')">
            <div class="upcoming-item-icon">✅</div>
            <div style="flex:1;">
              <div class="upcoming-item-title">${esc(t.title)}</div>
              <div class="upcoming-item-meta">${esc(t.subject)||'No subject'} · Due ${fmtDate(t.due)} <span class="edit-hint">✎ tap to edit</span></div>
            </div>
            <div class="due-badge ${cls}">${badge}</div>
          </div>`;
      }).join('')
    : _emptyState('🎉',null,'Nothing due in the next 2 weeks!','padding:16px 0;');

  // ── Upcoming exams ────────────────────────────────────────────
  const upcomingExams = (S.events[c.id]||[])
    .filter(e => e.category==='exam' && e.date>=ts && e.date<=in30)
    .sort((a,b) => a.date.localeCompare(b.date));

  $('dash-upcoming-exams').innerHTML = upcomingExams.length
    ? upcomingExams.map(e => {
        const daysUntil = Math.round((new Date(e.date+'T00:00:00') - new Date(ts+'T00:00:00')) / 86400000);
        const { badge, cls } = _dueBadge(daysUntil, false);
        return `
          <div class="upcoming-item exam" style="cursor:pointer;" onclick="openEditEvent('${e.id}')">
            <div class="upcoming-item-icon">📝</div>
            <div style="flex:1;">
              <div class="upcoming-item-title">${esc(e.title)}</div>
              <div class="upcoming-item-meta">${fmtDate(e.date)}${e.notes?' · '+esc(e.notes):''} <span class="edit-hint">✎ tap to edit</span></div>
            </div>
            <div class="due-badge ${cls}">${badge}</div>
          </div>`;
      }).join('')
    : _emptyState('📚',null,'No exams in the next month','padding:16px 0;');

  // ── Revision warnings ─────────────────────────────────────────
  _renderRevisionWarnings(c, upcomingExams, ts);

  // ── Recent activity ───────────────────────────────────────────
  const all = [];
  (S.grades[c.id]    ||[]).forEach(g => { const s=(S.subjects[c.id]||[]).find(s=>s.id===g.subjectId); all.push({date:ts,icon:'📊',text:`Grade added: ${s?s.name:'Subject'} ${g.term} — ${g.scored}/${g.max}`}); });
  (S.tasks[c.id]     ||[]).forEach(t => all.push({date:t.due||ts,icon:'✅',text:`Task: ${t.title}${t.done?' ✓':''}`}));
  (S.milestones[c.id]||[]).forEach(m => all.push({date:m.date,icon:'🏆',text:`Milestone: ${m.title}`}));
  (S.journal[c.id]   ||[]).forEach(j => all.push({date:j.date||ts,icon:'📓',text:`Journal: ${(j.highlights||j.text||'').substring(0,60)}`}));

  const recent = all.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  $('recent-activity').innerHTML = recent.length
    ? recent.map(a=>`
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--parchment);">
          <span style="font-size:18px;">${a.icon}</span>
          <div>
            <div style="font-size:13px;">${a.text}</div>
            <div style="font-size:11px;color:var(--text-soft);margin-top:2px;">${fmtDate(a.date)}</div>
          </div>
        </div>`).join('')
    : _emptyState('🌱',null,'Activity will appear here once you start adding data.','padding:24px 0;');
}

// ── Due-date badge helper ─────────────────────────────────────────
function _dueBadge(daysUntil, isOverdue) {
  if (isOverdue || daysUntil < 0) return { badge:'Overdue',  cls:'overdue' };
  if (daysUntil === 0)            return { badge:'Today',    cls:'soon' };
  if (daysUntil === 1)            return { badge:'Tomorrow', cls:'soon' };
  if (daysUntil <= 3)             return { badge:`In ${daysUntil}d`, cls:'soon' };
  return                                 { badge:`In ${daysUntil}d`, cls:'' };
}

// ── Revision warnings ─────────────────────────────────────────────
function _renderRevisionWarnings(c, upcomingExams, ts) {
  const allTasks = S.tasks[c.id] || [];
  const warnings = [];

  upcomingExams.forEach(e => {
    if (e.subject) {
      // Case A: exam has a subject — check for a matching revision task
      const hasRevision = allTasks.some(t =>
        t.isRevision === 'true' &&
        t.subject && t.subject.toLowerCase() === e.subject.toLowerCase() &&
        t.due && t.due <= e.date &&
        (!t.done ? t.due >= ts : true)  // pending must still be future; completed always counts
      );
      if (!hasRevision) {
        const key = e.subject+'|'+e.id;
        if (!warnings.find(w => w.key === key))
          warnings.push({ key, subject:e.subject, examTitle:e.title, examDate:e.date, needsSubject:false });
      }
    } else {
      // Case B: exam has no subject — prompt to add one so warnings can work
      const key = 'nosubject|'+e.id;
      if (!warnings.find(w => w.key === key))
        warnings.push({ key, subject:'', examTitle:e.title, examDate:e.date, needsSubject:true, eventId:e.id });
    }
  });

  const el = $('dash-revision-warnings');
  if (!warnings.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="dash-section-title" style="color:var(--amber);">
        ⚠️ Revision not scheduled
        <span style="font-size:12px;font-weight:500;color:var(--text-soft);font-family:var(--sans);">exams approaching</span>
      </div>
      ${warnings.map(w => w.needsSubject ? `
        <div class="revision-warning">
          <div class="revision-warning-icon">📝</div>
          <div style="flex:1;">
            <div class="revision-warning-title">Set subject for: ${esc(w.examTitle)}</div>
            <div class="revision-warning-meta">${fmtDate(w.examDate)} · Edit this exam to add its subject so revision reminders work</div>
          </div>
          <button class="revision-warning-btn" onclick="openEditEvent('${w.eventId}')">Edit exam</button>
        </div>` : `
        <div class="revision-warning">
          <div class="revision-warning-icon">📚</div>
          <div style="flex:1;">
            <div class="revision-warning-title">No revision scheduled for ${esc(w.subject)}</div>
            <div class="revision-warning-meta">${esc(w.examTitle)} · ${fmtDate(w.examDate)}</div>
          </div>
          <button class="revision-warning-btn" onclick="openAddRevision('${esc(w.subject)}')">Schedule now</button>
        </div>`
      ).join('')}
    </div>`;
}


// ───────────────────────────────────────────────────────────────────
// §20  BOOT — wait for GSI, then initialise
// ───────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  const waitForGSI = setInterval(() => {
    if (window.google && window.google.accounts) {
      clearInterval(waitForGSI);
      initGoogleAuth();
    }
  }, 100);

  // Fallback: if GSI hasn't loaded after 8 s, show auth with an error toast
  setTimeout(() => {
    clearInterval(waitForGSI);
    if (!window.google) {
      $('loading-screen').classList.add('hidden');
      $('auth-screen').style.display = 'flex';
      toast('Could not load Google Sign-In. Check your internet connection.', true);
    }
  }, 8000);
});

