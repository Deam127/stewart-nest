# 🪺 The Stewart Nest

The Stewart family organiser for Lee Roy, Shirley and Skyler (and soon Madilea May).

**Phase 1 (this version)**
- **Logins with passwords.** Lee Roy is the **admin**:
  - On the very first login, Lee Roy chooses his own password (at least 6 characters).
  - In **Family → 👥 Family profiles**, Lee Roy gives Shirley and Skyler a temporary password. They log in with it once, then must choose their own.
  - Old 4-digit PINs from earlier versions work once, then a new password is required.
  - Five wrong passwords lock a profile for 15 minutes. The admin can unlock it by setting a temporary password.
  - The admin can add family members (e.g. Madilea later, or a grandparent), edit names, emoji and colours, and switch profiles off.
- **Calendar landing page** showing the month's suppers. Tap a day to see breakfast, lunch and supper with everyone's portions and the method.
- **Seasonal menu.** Each month's menu builds itself from a rotation:
  - summer (Oct–Mar): braais and salads
  - winter (Apr–Sep): soups and stews
  - You can swap any meal and take recipes out of rotation when they're out of season or not in stock.
- **Rain-out plans.** Every braai has an indoor backup. The calendar uses the Krugersdorp forecast to flag rain, one tap switches to the backup, and the family is notified.
- **Day plans** (outings, visitors), each with its own rain plan.
- **Notes** on any day.
- **Tasks by house area:**
  - areas: kitchen, bathroom, main bedroom, second bedroom, lounge, toilet, yard, Madilea, car, workouts, groceries
  - assign tasks to each other, as one-offs or repeating chores
  - the person gets a notification, and whoever gave the task is told when it's done
- **Shirley's checklist rule.** Undone tasks carry over to the next day with a "days late" counter until they're ticked.
- **Weekly rewards and accountability:**
  - points per person per week: full points on the day, half points if done late
  - on-time, late and still-open counts
  - a reward goal per person, and Mom or Dad hands the reward out
- **Madilea countdown** in the header.

**Planning & schedule (latest):**
- **📖 Recipes:** a catalogue of breakfasts, lunches and suppers with ingredients linked to inventory items (pack sizes and prices), a cost per meal, portions and method. Add new recipes and new ingredient items.
- **🔁 Weekly rotation:** which suppers cycle on which weekday, separately for summer and winter. Monthly menus are built from it.
- **🗓️ Plan ahead:** build menus months ahead, then pick any date range to see every ingredient needed in packs, minus what's in the cupboard, costed against the budget. One tap turns it into the shopping list.
- **📅 Events & schedule:**
  - one-off, weekly, monthly or yearly events
  - "school days only" (skips holidays and school breaks) and "skip public holidays"
  - routines shown on the day page only
  - reminders the day before (from 17:00) or the morning of (from 06:00); a child's reminders also go to the grown-ups
- **Preloaded:**
  - SA public holidays from Dec 2026 to Dec 2027
  - public school terms for 2026 term 4 and all of 2027 (DBE gazette), with schools open/close reminders
  - Wednesday bin day (reminder Tuesday evening)
  - Lee Roy's work routine (07:00–17:30, weekdays, not public holidays)
  - Skyler's school days
  - Madilea's due date
  - The bins chore moved to Tuesday.

**Also in this version:** meal ratings (stars, keep/swap, comments, with a report to paste into Claude), plus phone home-screen icons.

**Phase 2 (done):** family chat, fun-time ideas, Madilea's going-out bag and monthly buy list, stock take before shopping, barcode and photo inventory, and workouts.

---

## Run it on the laptop

**Easiest (Windows):** double-click **`Start Stewart Nest.bat`**. On the first run it installs Node.js if needed, installs the app, sets up the database and opens the browser. After that it just starts the app.

**By hand:**

You need **Node.js 20 or newer** (https://nodejs.org, LTS) and **Git**.

```bash
git clone https://github.com/Deam127/stewart-nest.git
cd stewart-nest
npm install
npm run setup      # creates the local database with recipes, family and chores (first time only!)
npm run dev
```

Open **http://localhost:8787**.

**Phones on the home Wi-Fi:** use the laptop's IP address instead, for example `http://192.168.1.20:8787`. To find the IP, run `ipconfig` on Windows and look for the IPv4 address. Chrome on Android can then "Add to Home screen".

> Updating: copy the new files over the old folder. The database upgrades itself automatically the next time the app starts, so your data stays.
>
> ⚠️ `npm run setup` (also `npm run db:reset`) **wipes all data** and starts fresh. Only run it the first time.
> Data lives in `.wrangler/state` inside the folder. Back that folder up if you care about it.

## Put it on Cloudflare (later)

```bash
npx wrangler login
npx wrangler d1 create stewart-nest       # copy the database_id it prints into wrangler.jsonc
npm run db:remote:reset                   # creates tables + seed data online (first time only)
npm run deploy
```

You'll get a `https://stewart-nest.<your-account>.workers.dev` address, and you can attach your own domain in the Cloudflare dashboard. Pop-up notifications on phones need HTTPS, which Cloudflare gives you.

## Changing things

| What | Where |
|---|---|
| Chores, points and days | In the app: **Tasks → Repeating chores**. Starting list: `seed/family.sql` |
| Reward goals | In the app: **Rewards → Change goal** (Mom or Dad) |
| Supper rotation per weekday | `ROTATION` in `src/worker.js` |
| Recipes, portions, methods | `seed/recipes.sql` |
| Baby due date and rain warning level | In the app: **More** |

## How it's built

- `src/worker.js` is the API: a Cloudflare Worker using a D1 (SQLite) database.
- `public/` holds the app itself, in plain HTML, CSS and JS with no build step.
- `schema.sql` defines the database tables.
- The weather comes from Open-Meteo (free, no key needed).
