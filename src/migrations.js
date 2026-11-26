// The Stewart Nest — database upgrades. Each version runs once, automatically, when the app starts.
// Existing data is kept. Add new versions at the bottom.
import { SEED_V4 } from './seed-v4.js';
import { SEED_V6 } from './seed-v6.js';

const q = (s) => (s == null ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'");

// Weekly supper rotation (weekday 1=Mon … 7=Sun) — now stored in the database and editable in the app
const ROTATION = {
  summer: { 1: ['s_bol', 's_las', 's_bob', 's_cot'], 2: ['s_cur'], 3: ['s_ff', 's_mac', 's_vet'], 4: ['s_sfn', 's_alk', 's_sfr'], 5: ['s_win'], 6: ['s_br1', 's_br2', 's_br3', 's_br4'], 7: ['s_rst', 's_stw'] },
  winter: { 1: ['s_bol', 's_cot', 's_bob', 's_las'], 2: ['s_cur'], 3: ['s_soup', 's_mac', 's_vet', 's_len'], 4: ['s_alk', 's_stw', 's_efr'], 5: ['s_win'], 6: ['s_br1', 's_br3', 's_br2', 's_br4'], 7: ['s_stw', 's_rst'] },
};
const rotationSql = Object.entries(ROTATION).flatMap(([season, days]) =>
  Object.entries(days).flatMap(([wd, ids]) => ids.map((id, i) =>
    `INSERT OR IGNORE INTO rotation (season, weekday, recipe_id, sort) VALUES ('${season}', ${wd}, '${id}', ${i})`)));

// ---------- the family's starting schedule ----------
// Public holidays (Public Holidays Act; Sunday holidays move to Monday). Check gov.za each year for once-off holidays.
const HOLIDAYS = [
  ['2026-12-16', 'Day of Reconciliation'], ['2026-12-25', 'Christmas Day'], ['2026-12-26', 'Day of Goodwill'],
  ['2027-01-01', "New Year's Day"], ['2027-03-21', 'Human Rights Day'], ['2027-03-22', 'Public holiday (Human Rights Day moved)'],
  ['2027-03-26', 'Good Friday'], ['2027-03-29', 'Family Day'], ['2027-04-27', 'Freedom Day'], ['2027-05-01', "Workers' Day"],
  ['2027-06-16', 'Youth Day'], ['2027-08-09', "National Women's Day"], ['2027-09-24', 'Heritage Day'],
  ['2027-12-16', 'Day of Reconciliation'], ['2027-12-25', 'Christmas Day'], ['2027-12-26', 'Day of Goodwill'],
  ['2027-12-27', 'Public holiday (Day of Goodwill moved)'],
];
// Public school terms for learners (Department of Basic Education gazetted calendars, 25 Feb 2025)
const TERMS = [
  ['2026-10-06', '2026-12-09', 'School term 4 (2026)'],
  ['2027-01-13', '2027-03-19', 'School term 1 (2027)'],
  ['2027-04-06', '2027-06-25', 'School term 2 (2027)'],
  ['2027-07-20', '2027-10-01', 'School term 3 (2027)'],
  ['2027-10-11', '2027-12-08', 'School term 4 (2027)'],
];
const SPECIAL_SCHOOL_HOLIDAYS = [['2027-04-26', 'Special school holiday (Freedom Day long weekend)']];

const ev = (o) => `INSERT INTO events (title, category, who, start_date, end_date, start_time, end_time, repeat, repeat_days, repeat_until,
  school_days_only, skip_holidays, quiet, remind, notes, created_by) VALUES (${q(o.title)}, ${q(o.category)}, ${q(o.who || '')}, ${q(o.start)},
  ${q(o.end)}, ${q(o.from)}, ${q(o.to)}, ${q(o.repeat || 'none')}, ${q(o.days)}, ${q(o.until)}, ${o.schoolDays ? 1 : 0}, ${o.skipHolidays ? 1 : 0},
  ${o.quiet ? 1 : 0}, ${q(o.remind || 'none')}, ${q(o.notes)}, 'lee-roy')`;

const scheduleSql = [
  ...HOLIDAYS.map(([d, t]) => ev({ title: t, category: 'holiday', start: d })),
  ...TERMS.map(([a, b, t]) => ev({ title: t, category: 'term', who: 'skyler', start: a, end: b, quiet: 1 })),
  ...TERMS.flatMap(([a, b, t]) => [
    ev({ title: '🏫 Schools open', category: 'school', who: 'skyler', start: a, remind: 'day_before', notes: `${t} starts. Uniform, stationery and transport money ready?` }),
    ev({ title: '🎉 Schools close', category: 'school', who: 'skyler', start: b, remind: 'day_before', notes: `Last day of ${t}.` }),
  ]),
  ...SPECIAL_SCHOOL_HOLIDAYS.map(([d, t]) => ev({ title: t, category: 'school_holiday', who: 'skyler', start: d })),
  ev({ title: '🗑️ Bin day', category: 'bins', start: '2026-11-25', repeat: 'weekly', days: '3', remind: 'day_before', notes: 'Bins out on Tuesday night. Collection is Wednesday morning.' }),
  ev({ title: '💼 Lee Roy at work', category: 'work', who: 'lee-roy', start: '2026-11-23', from: '07:00', to: '17:30', repeat: 'weekly', days: '12345', skipHolidays: 1, quiet: 1, notes: 'Leaves home at 07:00, usually home about 17:30.' }),
  ev({ title: '🚌 Skyler to school (public transport)', category: 'school', who: 'skyler', start: '2026-11-23', repeat: 'weekly', days: '12345', schoolDays: 1, quiet: 1, notes: 'Set the leave/collect times in Events → edit.' }),
  ev({ title: '👶 Madilea due date', category: 'family', start: '2027-01-06', remind: 'day_before' }),
];


// ---------- v5: rest of 2026 schedule, Skyler's school day, morning check, dogs, bin rule ----------
const HOLIDAYS_2026 = [
  ['2026-01-01', "New Year's Day"], ['2026-03-21', 'Human Rights Day'], ['2026-04-03', 'Good Friday'], ['2026-04-06', 'Family Day'],
  ['2026-04-27', 'Freedom Day'], ['2026-05-01', "Workers' Day"], ['2026-06-16', 'Youth Day'], ['2026-08-09', "National Women's Day"],
  ['2026-08-10', "Public holiday (Women's Day moved)"], ['2026-09-24', 'Heritage Day'], ['2026-11-04', 'Local Government Elections (once-off)'],
];
const TERMS_2026 = [
  ['2026-01-14', '2026-03-27', 'School term 1 (2026)'],
  ['2026-04-08', '2026-06-26', 'School term 2 (2026)'],
  ['2026-07-21', '2026-09-23', 'School term 3 (2026)'],
];
const SKYLER_TPL = (title, area, days, pts, when, routine) =>
  `INSERT INTO task_templates (title, area, assignee, days, points, created_by, when_school, routine) VALUES (${q(title)}, ${q(area)}, 'skyler', '${days}', ${pts}, 'shirley', '${when}', ${q(routine)})`;

const v5 = [
  "ALTER TABLE task_templates ADD COLUMN when_school TEXT NOT NULL DEFAULT 'any'",
  'ALTER TABLE task_templates ADD COLUMN routine TEXT',
  'ALTER TABLE tasks ADD COLUMN routine TEXT',
  ...HOLIDAYS_2026.map(([d, t]) => ev({ title: t, category: 'holiday', start: d })),
  ...TERMS_2026.map(([a, b, t]) => ev({ title: t, category: 'term', who: 'skyler', start: a, end: b, quiet: 1 })),
  ...TERMS_2026.flatMap(([a, b, t]) => [
    ev({ title: '🏫 Schools open', category: 'school', who: 'skyler', start: a, remind: 'day_before', notes: `${t} starts.` }),
    ev({ title: '🎉 Schools close', category: 'school', who: 'skyler', start: b, remind: 'day_before', notes: `Last day of ${t}.` }),
  ]),
  ev({ title: 'Special school holiday', category: 'school_holiday', who: 'skyler', start: '2026-06-15' }),
  // Skyler's school day (typical Gauteng public school hours; edit if his school differs)
  `UPDATE events SET title = '🎒 Skyler at school', start_time = '07:30', end_time = '14:00',
     notes = 'Public school, public transport. Typical hours; edit the times if his school differs.' WHERE title = '🚌 Skyler to school (public transport)'`,
  // Skyler's morning check (every morning; "get dressed for school" only on school days)
  "UPDATE task_templates SET routine = 'morning', title = '☀️ Make your bed' WHERE assignee = 'skyler' AND title = 'Make your bed'",
  "UPDATE task_templates SET routine = 'morning', title = '☀️ Make or help with breakfast' WHERE assignee = 'skyler' AND title = 'Make or help with breakfast'",
  SKYLER_TPL('☀️ Brush your teeth', 'Bathroom', '1234567', 2, 'any', 'morning'),
  SKYLER_TPL('☀️ Wash your face', 'Bathroom', '1234567', 2, 'any', 'morning'),
  SKYLER_TPL('☀️ Get dressed for school', 'Second bedroom', '12345', 2, 'school', 'morning'),
  // No school (weekends, holidays): help around the house
  SKYLER_TPL('Help inside the house (ask Mom what is needed)', 'Lounge', '1234567', 10, 'no_school', null),
  SKYLER_TPL('Help outside (yard & garden)', 'Yard', '1234567', 10, 'no_school', null),
  // Two dogs need walking: Skyler after school / in the day, the whole family on Sunday
  SKYLER_TPL('🐕 Walk the dogs', 'Dogs', '123456', 10, 'any', null),
  "UPDATE task_templates SET title = '💪 Family walk with the dogs' WHERE title = '💪 Family walk with the dog'",
  // Bins go out on Wednesday (collection day): Lee Roy on school days, Skyler on public & school holidays
  "UPDATE task_templates SET title = '🗑️ Take the bins out (collection today)', area = 'Yard', days = '3', when_school = 'school' WHERE title = 'Put the bins out (collection Wednesday)'",
  "UPDATE task_templates SET title = '🗑️ Take the bins out (collection today)', area = 'Yard', days = '3', when_school = 'school' WHERE title = 'Take out the bins'",
  SKYLER_TPL('🗑️ Take the bins out (collection today)', 'Yard', '3', 5, 'no_school', null),
  "UPDATE events SET notes = 'Bins out on Wednesday morning: Lee Roy on school days, Skyler on public & school holidays.' WHERE title = '🗑️ Bin day'",
  // stop the old Tuesday bin chore that may still be open
  "DELETE FROM tasks WHERE title = 'Put the bins out (collection Wednesday)' AND done_at IS NULL",
];

// Islamic holy days (estimates: the exact day follows the moon sighting announced by the UUCSA in South Africa, ±1 day)
const MS = 'Estimated date, may shift a day with the moon sighting.';
const ISLAMIC = [
  ['2027-01-05', null, '☪️ Laylat al-Miraj (Night Journey)', MS],
  ['2027-02-08', '2027-03-09', '🌙 Ramadan (month of fasting)', 'Fasting from dawn (Fajr) to sunset (Maghrib). Iftar is at sunset, so don\'t plan daytime meals with them; evening visits after iftar are often welcome. ' + MS, 'day_before'],
  ['2027-03-05', null, '☪️ Laylat al-Qadr (Night of Power, likely)', 'One of the holiest nights, spent in prayer. ' + MS],
  ['2027-03-10', null, '🎉 Eid al-Fitr', 'The big celebration at the end of Ramadan, their "Christmas". Send Eid Mubarak greetings! ' + MS, 'week'],
  ['2027-05-16', null, '☪️ Day of Arafah', 'Many fast today. ' + MS],
  ['2027-05-17', null, '🎉 Eid al-Adha', 'Festival of Sacrifice: family, prayers, sharing meat. Eid Mubarak! ' + MS, 'week'],
  ['2027-06-06', null, '☪️ Islamic New Year (1449)', MS],
  ['2027-06-15', null, '☪️ Day of Ashura', MS],
  ['2027-08-15', null, '☪️ Mawlid an-Nabi (Prophet\'s birthday)', MS],
];

// Used by the self-repair: re-create these only if they're missing
export const REPAIR_DATA = [
  ...ISLAMIC.map(([a, , t]) => `UPDATE events SET layer = 'islam', category = 'faith' WHERE title = ${q(t)} AND start_date = '${a}' AND layer IS NULL`),
  ...ISLAMIC.map(([a, b, t, notes, remind]) => `INSERT INTO events (title, category, who, start_date, end_date, remind, notes, layer, created_by)
     SELECT ${q(t)}, 'faith', '', '${a}', ${b ? `'${b}'` : 'NULL'}, '${remind || 'none'}', ${q(notes)}, 'islam', 'lee-roy'
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = ${q(t)} AND start_date = '${a}')`),
  ...[['lee-roy', 'Lee Roy', '05-22'], ['skyler', 'Skyler', '05-30'], ['shirley', 'Shirley', '05-31']].map(([id, n, d]) =>
    `INSERT INTO events (title, category, who, start_date, repeat, remind, person, created_by)
     SELECT '🎂 ${n}''s birthday', 'birthday', '', '2026-${d}', 'yearly', 'week', '${id}', 'lee-roy'
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE person = '${id}' AND category = 'birthday')`),
];

export const UPGRADES = {
  3: [
    'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN hash_algo TEXT NOT NULL DEFAULT 'sha256-pin'",
    'ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1',
    "UPDATE users SET is_admin = 1 WHERE id = 'lee-roy'",
    "UPDATE users SET must_change = 1 WHERE pin_hash IS NOT NULL AND hash_algo = 'sha256-pin'",
    `CREATE TABLE IF NOT EXISTS meal_ratings (
       date TEXT NOT NULL, recipe_id TEXT NOT NULL, user_id TEXT NOT NULL, stars INTEGER, verdict TEXT, comment TEXT,
       updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (date, recipe_id, user_id))`,
  ],
  4: [
    // recipe catalogue: ingredients linked to inventory items, in the item's pack unit (g, ml, each, kg)
    'ALTER TABLE items ADD COLUMN pack_qty REAL',
    'ALTER TABLE items ADD COLUMN pack_unit TEXT',
    'ALTER TABLE items ADD COLUMN ref TEXT',
    'ALTER TABLE recipes ADD COLUMN notes TEXT',
    `CREATE TABLE IF NOT EXISTS recipe_items (
       recipe_id TEXT NOT NULL REFERENCES recipes(id), item_id INTEGER NOT NULL REFERENCES items(id), qty REAL NOT NULL,
       PRIMARY KEY (recipe_id, item_id))`,
    `CREATE TABLE IF NOT EXISTS rotation (
       season TEXT NOT NULL, weekday INTEGER NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes(id), sort INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (season, weekday, recipe_id))`,
    ...SEED_V4,
    ...rotationSql,
    // family calendar
    `CREATE TABLE IF NOT EXISTS events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       title TEXT NOT NULL,
       category TEXT NOT NULL DEFAULT 'other',  -- holiday, term, school, school_holiday, bins, work, birthday, appointment, family, other
       who TEXT NOT NULL DEFAULT '',             -- comma-separated user ids; '' = whole family
       start_date TEXT NOT NULL, end_date TEXT,  -- end_date for multi-day events (terms, trips)
       start_time TEXT, end_time TEXT,
       repeat TEXT NOT NULL DEFAULT 'none',      -- none | weekly | monthly | yearly
       repeat_days TEXT,                         -- weekly: '135' = Mon, Wed, Fri
       repeat_until TEXT,
       school_days_only INTEGER NOT NULL DEFAULT 0,  -- only on school days (in a term, not a holiday)
       skip_holidays INTEGER NOT NULL DEFAULT 0,     -- skip public holidays
       quiet INTEGER NOT NULL DEFAULT 0,             -- routine: shown on the day page, not in the month grid
       remind TEXT NOT NULL DEFAULT 'none',          -- none | day_before | morning | both
       notes TEXT,
       created_by TEXT,
       active INTEGER NOT NULL DEFAULT 1)`,
    'CREATE TABLE IF NOT EXISTS event_skips (event_id INTEGER NOT NULL, date TEXT NOT NULL, PRIMARY KEY (event_id, date))',
    'CREATE TABLE IF NOT EXISTS reminder_log (event_id INTEGER NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (event_id, date, kind))',
    ...scheduleSql,
    // bins go out the night before collection (Wednesday), after Lee Roy gets home
    "UPDATE task_templates SET title = 'Put the bins out (collection Wednesday)', days = '2' WHERE title = 'Take out the bins'",
  ],
  5: v5,
  6: [
    // shared photos: memories (gallery), supper photos and activity photos pinned to a calendar day
    `CREATE TABLE IF NOT EXISTS photos (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       photo_key TEXT NOT NULL,
       caption TEXT,
       date TEXT NOT NULL,                 -- the calendar day it belongs to
       kind TEXT NOT NULL DEFAULT 'memory', -- memory | meal | activity
       recipe_id TEXT,                     -- for supper photos: what we ate
       user_id TEXT REFERENCES users(id),
       slideshow INTEGER NOT NULL DEFAULT 1, -- shows in the background slideshow
       created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    'CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date)',
    // big recipe library (+ new ingredient items with estimated prices)
    ...SEED_V6,
  ],
  7: [
    // the dogs: Niela & Luka
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('dogs', 'Niela & Luka')",
    "UPDATE task_templates SET title = '🐕 Walk Niela & Luka' WHERE title = '🐕 Walk the dogs'",
    "UPDATE tasks SET title = '🐕 Walk Niela & Luka' WHERE title = '🐕 Walk the dogs'",
    "UPDATE task_templates SET title = '💪 Family walk with Niela & Luka' WHERE title = '💪 Family walk with the dogs'",
    "UPDATE tasks SET title = '💪 Family walk with Niela & Luka' WHERE title = '💪 Family walk with the dogs'",
    "UPDATE task_templates SET title = 'Pick up after Niela & Luka (dog poo)' WHERE title = 'Pick up dog poo'",
    "UPDATE tasks SET title = 'Pick up after Niela & Luka (dog poo)' WHERE title = 'Pick up dog poo' AND done_at IS NULL",
    "UPDATE items SET name = 'Bobtail dog food 8kg (Niela & Luka)' WHERE name = 'Bobtail dog food 8kg'",
  ],
  8: [
    // per-person permissions (JSON; NULL = defaults for their role) and what the children call each grown-up
    'ALTER TABLE users ADD COLUMN permissions TEXT',
    'ALTER TABLE users ADD COLUMN kid_name TEXT',
    "UPDATE users SET kid_name = 'Dad' WHERE id = 'lee-roy'",
    "UPDATE users SET kid_name = 'Mom' WHERE id = 'shirley'",
    // Skyler: only his own tasks, ratings and photos to start with (Lee Roy can switch more on)
    `UPDATE users SET permissions = '{}' WHERE id = 'skyler'`,
    "UPDATE task_templates SET title = 'Help inside the house (ask your mom what''s needed)' WHERE title = 'Help inside the house (ask Mom what is needed)'",
    "UPDATE tasks SET title = 'Help inside the house (ask your mom what''s needed)' WHERE title = 'Help inside the house (ask Mom what is needed)' AND done_at IS NULL",
    // birthdays on profiles (MM-DD, or YYYY-MM-DD if the year is known) + a yearly calendar event linked to the person
    'ALTER TABLE users ADD COLUMN birthday TEXT',
    'ALTER TABLE events ADD COLUMN person TEXT',
    "UPDATE users SET birthday = '05-22' WHERE id = 'lee-roy'",
    "UPDATE users SET birthday = '05-30' WHERE id = 'skyler'",
    "UPDATE users SET birthday = '05-31' WHERE id = 'shirley'",
    ...[['lee-roy', 'Lee Roy', '05-22'], ['skyler', 'Skyler', '05-30'], ['shirley', 'Shirley', '05-31']].map(([id, n, d]) =>
      `INSERT INTO events (title, category, who, start_date, repeat, remind, person, created_by)
       SELECT '🎂 ${n}''s birthday', 'birthday', '', '2026-${d}', 'yearly', 'week', '${id}', 'lee-roy'
       WHERE NOT EXISTS (SELECT 1 FROM events WHERE person = '${id}' AND category = 'birthday' AND active = 1)`),
    // calendar layers that each person can switch on/off (first one: Islamic calendar for Lee Roy's sister's family)
    'ALTER TABLE events ADD COLUMN layer TEXT',
    'ALTER TABLE users ADD COLUMN prefs TEXT',
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('islam_family', 'Your sister''s family'), ('islam_method', '3'), ('islam_school', '1')",
    ...ISLAMIC.map(([a, b, t, notes, remind]) => `INSERT INTO events (title, category, who, start_date, end_date, remind, notes, layer, created_by)
       VALUES (${q(t)}, 'faith', '', '${a}', ${b ? `'${b}'` : 'NULL'}, '${remind || 'none'}', ${q(notes)}, 'islam', 'lee-roy')`),
  ],
  9: [
    // a shopping list can cover just part of the month (from/to); budgets are shown pro-rata for those days
    'ALTER TABLE shop_trips ADD COLUMN from_date TEXT',
    'ALTER TABLE shop_trips ADD COLUMN to_date TEXT',
  ],
  10: [
    // chat: replies, reactions, deleting your own message
    'ALTER TABLE chat_messages ADD COLUMN reply_to INTEGER',
    'ALTER TABLE chat_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE chat_messages ADD COLUMN card TEXT', // shared task / supper / event / recipe / poll (JSON)
    `CREATE TABLE IF NOT EXISTS chat_votes (message_id INTEGER NOT NULL, user_id TEXT NOT NULL, opt INTEGER NOT NULL,
       PRIMARY KEY (message_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS chat_reactions (message_id INTEGER NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (message_id, user_id, emoji))`,
  ],
  11: [
    // each message carries a one-off id from the phone, so a double tap or a retry never posts it twice
    'ALTER TABLE chat_messages ADD COLUMN client_id TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS chat_client ON chat_messages (user_id, client_id)',
    // deleting now removes a message completely, so clear out the old "message deleted" placeholders
    'DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE deleted = 1)',
    'DELETE FROM chat_votes WHERE message_id IN (SELECT id FROM chat_messages WHERE deleted = 1)',
    'DELETE FROM chat_messages WHERE deleted = 1',
  ],
};
