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
API_FOOTBALL_KEY=
FOOTBALL_DATA_TOKEN=
CLOUD_FIXTURE_WINDOW_DAYS=1
SPORTTERY_PAGE_SIZE=80
SPORTTERY_PAGE_DEPTH=16
DETAIL_ENRICH_LIMIT=60
```

## Free Data Source

Use one of these free API keys on Render:

- Recommended: API-Football free plan. Set `API_FOOTBALL_KEY`. It supports fixtures, status, kickoff time, live minute/status and score fields. Keep `REFRESH_MINUTES=30` to stay within the free daily quota.
- Backup: football-data.org free plan. Set `FOOTBALL_DATA_TOKEN`. It supports fixtures and delayed scores on the free plan, but true live scores require a paid tier.

`DATA_PROVIDER=auto` chooses `API_FOOTBALL_KEY` first, then `FOOTBALL_DATA_TOKEN`, then Sporttery/local seed fallback.

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
