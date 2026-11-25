# 🪺 The Stewart Nest

The Stewart family organiser for Lee Roy, Shirley and Skyler (and soon Madilea May).

**Phase 1 (this version)**
- **Logins** for Lee Roy, Shirley and Skyler. Each person picks a 4-digit PIN the first time they log in. Five wrong PINs lock that profile for 15 minutes, and Mom or Dad can reset a forgotten PIN.
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

**Phase 2 (next):** family chat, fun-time ideas, Madilea's going-out bag and monthly buy list, stock take before shopping, barcode and photo inventory, and workouts.

---

## Run it on the laptop

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
