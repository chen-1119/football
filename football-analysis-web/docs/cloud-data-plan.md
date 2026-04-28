# Cloud Data Plan

## Goal

The app should update without a local computer and keep the latest snapshot after a free Render restart.

## Free Architecture

1. Render Free hosts the web app.
2. GitHub Actions wakes Render every 30 minutes by calling `/api/refresh`.
3. Render fetches data from the configured free provider:
   - `THESPORTSDB_KEY` first
   - `API_FOOTBALL_KEY` second
   - `FOOTBALL_DATA_TOKEN` third
   - Sporttery or bundled seed as final fallback
4. Render writes the latest snapshot to Supabase Free.
5. On startup, Render loads the Supabase snapshot before fetching new data.

## Supabase Setup

Create a free Supabase project, open SQL Editor, and run:

```sql
create table if not exists public.football_snapshots (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

Set these Render environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CLOUD_SNAPSHOT_TABLE=football_snapshots
CLOUD_SNAPSHOT_ID=latest
```

The service role key must stay server-side only. Do not expose it in frontend code.

## GitHub Actions Setup

In GitHub repository settings, add this repository secret:

```env
RENDER_REFRESH_URL=https://football-analysis-web.onrender.com/api/refresh
```

The workflow `.github/workflows/refresh-render.yml` runs every 30 minutes and can also be triggered manually.

## Provider Notes

- TheSportsDB is the recommended free-first source for this project because it provides soccer day events and a livescore endpoint with a free key.
- API-Football has stronger structured live fields, but the free quota is limited, so keep the refresh interval conservative.
- football-data.org free data is useful for fixtures and delayed scores, but live scores require a paid tier.
- Scraping arbitrary score websites should be a last resort because it is fragile and may violate site terms or be blocked by bot protection.
