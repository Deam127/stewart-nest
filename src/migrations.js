// The Stewart Nest — database upgrades. Each version runs once, automatically, when the app starts.
// Existing data is kept. Add new versions at the bottom.
import { SEED_V4 } from './seed-v4.js';

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
};
