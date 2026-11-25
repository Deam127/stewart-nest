-- The Stewart Nest — database schema (Cloudflare D1 / SQLite)
-- Safe to re-run: drops and recreates everything. Use `npm run db:reset`.

DROP TABLE IF EXISTS meal_ratings;
DROP TABLE IF EXISTS workout_logs;
DROP TABLE IF EXISTS workout_info;
DROP TABLE IF EXISTS shop_lines;
DROP TABLE IF EXISTS shop_trips;
DROP TABLE IF EXISTS stock_counts;
DROP TABLE IF EXISTS stock_takes;
DROP TABLE IF EXISTS item_prices;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS checklist_items;
DROP TABLE IF EXISTS checklists;
DROP TABLE IF EXISTS fun_votes;
DROP TABLE IF EXISTS fun_ideas;
DROP TABLE IF EXISTS chat_reads;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS rewards_log;
DROP TABLE IF EXISTS reward_goals;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS task_templates;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS day_plans;
DROP TABLE IF EXISTS menu;
DROP TABLE IF EXISTS recipes;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id        TEXT PRIMARY KEY,          -- 'lee-roy', 'shirley', 'skyler'
  name      TEXT NOT NULL,             -- short name used in the app
  full_name TEXT NOT NULL,
  colour    TEXT NOT NULL,
  emoji     TEXT NOT NULL,
  is_parent INTEGER NOT NULL DEFAULT 0,
  pin_hash  TEXT,                      -- NULL until the person sets a PIN on first login
  salt      TEXT,
  failed    INTEGER NOT NULL DEFAULT 0, -- wrong PIN attempts in a row
  locked_until TEXT                     -- 5 wrong PINs locks the profile for 15 minutes
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Recipes: meal = 'b' breakfast, 'l' lunch, 's' supper
-- season = 'all' | 'summer' | 'winter'; outdoor = needs a dry day (braai)
-- rain_backup = recipe id to use if it rains; active = 0 hides it from new menus
CREATE TABLE recipes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  meal        TEXT NOT NULL,
  season      TEXT NOT NULL DEFAULT 'all',
  outdoor     INTEGER NOT NULL DEFAULT 0,
  rain_backup TEXT,
  portions    TEXT,                    -- JSON ["Lee Roy …","Shirley …","Skyler …"]
  ingredients TEXT,                    -- JSON {item: qty}
  meat        TEXT,                    -- JSON {cut: kg}
  method      TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

-- One row per date per meal slot
CREATE TABLE menu (
  date       TEXT NOT NULL,            -- YYYY-MM-DD
  meal       TEXT NOT NULL,            -- b / l / s
  recipe_id  TEXT NOT NULL REFERENCES recipes(id),
  use_backup INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, meal)
);

-- Plans for a day (braai with friends, park outing…) with an optional rain-out plan
CREATE TABLE day_plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  time       TEXT,
  title      TEXT NOT NULL,
  outdoor    INTEGER NOT NULL DEFAULT 0,
  rain_plan  TEXT,
  use_rain   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Repeating chores. days = weekdays it is due, '1'=Mon … '7'=Sun, e.g. '1234567' or '6'
CREATE TABLE task_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  area       TEXT NOT NULL,
  assignee   TEXT NOT NULL REFERENCES users(id),
  days       TEXT NOT NULL,
  points     INTEGER NOT NULL DEFAULT 5,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id)
);

-- Individual tasks (one-offs and generated instances of templates).
-- Undone tasks stay on the list every day after due_date until ticked (carry-over).
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  area        TEXT NOT NULL,
  assignee    TEXT NOT NULL REFERENCES users(id),
  assigned_by TEXT REFERENCES users(id),
  due_date    TEXT NOT NULL,
  points      INTEGER NOT NULL DEFAULT 5,
  template_id INTEGER REFERENCES task_templates(id),
  note        TEXT,
  done_at     TEXT,                    -- local date YYYY-MM-DD it was ticked
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee, done_at, due_date);
CREATE UNIQUE INDEX idx_tasks_template_day ON tasks(template_id, due_date) WHERE template_id IS NOT NULL;

CREATE TABLE reward_goals (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  target  INTEGER NOT NULL,            -- points needed in a week
  reward  TEXT NOT NULL
);

CREATE TABLE rewards_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id),
  week_start  TEXT NOT NULL,           -- Monday YYYY-MM-DD
  points      INTEGER NOT NULL,
  reward      TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, week_start)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  text       TEXT NOT NULL,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read);
