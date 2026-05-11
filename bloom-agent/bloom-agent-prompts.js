// ═══════════════════════════════════════════════════════════════════
// bloom-agent-prompts.js — Claude prompts and message templates
// ═══════════════════════════════════════════════════════════════════
//
// DESIGN PRINCIPLE
// ────────────────
// Every message Bloom sends to a parent should answer one question:
//
//   "What is worth celebrating or noticing about my child right now?"
//
// Confirmations are not receipts. They are brief glimpses of progress.
// The weekly digest is not a report card. It is a travel guide update:
// "here's what I noticed this week, and here's what to look for next."
//
// BANNED WORDS (never appear in any message Bloom sends)
// ──────────────────────────────────────────────────────
//   monitor, track, compliance, overdue (use "still in progress"),
//   failed, missing, behind (use "building up"), warning
//
// TUNING
// ──────
// Edit this file to adjust AI behaviour and message tone.
// No other file needs to change.
// ═══════════════════════════════════════════════════════════════════

'use strict';

// ── Intent schema ────────────────────────────────────────────────
// Claude always replies with one of these JSON shapes.
// The bot acts on the intent without any further AI calls.

const INTENT_SCHEMA = `
You must ALWAYS reply with a single valid JSON object.
No markdown, no prose, no code fences — raw JSON only.
The object must have an "intent" field matching one of the values below.

INTENT: log_task
  Use when the user wants to add homework, an assignment, or any to-do.
  {
    "intent":     "log_task",
    "childName":  "<string | null>",
    "title":      "<string>",
    "subject":    "<string | null>",
    "due":        "<YYYY-MM-DD | null>",
    "priority":   "high" | "medium" | "low",
    "isRevision": true | false,
    "notes":      "<string | null>"
  }

INTENT: log_event
  Use when the user wants to add a test, exam, holiday, CCA session,
  or any calendar date. Prefer this over log_task when a specific date
  is the main piece of information.
  {
    "intent":   "log_event",
    "childName":"<string | null>",
    "title":    "<string>",
    "date":     "<YYYY-MM-DD>",
    "category": "exam" | "holiday" | "cca" | "school" | "personal",
    "subject":  "<string | null>",
    "notes":    "<string | null>"
  }

INTENT: log_multiple
  Use when the user's message contains more than one distinct item.
  Each item is a log_task or log_event object without the outer "intent" field.
  {
    "intent": "log_multiple",
    "items":  [ ...log_task or log_event objects... ]
  }

INTENT: schedule_revision
  Use when the user explicitly asks to set up revision sessions —
  e.g. "remind Emma to revise Science every day this week".
  {
    "intent":    "schedule_revision",
    "childName": "<string | null>",
    "subject":   "<string>",
    "startDate": "<YYYY-MM-DD>",
    "recur":     "once" | "weekly" | "biweekly",
    "untilDate": "<YYYY-MM-DD | null>",
    "notes":     "<string | null>"
  }

INTENT: clarify
  Use ONLY when you genuinely cannot proceed — e.g. no date for an event,
  or completely unclear if it is a task or event. Ask exactly ONE short,
  friendly question.
  {
    "intent":   "clarify",
    "question": "<string>"
  }

INTENT: unknown
  Use for greetings, thanks, off-topic messages, or anything that is not
  clearly one of the above.
  {
    "intent": "unknown",
    "reply":  "<warm one-line response>"
  }
`;

// ── Logging system prompt ─────────────────────────────────────────
// Used for every incoming parent message to parse intent.

const buildSystemPrompt = ({ childrenNames, todayStr }) => `
You are Bloom's companion for parents — warm, perceptive, and brief.
Your role is to help parents capture their child's schedule effortlessly
so they can spend energy guiding rather than administering.

Context
───────
Today's date : ${todayStr}
Children in this account: ${
  childrenNames.length > 0
    ? childrenNames.join(', ')
    : '(none yet — use null for childName)'
}

Your job
────────
1. Read the parent's message and identify what to log: a task, a
   calendar event, a revision schedule, or multiple items at once.

2. Resolve relative dates precisely:
   - "tomorrow"       → tomorrow's date
   - "next Friday"    → the coming Friday (never today even if today is Friday)
   - "this Thursday"  → the Thursday of the current week
   - "in 3 days"      → today + 3
   - No date for a task  → null (do not guess)
   - No date for an event → use clarify intent

3. Infer the child:
   - If only one child exists, always use them.
   - If the parent names a child, use that child.
   - If genuinely unclear with multiple children, use null.

4. Infer priority:
   - "urgent", "important", due tomorrow → high
   - Exam within 3 days → high
   - Default → medium

5. Set isRevision: true only for explicit study or revision tasks,
   not for regular homework.

6. Multiple distinct items in one message → use log_multiple.

7. Use clarify only when you truly cannot proceed without more
   information. One question maximum.

Tone
────
You are a trusted family companion, not a form or a system.
Your clarify questions and unknown replies should feel like something
a thoughtful friend would say — never robotic, never bureaucratic.

${INTENT_SCHEMA}
`;

// ── Weekly digest system prompt ───────────────────────────────────
// Used by /week and the Sunday digest cron job (Phase 2).
// Given structured week data, Claude writes a progress-framed narrative.

const buildDigestPrompt = ({ childName, todayStr, weekData }) => `
You are writing Bloom's weekly guide update — a short, warm Telegram
message to a parent about their child's week.

Your purpose is to help the parent SEE PROGRESS, not file a report.
You are not a dashboard. You are a travel guide who has been watching
the journey and noticed something worth sharing.

Today : ${todayStr}
Child : ${childName}

This week's data
────────────────
${JSON.stringify(weekData, null, 2)}

Write the message following this structure — but as warm flowing prose,
not a bullet-point list:

1. ONE opening observation about what stands out. This should name a
   PATTERN, not just a count. Good examples:
   — "She finished most things before Thursday this week — earlier than
     usual. That kind of self-pacing is worth encouraging."
   — "Three subjects had homework logged this week, and all three were
     completed. That's a full week with nothing left behind."
   Avoid starting with numbers or percentages.

2. Exams coming up in the next 7–14 days, with revision status.
   — If revision IS planned: affirm the preparation specifically.
     "Revision for Science is already scheduled — that lead time means
     she goes into Friday feeling prepared, not rushed."
   — If revision is NOT planned: frame as an opportunity, not a warning.
     "The Maths test is 8 days away — still a good window to set up
     a couple of revision sessions if she'd like that support."

3. ONE "thing to ask" — a dinner-table conversation starter that opens
   reflection, not compliance-checking. Examples:
   — "Ask her how she felt about her preparation for the English test —
     not the score, but whether she felt ready walking in."
   — "It might be worth asking what subject felt hardest this week and
     why — often that's where the most useful thinking happens."

4. ONE thing to celebrate — however small. If tasks were done early,
   name the habit. If revision was planned ahead, name that too.
   If nothing significant happened: "Logging everything this week
   means you have a complete picture — that's the foundation."

Rules
─────
- Maximum 180 words total.
- Use Telegram Markdown: *bold* for child's name and key phrases only.
  No headers, no bullet points.
- Never use: monitor, track, overdue, failed, missing, compliance,
  behind, warning. Use "still in progress" or "building up" instead.
- Do not list every task by name. Describe the pattern.
- End with the "thing to ask" — it is the most actionable line and
  should be what the parent remembers.
- Reply with only the message text. No JSON. No preamble. No sign-off.
`;

// ── Confirmation message builder ──────────────────────────────────
// Turns a parsed intent into a progress-aware confirmation.
//
// progressCtx (optional): { completionRate, totalPending,
//   revisionScheduled, revisionLeadDays }
// Adds a one-line progress note when the signal is genuinely meaningful.

const buildConfirmation = (intent, children, progressCtx = null) => {

  const fmt = d => {
    if (!d) return 'no due date';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  };

  const childLabel = name => name ? ` for *${name}*` : '';

  // Resolve display name from intent or children list
  const resolveName = intentName =>
    intentName || (children.length === 1 ? children[0].name : null);

  // ── Progress note ───────────────────────────────────────────────
  // Shown only when there is a genuinely meaningful signal.
  // Celebrates growth; never flags problems.
  const progressNote = name => {
    if (!progressCtx) return '';
    const { completionRate, totalPending, revisionScheduled, revisionLeadDays } = progressCtx;
    const pronoun = name ? name.split(' ')[0] : 'Things';

    // Strong completion rate with low pending — celebrate the habit
    if (completionRate >= 0.8 && totalPending <= 3) {
      return `\n\n_${pronoun} is keeping on top of things this week — tasks are getting done early. That self-pacing is a habit worth naming. 🌱_`;
    }
    // Revision planned well ahead of an exam — affirm the lead time
    if (revisionScheduled && revisionLeadDays >= 5) {
      return `\n\n_Revision is already planned ahead — that lead time is one of the strongest study habits. Worth letting ${name || 'them'} know you noticed. 📚_`;
    }
    // Pile-up building — gentle, dinner-table framing, not an alert
    if (totalPending >= 8) {
      return `\n\n_A few things are building up this week — might be a natural moment to check in over dinner about how the week feels._`;
    }
    return '';
  };

  // ── Intent → confirmation ────────────────────────────────────────

  switch (intent.intent) {

    case 'log_task': {
      const name = resolveName(intent.childName);
      const rev  = intent.isRevision ? ' 📚 _(revision)_' : '';
      const subj = intent.subject ? ` · ${intent.subject}` : '';
      return (
        `🌱 Logged${childLabel(name)}\n` +
        `*${intent.title}*${subj}${rev}\n` +
        `Due: ${fmt(intent.due)} · ${intent.priority} priority` +
        progressNote(name)
      );
    }

    case 'log_event': {
      const name  = resolveName(intent.childName);
      const subj  = intent.subject ? ` · ${intent.subject}` : '';
      const emoji = { exam:'📝', holiday:'🏖️', cca:'🎯', school:'🏫', personal:'⭐' }[intent.category] || '📅';

      // For exams: a brief reflection prompt about preparation mindset.
      // Not a reminder — a reframe of how to think about results.
      const examNote = (intent.category === 'exam' && intent.subject)
        ? `\n\n_When the result comes in, it's worth asking ${name || 'them'} not just what they scored, but what they'd do differently next time in revision. That's the question that compounds over years._`
        : '';

      return (
        `${emoji} Logged${childLabel(name)}\n` +
        `*${intent.title}*${subj}\n` +
        `Date: ${fmt(intent.date)}` +
        examNote
      );
    }

    case 'log_multiple': {
      const taskItems  = intent.items.filter(i => !('date' in i) || 'due' in i);
      const eventItems = intent.items.filter(i => 'date' in i && !('due' in i));

      const lines = intent.items.map(item => {
        if ('date' in item && !('due' in item)) {
          const emoji = { exam:'📝', holiday:'🏖️', cca:'🎯', school:'🏫', personal:'⭐' }[item.category] || '📅';
          return `  ${emoji} ${item.title} — ${fmt(item.date)}`;
        }
        const rev = item.isRevision ? ' 📚' : '';
        return `  ✅ ${item.title}${item.subject ? ' · ' + item.subject : ''}${rev} — due ${fmt(item.due)}`;
      });

      const parts = [];
      if (taskItems.length)  parts.push(`${taskItems.length} task${taskItems.length > 1 ? 's' : ''}`);
      if (eventItems.length) parts.push(`${eventItems.length} event${eventItems.length > 1 ? 's' : ''}`);

      return `🌱 Logged ${parts.join(' and ')}:\n${lines.join('\n')}`;
    }

    case 'schedule_revision': {
      const name  = resolveName(intent.childName);
      const freq  = { once: 'once', weekly: 'every week', biweekly: 'every 2 weeks' }[intent.recur] || intent.recur;
      const until = intent.untilDate ? ` until ${fmt(intent.untilDate)}` : '';
      return (
        `📚 Revision scheduled${childLabel(name)}\n` +
        `*${intent.subject}* · ${freq}${until}\n` +
        `Starting: ${fmt(intent.startDate)}\n\n` +
        `_Planning revision before the pressure builds is one of the habits that separates prepared from panicked. Well done for setting this up early._`
      );
    }

    default:
      return null;
  }
};

// ── Revision offer ────────────────────────────────────────────────
// Shown after logging an exam when no revision is yet scheduled.
// Framed as an opportunity, not a warning.

const buildRevisionOffer = (subject, childName) => {
  const name = childName || 'them';
  return (
    `\n\nRevision for *${subject}* isn't scheduled yet — ` +
    `but there's still a good window. Even one session a week now ` +
    `gives ${name} time to consolidate rather than cram at the end. ` +
    `Want me to set that up? Just say _"yes, weekly"_ or _"yes, every 2 weeks"_.`
  );
};

// ── Week data formatter ───────────────────────────────────────────
// Formats raw Sheet rows into the structured object passed to
// buildDigestPrompt. Called by /week and (in Phase 2) the Sunday cron.

const buildWeekData = ({ tasks, events, previousTasks }) => {
  const now = new Date();

  const local = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const fmt = d => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })
    : null;

  const todayStr     = local(now);
  const sevenAgo     = local(new Date(now.getTime() - 7  * 86400000));
  const fourteenAhead= local(new Date(now.getTime() + 14 * 86400000));
  const sevenAhead   = local(new Date(now.getTime() + 7  * 86400000));

  // ── Tasks this week ─────────────────────────────────────────────
  const weekTasks     = tasks.filter(t => t.due >= sevenAgo   && t.due <= todayStr);
  const completed     = weekTasks.filter(t => t.done === 'true');
  const stillPending  = tasks.filter(t => t.done !== 'true'   && t.due && t.due <= todayStr);
  const upcoming      = tasks.filter(t => t.done !== 'true'   && t.due > todayStr && t.due <= sevenAhead);

  // ── Completion rate vs previous week ────────────────────────────
  const prevTotal     = (previousTasks || []).length;
  const prevCompleted = (previousTasks || []).filter(t => t.done === 'true').length;
  const thisRate      = weekTasks.length > 0 ? completed.length / weekTasks.length : null;
  const prevRate      = prevTotal > 0 ? prevCompleted / prevTotal : null;

  // ── Trend: are things improving? ────────────────────────────────
  // Named positively: "improving", "consistent", or null if no data.
  let completionTrend = null;
  if (thisRate !== null && prevRate !== null) {
    if (thisRate > prevRate + 0.1)      completionTrend = 'improving';
    else if (thisRate >= prevRate - 0.1) completionTrend = 'consistent';
    else                                 completionTrend = 'building up';
  }

  // ── Upcoming exams with revision status ─────────────────────────
  const upcomingExams = events
    .filter(e => e.category === 'exam' && e.date >= todayStr && e.date <= fourteenAhead)
    .map(e => {
      const revSessions = tasks.filter(t =>
        t.isRevision === 'true' &&
        t.subject && e.subject &&
        t.subject.toLowerCase() === e.subject.toLowerCase() &&
        t.due >= todayStr && t.due <= e.date
      );
      const daysAway = Math.round(
        (new Date(e.date + 'T00:00:00') - now) / 86400000
      );
      return {
        title:            e.title,
        subject:          e.subject || null,
        date:             fmt(e.date),
        daysAway,
        revisionPlanned:  revSessions.length > 0,
        revisionSessions: revSessions.length,
      };
    });

  // ── Revision lead time ───────────────────────────────────────────
  // Average days between a revision task and its associated exam.
  // Higher = better planning ahead.
  const revisionLeadDays = (() => {
    const revTasks = tasks.filter(t => t.isRevision === 'true' && t.due);
    if (!revTasks.length) return null;
    const leads = revTasks.flatMap(t => {
      const exam = events.find(e =>
        e.category === 'exam' && e.subject && t.subject &&
        e.subject.toLowerCase() === t.subject.toLowerCase() &&
        e.date >= t.due
      );
      if (!exam) return [];
      const days = Math.round(
        (new Date(exam.date + 'T00:00:00') - new Date(t.due + 'T00:00:00')) / 86400000
      );
      return days > 0 ? [days] : [];
    });
    return leads.length
      ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length)
      : null;
  })();

  return {
    periodCovered:       `${fmt(sevenAgo)} – ${fmt(todayStr)}`,
    // Completion
    tasksThisWeek:       weekTasks.length,
    completedThisWeek:   completed.length,
    completionRate:      thisRate !== null ? Math.round(thisRate * 100) + '%' : 'n/a',
    completionRatePrev:  prevRate !== null ? Math.round(prevRate * 100) + '%' : 'n/a',
    completionTrend,
    // Still in progress (not "overdue")
    stillInProgress:     stillPending.map(t => ({
      title:   t.title,
      subject: t.subject,
      due:     fmt(t.due),
    })),
    // Coming up next week
    upcomingNextWeek:    upcoming.map(t => ({
      title:   t.title,
      subject: t.subject,
      due:     fmt(t.due),
    })),
    // Exams
    upcomingExams,
    // Revision habit signal
    revisionLeadDays,
    revisionLeadSignal: revisionLeadDays === null ? 'no data yet'
      : revisionLeadDays >= 7  ? 'planning well ahead'
      : revisionLeadDays >= 3  ? 'reasonable lead time'
      : 'last-minute — opportunity to build the habit earlier',
    // Breadth
    subjectsThisWeek:    [...new Set(weekTasks.map(t => t.subject).filter(Boolean))],
  };
};

module.exports = {
  buildSystemPrompt,
  buildDigestPrompt,
  buildConfirmation,
  buildRevisionOffer,
  buildWeekData,
  INTENT_SCHEMA,
};
