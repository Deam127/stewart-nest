-- The Stewart Nest — Phase 2 tables
-- Run once on a database that already has Phase 1: `npm run db:phase2`
-- (A fresh `npm run setup` runs this automatically.)

-- ---------- family chat ----------
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  text       TEXT,
  photo_key  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  last_id INTEGER NOT NULL DEFAULT 0
);

-- ---------- family fun ----------
-- where: 'home' | 'out'; cost: 0 free, 1 cheap (<R200), 2 treat; easy = gentle enough for a heavily pregnant mom / new baby
CREATE TABLE IF NOT EXISTS fun_ideas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  details    TEXT,
  place      TEXT NOT NULL DEFAULT 'home',
  cost       INTEGER NOT NULL DEFAULT 0,
  easy       INTEGER NOT NULL DEFAULT 0,
  needs_dry  INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  last_done  TEXT,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS fun_votes (
  idea_id INTEGER NOT NULL REFERENCES fun_ideas(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (idea_id, user_id)
);

-- ---------- checklists (Madilea's bags, hospital bags, monthly buy lists) ----------
-- kind: 'bag' (reusable: untick all to repack) | 'buy' (one per month, month = YYYY-MM)
CREATE TABLE IF NOT EXISTS checklists (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  kind   TEXT NOT NULL,
  title  TEXT NOT NULL,
  month  TEXT,
  sort   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id  INTEGER NOT NULL REFERENCES checklists(id),
  text     TEXT NOT NULL,
  qty      TEXT,
  price    REAL,
  done     INTEGER NOT NULL DEFAULT 0,
  done_by  TEXT REFERENCES users(id),
  sort     INTEGER NOT NULL DEFAULT 0
);

-- ---------- inventory ----------
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE,                -- NEST-0001 (our own code)
  barcode    TEXT,                       -- EAN/UPC from the pack
  name       TEXT NOT NULL,
  brand      TEXT,
  size       TEXT,                       -- '2kg', '750ml', '18 rolls'
  section    TEXT NOT NULL DEFAULT 'Other',
  kind       TEXT NOT NULL DEFAULT 'grocery', -- grocery | household | meat | baby
  price      REAL,                       -- last price paid / expected
  shop       TEXT,
  photo_key  TEXT,
  par        REAL NOT NULL DEFAULT 1,    -- how many we want in the house at the start of the month
  on_hand    REAL NOT NULL DEFAULT 0,
  essential  INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
CREATE TABLE IF NOT EXISTS item_prices (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  price   REAL NOT NULL,
  shop    TEXT,
  date    TEXT NOT NULL
);

-- A stock take: someone counts what's in the cupboards before shopping
CREATE TABLE IF NOT EXISTS stock_takes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_by TEXT REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_counts (
  take_id INTEGER NOT NULL REFERENCES stock_takes(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty     REAL NOT NULL,
  PRIMARY KEY (take_id, item_id)
);

-- A shopping trip built from the stock take; the trolley is tracked in-store
CREATE TABLE IF NOT EXISTS shop_trips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  take_id     INTEGER REFERENCES stock_takes(id),
  budget      REAL NOT NULL,
  shop        TEXT,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | done
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS shop_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id   INTEGER NOT NULL REFERENCES shop_trips(id),
  item_id   INTEGER REFERENCES items(id),   -- NULL for extras picked up in-store
  name      TEXT NOT NULL,
  plan_qty  REAL NOT NULL DEFAULT 0,
  plan_price REAL,
  in_trolley INTEGER NOT NULL DEFAULT 0,
  qty       REAL,
  price     REAL,                           -- actual unit price
  skipped   INTEGER NOT NULL DEFAULT 0
);

-- ---------- workouts ----------
-- A workout is a repeating chore in the 'Workouts' area (so it carries over, earns points and shows on the calendar).
-- These tables add how long it should take, how to do it, and what was actually done.
CREATE TABLE IF NOT EXISTS workout_info (
  template_id INTEGER PRIMARY KEY REFERENCES task_templates(id),
  minutes     INTEGER NOT NULL DEFAULT 20,
  howto       TEXT
);
CREATE TABLE IF NOT EXISTS workout_logs (
  task_id  INTEGER PRIMARY KEY REFERENCES tasks(id),
  minutes  INTEGER,
  feel     INTEGER,               -- 1 tough … 3 great
  note     TEXT
);
