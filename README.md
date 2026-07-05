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
  event text not null,
  outcome text not null,
  price numeric not null check (price > 0 and price < 100),  -- implied probability, %
  stake numeric not null check (stake > 0),                  -- $ risked
  status text not null default 'open' check (status in ('open','won','lost','push')),
  notes text,
  created_at timestamptz not null default now()
);

alter table trades enable row level security;

create policy "select own trades" on trades for select using (auth.uid() = user_id);
create policy "insert own trades" on trades for insert with check (auth.uid() = user_id);
create policy "update own trades" on trades for update using (auth.uid() = user_id);
create policy "delete own trades" on trades for delete using (auth.uid() = user_id);
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

- **Payout if correct** = `stake / (price / 100)` (e.g. $45 at 50% → $90).
- **P&L** on a won trade = payout − stake; on a lost trade = −stake; push = 0.
- **Lose-lose flag**: for each event with two or more *open* trades on different outcomes,
  sums their entry prices. ≥100% combined means you cannot come out ahead on any outcome
  (red flag); 85–99% is a thin-margin warning (yellow flag).
