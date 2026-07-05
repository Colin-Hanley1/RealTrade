# RealTradeTracker — Ledger

A personal trade log for prediction-market-style trades on RealSports: stake $X at a price
representing implied probability (e.g. $45 at 50% returns $90 if correct). Tracks full
history and flags **"lose-lose" combos** — opposing positions on the same event whose
combined entry prices are ≥100%, which guarantee a net loss no matter the outcome.

Static site (no build step), built for a single user, with [Supabase](https://supabase.com)
as the backend for auth and storage — so it deploys straight to GitHub Pages with no server
to run.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier is plenty).
2. In **Project Settings → Data API**, copy the **Project URL**.
3. In **Project Settings → API Keys**, copy the **anon public** key.
4. Paste both into `config.js`:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJ...";
   ```
   The anon key is safe to commit — Row Level Security (below) keeps every user's rows
   private to them even though the key is public in the deployed site.

## 2. Create the `trades` table

In the Supabase dashboard, open **SQL Editor** and run:

```sql
create table trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  trade_date date not null,
  league text not null check (league in ('MLB','WNBA')),
  event text not null,
  outcome text not null,
  price numeric not null check (price > 0 and price < 100),  -- implied probability, %
  units numeric not null check (units > 0),                  -- stake in bet-sizing units
  stake numeric not null check (stake > 0),                  -- units × unit size, in Rax, at entry time
  status text not null default 'open' check (status in ('open','won','lost','push')),
  notes text,
  created_at timestamptz not null default now()
);

alter table trades enable row level security;

create policy "select own trades" on trades for select using (auth.uid() = user_id);
create policy "insert own trades" on trades for insert with check (auth.uid() = user_id);
create policy "update own trades" on trades for update using (auth.uid() = user_id);
create policy "delete own trades" on trades for delete using (auth.uid() = user_id);

create table settings (
  user_id uuid primary key default auth.uid() references auth.users(id),
  unit_size numeric not null default 1 check (unit_size > 0)
);

alter table settings enable row level security;

create policy "select own settings" on settings for select using (auth.uid() = user_id);
create policy "insert own settings" on settings for insert with check (auth.uid() = user_id);
create policy "update own settings" on settings for update using (auth.uid() = user_id);
```

If you already created the `trades` table before the `league`/`units` columns existed,
migrate it instead:

```sql
alter table trades add column league text not null default 'MLB' check (league in ('MLB','WNBA'));
alter table trades alter column league drop default;
alter table trades add column units numeric not null default 1 check (units > 0);
alter table trades alter column units drop default;
```

## 3. Create your one user account

This app has no public sign-up — you create your single account directly in the dashboard:

1. **Authentication → Users → Add user**.
2. Enter your email and a password, and check **Auto Confirm User** (so it's usable
   immediately, no confirmation email needed).

That's the only account this site will ever accept — the login screen only signs in, it
never creates new accounts, so the deployed URL being public doesn't expose your data to
anyone else.

## 4. Run it locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` and sign in with the account you created above.

## 5. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create RealTradeTracker --public --source=. --push
```

Then in the GitHub repo: **Settings → Pages → Build and deployment → Source: Deploy from a
branch → Branch: main / (root)**. Your site will be live at
`https://<your-username>.github.io/RealTradeTracker/`.

## How the numbers work

- Stakes and P&L are denominated in **Rax** (RealSports' in-app currency), not USD. Rax is
  whole-number — unit size, stake, and payout are always rounded **down**, never to nearest
  or up.
- Stake is entered in **units** (e.g. 0.5, 1, 2), not raw Rax. Set your **Unit Size** once
  (top of the New Trade tab, saved to your account) and every trade's Rax stake is computed
  as `units × unit size` at the time you log it — changing your unit size later doesn't
  retroactively change past trades' recorded stakes.
- **Payout if correct** = `stake / (price / 100)` (e.g. 45 Rax at 50% → 90 Rax).
- **P&L** on a won trade = payout − stake; on a lost trade = −stake; push = 0.
- **Lose-lose flag**: for each event with two or more *open* trades on different outcomes,
  sums their entry prices. ≥100% combined means you cannot come out ahead on any outcome
  (red flag); 85–99% is a thin-margin warning (yellow flag).

## League / Market / Event fields

- **League** is limited to MLB and WNBA.
- Instead of typing a free-text event name, you pick **Away** and **Home** teams by
  abbreviation (NYY, BOS, ATH, ...). The team list (`TEAM_ABBR` in `app.js`) isn't guaranteed
  exhaustive (e.g. brand-new expansion franchises may be missing) — pick **Other…** to type
  any code not listed.
- These, plus the date, generate a standardized **Event ID** (e.g. `BOS@NYY-2026-07-05`),
  shown live under the form and stored as the trade's `event` value. It's built from the two
  team codes *sorted alphabetically*, so it comes out identical no matter which order you
  enter away/home in across separate trades — this is what makes the lose-lose check
  (below) reliably match both legs of the same game instead of depending on typing the same
  free-text event name twice.
- **Market** is Moneyline, NRFI, or YRFI for MLB; WNBA only offers Moneyline (NRFI/YRFI are
  first-inning baseball props and don't apply). Moneyline additionally shows a **Side**
  picker scoped to just the two teams you picked; NRFI/YRFI are themselves the pick, so no
  side field is needed.
