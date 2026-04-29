# Free Deployment

## Recommended: Render Free Web Service

This project is ready for Render Blueprint deployment through `render.yaml`.

1. Push this repository to GitHub.
2. Open https://dashboard.render.com/blueprints
3. Click **New Blueprint Instance**.
4. Connect the GitHub repository.
5. Select this project root if Render asks for a root directory:
   `football-analysis-web`
6. Render will read `render.yaml` and create a free web service.

Default environment:

```env
HOST=0.0.0.0
REFRESH_MINUTES=30
LIVE_REFRESH_SECONDS=1800
DATA_PROVIDER=auto
DATA_CONTENT_MODE=sporttery-compatible
ESPN_SOCCER_LEAGUES=eng.1,esp.1,ita.1,ger.1,fra.1,uefa.champions,uefa.europa,uefa.europa.conf
THESPORTSDB_KEY=
API_FOOTBALL_KEY=
FOOTBALL_DATA_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CLOUD_SNAPSHOT_TABLE=football_snapshots
CLOUD_SNAPSHOT_ID=latest
CLOUD_FIXTURE_WINDOW_DAYS=0
TARGET_LEAGUE_CODES=39,140,135,78,61
TARGET_LEAGUE_NAMES=英超,西甲,意甲,德甲,法甲
SPORTTERY_PAGE_SIZE=80
SPORTTERY_PAGE_DEPTH=16
DETAIL_ENRICH_LIMIT=60
```

## Free Data Source

Use one of these free API keys on Render:

- No-key fallback: ESPN public scoreboard JSON. This is enabled by default and does not require local sync or an API quota, but it is not an official contracted data API and coverage is mainly mainstream leagues.
- Recommended free-first source: TheSportsDB. Set `THESPORTSDB_KEY`. It provides soccer day events and a livescore endpoint with a free key.
- Strong structured live data: API-Football free plan. Set `API_FOOTBALL_KEY`. It supports fixtures, status, kickoff time, live minute/status and score fields. Keep `REFRESH_MINUTES=30` to stay within the free daily quota.
- Backup: football-data.org free plan. Set `FOOTBALL_DATA_TOKEN`. It supports fixtures and delayed scores on the free plan, but true live scores require a paid tier.

`DATA_CONTENT_MODE=sporttery-compatible` keeps the Sporttery/Jingcai match pool as the canonical content. Cloud APIs are fallback sources only and should not replace the Sporttery-style match list.

`DATA_PROVIDER=auto` chooses Sporttery first in compatible mode. If no Sporttery snapshot exists, it falls back to API-Football, then TheSportsDB, then football-data.org, then the ESPN no-key scoreboard fallback.

## Free Cloud Snapshot Storage

Render Free does not preserve local filesystem changes. Use Supabase Free for the latest snapshot:

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

See `docs/cloud-data-plan.md` for the full cloud update flow.

Optional AI provider keys:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
```

## Notes

- Free web services may sleep after inactivity.
- The local SQLite/cache files under `server-cache/` are not intended as durable storage on free hosting.
- If the service restarts, it will rebuild cache through the configured free API. If no free API key is set, it uses the bundled seed snapshot.
- For production paid usage, move `server-cache/matches.sqlite` to a persistent disk or external database.
- Some cloud egress IPs may be blocked by Sporttery. If `/api/status` shows `sporttery_http_567`, set `API_FOOTBALL_KEY` or `FOOTBALL_DATA_TOKEN`.

## Cloud Scheduled Refresh

The included GitHub Actions workflow can wake Render every 30 minutes without using your local computer.

Set this GitHub repository secret:

```env
RENDER_REFRESH_URL=https://football-analysis-web.onrender.com/api/refresh
RENDER_BASE_URL=https://football-analysis-web.onrender.com
ADMIN_SYNC_TOKEN=copy_from_render_environment
SPORTTERY_PROXY_URL=https://your-worker.your-subdomain.workers.dev/?token=your_proxy_token
```

`RENDER_BASE_URL` and `ADMIN_SYNC_TOKEN` enable the GitHub Actions cloud worker to fetch the official Sporttery current match list and import it into Render. This keeps the app aligned with the Jingcai/Sporttery match pool without running anything locally.

`SPORTTERY_PROXY_URL` is optional. Use it only if GitHub Actions cannot access Sporttery directly. A Cloudflare Worker template is included at `cloudflare/sporttery-proxy-worker.js`.

## Optional Cloudflare Worker Proxy

If both Render and GitHub Actions cannot access the official Sporttery endpoint, deploy the Worker in `cloudflare/sporttery-proxy-worker.js`:

1. Create a free Cloudflare Worker.
2. Paste the file contents into the Worker editor.
3. Add a Worker variable named `SPORTTERY_PROXY_TOKEN`.
4. Save and deploy.
5. Add this GitHub Actions secret:

```env
SPORTTERY_PROXY_URL=https://your-worker.your-subdomain.workers.dev/?token=your_proxy_token
```

The sync workflow tries the official endpoint first, then `SPORTTERY_SOURCE_URLS`, then `SPORTTERY_PROXY_URL`.

## External Sync For Render

Render can serve the site globally, but Sporttery may block Render's cloud IP. In that case, run a local sync from a machine that can access Sporttery:

1. In Render, open the service environment variables and copy `ADMIN_SYNC_TOKEN`.
2. Start the local app and let it refresh Sporttery data.
3. Push the local snapshot to Render:

```powershell
$env:RENDER_BASE_URL="https://football-analysis-web.onrender.com"
$env:ADMIN_SYNC_TOKEN="paste_render_admin_sync_token_here"
npm run push:render
```

The Render site will then show the pushed data globally.

## Docker Alternative

Platforms that support Docker, such as Koyeb, can use the included `Dockerfile`.

Required runtime variables:

```env
HOST=0.0.0.0
PORT=8787
```
