const http = require("http");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 5);
const LIVE_REFRESH_SECONDS = Number(process.env.LIVE_REFRESH_SECONDS || 60);
const ADMIN_SYNC_TOKEN = process.env.ADMIN_SYNC_TOKEN || "";
const DATA_PROVIDER = String(process.env.DATA_PROVIDER || "auto").trim().toLowerCase();
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || "";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CLOUD_SNAPSHOT_TABLE = process.env.CLOUD_SNAPSHOT_TABLE || "football_snapshots";
const CLOUD_SNAPSHOT_ID = process.env.CLOUD_SNAPSHOT_ID || "latest";
const ESPN_SOCCER_LEAGUES = (process.env.ESPN_SOCCER_LEAGUES ||
  "eng.1,esp.1,ita.1,ger.1,fra.1,uefa.champions,uefa.europa,uefa.europa.conf").split(",").map((x) => x.trim()).filter(Boolean);
const SPORTTERY_BASE = "https://webapi.sporttery.cn";
const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const FOOTBALL_DATA_BASE = "https://api.football-data.org/v4";
const THESPORTSDB_BASE = "https://www.thesportsdb.com";
const ESPN_SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const PUBLIC_DIR = __dirname;
const CACHE_DIR = path.join(__dirname, "server-cache");
const CACHE_FILE = path.join(CACHE_DIR, "snapshot.json");
const SEED_CACHE_FILE = path.join(__dirname, "seed-snapshot.json");
const AI_PREDICTION_CACHE_FILE = path.join(CACHE_DIR, "ai-predictions.json");
const SNAPSHOT_HISTORY_DIR = path.join(CACHE_DIR, "history");
const DB_FILE = path.join(CACHE_DIR, "matches.sqlite");
const MAX_SNAPSHOT_HISTORY = Number(process.env.MAX_SNAPSHOT_HISTORY || 48);

const SPORTTERY_METHODS = ["concern", "live", "result", "all"];
const SPORTTERY_PAGE_SIZE = Number(process.env.SPORTTERY_PAGE_SIZE || 80);
const SPORTTERY_PAGE_DEPTH = Number(process.env.SPORTTERY_PAGE_DEPTH || 16);
const DETAIL_ENRICH_LIMIT = Number(process.env.DETAIL_ENRICH_LIMIT || 60);
const FX_USD_CNY = Number(process.env.FX_USD_CNY || 7.2);
const CLOUD_FIXTURE_WINDOW_DAYS = Number(process.env.CLOUD_FIXTURE_WINDOW_DAYS || 1);

const LEAGUE_NAME_ZH = new Map(
  [
    ["English Premier League", "英超"],
    ["Premier League", "英超"],
    ["Spanish LALIGA", "西甲"],
    ["La Liga", "西甲"],
    ["Italian Serie A", "意甲"],
    ["Serie A", "意甲"],
    ["German Bundesliga", "德甲"],
    ["Bundesliga", "德甲"],
    ["French Ligue 1", "法甲"],
    ["Ligue 1", "法甲"],
    ["UEFA Champions League", "欧冠"],
    ["UEFA Europa League", "欧联"],
    ["UEFA Conference League", "欧协联"],
    ["English League 1", "英甲"],
    ["Portuguese Primeira Liga", "葡超"],
    ["Germany Women Bundesliga", "德国女足联赛"],
    ["Slovenian 2 SNL", "斯洛文尼亚乙级联赛"],
  ].map(([key, value]) => [key.toLowerCase(), value])
);

const TARGET_LEAGUE_CODES = new Set((process.env.TARGET_LEAGUE_CODES || "39,140,135,78,61").split(",").map((x) => x.trim()).filter(Boolean));
const TARGET_LEAGUE_NAMES = new Set((process.env.TARGET_LEAGUE_NAMES || "英超,西甲,意甲,德甲,法甲").split(",").map((x) => x.trim()).filter(Boolean));

const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  { id: "gemini", name: "Google Gemini", envKey: "GEMINI_API_KEY" },
  { id: "deepseek", name: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
];

const AI_MODELS = [
  {
    id: "openai-gpt-5.4-mini",
    provider: "openai",
    model: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    inputUsdPerMTok: 0.75,
    cachedInputUsdPerMTok: 0.075,
    outputUsdPerMTok: 4.5,
    tier: "均衡",
    speed: "快",
  },
  {
    id: "openai-gpt-5.4",
    provider: "openai",
    model: "gpt-5.4",
    name: "GPT-5.4",
    inputUsdPerMTok: 2.5,
    cachedInputUsdPerMTok: 0.25,
    outputUsdPerMTok: 15,
    tier: "旗舰",
    speed: "中",
  },
  {
    id: "anthropic-sonnet-4.5",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    inputUsdPerMTok: 3,
    cachedInputUsdPerMTok: 0.3,
    outputUsdPerMTok: 15,
    tier: "旗舰",
    speed: "中",
  },
  {
    id: "anthropic-haiku-4.5",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    inputUsdPerMTok: 1,
    cachedInputUsdPerMTok: 0.1,
    outputUsdPerMTok: 5,
    tier: "轻量",
    speed: "快",
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    provider: "gemini",
    model: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash-Lite",
    inputUsdPerMTok: 0.25,
    cachedInputUsdPerMTok: 0.025,
    outputUsdPerMTok: 1.5,
    tier: "轻量",
    speed: "快",
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    inputUsdPerMTok: 2,
    cachedInputUsdPerMTok: 0.2,
    outputUsdPerMTok: 12,
    tier: "旗舰",
    speed: "中",
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    model: "deepseek-chat",
    name: "DeepSeek Chat (V3.2)",
    inputUsdPerMTok: 0.28,
    cachedInputUsdPerMTok: 0.028,
    outputUsdPerMTok: 0.42,
    tier: "轻量",
    speed: "快",
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    model: "deepseek-reasoner",
    name: "DeepSeek Reasoner (V3.2)",
    inputUsdPerMTok: 0.28,
    cachedInputUsdPerMTok: 0.028,
    outputUsdPerMTok: 0.42,
    tier: "推理",
    speed: "中",
  },
];

const AI_PROMPT_TEMPLATES = [
  {
    id: "prd-basic-fundamentals",
    name: "基本面分析提示词",
    category: "基本面",
    prompt:
      "你是职业足球赛前分析师。请从近期战绩、联赛排名、主客场效率、进攻/防守质量、伤停名单五个维度，输出结构化中文分析。必须包含：核心结论、关键数据、风险提示。",
  },
  {
    id: "prd-tactical-context",
    name: "战术情境分析提示词",
    category: "战术",
    prompt:
      "请对双方阵型匹配、关键对位、压迫与反击路径、边路推进效率、定位球威胁进行分析，并用“主队优势/客队优势/均势”进行最终判定。",
  },
  {
    id: "prd-market-odds",
    name: "赔率与市场分析提示词",
    category: "市场",
    prompt:
      "基于1X2赔率、盘口变化、市场热度，拆解隐含概率与边际价值。仅讨论数据，不提供投注建议。输出包含：赔率解读、市场情绪、异常波动解释。",
  },
  {
    id: "prd-model-output",
    name: "综合预测模型提示词",
    category: "模型",
    prompt:
      "综合 xG/xGA、进攻防守效率、赛程疲劳、阵容可用性与市场信息，给出胜平负概率、候选比分矩阵、置信度分层（高/中/低）及不确定性来源。",
  },
];

const AI_PRICING_SCENARIOS = [
  { id: "quick", name: "快评版", inputTokens: 2600, outputTokens: 900, calls: 1, markup: 2.2, minCny: 0.3 },
  { id: "deep", name: "深度版", inputTokens: 8800, outputTokens: 3200, calls: 1, markup: 2.8, minCny: 0.8 },
  { id: "pro", name: "专家版", inputTokens: 14000, outputTokens: 5200, calls: 1, markup: 3.4, minCny: 1.5 },
];

const AI_PRICING_SOURCES = [
  { provider: "OpenAI", url: "https://developers.openai.com/api/docs/pricing", checkedAt: "2026-04-23" },
  { provider: "Anthropic", url: "https://docs.anthropic.com/en/docs/about-claude/pricing", checkedAt: "2026-04-23" },
  { provider: "Google Gemini", url: "https://ai.google.dev/gemini-api/docs/pricing", checkedAt: "2026-04-23" },
  { provider: "DeepSeek", url: "https://api-docs.deepseek.com/quick_start/pricing/", checkedAt: "2026-04-23" },
];

const cache = {
  updatedAt: null,
  source: "fallback-mock",
  matches: [],
  analysisById: {},
  news: [],
  lastError: null,
  refreshing: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextRefreshAt: null,
  refreshCount: 0,
  lastDurationMs: null,
  lastSnapshotFile: null,
};

const API_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

let db = null;
let upsertLatestStmt = null;
let insertHistoryStmt = null;
let selectLatestFingerprintStmt = null;
let insertSnapshotStmt = null;
let searchHistoryCountStmt = null;
let searchHistoryRowsStmt = null;
let searchTimelineStmt = null;
let selectLatestByIdStmt = null;
let insertPredictionArchiveStmt = null;
let selectPredictionArchiveByIdStmt = null;
let selectPredictionArchiveAllStmt = null;
let selectLatestOddsByIdStmt = null;
const predictionArchiveCache = new Map();
const advancedAnalysisCache = new Map();
const aiPredictionCache = new Map();
const ADVANCED_CACHE_TTL_MS = Number(process.env.ADVANCED_CACHE_TTL_MS || 5 * 60 * 1000);

function normText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function normalizeIsoDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function scoreFromSections(section) {
  const s = normText(section);
  if (!s) return { home: null, away: null };
  const match = s.match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!match) return { home: null, away: null };
  return { home: Number(match[1]), away: Number(match[2]) };
}

function toDbNum(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function matchFingerprint(match) {
  return [
    normText(match.status),
    normText(match.statusCode),
    normText(match.datetime),
    toDbNum(match.score?.fullTime?.home),
    toDbNum(match.score?.fullTime?.away),
    toDbNum(match.odds?.oneXTwo?.home),
    toDbNum(match.odds?.oneXTwo?.draw),
    toDbNum(match.odds?.oneXTwo?.away),
  ].join("|");
}

function initDatabase() {
  ensureCacheDir();
  db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_at TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT,
      refresh_count INTEGER,
      match_count INTEGER,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS match_latest (
      match_id TEXT PRIMARY KEY,
      source_id TEXT,
      source_method TEXT,
      league_code TEXT,
      league TEXT,
      competition TEXT,
      match_num_str TEXT,
      round_text TEXT,
      match_time TEXT,
      status TEXT,
      status_code TEXT,
      status_name TEXT,
      home_team_id TEXT,
      home_name TEXT,
      home_short TEXT,
      away_team_id TEXT,
      away_name TEXT,
      away_short TEXT,
      venue TEXT,
      city TEXT,
      odds_home REAL,
      odds_draw REAL,
      odds_away REAL,
      score_home INTEGER,
      score_away INTEGER,
      fingerprint TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      source_id TEXT,
      source_method TEXT,
      league_code TEXT,
      league TEXT,
      competition TEXT,
      match_num_str TEXT,
      round_text TEXT,
      match_time TEXT,
      status TEXT,
      status_code TEXT,
      status_name TEXT,
      home_team_id TEXT,
      home_name TEXT,
      home_short TEXT,
      away_team_id TEXT,
      away_name TEXT,
      away_short TEXT,
      venue TEXT,
      city TEXT,
      odds_home REAL,
      odds_draw REAL,
      odds_away REAL,
      score_home INTEGER,
      score_away INTEGER,
      fingerprint TEXT NOT NULL,
      snapshot_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prediction_archive (
      match_id TEXT PRIMARY KEY,
      locked_at TEXT NOT NULL,
      status_at_lock TEXT,
      lock_reason TEXT,
      analysis_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_match_latest_datetime ON match_latest(match_time);
    CREATE INDEX IF NOT EXISTS idx_match_latest_league ON match_latest(league);
    CREATE INDEX IF NOT EXISTS idx_match_latest_status ON match_latest(status);
    CREATE INDEX IF NOT EXISTS idx_match_history_match ON match_history(match_id);
    CREATE INDEX IF NOT EXISTS idx_match_history_snapshot ON match_history(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_prediction_archive_locked_at ON prediction_archive(locked_at);
  `);

  insertSnapshotStmt = db.prepare(`
    INSERT INTO refresh_snapshot (snapshot_at, source, updated_at, refresh_count, match_count, last_error)
    VALUES (@snapshot_at, @source, @updated_at, @refresh_count, @match_count, @last_error)
  `);

  upsertLatestStmt = db.prepare(`
    INSERT INTO match_latest (
      match_id, source_id, source_method, league_code, league, competition, match_num_str, round_text, match_time,
      status, status_code, status_name, home_team_id, home_name, home_short, away_team_id, away_name, away_short,
      venue, city, odds_home, odds_draw, odds_away, score_home, score_away, fingerprint, snapshot_at, updated_at
    ) VALUES (
      @match_id, @source_id, @source_method, @league_code, @league, @competition, @match_num_str, @round_text, @match_time,
      @status, @status_code, @status_name, @home_team_id, @home_name, @home_short, @away_team_id, @away_name, @away_short,
      @venue, @city, @odds_home, @odds_draw, @odds_away, @score_home, @score_away, @fingerprint, @snapshot_at, @updated_at
    )
    ON CONFLICT(match_id) DO UPDATE SET
      source_id = excluded.source_id,
      source_method = excluded.source_method,
      league_code = excluded.league_code,
      league = excluded.league,
      competition = excluded.competition,
      match_num_str = excluded.match_num_str,
      round_text = excluded.round_text,
      match_time = excluded.match_time,
      status = excluded.status,
      status_code = excluded.status_code,
      status_name = excluded.status_name,
      home_team_id = excluded.home_team_id,
      home_name = excluded.home_name,
      home_short = excluded.home_short,
      away_team_id = excluded.away_team_id,
      away_name = excluded.away_name,
      away_short = excluded.away_short,
      venue = excluded.venue,
      city = excluded.city,
      odds_home = excluded.odds_home,
      odds_draw = excluded.odds_draw,
      odds_away = excluded.odds_away,
      score_home = excluded.score_home,
      score_away = excluded.score_away,
      fingerprint = excluded.fingerprint,
      snapshot_at = excluded.snapshot_at,
      updated_at = excluded.updated_at
  `);

  insertHistoryStmt = db.prepare(`
    INSERT INTO match_history (
      match_id, source_id, source_method, league_code, league, competition, match_num_str, round_text, match_time,
      status, status_code, status_name, home_team_id, home_name, home_short, away_team_id, away_name, away_short,
      venue, city, odds_home, odds_draw, odds_away, score_home, score_away, fingerprint, snapshot_at, updated_at
    ) VALUES (
      @match_id, @source_id, @source_method, @league_code, @league, @competition, @match_num_str, @round_text, @match_time,
      @status, @status_code, @status_name, @home_team_id, @home_name, @home_short, @away_team_id, @away_name, @away_short,
      @venue, @city, @odds_home, @odds_draw, @odds_away, @score_home, @score_away, @fingerprint, @snapshot_at, @updated_at
    )
  `);

  selectLatestFingerprintStmt = db.prepare("SELECT fingerprint FROM match_latest WHERE match_id = ?");

  searchHistoryCountStmt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM match_latest
    WHERE (@q = '' OR lower(league || ' ' || competition || ' ' || home_name || ' ' || away_name || ' ' || match_num_str) LIKE '%' || lower(@q) || '%')
      AND (@league = '' OR league = @league OR league_code = @league)
      AND (@status = '' OR status = @status OR status_code = @status)
      AND (@date_from = '' OR substr(match_time, 1, 10) >= @date_from)
      AND (@date_to = '' OR substr(match_time, 1, 10) <= @date_to)
  `);

  searchHistoryRowsStmt = db.prepare(`
    SELECT
      match_id AS id,
      source_id AS sourceId,
      source_method AS sourceMethod,
      league_code AS leagueCode,
      league,
      competition,
      match_num_str AS matchNumStr,
      round_text AS round,
      match_time AS datetime,
      status,
      status_code AS statusCode,
      status_name AS statusName,
      home_team_id AS homeTeamId,
      home_name AS homeName,
      home_short AS homeShort,
      away_team_id AS awayTeamId,
      away_name AS awayName,
      away_short AS awayShort,
      venue,
      city,
      odds_home AS oddsHome,
      odds_draw AS oddsDraw,
      odds_away AS oddsAway,
      score_home AS scoreHome,
      score_away AS scoreAway,
      snapshot_at AS snapshotAt,
      updated_at AS updatedAt
    FROM match_latest
    WHERE (@q = '' OR lower(league || ' ' || competition || ' ' || home_name || ' ' || away_name || ' ' || match_num_str) LIKE '%' || lower(@q) || '%')
      AND (@league = '' OR league = @league OR league_code = @league)
      AND (@status = '' OR status = @status OR status_code = @status)
      AND (@date_from = '' OR substr(match_time, 1, 10) >= @date_from)
      AND (@date_to = '' OR substr(match_time, 1, 10) <= @date_to)
    ORDER BY datetime(match_time) DESC
    LIMIT @limit OFFSET @offset
  `);

  searchTimelineStmt = db.prepare(`
    SELECT
      snapshot_at AS snapshotAt,
      status,
      status_code AS statusCode,
      status_name AS statusName,
      odds_home AS oddsHome,
      odds_draw AS oddsDraw,
      odds_away AS oddsAway,
      score_home AS scoreHome,
      score_away AS scoreAway
    FROM match_history
    WHERE match_id = ?
    ORDER BY datetime(snapshot_at) DESC
    LIMIT ?
  `);

  selectLatestByIdStmt = db.prepare(`
    SELECT
      match_id AS id,
      source_id AS sourceId,
      source_method AS sourceMethod,
      league_code AS leagueCode,
      league,
      competition,
      match_num_str AS matchNumStr,
      round_text AS round,
      match_time AS datetime,
      status,
      status_code AS statusCode,
      status_name AS statusName,
      home_team_id AS homeTeamId,
      home_name AS homeName,
      home_short AS homeShort,
      away_team_id AS awayTeamId,
      away_name AS awayName,
      away_short AS awayShort,
      venue,
      city,
      odds_home AS oddsHome,
      odds_draw AS oddsDraw,
      odds_away AS oddsAway,
      score_home AS scoreHome,
      score_away AS scoreAway
    FROM match_latest
    WHERE match_id = ?
    LIMIT 1
  `);

  insertPredictionArchiveStmt = db.prepare(`
    INSERT OR IGNORE INTO prediction_archive (
      match_id, locked_at, status_at_lock, lock_reason, analysis_json, updated_at
    ) VALUES (
      @match_id, @locked_at, @status_at_lock, @lock_reason, @analysis_json, @updated_at
    )
  `);

  selectPredictionArchiveByIdStmt = db.prepare(`
    SELECT
      match_id AS matchId,
      locked_at AS lockedAt,
      status_at_lock AS statusAtLock,
      lock_reason AS lockReason,
      analysis_json AS analysisJson
    FROM prediction_archive
    WHERE match_id = ?
    LIMIT 1
  `);

  selectPredictionArchiveAllStmt = db.prepare(`
    SELECT
      match_id AS matchId,
      locked_at AS lockedAt,
      status_at_lock AS statusAtLock,
      lock_reason AS lockReason,
      analysis_json AS analysisJson
    FROM prediction_archive
  `);

  selectLatestOddsByIdStmt = db.prepare(`
    SELECT
      odds_home AS home,
      odds_draw AS draw,
      odds_away AS away,
      snapshot_at AS snapshotAt
    FROM match_history
    WHERE match_id = ?
      AND odds_home IS NOT NULL
      AND odds_draw IS NOT NULL
      AND odds_away IS NOT NULL
    ORDER BY datetime(snapshot_at) DESC
    LIMIT 1
  `);

  predictionArchiveCache.clear();
  const archivedRows = selectPredictionArchiveAllStmt.all();
  for (const row of archivedRows) {
    try {
      const parsed = JSON.parse(row.analysisJson || "{}");
      predictionArchiveCache.set(row.matchId, {
        matchId: row.matchId,
        lockedAt: row.lockedAt || null,
        statusAtLock: row.statusAtLock || "",
        lockReason: row.lockReason || "",
        analysis: parsed,
      });
    } catch {
      // ignore broken archive rows
    }
  }
}

function toHistoryRow(match, snapshotAt, updatedAt) {
  return {
    match_id: normText(match.id),
    source_id: normText(match.sourceId),
    source_method: normText(match.sourceMethod),
    league_code: normText(match.leagueCode),
    league: normText(match.league, "未分类联赛"),
    competition: normText(match.competition, "足球赛事"),
    match_num_str: normText(match.matchNumStr),
    round_text: normText(match.round),
    match_time: normText(match.datetime),
    status: normText(match.status),
    status_code: normText(match.statusCode),
    status_name: normText(match.statusName),
    home_team_id: normText(match.home?.id),
    home_name: normText(match.home?.name, "主队"),
    home_short: normText(match.home?.short, "主队"),
    away_team_id: normText(match.away?.id),
    away_name: normText(match.away?.name, "客队"),
    away_short: normText(match.away?.short, "客队"),
    venue: normText(match.venue),
    city: normText(match.city),
    odds_home: toDbNum(match.odds?.oneXTwo?.home),
    odds_draw: toDbNum(match.odds?.oneXTwo?.draw),
    odds_away: toDbNum(match.odds?.oneXTwo?.away),
    score_home: toDbNum(match.score?.fullTime?.home),
    score_away: toDbNum(match.score?.fullTime?.away),
    fingerprint: matchFingerprint(match),
    snapshot_at: snapshotAt,
    updated_at: updatedAt,
  };
}

function persistMatchesToDatabase(matches) {
  if (!db || !Array.isArray(matches) || !matches.length) return;
  const snapshotAt = new Date().toISOString();
  const updatedAt = cache.updatedAt || snapshotAt;
  const tx = db.transaction((rows) => {
    for (const match of rows) {
      const row = toHistoryRow(match, snapshotAt, updatedAt);
      const prev = selectLatestFingerprintStmt.get(row.match_id);
      upsertLatestStmt.run(row);
      if (!prev || prev.fingerprint !== row.fingerprint) {
        insertHistoryStmt.run(row);
      }
    }
    insertSnapshotStmt.run({
      snapshot_at: snapshotAt,
      source: cache.source || "unknown",
      updated_at: updatedAt,
      refresh_count: cache.refreshCount || 0,
      match_count: rows.length,
      last_error: cache.lastError || "",
    });
  });
  tx(matches);
}

function mapDbSearchRow(row) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    source: "sporttery-webapi",
    sourceMethod: row.sourceMethod || "",
    leagueCode: row.leagueCode || "",
    league: row.league || "未分类联赛",
    competition: row.competition || "足球赛事",
    matchNumStr: row.matchNumStr || "",
    round: row.round || "",
    datetime: row.datetime,
    venue: row.venue || "官方暂未提供",
    city: row.city || "",
    status: row.status || "WAIT",
    statusCode: row.statusCode || "",
    statusName: row.statusName || "",
    home: {
      id: row.homeTeamId || "",
      name: row.homeName || "主队",
      short: row.homeShort || "主队",
      color: "#2B68FF",
      rank: null,
    },
    away: {
      id: row.awayTeamId || "",
      name: row.awayName || "客队",
      short: row.awayShort || "客队",
      color: "#F93A4A",
      rank: null,
    },
    odds: {
      oneXTwo: sanitizeOdds({ home: row.oddsHome, draw: row.oddsDraw, away: row.oddsAway }),
    },
    score: {
      fullTime: {
        home: toDbNum(row.scoreHome),
        away: toDbNum(row.scoreAway),
      },
    },
    snapshotAt: row.snapshotAt,
    updatedAt: row.updatedAt,
  };
}

function searchHistoryInDatabase({ q, league, status, dateFrom, dateTo, page, pageSize }) {
  if (!db) {
    return { total: 0, rows: [], page, pageSize, totalPages: 0 };
  }
  const params = {
    q: normText(q),
    league: normText(league),
    status: normText(status),
    date_from: normalizeIsoDate(dateFrom) || "",
    date_to: normalizeIsoDate(dateTo) || "",
    limit: Math.max(1, Math.min(200, Number(pageSize) || 50)),
    offset: Math.max(0, ((Number(page) || 1) - 1) * Math.max(1, Math.min(200, Number(pageSize) || 50))),
  };
  const total = searchHistoryCountStmt.get(params)?.total || 0;
  const rows = searchHistoryRowsStmt.all(params).map(mapDbSearchRow);
  const totalPages = total > 0 ? Math.ceil(total / params.limit) : 0;
  return { total, rows, page: Number(page) || 1, pageSize: params.limit, totalPages };
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(SNAPSHOT_HISTORY_DIR)) fs.mkdirSync(SNAPSHOT_HISTORY_DIR, { recursive: true });
}

function computeNextRefreshAt(baseTime = Date.now()) {
  return new Date(baseTime + REFRESH_MINUTES * 60 * 1000).toISOString();
}

function loadCache() {
  ensureCacheDir();
  const file = fs.existsSync(CACHE_FILE) ? CACHE_FILE : fs.existsSync(SEED_CACHE_FILE) ? SEED_CACHE_FILE : "";
  if (!file) return;
  try {
    const raw = fs.readFileSync(file, "utf8");
    let parsed = JSON.parse(raw);
    if (
      parsed?.source &&
      String(parsed.source).startsWith("fallback-mock") &&
      fs.existsSync(SEED_CACHE_FILE)
    ) {
      parsed = JSON.parse(fs.readFileSync(SEED_CACHE_FILE, "utf8"));
    }
    if (!parsed || typeof parsed !== "object") return;
    cache.updatedAt = parsed.updatedAt || null;
    cache.source = parsed.source || cache.source;
    cache.matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    cache.analysisById = parsed.analysisById && typeof parsed.analysisById === "object" ? parsed.analysisById : {};
    cache.news = Array.isArray(parsed.news) ? parsed.news : [];
    cache.lastError = parsed.lastError || null;
    cache.lastAttemptAt = parsed.lastAttemptAt || null;
    cache.lastSuccessAt = parsed.lastSuccessAt || null;
    cache.nextRefreshAt = parsed.nextRefreshAt || (parsed.updatedAt ? computeNextRefreshAt(new Date(parsed.updatedAt).getTime()) : null);
    cache.refreshCount = Number.isFinite(Number(parsed.refreshCount)) ? Number(parsed.refreshCount) : 0;
    cache.lastDurationMs = Number.isFinite(Number(parsed.lastDurationMs)) ? Number(parsed.lastDurationMs) : null;
    cache.lastSnapshotFile = parsed.lastSnapshotFile || null;
  } catch (error) {
    cache.lastError = `load cache failed: ${String(error.message || error)}`;
  }
}

function snapshotPayload() {
  return {
    updatedAt: cache.updatedAt,
    source: cache.source,
    matches: cache.matches,
    analysisById: cache.analysisById,
    news: cache.news,
    lastError: cache.lastError,
    lastAttemptAt: cache.lastAttemptAt,
    lastSuccessAt: cache.lastSuccessAt,
    nextRefreshAt: cache.nextRefreshAt,
    refreshCount: cache.refreshCount,
    lastDurationMs: cache.lastDurationMs,
    lastSnapshotFile: cache.lastSnapshotFile,
  };
}

function cloudSnapshotEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function loadCloudSnapshot() {
  if (!cloudSnapshotEnabled()) return null;
  const table = encodeURIComponent(CLOUD_SNAPSHOT_TABLE);
  const id = encodeURIComponent(CLOUD_SNAPSHOT_ID);
  const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=payload&limit=1`;
  const response = await fetch(url, { headers: supabaseHeaders({ Accept: "application/json" }) });
  if (!response.ok) throw new Error(`supabase_load_http_${response.status}`);
  const rows = await response.json();
  return rows?.[0]?.payload || null;
}

async function saveCloudSnapshot() {
  if (!cloudSnapshotEnabled() || !Array.isArray(cache.matches) || !cache.matches.length) return;
  const table = encodeURIComponent(CLOUD_SNAPSHOT_TABLE);
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`;
  const response = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders({ Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({
      id: CLOUD_SNAPSHOT_ID,
      payload: snapshotPayload(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`supabase_save_http_${response.status}`);
}

function importSnapshotPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_snapshot_payload");
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  if (!matches.length) throw new Error("snapshot_matches_required");

  cache.source = normText(payload.source, "external-sync");
  cache.updatedAt = payload.updatedAt || new Date().toISOString();
  cache.matches = matches;
  cache.analysisById =
    payload.analysisById && typeof payload.analysisById === "object" ? payload.analysisById : {};
  cache.news = Array.isArray(payload.news) ? payload.news : [];
  cache.lastError = null;
  cache.lastSuccessAt = cache.updatedAt;
  cache.nextRefreshAt = computeNextRefreshAt();
  cache.refreshCount += 1;
  persistMatchesToDatabase(cache.matches);
  saveCache();
  writeHistorySnapshot();
}

function saveCache() {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshotPayload(), null, 2), "utf8");
}

function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return localDateKey(new Date());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function aiPredictionCacheKey(matchId, dateKey = localDateKey()) {
  return `${dateKey}:${String(matchId || "")}`;
}

function loadAiPredictionCache() {
  ensureCacheDir();
  aiPredictionCache.clear();
  if (!fs.existsSync(AI_PREDICTION_CACHE_FILE)) return;
  try {
    const raw = fs.readFileSync(AI_PREDICTION_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    Object.entries(parsed).forEach(([key, value]) => {
      if (value && typeof value === "object") aiPredictionCache.set(key, value);
    });
  } catch (error) {
    cache.lastError = `load ai prediction cache failed: ${String(error.message || error)}`;
  }
}

function saveAiPredictionCache() {
  ensureCacheDir();
  const today = localDateKey();
  const payload = {};
  for (const [key, value] of aiPredictionCache.entries()) {
    const dateKey = String(key).split(":")[0];
    if (dateKey === today || value?.pinned) payload[key] = value;
  }
  fs.writeFileSync(AI_PREDICTION_CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function writeHistorySnapshot() {
  ensureCacheDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `snapshot-${stamp}.json`;
  const filePath = path.join(SNAPSHOT_HISTORY_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(snapshotPayload(), null, 2), "utf8");
  cache.lastSnapshotFile = path.relative(__dirname, filePath).replace(/\\/g, "/");

  const historyFiles = fs
    .readdirSync(SNAPSHOT_HISTORY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const overflow = historyFiles.length - MAX_SNAPSHOT_HISTORY;
  if (overflow > 0) {
    historyFiles.slice(0, overflow).forEach((name) => {
      fs.unlinkSync(path.join(SNAPSHOT_HISTORY_DIR, name));
    });
  }
}

function schedulerStatus() {
  return {
    refreshing: cache.refreshing,
    refreshMinutes: REFRESH_MINUTES,
    liveRefreshSeconds: LIVE_REFRESH_SECONDS,
    updatedAt: cache.updatedAt,
    lastAttemptAt: cache.lastAttemptAt,
    lastSuccessAt: cache.lastSuccessAt,
    nextRefreshAt: cache.nextRefreshAt,
    refreshCount: cache.refreshCount,
    lastDurationMs: cache.lastDurationMs,
    lastSnapshotFile: cache.lastSnapshotFile,
    matchCount: cache.matches.length,
    analysisCount: Object.keys(cache.analysisById).length,
    archivedPredictionCount: predictionArchiveCache.size,
    lastError: cache.lastError,
  };
}

function providerEnabled(providerId) {
  const provider = AI_PROVIDERS.find((x) => x.id === providerId);
  if (!provider) return false;
  return Boolean(process.env[provider.envKey]);
}

function calcApiCostUsd(model, inputTokens, outputTokens, cachedInputTokens = 0) {
  const inputCost = (inputTokens / 1_000_000) * model.inputUsdPerMTok;
  const outputCost = (outputTokens / 1_000_000) * model.outputUsdPerMTok;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * (model.cachedInputUsdPerMTok || 0);
  return inputCost + outputCost + cachedInputCost;
}

function retailPriceCny(apiCostUsd, markup, minCny) {
  const gross = apiCostUsd * FX_USD_CNY * markup;
  const final = Math.max(minCny || 0, gross);
  return Number(final.toFixed(2));
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return fallback;
  return Math.floor(n);
}

function buildScenarioEstimates(model) {
  return AI_PRICING_SCENARIOS.map((scenario) => {
    const apiCostUsd = calcApiCostUsd(model, scenario.inputTokens, scenario.outputTokens, 0) * scenario.calls;
    const suggestedPriceCny = retailPriceCny(apiCostUsd, scenario.markup, scenario.minCny);
    return {
      id: scenario.id,
      name: scenario.name,
      inputTokens: scenario.inputTokens,
      outputTokens: scenario.outputTokens,
      calls: scenario.calls,
      markup: scenario.markup,
      minCny: scenario.minCny,
      apiCostUsd: Number(apiCostUsd.toFixed(6)),
      suggestedPriceCny,
      grossMarginEstimate:
        suggestedPriceCny > 0
          ? Number((((suggestedPriceCny - apiCostUsd * FX_USD_CNY) / suggestedPriceCny) * 100).toFixed(1))
          : 0,
    };
  });
}

function aiCatalogPayload() {
  return {
    updatedAt: new Date().toISOString(),
    fxUsdCny: FX_USD_CNY,
    pricingSources: AI_PRICING_SOURCES,
    providers: AI_PROVIDERS.map((provider) => ({
      ...provider,
      enabled: providerEnabled(provider.id),
      envConfigured: providerEnabled(provider.id),
    })),
    models: AI_MODELS.map((model) => ({
      ...model,
      enabled: providerEnabled(model.provider),
      scenarioEstimates: buildScenarioEstimates(model),
    })),
    promptTemplates: AI_PROMPT_TEMPLATES,
    pricingScenarios: AI_PRICING_SCENARIOS,
  };
}

function compactAnalysisForPrompt(match, analysis) {
  return {
    match: {
      id: match?.id || "",
      league: match?.league || "",
      competition: match?.competition || "",
      time: match?.datetime || "",
      venue: match?.venue || "",
      status: match?.status || "",
      stage: match?.round || match?.matchNumStr || "",
      home: match?.home || {},
      away: match?.away || {},
      odds: match?.odds || {},
      score: match?.score || {},
    },
    fundamentals: analysis?.fundamentals || {},
    context: analysis?.context || {},
    market: analysis?.market || {},
    prediction: analysis?.prediction || {},
    dataNotice:
      "如果排名、xG、伤停、天气、裁判、亚盘或大小球等字段缺失，必须写明“该项数据不足”，不要编造。",
  };
}

function buildMatchAiPredictionPrompt(match, analysis) {
  const data = compactAnalysisForPrompt(match, analysis);
  return `请你作为一名专业足球赛事分析师，基于多维度数据对【${match?.home?.name || "主队"}】vs【${match?.away?.name || "客队"}】进行赛前分析和预测。不要只根据排名或近期胜负判断，需要综合球队基本面、攻防数据、主客场表现、近期状态、伤停阵容、战术风格、赛程体能、战意、历史交锋、天气场地、裁判因素以及赔率盘口变化进行分析。

比赛信息：
- 比赛：${match?.home?.name || "主队"} vs ${match?.away?.name || "客队"}
- 联赛/赛事：${match?.league || match?.competition || "该项数据不足"}
- 比赛时间：${match?.datetime || "该项数据不足"}
- 比赛地点：${match?.venue || "该项数据不足"}
- 当前阶段：${match?.round || match?.matchNumStr || "该项数据不足"}

已知结构化数据如下，请只基于这些数据和明确可推导的信息分析；缺失项必须标注“该项数据不足”：
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

请按以下结构输出：
一、比赛基本面分析
二、近期状态分析
三、主客场表现分析
四、进攻能力分析
五、防守能力分析
六、伤停与首发阵容分析
七、战术风格与克制关系分析
八、赛程体能与战意分析
九、历史交锋分析
十、天气、场地与裁判因素
十一、赔率与盘口分析
十二、综合判断与预测结论

结论必须包含：
1. 胜平负倾向和信心等级。
2. 让球方向。如果缺少亚洲盘口，说明“亚洲盘口数据不足”，只能给数据倾向。
3. 大小球方向。如果缺少大小球盘口，说明“大小球盘口数据不足”，只能基于进球模型判断。
4. 2-3 个参考比分。
5. 风险点。
6. 最终建议，分为“稳妥方向”和“激进方向”。

输出要求：逻辑清晰，每个判断说明依据；不要绝对化；不要提供投注入口或保证收益表述。`;
}

function fallbackAiPredictionText(match, analysis) {
  const probs = analysis?.prediction?.probabilities || {};
  const homeP = Math.round(Number(probs.home || 0) * 100);
  const drawP = Math.round(Number(probs.draw || 0) * 100);
  const awayP = Math.round(Number(probs.away || 0) * 100);
  const scores = (analysis?.prediction?.scoreMatrix || [])
    .slice(0, 3)
    .map((x) => x.score)
    .join("、");
  const standing = analysis?.fundamentals?.history?.standing || {};
  const ad = analysis?.fundamentals?.attackDefense || {};
  const h2h = analysis?.context?.h2h?.note || "该项数据不足";
  const odds = analysis?.market?.odds?.oneXTwo || {};
  const oddsText =
    hasValidOdds(odds) && odds.home && odds.draw && odds.away
      ? `当前 1X2 为主胜 ${odds.home}、平局 ${odds.draw}、客胜 ${odds.away}。`
      : "当前 1X2 赔率数据不足。";

  return `一、比赛基本面分析
主队近况积分/净胜球参考：${standing.home?.points ?? "该项数据不足"} / ${standing.home?.goalDiff ?? "该项数据不足"}；客队参考：${standing.away?.points ?? "该项数据不足"} / ${standing.away?.goalDiff ?? "该项数据不足"}。当前数据更适合做趋势判断，不宜只按排名下结论。

二、近期状态分析
主队近况：${standing.home?.record ?? "该项数据不足"}；客队近况：${standing.away?.record ?? "该项数据不足"}。如果只看胜平负，样本仍偏薄，需要结合对手强弱、射门质量和临场阵容再确认。

三、主客场表现分析
该项数据不足。现有接口未稳定提供主客场拆分胜率、主场/客场进失球和抗压指标。

四、进攻能力分析
xG 参考为主队 ${ad.xg?.home ?? "该项数据不足"}、客队 ${ad.xg?.away ?? "该项数据不足"}；射门参考为主队 ${ad.shots?.home ?? "该项数据不足"}、客队 ${ad.shots?.away ?? "该项数据不足"}。从模型输入看，${homeP >= awayP ? "主队" : "客队"}创造机会倾向略高。

五、防守能力分析
xGA 参考为主队 ${ad.xga?.home ?? "该项数据不足"}、客队 ${ad.xga?.away ?? "该项数据不足"}。门将状态、防守失误和定位球防守细节目前数据不足。

六、伤停与首发阵容分析
伤停和预测首发以官方赛前数据为准；若详情页未展示具体名单，则该项数据不足，不能假设核心球员一定出场。

七、战术风格与克制关系分析
${analysis?.context?.tactical?.matchup || "该项数据不足"} ${analysis?.context?.tactical?.conflictAnalysis || ""}

八、赛程体能与战意分析
体能指数参考：主队 ${analysis?.context?.environment?.fatigue?.home ?? "该项数据不足"}、客队 ${analysis?.context?.environment?.fatigue?.away ?? "该项数据不足"}。争冠、保级、杯赛轮换等战意信息目前需要赛前新闻补充。

九、历史交锋分析
${h2h} 历史交锋会受教练、阵容和赛季阶段变化影响，参考权重不宜过高。

十、天气、场地与裁判因素
天气：${analysis?.context?.environment?.weather || "该项数据不足"}。裁判出牌、点球倾向和场地质量数据不足。

十一、赔率与盘口分析
${oddsText} 亚洲盘口和大小球盘口数据不足，不能直接给盘口强结论；只能结合概率和进球模型做方向性判断。

十二、综合判断与预测结论
胜平负倾向：${homeP >= drawP && homeP >= awayP ? "主胜" : awayP >= homeP && awayP >= drawP ? "客胜" : "平局"}，信心等级：${analysis?.prediction?.conclusion?.confidence || "medium"}。
让球方向：盘口数据不足，倾向参考 ${homeP >= awayP ? "主队方向" : "客队方向"}。
大小球方向：基于进球模型倾向 ${Number((analysis?.prediction?.poissonLambda?.home || 0) + (analysis?.prediction?.poissonLambda?.away || 0)) >= 2.5 ? "大球" : "小球"}，但盘口数据不足。
比分参考：${scores || analysis?.prediction?.conclusion?.predictedScore || "该项数据不足"}。
风险点：临场首发变化、伤停更新、赔率临场波动、红牌点球等高随机事件。
稳妥方向：优先参考胜平负概率中优势更明显的一侧，同时等待首发确认。
激进方向：参考比分和大小球模型，但不夸大确定性。`;
}

function chooseDefaultAiModel(modelId = "") {
  const requested = modelId ? AI_MODELS.find((x) => x.id === modelId && providerEnabled(x.provider)) : null;
  if (requested) return requested;
  return AI_MODELS.find((x) => providerEnabled(x.provider)) || null;
}

async function buildOrGetDailyAiPrediction(match, analysis, modelId = "") {
  const dateKey = localDateKey();
  const key = aiPredictionCacheKey(match?.id, dateKey);
  const cached = aiPredictionCache.get(key);
  if (cached?.text) return { ...cached, cached: true };

  const model = chooseDefaultAiModel(modelId);
  const systemPrompt =
    "你是专业足球赛事赛前分析师。你必须用中文、结构化、客观输出；数据缺失时明确写“该项数据不足”，不得编造事实；不得承诺收益或提供投注入口。";
  const prompt = buildMatchAiPredictionPrompt(match, analysis);

  let entry;
  if (model) {
    try {
      const result = await callAiProvider(model, { prompt, systemPrompt, maxTokens: 3600, temperature: 0.25 });
      entry = {
        matchId: match.id,
        dateKey,
        generatedAt: new Date().toISOString(),
        providerConfigured: true,
        provider: model.provider,
        modelId: model.id,
        modelName: model.name,
        prompt,
        text: result.text || fallbackAiPredictionText(match, analysis),
        usage: result.raw?.usage || null,
      };
    } catch (error) {
      entry = {
        matchId: match.id,
        dateKey,
        generatedAt: new Date().toISOString(),
        providerConfigured: false,
        provider: "local-fallback",
        modelId: model.id,
        modelName: `${model.name} 调用失败，已使用本地结构化降级分析`,
        prompt,
        text: fallbackAiPredictionText(match, analysis),
        usage: null,
        error: String(error.message || error),
      };
    }
  } else {
    entry = {
      matchId: match.id,
      dateKey,
      generatedAt: new Date().toISOString(),
      providerConfigured: false,
      provider: "local-fallback",
      modelId: "",
      modelName: "本地结构化降级分析",
      prompt,
      text: fallbackAiPredictionText(match, analysis),
      usage: null,
    };
  }

  aiPredictionCache.set(key, entry);
  saveAiPredictionCache();
  return { ...entry, cached: false };
}

function parseJsonBody(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // ignore
  }
  return {};
}

function toStatusBucket(matchStatusCode) {
  const code = String(matchStatusCode || "");
  if (["2", "3"].includes(code)) return "SELL";
  if (["4", "5", "6", "7", "8", "9"].includes(code)) return "LIVE";
  if (["10", "11", "12", "13"].includes(code)) return "RESULT";
  return "WAIT";
}

function parseDateTime(dateStr, timeStr) {
  const date = normText(dateStr);
  const time = normText(timeStr);
  if (!date) return new Date().toISOString();
  if (!time) return `${date}T00:00:00+08:00`;
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : "00:00:00";
  return `${date}T${hhmm}+08:00`;
}

function formatDateOffset(offsetDays = 0) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const sg = new Date(utcMs + 8 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return sg.toISOString().slice(0, 10);
}

function toShortName(name) {
  if (!name) return "---";
  if (name.length <= 3) return name.toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

function zhLeagueName(name, fallback = "足球赛事") {
  const raw = normText(name, fallback);
  return LEAGUE_NAME_ZH.get(raw.toLowerCase()) || raw;
}

function isTargetCompetition(match) {
  if (!match) return false;
  const code = normText(match.leagueCode);
  const league = normText(match.league);
  const competition = normText(match.competition);
  return (
    TARGET_LEAGUE_CODES.has(code) ||
    TARGET_LEAGUE_NAMES.has(league) ||
    TARGET_LEAGUE_NAMES.has(competition)
  );
}

function filterTargetCompetitions(matches) {
  return (Array.isArray(matches) ? matches : []).filter(isTargetCompetition);
}

function toNum(v, fallback = 0) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function impliedProbs(odds) {
  const invH = odds.home > 1.01 ? 1 / odds.home : 0;
  const invD = odds.draw > 1.01 ? 1 / odds.draw : 0;
  const invA = odds.away > 1.01 ? 1 / odds.away : 0;
  const total = invH + invD + invA || 1;
  return {
    home: invH / total,
    draw: invD / total,
    away: invA / total,
  };
}

function sanitizeOdds(rawOdds) {
  const home = toNum(rawOdds?.home, 0);
  const draw = toNum(rawOdds?.draw, 0);
  const away = toNum(rawOdds?.away, 0);
  if (home > 1.01 && draw > 1.01 && away > 1.01) {
    return { home, draw, away };
  }
  return { home: null, draw: null, away: null };
}

function hasValidOdds(odds) {
  return Boolean(odds && odds.home > 1.01 && odds.draw > 1.01 && odds.away > 1.01);
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function isPreMatchStatus(status) {
  return status === "WAIT" || status === "SELL";
}

function getPredictionArchive(matchId) {
  return predictionArchiveCache.get(String(matchId || "")) || null;
}

function mergeLockedForecastIntoAnalysis(analysis, archiveEntry) {
  const out = cloneJson(analysis, {}) || {};
  const locked = cloneJson(archiveEntry?.analysis, null);
  if (!locked) return out;

  if (!out.market) out.market = {};
  if (locked.market?.odds) out.market.odds = cloneJson(locked.market.odds, out.market.odds || {});

  if (locked.market?.psychology) {
    if (!out.market.psychology) out.market.psychology = {};
    if (locked.market.psychology.analysisText) {
      out.market.psychology.analysisText = locked.market.psychology.analysisText;
    }
    if (locked.market.psychology.motivation) {
      out.market.psychology.motivation = cloneJson(locked.market.psychology.motivation, out.market.psychology.motivation || {});
    }
    if (locked.market.psychology.publicSentiment) {
      out.market.psychology.publicSentiment = cloneJson(
        locked.market.psychology.publicSentiment,
        out.market.psychology.publicSentiment || {}
      );
    }
  }

  if (locked.prediction) out.prediction = cloneJson(locked.prediction, out.prediction || {});
  out.predictionArchive = {
    locked: true,
    lockedAt: archiveEntry?.lockedAt || null,
    statusAtLock: archiveEntry?.statusAtLock || "",
    lockReason: archiveEntry?.lockReason || "",
  };
  return out;
}

function buildArchiveCandidateAnalysis(match, currentAnalysis, previousAnalysis) {
  const prev = cloneJson(previousAnalysis, null);
  if (prev && hasValidOdds(prev?.market?.odds?.oneXTwo)) {
    return prev;
  }

  const current = cloneJson(currentAnalysis, null);
  if (current && hasValidOdds(current?.market?.odds?.oneXTwo)) {
    return current;
  }

  const row = selectLatestOddsByIdStmt ? selectLatestOddsByIdStmt.get(String(match?.id || "")) : null;
  if (row && hasValidOdds({ home: row.home, draw: row.draw, away: row.away })) {
    const m = cloneJson(match, {}) || {};
    if (!m.odds) m.odds = {};
    m.odds.oneXTwo = {
      home: Number(row.home),
      draw: Number(row.draw),
      away: Number(row.away),
    };
    if (!m.status || !isPreMatchStatus(m.status)) {
      m.status = "SELL";
      m.statusCode = m.statusCode || "2";
      m.statusName = m.statusName || "已开售";
    }
    const rebuilt = buildAnalysisFromSporttery(m, {});
    return enrichAnalysisForMatch(m, rebuilt);
  }

  return prev || current || null;
}

function tryLockPredictionArchive(match, currentAnalysis, previousAnalysis, previousMatch = null) {
  const matchId = String(match?.id || "");
  if (!matchId || isPreMatchStatus(match?.status)) return null;

  const existing = getPredictionArchive(matchId);
  if (existing) return existing;
  if (!insertPredictionArchiveStmt) return null;

  const candidate = buildArchiveCandidateAnalysis(match, currentAnalysis, previousAnalysis);
  if (!candidate) return null;

  const now = new Date().toISOString();
  const lockReason = previousMatch && isPreMatchStatus(previousMatch.status) ? "kickoff_transition" : "post_kickoff_backfill";
  const payload = {
    match_id: matchId,
    locked_at: now,
    status_at_lock: normText(match?.status),
    lock_reason: lockReason,
    analysis_json: JSON.stringify(candidate),
    updated_at: now,
  };
  const info = insertPredictionArchiveStmt.run(payload);

  if (info?.changes > 0) {
    const archived = {
      matchId,
      lockedAt: now,
      statusAtLock: payload.status_at_lock,
      lockReason,
      analysis: candidate,
    };
    predictionArchiveCache.set(matchId, archived);
    return archived;
  }

  if (selectPredictionArchiveByIdStmt) {
    const row = selectPredictionArchiveByIdStmt.get(matchId);
    if (row) {
      try {
        const parsed = JSON.parse(row.analysisJson || "{}");
        const archived = {
          matchId,
          lockedAt: row.lockedAt || null,
          statusAtLock: row.statusAtLock || "",
          lockReason: row.lockReason || "",
          analysis: parsed,
        };
        predictionArchiveCache.set(matchId, archived);
        return archived;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function poisson(lambda, k) {
  let fact = 1;
  for (let i = 2; i <= k; i += 1) fact *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact;
}

function scoreMatrix(homeLambda, awayLambda, maxGoals = 4) {
  const rows = [];
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      rows.push({
        score: `${h}-${a}`,
        probability: poisson(homeLambda, h) * poisson(awayLambda, a),
      });
    }
  }
  rows.sort((x, y) => y.probability - x.probability);
  return rows.slice(0, 8);
}

function verdict(edge) {
  if (edge > 0.035) return "value";
  if (edge > 0.015) return "slight-value";
  return "no-value";
}

function buildCommentary(match, p) {
  if (!p) {
    return `当前场次暂无官方完整赔率，建议以中国竞彩网临场开售数据为准。`;
  }
  const side = p.home >= p.away ? match.home.name : match.away.name;
  const gap = Math.abs(p.home - p.away);
  const strength = gap > 0.12 ? "优势较为明显" : gap > 0.06 ? "略占上风" : "双方接近";
  return `${side}在赔率隐含概率上${strength}。结合近期开售指数变化，建议关注临场盘口与首发名单再做最终判断。`;
}

function buildAnalysisFromSporttery(match, detail) {
  const odds = sanitizeOdds(match.odds?.oneXTwo);
  const validOdds = hasValidOdds(odds);
  const p = validOdds ? impliedProbs(odds) : { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  const homeLambda = Math.max(0.65, Math.min(2.3, 1.0 + p.home * 1.7));
  const awayLambda = Math.max(0.55, Math.min(2.2, 1.0 + p.away * 1.6));
  const matrix = scoreMatrix(homeLambda, awayLambda);
  const top = matrix[0] || { score: "1-1", probability: 0.12 };

  const homeScore = Math.round(45 + p.home * 55);
  const drawScore = Math.round(35 + p.draw * 50);
  const awayScore = Math.round(45 + p.away * 55);

  const homeEdge = validOdds ? p.home - 1 / odds.home : 0;
  const drawEdge = validOdds ? p.draw - 1 / odds.draw : 0;
  const awayEdge = validOdds ? p.away - 1 / odds.away : 0;

  const resultList = Array.isArray(detail?.matchResultList) ? detail.matchResultList : [];
  const oddsTrend = validOdds
    ? [
        {
          time: "初始",
          home: Number((odds.home * 1.04).toFixed(2)),
          draw: Number((odds.draw * 0.98).toFixed(2)),
          away: Number((odds.away * 0.97).toFixed(2)),
        },
        { time: "当前", home: odds.home, draw: odds.draw, away: odds.away },
      ]
    : [];

  const matchStatusText = match.matchStatusName || match.statusName || "未开赛";
  const tacticalHome = `${match.home.short} 更倾向中前场持续压迫，争取在转换阶段形成局部人数优势。`;
  const tacticalAway = `${match.away.short} 以稳守反击为主，依赖边路推进和快速直塞寻找机会。`;
  const conflict = `风格冲突点：${match.home.short}控球推进 vs ${match.away.short}回撤反击，比赛节奏可能呈现“主导+突击”结构。`;

  return {
    generatedAt: new Date().toISOString(),
    fundamentals: {
      history: {
        recentForm: {
          home: ["-", "-", "-", "-", "-"],
          away: ["-", "-", "-", "-", "-"],
        },
        standing: {
          home: { rank: "-", points: "-", goalDiff: "-" },
          away: { rank: "-", points: "-", goalDiff: "-" },
        },
      },
      attackDefense: {
        xg: { home: Number(homeLambda.toFixed(2)), away: Number(awayLambda.toFixed(2)) },
        xga: { home: Number((1.4 - p.home * 0.6).toFixed(2)), away: Number((1.4 - p.away * 0.6).toFixed(2)) },
        shots: { home: Number((8 + p.home * 10).toFixed(1)), away: Number((8 + p.away * 10).toFixed(1)) },
        onTarget: { home: Number((2.8 + p.home * 3).toFixed(1)), away: Number((2.8 + p.away * 3).toFixed(1)) },
        possession: { home: Math.round(45 + p.home * 20), away: Math.round(45 + p.away * 20) },
        passAccuracy: { home: Math.round(78 + p.home * 12), away: Math.round(78 + p.away * 12) },
      },
      squad: {
        injuries: {
          home: [],
          away: [],
        },
        lineup: { home: "首发未公布", away: "首发未公布" },
      },
    },
    context: {
      tactical: {
        matchup: `${match.home.short} vs ${match.away.short} 战术博弈`,
        keyDuel: `${match.home.short}边路推进 vs ${match.away.short}边后卫回防`,
        styleConflictIndex: Math.round(50 + Math.abs(homeScore - awayScore) * 0.6),
        styleHomeText: tacticalHome,
        styleAwayText: tacticalAway,
        conflictAnalysis: conflict,
        keyDuels: [`${match.home.short}中前场压迫链条`, `${match.away.short}反击第一传质量`],
      },
      environment: {
        weather: "待接入天气源",
        fatigue: { home: Math.round(28 + p.away * 20), away: Math.round(28 + p.home * 20) },
      },
      h2h: {
        last5: { homeWin: 2, draw: 1, awayWin: 2 },
        note: `${matchStatusText}；历史交锋可在后续版本接入官方数据库补全。`,
      },
    },
    market: {
      psychology: {
        motivation: { home: homeScore, away: awayScore },
        publicSentiment: { home: Math.round(p.home * 100), away: Math.round(p.away * 100) },
        mediaHeat: Math.round(55 + Math.max(homeScore, awayScore) * 0.3),
        analysisText: buildCommentary(match, validOdds ? p : null),
      },
      odds: {
        oneXTwo: odds,
        trend: oddsTrend,
        detailCount: resultList.length,
      },
    },
    prediction: {
      factors: [
        { name: "赔率强度", home: homeScore, away: awayScore, weight: 0.28, direction: homeScore >= awayScore ? "home" : "away" },
        { name: "平局张力", home: drawScore, away: drawScore, weight: 0.16, direction: "neutral" },
        { name: "攻守平衡", home: Math.round(homeLambda * 38), away: Math.round(awayLambda * 38), weight: 0.24, direction: homeLambda >= awayLambda ? "home" : "away" },
        { name: "临场状态", home: Math.round(60 + p.home * 20), away: Math.round(60 + p.away * 20), weight: 0.18, direction: homeScore >= awayScore ? "home" : "away" },
        { name: "市场波动", home: Math.round(55 + homeEdge * 200), away: Math.round(55 + awayEdge * 200), weight: 0.14, direction: homeEdge >= awayEdge ? "home" : "away" },
      ],
      probabilities: {
        home: Number(p.home.toFixed(3)),
        draw: Number(p.draw.toFixed(3)),
        away: Number(p.away.toFixed(3)),
      },
      poissonLambda: { home: Number(homeLambda.toFixed(2)), away: Number(awayLambda.toFixed(2)) },
      scoreMatrix: matrix.map((x) => ({ score: x.score, probability: Number(x.probability.toFixed(3)) })),
      kelly: [
        {
          market: "主胜",
          impliedProb: validOdds ? Number((1 / odds.home).toFixed(3)) : null,
          modelProb: Number(p.home.toFixed(3)),
          edge: Number(homeEdge.toFixed(3)),
          verdict: validOdds ? verdict(homeEdge) : "no-value",
        },
        {
          market: "平局",
          impliedProb: validOdds ? Number((1 / odds.draw).toFixed(3)) : null,
          modelProb: Number(p.draw.toFixed(3)),
          edge: Number(drawEdge.toFixed(3)),
          verdict: validOdds ? verdict(drawEdge) : "no-value",
        },
        {
          market: "客胜",
          impliedProb: validOdds ? Number((1 / odds.away).toFixed(3)) : null,
          modelProb: Number(p.away.toFixed(3)),
          edge: Number(awayEdge.toFixed(3)),
          verdict: validOdds ? verdict(awayEdge) : "no-value",
        },
      ],
      conclusion: {
        predictedScore: top.score,
        confidence: top.probability > 0.17 ? "high" : top.probability > 0.12 ? "medium" : "low",
      },
    },
  };
}

async function fetchSportteryJson(pathname, tab = "concern") {
  const url = `${SPORTTERY_BASE}${pathname}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Referer: `https://m.sporttery.cn/mjc/zqsj/?tab=${tab}`,
      Origin: "https://m.sporttery.cn",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`sporttery_http_${response.status}`);
  }
  const data = await response.json();
  if (!data || data.success !== true) {
    throw new Error(`sporttery_api_error_${data?.errorCode || "unknown"}`);
  }
  return data;
}

async function fetchFootballUniformJson(pathname) {
  const data = await fetchSportteryJson(pathname, "concern");
  return data?.value || {};
}

async function fetchAdvancedMatchPack(sportteryMatchId) {
  const sid = normText(sportteryMatchId);
  if (!sid) return null;
  const cached = advancedAnalysisCache.get(sid);
  if (cached && Date.now() - cached.ts < ADVANCED_CACHE_TTL_MS) {
    return cached.data;
  }

  const safe = async (path) => {
    try {
      return await fetchFootballUniformJson(path);
    } catch {
      return null;
    }
  };

  const encoded = encodeURIComponent(sid);
  const [head, tables, injury, players, matchResult, resultHistory, futureMatches] = await Promise.all([
    safe(`/gateway/uniform/football/getMatchHeadV1.qry?sportteryMatchId=${encoded}`),
    safe(`/gateway/uniform/football/getMatchTablesV1.qry?sportteryMatchId=${encoded}`),
    safe(`/gateway/uniform/football/getInjurySuspensionV1.qry?sportteryMatchId=${encoded}`),
    safe(`/gateway/uniform/football/getMatchPlayerV1.qry?sportteryMatchId=${encoded}&termLimits=3`),
    safe(`/gateway/uniform/football/getMatchResultV1.qry?sportteryMatchId=${encoded}&termLimits=10&tournamentFlag=0&homeAwayFlag=0`),
    safe(`/gateway/uniform/football/getResultHistoryV1.qry?sportteryMatchId=${encoded}&termLimits=5&tournamentFlag=0&homeAwayFlag=0`),
    safe(`/gateway/uniform/football/getFutureMatchesV1.qry?sportteryMatchId=${encoded}&termLimits=4`),
  ]);

  const data = { head, tables, injury, players, matchResult, resultHistory, futureMatches };
  advancedAnalysisCache.set(sid, { ts: Date.now(), data });
  return data;
}

function parseFullCourtGoal(goalText) {
  const text = normText(goalText);
  const m = text.match(/(\d+)\s*[:\-]\s*(\d+)/);
  if (!m) return { home: null, away: null };
  return { home: Number(m[1]), away: Number(m[2]) };
}

function parseTeamFormFromMatches(list, teamSportteryId, limit = 5) {
  const teamId = String(teamSportteryId || "");
  if (!teamId) return [];
  const rows = Array.isArray(list) ? list : [];
  const form = [];
  for (const row of rows) {
    if (form.length >= limit) break;
    const homeTeamId = String(row?.sportteryHomeTeamId || "");
    const awayTeamId = String(row?.sportteryAwayTeamId || "");
    const score = parseFullCourtGoal(row?.fullCourtGoal);
    if (!Number.isFinite(score.home) || !Number.isFinite(score.away)) continue;
    if (homeTeamId !== teamId && awayTeamId !== teamId) continue;
    let gf = score.home;
    let ga = score.away;
    if (awayTeamId === teamId) {
      gf = score.away;
      ga = score.home;
    }
    if (gf > ga) form.push("W");
    else if (gf < ga) form.push("L");
    else form.push("D");
  }
  return form;
}

function findTableBySportteryId(tables, sportteryTeamId) {
  const rows = Array.isArray(tables?.tables) ? tables.tables : [];
  const id = String(sportteryTeamId || "");
  return rows.find((row) => String(row?.sportteryTeamId || "") === id) || null;
}

function mapTableStanding(row) {
  if (!row) return { rank: "-", points: "-", goalDiff: "-" };
  const win = Number(row.winGoalMatchCnt || 0);
  const draw = Number(row.drawMatchCnt || 0);
  const total = Number(row.totalLegCnt || 0);
  const loss = Math.max(0, total - win - draw);
  return {
    rank: row.ranking ?? "-",
    points: row.points ?? "-",
    goalDiff: row.lossGoalMatchCnt ?? "-",
    record: `${win}-${draw}-${loss}`,
  };
}

function normalizeInjuryPlayer(item) {
  if (!item) return null;
  const injury = Number(item.injuryFlag || 0) === 1;
  const suspension = Number(item.suspensionFlag || 0) === 1;
  const status = suspension ? "停赛" : injury ? "伤病" : "可用";
  const reason = suspension ? "停赛" : injury ? "伤病" : "状态正常";
  return {
    player: normText(item.personName || item.playerName || "未知球员"),
    issue: `${reason}${item.playerPositionDesc ? `(${item.playerPositionDesc})` : ""}${item.uniformNo ? ` #${item.uniformNo}` : ""}`,
    status,
  };
}

function buildInjuryList(sideInjury, sidePlayers) {
  const listA = Array.isArray(sideInjury?.injuriesAndSuspensionsList) ? sideInjury.injuriesAndSuspensionsList : [];
  const listB = Array.isArray(sidePlayers?.playerList)
    ? sidePlayers.playerList.filter((p) => Number(p.injuryFlag || 0) === 1 || Number(p.suspensionFlag || 0) === 1)
    : [];
  const merged = [...listA, ...listB].map(normalizeInjuryPlayer).filter(Boolean);
  const seen = new Set();
  return merged.filter((x) => {
    const key = `${x.player}|${x.issue}|${x.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPredictedLineupText(sidePlayers) {
  const list = Array.isArray(sidePlayers?.playerList) ? sidePlayers.playerList : [];
  if (!list.length) return "首发未公布";
  const starters = [...list]
    .sort((a, b) => {
      const sa = Number(a.startedMatchCnt || 0);
      const sb = Number(b.startedMatchCnt || 0);
      if (sb !== sa) return sb - sa;
      const aa = Number(a.appearanceCnt || 0);
      const ab = Number(b.appearanceCnt || 0);
      return ab - aa;
    })
    .slice(0, 11)
    .map((p) => `${normText(p.personName, "球员")}${p.uniformNo ? `#${p.uniformNo}` : ""}`);
  return starters.join(" / ");
}

function applyAdvancedPackToAnalysis(match, analysis, pack) {
  if (!pack) return analysis;
  const out = JSON.parse(JSON.stringify(analysis || {}));
  if (!out.fundamentals) out.fundamentals = {};
  if (!out.fundamentals.history) out.fundamentals.history = {};
  if (!out.fundamentals.squad) out.fundamentals.squad = {};
  if (!out.context) out.context = {};
  if (!out.context.h2h) out.context.h2h = {};

  const homeSportteryId = match?.home?.id;
  const awaySportteryId = match?.away?.id;

  const homeForm = parseTeamFormFromMatches(pack?.matchResult?.home?.matchList, homeSportteryId, 5);
  const awayForm = parseTeamFormFromMatches(pack?.matchResult?.away?.matchList, awaySportteryId, 5);
  out.fundamentals.history.recentForm = {
    home: homeForm.length ? homeForm : out.fundamentals.history.recentForm?.home || ["-", "-", "-", "-", "-"],
    away: awayForm.length ? awayForm : out.fundamentals.history.recentForm?.away || ["-", "-", "-", "-", "-"],
  };

  const homeTable = findTableBySportteryId(pack?.tables, homeSportteryId);
  const awayTable = findTableBySportteryId(pack?.tables, awaySportteryId);
  out.fundamentals.history.standing = {
    home: { ...(out.fundamentals.history.standing?.home || {}), ...mapTableStanding(homeTable) },
    away: { ...(out.fundamentals.history.standing?.away || {}), ...mapTableStanding(awayTable) },
  };

  const homeInjury = buildInjuryList(pack?.injury?.home, pack?.players?.home);
  const awayInjury = buildInjuryList(pack?.injury?.away, pack?.players?.away);
  out.fundamentals.squad.injuries = {
    home: homeInjury.length ? homeInjury : out.fundamentals.squad.injuries?.home || [],
    away: awayInjury.length ? awayInjury : out.fundamentals.squad.injuries?.away || [],
  };
  out.fundamentals.squad.lineup = {
    home: buildPredictedLineupText(pack?.players?.home),
    away: buildPredictedLineupText(pack?.players?.away),
  };

  const h2hStats = pack?.resultHistory?.statistics || {};
  const h2hList = Array.isArray(pack?.resultHistory?.matchList) ? pack.resultHistory.matchList : [];
  out.context.h2h.last5 = {
    homeWin: Number(h2hStats.winGoalMatchCnt || 0),
    draw: Number(h2hStats.drawMatchCnt || 0),
    awayWin: Number(h2hStats.lossGoalMatchCnt || 0),
  };
  out.context.h2h.note = h2hList.length
    ? `历史交锋样本${h2hList.length}场：主队胜率${h2hStats.winProbability || "0%"}，平局${h2hStats.drawProbability || "0%"}。`
    : out.context.h2h.note || "暂无可用交锋样本。";
  return out;
}

async function fetchSportteryHtml(pathname) {
  const url = `https://m.sporttery.cn${pathname}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Referer: "https://m.sporttery.cn/",
      Origin: "https://m.sporttery.cn",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`sporttery_html_http_${response.status}`);
  }
  return response.text();
}

function toAbsoluteSportteryUrl(href) {
  if (!href) return "https://m.sporttery.cn/";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `https://m.sporttery.cn${href}`;
  return `https://m.sporttery.cn/${href}`;
}

async function fetchChineseNews() {
  try {
    const html = await fetchSportteryHtml("/htmlfrag/697.html");
    const regex = /<a href="([^"]+)">[\s\S]*?<p class="u-list-tit">([\s\S]*?)<\/p>[\s\S]*?<p class="u-list-date">([\s\S]*?)<\/p>/gi;
    const items = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      const href = toAbsoluteSportteryUrl(match[1]?.trim());
      const title = (match[2] || "").replace(/<[^>]+>/g, "").trim();
      const date = (match[3] || "").replace(/<[^>]+>/g, "").trim();
      if (!title) continue;
      items.push({ title, date, url: href });
      if (items.length >= 8) break;
    }
    return items;
  } catch {
    return [];
  }
}

function buildMatchListPath(method, pageNo = null, pageType = null) {
  const params = new URLSearchParams();
  params.set("method", method);
  params.set("pageSize", String(SPORTTERY_PAGE_SIZE));
  if (pageNo !== null && pageNo !== undefined) {
    params.set("pageNo", String(pageNo));
  }
  if (pageType !== null && pageType !== undefined) {
    params.set("pageType", String(pageType));
  }
  return `/gateway/uniform/fb/getMatchDataPageListV1.qry?${params.toString()}`;
}

function flattenMatchesFromPayload(payload, method) {
  const days = payload.value?.matchInfoList || [];
  const list = [];
  for (const day of days) {
    for (const m of day.subMatchList || []) {
      const sectionScore = scoreFromSections(m.sectionsNo999 || m.sectionsNo1);
      const scoreHome = toNum(m.homeScore, sectionScore.home);
      const scoreAway = toNum(m.awayScore, sectionScore.away);
      const id = `sporttery-${m.matchId}`;
      list.push({
        id,
        sourceId: String(m.matchId),
        source: "sporttery-webapi",
        sourceMethod: method,
        matchNumStr: m.matchNumStr || "",
        leagueCode: String(m.leagueId || ""),
        league: m.leagueAllName || m.leagueAbbName || "未知联赛",
        competition: m.leagueAllName || "足球赛事",
        round: m.matchNumStr || "",
        datetime: parseDateTime(m.matchDate, m.matchTime),
        venue: "官方未提供",
        city: "",
        status: toStatusBucket(m.matchStatus),
        statusCode: String(m.matchStatus || ""),
        statusName: m.matchStatusName || "",
        home: {
          id: String(m.homeTeamId || ""),
          name: m.homeTeamAllName || m.homeTeamAbbName || "主队",
          short: toShortName(m.homeTeamAbbName || m.homeTeamAllName || "主队"),
          color: "#2B68FF",
          rank: null,
        },
        away: {
          id: String(m.awayTeamId || ""),
          name: m.awayTeamAllName || m.awayTeamAbbName || "客队",
          short: toShortName(m.awayTeamAbbName || m.awayTeamAllName || "客队"),
          color: "#F93A4A",
          rank: null,
        },
        odds: { oneXTwo: sanitizeOdds({ home: m.h, draw: m.d, away: m.a }) },
        score: {
          fullTime: {
            home: scoreHome,
            away: scoreAway,
          },
        },
      });
    }
  }
  return list;
}

async function fetchMatchListByMethod(method) {
  const supportsHistoryPaging = method === "all" || method === "result";

  const firstPayload = await fetchSportteryJson(buildMatchListPath(method), method);
  const allPayloads = [firstPayload];

  if (supportsHistoryPaging) {
    for (let page = 1; page < SPORTTERY_PAGE_DEPTH; page += 1) {
      try {
        const payload = await fetchSportteryJson(buildMatchListPath(method, page, 0), method);
        const dayLen = payload?.value?.matchInfoList?.length || 0;
        if (!dayLen) break;
        allPayloads.push(payload);
        const hasMore = payload?.value?.prePage && String(payload.value.prePage) !== "0";
        if (!hasMore) break;
      } catch {
        break;
      }
    }
  }

  return allPayloads.flatMap((payload) => flattenMatchesFromPayload(payload, method));
}

async function fetchApiFootballJson(pathname) {
  if (!API_FOOTBALL_KEY) throw new Error("api_football_key_missing");
  const url = `${API_FOOTBALL_BASE}${pathname}`;
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": API_FOOTBALL_KEY,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`api_football_http_${response.status}`);
  const data = await response.json();
  const errors = data?.errors;
  if (errors && ((Array.isArray(errors) && errors.length) || (typeof errors === "object" && Object.keys(errors).length))) {
    throw new Error(`api_football_error_${JSON.stringify(errors).slice(0, 160)}`);
  }
  return data;
}

function apiFootballStatusBucket(shortStatus) {
  const code = String(shortStatus || "").toUpperCase();
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(code)) return "LIVE";
  if (["FT", "AET", "PEN"].includes(code)) return "RESULT";
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(code)) return "RESULT";
  return "WAIT";
}

function mapApiFootballFixture(row) {
  const fixture = row?.fixture || {};
  const league = row?.league || {};
  const teams = row?.teams || {};
  const goals = row?.goals || {};
  const score = row?.score || {};
  const id = `api-football-${fixture.id}`;
  const statusCode = String(fixture.status?.short || "NS");
  const status = apiFootballStatusBucket(statusCode);
  const homeScore = toNum(score.fulltime?.home, toNum(goals.home, null));
  const awayScore = toNum(score.fulltime?.away, toNum(goals.away, null));
  const leagueName = zhLeagueName(league.name, "足球赛事");
  return {
    id,
    sourceId: String(fixture.id || ""),
    source: "api-football",
    sourceMethod: "fixtures",
    matchNumStr: fixture.id ? `AF-${fixture.id}` : "",
    leagueCode: String(league.id || ""),
    league: leagueName,
    competition: leagueName,
    round: league.round || "",
    datetime: fixture.date || new Date().toISOString(),
    venue: fixture.venue?.name || "官方暂未提供",
    city: fixture.venue?.city || "",
    status,
    statusCode,
    statusName: fixture.status?.long || statusCode,
    home: {
      id: String(teams.home?.id || ""),
      name: teams.home?.name || "主队",
      short: toShortName(teams.home?.name || "主队"),
      logo: teams.home?.logo || "",
      color: "#2B68FF",
      rank: null,
    },
    away: {
      id: String(teams.away?.id || ""),
      name: teams.away?.name || "客队",
      short: toShortName(teams.away?.name || "客队"),
      logo: teams.away?.logo || "",
      color: "#F93A4A",
      rank: null,
    },
    odds: { oneXTwo: sanitizeOdds({}) },
    score: { fullTime: { home: homeScore, away: awayScore } },
  };
}

async function fetchMatchesFromApiFootball() {
  const days = [];
  const window = Math.max(0, Math.min(3, CLOUD_FIXTURE_WINDOW_DAYS));
  for (let offset = -window; offset <= window; offset += 1) days.push(formatDateOffset(offset));
  const payloads = await Promise.all(
    days.map((date) => fetchApiFootballJson(`/fixtures?date=${encodeURIComponent(date)}&timezone=Asia%2FShanghai`))
  );
  return dedupeMatches(filterTargetCompetitions(payloads.flatMap((payload) => (payload?.response || []).map(mapApiFootballFixture))));
}

async function fetchFootballDataJson(pathname) {
  if (!FOOTBALL_DATA_TOKEN) throw new Error("football_data_token_missing");
  const response = await fetch(`${FOOTBALL_DATA_BASE}${pathname}`, {
    headers: {
      "X-Auth-Token": FOOTBALL_DATA_TOKEN,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`football_data_http_${response.status}`);
  return response.json();
}

function footballDataStatusBucket(statusText) {
  const status = String(statusText || "").toUpperCase();
  if (["LIVE", "IN_PLAY", "PAUSED"].includes(status)) return "LIVE";
  if (status === "FINISHED") return "RESULT";
  return "WAIT";
}

function mapFootballDataMatch(row) {
  const id = `football-data-${row.id}`;
  const statusCode = String(row.status || "");
  const status = footballDataStatusBucket(statusCode);
  const leagueName = zhLeagueName(row.competition?.name, "足球赛事");
  return {
    id,
    sourceId: String(row.id || ""),
    source: "football-data",
    sourceMethod: "matches",
    matchNumStr: row.id ? `FD-${row.id}` : "",
    leagueCode: row.competition?.code || String(row.competition?.id || ""),
    league: leagueName,
    competition: leagueName,
    round: row.stage || row.group || "",
    datetime: row.utcDate || new Date().toISOString(),
    venue: row.venue || "官方暂未提供",
    city: "",
    status,
    statusCode,
    statusName: statusCode,
    home: {
      id: String(row.homeTeam?.id || ""),
      name: row.homeTeam?.name || "主队",
      short: toShortName(row.homeTeam?.shortName || row.homeTeam?.tla || row.homeTeam?.name || "主队"),
      crest: row.homeTeam?.crest || "",
      color: "#2B68FF",
      rank: null,
    },
    away: {
      id: String(row.awayTeam?.id || ""),
      name: row.awayTeam?.name || "客队",
      short: toShortName(row.awayTeam?.shortName || row.awayTeam?.tla || row.awayTeam?.name || "客队"),
      crest: row.awayTeam?.crest || "",
      color: "#F93A4A",
      rank: null,
    },
    odds: { oneXTwo: sanitizeOdds({}) },
    score: {
      fullTime: {
        home: toNum(row.score?.fullTime?.home, null),
        away: toNum(row.score?.fullTime?.away, null),
      },
    },
  };
}

async function fetchMatchesFromFootballData() {
  const from = formatDateOffset(-Math.max(0, Math.min(3, CLOUD_FIXTURE_WINDOW_DAYS)));
  const to = formatDateOffset(Math.max(0, Math.min(3, CLOUD_FIXTURE_WINDOW_DAYS)));
  const payload = await fetchFootballDataJson(`/matches?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`);
  return dedupeMatches(filterTargetCompetitions((payload?.matches || []).map(mapFootballDataMatch)));
}

async function fetchTheSportsDbJson(pathname) {
  if (!THESPORTSDB_KEY) throw new Error("thesportsdb_key_missing");
  const response = await fetch(`${THESPORTSDB_BASE}${pathname}`, {
    headers: {
      "X-API-KEY": THESPORTSDB_KEY,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`thesportsdb_http_${response.status}`);
  return response.json();
}

function theSportsDbStatusBucket(row) {
  const progress = String(row?.strProgress || row?.strStatus || row?.strEventStatus || "").toLowerCase();
  const hasScore = row?.intHomeScore !== null && row?.intHomeScore !== undefined && row?.intAwayScore !== null && row?.intAwayScore !== undefined;
  if (progress.includes("live") || progress.includes("half") || progress.includes("'") || progress.includes("in play")) return "LIVE";
  if (progress.includes("final") || progress.includes("finished") || progress.includes("ft") || (hasScore && row?.dateEventLocal)) return "RESULT";
  return "WAIT";
}

function mapTheSportsDbEvent(row, sourceMethod = "eventsday") {
  const eventId = row?.idEvent || row?.idLiveScore || row?.idEventLocal || `${row?.dateEvent || ""}-${row?.strHomeTeam || ""}-${row?.strAwayTeam || ""}`;
  const homeName = row?.strHomeTeam || row?.strHomeTeamBadge || row?.strHome || "Home";
  const awayName = row?.strAwayTeam || row?.strAwayTeamBadge || row?.strAway || "Away";
  const date = row?.dateEventLocal || row?.dateEvent || formatDateOffset(0);
  const time = row?.strTimeLocal || row?.strTime || "00:00:00";
  const timestamp = row?.strTimestamp || (String(date).includes("T") ? date : parseDateTime(date, String(time).slice(0, 5)));
  const status = theSportsDbStatusBucket(row);
  const leagueName = zhLeagueName(row?.strLeague, "足球赛事");
  return {
    id: `thesportsdb-${eventId}`,
    sourceId: String(eventId || ""),
    source: "thesportsdb",
    sourceMethod,
    matchNumStr: eventId ? `TSDB-${eventId}` : "",
    leagueCode: String(row?.idLeague || ""),
    league: leagueName,
    competition: leagueName,
    round: row?.intRound ? `Round ${row.intRound}` : "",
    datetime: timestamp,
    venue: row?.strVenue || "官方暂未提供",
    city: row?.strCountry || "",
    status,
    statusCode: row?.strProgress || row?.strStatus || status,
    statusName: row?.strProgress || row?.strStatus || status,
    home: {
      id: String(row?.idHomeTeam || ""),
      name: homeName,
      short: toShortName(homeName),
      logo: row?.strHomeTeamBadge || "",
      color: "#2B68FF",
      rank: null,
    },
    away: {
      id: String(row?.idAwayTeam || ""),
      name: awayName,
      short: toShortName(awayName),
      logo: row?.strAwayTeamBadge || "",
      color: "#F93A4A",
      rank: null,
    },
    odds: { oneXTwo: sanitizeOdds({}) },
    score: {
      fullTime: {
        home: toNum(row?.intHomeScore, null),
        away: toNum(row?.intAwayScore, null),
      },
    },
  };
}

async function fetchMatchesFromTheSportsDb() {
  const days = [];
  const window = Math.max(0, Math.min(3, CLOUD_FIXTURE_WINDOW_DAYS));
  for (let offset = -window; offset <= window; offset += 1) days.push(formatDateOffset(offset));
  const dayPayloads = await Promise.all(
    days.map((date) => fetchTheSportsDbJson(`/api/v1/json/${encodeURIComponent(THESPORTSDB_KEY)}/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`))
  );
  let livePayload = null;
  try {
    livePayload = await fetchTheSportsDbJson("/api/v2/json/livescore/soccer");
  } catch {
    livePayload = null;
  }
  const dayMatches = dayPayloads.flatMap((payload) => (payload?.events || []).map((row) => mapTheSportsDbEvent(row, "eventsday")));
  const liveMatches = (livePayload?.livescores || livePayload?.events || []).map((row) => mapTheSportsDbEvent(row, "livescore"));
  return dedupeMatches(filterTargetCompetitions([...dayMatches, ...liveMatches]));
}

async function fetchEspnScoreboardJson(leagueCode) {
  const response = await fetch(`${ESPN_SCOREBOARD_BASE}/${encodeURIComponent(leagueCode)}/scoreboard`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 football-analysis-web",
    },
  });
  if (!response.ok) throw new Error(`espn_http_${leagueCode}_${response.status}`);
  return response.json();
}

function espnStatusBucket(statusType) {
  const state = String(statusType?.state || "").toLowerCase();
  if (state === "in") return "LIVE";
  if (state === "post" || statusType?.completed) return "RESULT";
  return "WAIT";
}

function mapEspnEvent(event, leagueInfo, leagueCode) {
  const competition = event?.competitions?.[0] || {};
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((x) => x.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((x) => x.homeAway === "away") || competitors[1] || {};
  const statusType = competition.status?.type || event?.status?.type || {};
  const status = espnStatusBucket(statusType);
  const homeTeam = home.team || {};
  const awayTeam = away.team || {};
  const leagueName = zhLeagueName(leagueInfo?.name || leagueInfo?.midsizeName || leagueCode, "足球赛事");
  return {
    id: `espn-${event.id}`,
    sourceId: String(event.id || ""),
    source: "espn-scoreboard",
    sourceMethod: leagueCode,
    matchNumStr: event.id ? `ESPN-${event.id}` : "",
    leagueCode: String(leagueInfo?.abbreviation || leagueCode || ""),
    league: leagueName,
    competition: leagueName,
    round: event?.season?.slug || "",
    datetime: competition.date || event.date || new Date().toISOString(),
    venue: competition.venue?.fullName || "官方暂未提供",
    city: competition.venue?.address?.city || competition.venue?.address?.country || "",
    status,
    statusCode: statusType.name || statusType.state || status,
    statusName: statusType.description || statusType.detail || status,
    home: {
      id: String(homeTeam.id || ""),
      name: homeTeam.displayName || homeTeam.name || "Home",
      short: toShortName(homeTeam.shortDisplayName || homeTeam.abbreviation || homeTeam.displayName || "Home"),
      logo: homeTeam.logo || "",
      color: homeTeam.color ? `#${String(homeTeam.color).replace(/^#/, "")}` : "#2B68FF",
      rank: null,
    },
    away: {
      id: String(awayTeam.id || ""),
      name: awayTeam.displayName || awayTeam.name || "Away",
      short: toShortName(awayTeam.shortDisplayName || awayTeam.abbreviation || awayTeam.displayName || "Away"),
      logo: awayTeam.logo || "",
      color: awayTeam.color ? `#${String(awayTeam.color).replace(/^#/, "")}` : "#F93A4A",
      rank: null,
    },
    odds: { oneXTwo: sanitizeOdds({}) },
    score: {
      fullTime: {
        home: toNum(home.score, null),
        away: toNum(away.score, null),
      },
    },
  };
}

async function fetchMatchesFromEspn() {
  const settled = await Promise.allSettled(ESPN_SOCCER_LEAGUES.map((league) => fetchEspnScoreboardJson(league)));
  const matches = [];
  settled.forEach((result, idx) => {
    if (result.status !== "fulfilled") return;
    const payload = result.value || {};
    const leagueInfo = Array.isArray(payload.leagues) ? payload.leagues[0] : null;
    for (const event of payload.events || []) {
      matches.push(mapEspnEvent(event, leagueInfo, ESPN_SOCCER_LEAGUES[idx]));
    }
  });
  const filtered = filterTargetCompetitions(matches);
  if (!filtered.length) throw new Error("espn_empty_matches");
  return dedupeMatches(filtered);
}

function configuredProvider() {
  if (DATA_PROVIDER === "espn" || DATA_PROVIDER === "espn-scoreboard") return "espn-scoreboard";
  if (DATA_PROVIDER === "thesportsdb" || DATA_PROVIDER === "sportsdb") return "thesportsdb";
  if (DATA_PROVIDER === "api-football" || DATA_PROVIDER === "apifootball") return "api-football";
  if (DATA_PROVIDER === "football-data" || DATA_PROVIDER === "footballdata") return "football-data";
  if (DATA_PROVIDER === "sporttery") return "sporttery";
  if (API_FOOTBALL_KEY) return "api-football";
  if (THESPORTSDB_KEY) return "thesportsdb";
  if (FOOTBALL_DATA_TOKEN) return "football-data";
  return "espn-scoreboard";
}

async function fetchMatchDetail(sourceId, statusCode) {
  const payload = await fetchSportteryJson(
    `/gateway/uniform/fb/getMatchGeneral.qry?matchId=${encodeURIComponent(sourceId)}&matchStatus=${encodeURIComponent(
      statusCode || "2"
    )}`,
    "concern"
  );
  return payload.value || {};
}

async function mapConcurrent(items, limit, worker) {
  const out = new Array(items.length);
  let index = 0;
  async function runner() {
    while (index < items.length) {
      const i = index++;
      out[i] = await worker(items[i], i);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) workers.push(runner());
  await Promise.all(workers);
  return out;
}

function dedupeMatches(list) {
  const map = new Map();
  for (const m of list) {
    const prev = map.get(m.id);
    if (!prev) {
      map.set(m.id, m);
      continue;
    }
    const priority = { LIVE: 4, SELL: 3, RESULT: 2, WAIT: 1 };
    const pCur = priority[m.status] || 0;
    const pPrev = priority[prev.status] || 0;
    const curOdds = hasValidOdds(m.odds?.oneXTwo);
    const prevOdds = hasValidOdds(prev.odds?.oneXTwo);
    const shouldReplace =
      pCur > pPrev ||
      (pCur === pPrev && curOdds && !prevOdds) ||
      (pCur === pPrev && curOdds === prevOdds && (m.sourceMethod === "concern" || prev.sourceMethod !== "concern"));
    if (shouldReplace) {
      map.set(m.id, { ...prev, ...m });
    }
  }
  return Array.from(map.values()).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function fallbackMatches() {
  const now = new Date();
  return [
    ["意甲", "莱切", "佛罗伦萨"],
    ["英超", "狼队", "热刺"],
    ["西甲", "赫罗纳", "贝蒂斯"],
    ["德甲", "法兰克福", "勒沃库森"],
    ["法甲", "巴黎圣日耳曼", "马赛"],
  ].map((x, idx) => ({
    id: `fallback-${idx + 1}`,
    sourceId: `fb-${idx + 1}`,
    source: "fallback-mock",
    sourceMethod: "concern",
    matchNumStr: `周${["一", "二", "三", "四", "五"][idx]}00${idx + 1}`,
    leagueCode: "",
    league: x[0],
    competition: x[0],
    round: "模拟场次",
    datetime: new Date(now.getTime() + idx * 3 * 3600 * 1000).toISOString(),
    venue: "Mock Stadium",
    city: "",
    status: "SELL",
    statusCode: "2",
    statusName: "已开售",
    home: { id: `h-${idx + 1}`, name: x[1], short: toShortName(x[1]), color: "#2B68FF", rank: null },
    away: { id: `a-${idx + 1}`, name: x[2], short: toShortName(x[2]), color: "#F93A4A", rank: null },
    odds: { oneXTwo: { home: 2.2 + idx * 0.1, draw: 3.1, away: 2.7 - idx * 0.05 } },
    score: { fullTime: { home: null, away: null } },
  }));
}

function fallbackNews() {
  return [
    {
      title: "竞猜有限度 快乐常相随",
      date: "2026-01-05",
      url: "https://m.sporttery.cn/jczx/jczq/jcdj/20260105/10051749.html",
    },
    {
      title: "中国竞彩网官方资讯",
      date: "",
      url: "https://m.sporttery.cn/jczx/jczq/",
    },
  ];
}

async function refreshFromSporttery() {
  const prevAnalysisById = cache.analysisById && typeof cache.analysisById === "object" ? cache.analysisById : {};
  const prevMatchesById = new Map((Array.isArray(cache.matches) ? cache.matches : []).map((m) => [m.id, m]));

  const lists = await Promise.all(SPORTTERY_METHODS.map((method) => fetchMatchListByMethod(method)));
  const merged = dedupeMatches(filterTargetCompetitions(lists.flat()));
  const news = await fetchChineseNews();

  const detailCandidates = merged
    .filter((match) => match.status === "SELL" || match.status === "LIVE" || match.status === "RESULT")
    .slice(0, DETAIL_ENRICH_LIMIT);
  const detailMap = new Map();
  const details = await mapConcurrent(detailCandidates, 4, async (match) => {
    try {
      return await fetchMatchDetail(match.sourceId, match.statusCode);
    } catch {
      return {};
    }
  });
  detailCandidates.forEach((match, idx) => {
    detailMap.set(match.id, details[idx] || {});
  });

  const analysisById = {};
  merged.forEach((match) => {
    analysisById[match.id] = buildAnalysisFromSporttery(match, detailMap.get(match.id) || {});
  });

  merged.forEach((match) => {
    if (isPreMatchStatus(match.status)) return;
    const currentAnalysis = analysisById[match.id];
    const prevAnalysis = prevAnalysisById[match.id] || null;
    const prevMatch = prevMatchesById.get(match.id) || null;
    const archiveEntry = tryLockPredictionArchive(match, currentAnalysis, prevAnalysis, prevMatch);
    if (archiveEntry) {
      analysisById[match.id] = mergeLockedForecastIntoAnalysis(currentAnalysis, archiveEntry);
    }
  });

  cache.source = "sporttery-webapi";
  cache.matches = merged;
  cache.analysisById = analysisById;
  cache.news = news;
  cache.updatedAt = new Date().toISOString();
  cache.lastError = null;
  persistMatchesToDatabase(merged);
}

async function refreshFromCloudFootballProvider(provider) {
  const prevAnalysisById = cache.analysisById && typeof cache.analysisById === "object" ? cache.analysisById : {};
  const prevMatchesById = new Map((Array.isArray(cache.matches) ? cache.matches : []).map((m) => [m.id, m]));
  let merged = [];
  if (provider === "football-data") {
    merged = await fetchMatchesFromFootballData();
  } else if (provider === "thesportsdb") {
    merged = await fetchMatchesFromTheSportsDb();
  } else if (provider === "espn-scoreboard") {
    merged = await fetchMatchesFromEspn();
  } else {
    merged = await fetchMatchesFromApiFootball();
  }
  if (!merged.length) throw new Error(`${provider}_empty_matches`);

  const analysisById = {};
  merged.forEach((match) => {
    analysisById[match.id] = buildAnalysisFromSporttery(match, {});
  });

  merged.forEach((match) => {
    if (isPreMatchStatus(match.status)) return;
    const currentAnalysis = analysisById[match.id];
    const prevAnalysis = prevAnalysisById[match.id] || null;
    const prevMatch = prevMatchesById.get(match.id) || null;
    const archiveEntry = tryLockPredictionArchive(match, currentAnalysis, prevAnalysis, prevMatch);
    if (archiveEntry) {
      analysisById[match.id] = mergeLockedForecastIntoAnalysis(currentAnalysis, archiveEntry);
    }
  });

  cache.source = provider;
  cache.matches = merged;
  cache.analysisById = analysisById;
  cache.news = Array.isArray(cache.news) ? cache.news : [];
  cache.updatedAt = new Date().toISOString();
  cache.lastError = null;
  persistMatchesToDatabase(merged);
}

async function refreshAllData() {
  if (cache.refreshing) return;
  cache.refreshing = true;
  const startedAt = Date.now();
  cache.lastAttemptAt = new Date(startedAt).toISOString();
  try {
    const provider = configuredProvider();
    if (provider === "sporttery") {
      await refreshFromSporttery();
    } else {
      await refreshFromCloudFootballProvider(provider);
    }
    cache.lastSuccessAt = cache.updatedAt;
    cache.refreshCount += 1;
    cache.lastDurationMs = Date.now() - startedAt;
    cache.nextRefreshAt = computeNextRefreshAt();
  } catch (error) {
    cache.lastError = String(error.message || error);
    const hasRealSnapshot =
      Array.isArray(cache.matches) &&
      cache.matches.length > 0 &&
      Array.isArray(cache.news) &&
      cache.analysisById &&
      typeof cache.analysisById === "object" &&
      cache.source &&
      !String(cache.source).startsWith("fallback-mock");

    if (hasRealSnapshot) {
      cache.source = `${cache.source || configuredProvider()}-stale`;
    } else {
      const list = fallbackMatches();
      const analysisById = {};
      for (const m of list) analysisById[m.id] = buildAnalysisFromSporttery(m, {});
      cache.source = "fallback-mock";
      cache.matches = list;
      cache.analysisById = analysisById;
      cache.news = fallbackNews();
      cache.updatedAt = new Date().toISOString();
    }
    cache.refreshCount += 1;
    cache.lastDurationMs = Date.now() - startedAt;
    cache.nextRefreshAt = computeNextRefreshAt();
  } finally {
    cache.refreshing = false;
    writeHistorySnapshot();
    saveCache();
    saveCloudSnapshot().catch((error) => {
      cache.lastError = cache.lastError || String(error.message || error);
      saveCache();
    });
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...API_CORS_HEADERS,
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(""));
  });
}

function serveStatic(res, filePath) {
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    json(res, 404, { ok: false, error: "not_found" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function callOpenAI(modelName, systemPrompt, userPrompt, maxTokens, temperature) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured_openai");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_completion_tokens: maxTokens,
    }),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || "";
  return { text, raw: payload };
}

async function callAnthropic(modelName, systemPrompt, userPrompt, maxTokens, temperature) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured_anthropic");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      system: systemPrompt || undefined,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  });
  if (!response.ok) throw new Error(`anthropic_http_${response.status}`);
  const payload = await response.json();
  const text =
    Array.isArray(payload?.content) && payload.content.length
      ? payload.content
          .filter((x) => x.type === "text")
          .map((x) => x.text || "")
          .join("\n")
      : "";
  return { text, raw: payload };
}

async function callGemini(modelName, systemPrompt, userPrompt, maxTokens, temperature) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured_gemini");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: systemPrompt ? { role: "system", parts: [{ text: systemPrompt }] } : undefined,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );
  if (!response.ok) throw new Error(`gemini_http_${response.status}`);
  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";
  return { text, raw: payload };
}

async function callDeepSeek(modelName, systemPrompt, userPrompt, maxTokens, temperature) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("provider_not_configured_deepseek");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });
  if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || "";
  return { text, raw: payload };
}

async function callAiProvider(modelConfig, { prompt, systemPrompt, maxTokens, temperature }) {
  if (!modelConfig) throw new Error("model_not_found");
  if (!prompt || typeof prompt !== "string") throw new Error("invalid_prompt");

  if (modelConfig.provider === "openai") {
    return callOpenAI(modelConfig.model, systemPrompt, prompt, maxTokens, temperature);
  }
  if (modelConfig.provider === "anthropic") {
    return callAnthropic(modelConfig.model, systemPrompt, prompt, maxTokens, temperature);
  }
  if (modelConfig.provider === "gemini") {
    return callGemini(modelConfig.model, systemPrompt, prompt, maxTokens, temperature);
  }
  if (modelConfig.provider === "deepseek") {
    return callDeepSeek(modelConfig.model, systemPrompt, prompt, maxTokens, temperature);
  }
  throw new Error("unsupported_provider");
}

function filterMatches({ league, status }) {
  return filterTargetCompetitions(cache.matches).filter((m) => {
    const leagueOk =
      !league || league === "全部" || league.toUpperCase() === "ALL" || m.league === league || m.leagueCode === league;
    const statusOk =
      !status ||
      status.toUpperCase() === "ALL" ||
      m.status === status.toUpperCase() ||
      m.statusName === status ||
      m.statusCode === status;
    return leagueOk && statusOk;
  });
}

function matchTimestamp(match) {
  const t = Date.parse(match?.datetime || "");
  return Number.isFinite(t) ? t : 0;
}

function isResultWithScore(match) {
  return (
    match?.status === "RESULT" &&
    Number.isFinite(Number(match?.score?.fullTime?.home)) &&
    Number.isFinite(Number(match?.score?.fullTime?.away))
  );
}

function teamResultView(match, teamId) {
  const isHome = String(match?.home?.id || "") === String(teamId || "");
  const gf = Number(isHome ? match?.score?.fullTime?.home : match?.score?.fullTime?.away);
  const ga = Number(isHome ? match?.score?.fullTime?.away : match?.score?.fullTime?.home);
  let result = "D";
  if (gf > ga) result = "W";
  if (gf < ga) result = "L";
  return { gf, ga, result };
}

function teamRecentStats(teamId, limit = 10) {
  const list = cache.matches
    .filter(
      (m) =>
        isResultWithScore(m) &&
        (String(m?.home?.id || "") === String(teamId || "") || String(m?.away?.id || "") === String(teamId || ""))
    )
    .sort((a, b) => matchTimestamp(b) - matchTimestamp(a))
    .slice(0, Math.max(1, limit));

  let w = 0;
  let d = 0;
  let l = 0;
  let gf = 0;
  let ga = 0;
  const form = [];
  list.forEach((m) => {
    const view = teamResultView(m, teamId);
    gf += view.gf;
    ga += view.ga;
    form.push(view.result);
    if (view.result === "W") w += 1;
    if (view.result === "D") d += 1;
    if (view.result === "L") l += 1;
  });
  return {
    form5: form.slice(0, 5),
    form10: form.slice(0, 10),
    w,
    d,
    l,
    gf,
    ga,
    points: w * 3 + d,
    sample: list.length,
  };
}

function h2hStats(homeId, awayId, limit = 6) {
  const list = cache.matches
    .filter((m) => {
      if (!isResultWithScore(m)) return false;
      const h = String(m?.home?.id || "");
      const a = String(m?.away?.id || "");
      const home = String(homeId || "");
      const away = String(awayId || "");
      return (h === home && a === away) || (h === away && a === home);
    })
    .sort((a, b) => matchTimestamp(b) - matchTimestamp(a))
    .slice(0, Math.max(1, limit));

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  list.forEach((m) => {
    const hs = Number(m?.score?.fullTime?.home);
    const as = Number(m?.score?.fullTime?.away);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) return;
    const homeIsRealHome = String(m?.home?.id || "") === String(homeId || "");
    const homeGoals = homeIsRealHome ? hs : as;
    const awayGoals = homeIsRealHome ? as : hs;
    if (homeGoals > awayGoals) homeWin += 1;
    else if (homeGoals < awayGoals) awayWin += 1;
    else draw += 1;
  });
  return { homeWin, draw, awayWin, sample: list.length };
}

function enrichAnalysisForMatch(match, baseAnalysis) {
  const analysis = JSON.parse(JSON.stringify(baseAnalysis || {}));
  const homeStats = teamRecentStats(match?.home?.id, 10);
  const awayStats = teamRecentStats(match?.away?.id, 10);
  const h2h = h2hStats(match?.home?.id, match?.away?.id, 6);

  if (!analysis.fundamentals) analysis.fundamentals = {};
  if (!analysis.fundamentals.history) analysis.fundamentals.history = {};
  if (!analysis.fundamentals.history.recentForm) analysis.fundamentals.history.recentForm = {};
  if (!analysis.fundamentals.history.standing) analysis.fundamentals.history.standing = {};

  analysis.fundamentals.history.recentForm.home = homeStats.form5.length ? homeStats.form5 : ["-", "-", "-", "-", "-"];
  analysis.fundamentals.history.recentForm.away = awayStats.form5.length ? awayStats.form5 : ["-", "-", "-", "-", "-"];
  analysis.fundamentals.history.standing.home = {
    rank: `近10场${homeStats.sample}场`,
    points: homeStats.points,
    goalDiff: homeStats.gf - homeStats.ga,
    record: `${homeStats.w}-${homeStats.d}-${homeStats.l}`,
    gf: homeStats.gf,
    ga: homeStats.ga,
  };
  analysis.fundamentals.history.standing.away = {
    rank: `近10场${awayStats.sample}场`,
    points: awayStats.points,
    goalDiff: awayStats.gf - awayStats.ga,
    record: `${awayStats.w}-${awayStats.d}-${awayStats.l}`,
    gf: awayStats.gf,
    ga: awayStats.ga,
  };

  if (!analysis.context) analysis.context = {};
  if (!analysis.context.h2h) analysis.context.h2h = {};
  analysis.context.h2h.last5 = {
    homeWin: h2h.homeWin,
    draw: h2h.draw,
    awayWin: h2h.awayWin,
  };
  analysis.context.h2h.note =
    h2h.sample > 0
      ? `近${h2h.sample}次交锋：主队${h2h.homeWin}胜，平${h2h.draw}场，客队${h2h.awayWin}胜。`
      : "暂无可用的双方历史交锋样本。";

  if (!analysis.market) analysis.market = {};
  if (!analysis.market.psychology) analysis.market.psychology = {};
  analysis.market.psychology.analysisText = `近况对比：${match?.home?.name || "主队"}近10场${homeStats.w}胜${homeStats.d}平${homeStats.l}负，${match?.away?.name || "客队"}近10场${awayStats.w}胜${awayStats.d}平${awayStats.l}负。`;
  return analysis;
}

function buildCoveragePayload() {
  const matches = filterTargetCompetitions(cache.matches);
  const byStatus = matches.reduce((acc, match) => {
    const key = match.status || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byLeagueMap = matches.reduce((acc, match) => {
    const key = match.league || "未分类联赛";
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());

  const byLeague = Array.from(byLeagueMap.entries())
    .map(([league, count]) => ({ league, count }))
    .sort((a, b) => b.count - a.count || a.league.localeCompare(b.league, "zh-CN"));

  return {
    ok: true,
    source: cache.source,
    updatedAt: cache.updatedAt,
    totalMatches: matches.length,
    totalLeagues: byLeague.length,
    byStatus,
    topLeagues: byLeague.slice(0, 20),
  };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  let bodyText = "";

  if (urlObj.pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, API_CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === "POST") bodyText = await readBody(req);

    if (req.method === "GET" && urlObj.pathname === "/api/status") {
      json(res, 200, {
        ok: true,
        source: cache.source,
        configuredProvider: configuredProvider(),
        espnScoreboardEnabled: true,
        theSportsDbEnabled: Boolean(THESPORTSDB_KEY),
        apiFootballEnabled: Boolean(API_FOOTBALL_KEY),
        footballDataEnabled: Boolean(FOOTBALL_DATA_TOKEN),
        cloudSnapshotEnabled: cloudSnapshotEnabled(),
        ...schedulerStatus(),
      });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/bootstrap") {
      const targetMatches = filterTargetCompetitions(cache.matches);
      const leagues = ["全部", ...Array.from(new Set(targetMatches.map((m) => m.league)))];
      json(res, 200, {
        ok: true,
        source: cache.source,
        updatedAt: cache.updatedAt,
        scheduler: schedulerStatus(),
        leagues: leagues.map((name) => ({ code: name === "全部" ? "ALL" : name, name })),
        matches: targetMatches,
        news: cache.news,
      });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/coverage") {
      json(res, 200, buildCoveragePayload());
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/news") {
      json(res, 200, { ok: true, updatedAt: cache.updatedAt, count: cache.news.length, news: cache.news });
      return;
    }

    if (req.method === "POST" && urlObj.pathname === "/api/admin/snapshot-import") {
      if (!ADMIN_SYNC_TOKEN) {
        json(res, 403, { ok: false, error: "admin_sync_disabled" });
        return;
      }
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : urlObj.searchParams.get("token") || "";
      if (token !== ADMIN_SYNC_TOKEN) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      try {
        const payload = parseJsonBody(bodyText);
        importSnapshotPayload(payload);
        json(res, 200, {
          ok: true,
          source: cache.source,
          updatedAt: cache.updatedAt,
          count: cache.matches.length,
        });
      } catch (error) {
        json(res, 400, { ok: false, error: String(error.message || error) });
      }
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/history/search") {
      const q = urlObj.searchParams.get("q") || "";
      const league = urlObj.searchParams.get("league") || "";
      const status = urlObj.searchParams.get("status") || "";
      const dateFrom = urlObj.searchParams.get("dateFrom") || "";
      const dateTo = urlObj.searchParams.get("dateTo") || "";
      const page = Math.max(1, Number(urlObj.searchParams.get("page") || 1));
      const pageSize = Math.max(1, Math.min(200, Number(urlObj.searchParams.get("pageSize") || 50)));
      const result = searchHistoryInDatabase({ q, league, status, dateFrom, dateTo, page, pageSize });
      json(res, 200, {
        ok: true,
        source: cache.source,
        updatedAt: cache.updatedAt,
        ...result,
      });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/history/timeline") {
      const matchId = urlObj.searchParams.get("matchId") || "";
      const limit = Math.max(1, Math.min(200, Number(urlObj.searchParams.get("limit") || 30)));
      if (!matchId) {
        json(res, 400, { ok: false, error: "matchId_required" });
        return;
      }
      const rows = db ? searchTimelineStmt.all(matchId, limit) : [];
      json(res, 200, { ok: true, matchId, count: rows.length, timeline: rows });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/ai/models") {
      json(res, 200, { ok: true, ...aiCatalogPayload() });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/ai/estimate") {
      const modelId = urlObj.searchParams.get("modelId") || AI_MODELS[0].id;
      const model = AI_MODELS.find((x) => x.id === modelId);
      if (!model) {
        json(res, 404, { ok: false, error: "model_not_found", modelId });
        return;
      }
      const inputTokens = toPositiveInt(urlObj.searchParams.get("inputTokens"), 2600);
      const outputTokens = toPositiveInt(urlObj.searchParams.get("outputTokens"), 900);
      const cachedInputTokens = toPositiveInt(urlObj.searchParams.get("cachedInputTokens"), 0);
      const calls = toPositiveInt(urlObj.searchParams.get("calls"), 1);
      const markup = Number(urlObj.searchParams.get("markup") || 2.6);
      const minCny = Number(urlObj.searchParams.get("minCny") || 0.3);
      const apiCostUsdSingle = calcApiCostUsd(model, inputTokens, outputTokens, cachedInputTokens);
      const apiCostUsd = apiCostUsdSingle * calls;
      const suggestedPriceCny = retailPriceCny(apiCostUsd, markup, minCny);
      json(res, 200, {
        ok: true,
        modelId,
        model: {
          id: model.id,
          name: model.name,
          provider: model.provider,
          inputUsdPerMTok: model.inputUsdPerMTok,
          outputUsdPerMTok: model.outputUsdPerMTok,
          cachedInputUsdPerMTok: model.cachedInputUsdPerMTok,
        },
        estimate: {
          inputTokens,
          outputTokens,
          cachedInputTokens,
          calls,
          markup,
          minCny,
          fxUsdCny: FX_USD_CNY,
          apiCostUsd: Number(apiCostUsd.toFixed(6)),
          apiCostCny: Number((apiCostUsd * FX_USD_CNY).toFixed(4)),
          suggestedPriceCny,
          grossMarginEstimate:
            suggestedPriceCny > 0
              ? Number((((suggestedPriceCny - apiCostUsd * FX_USD_CNY) / suggestedPriceCny) * 100).toFixed(1))
              : 0,
        },
      });
      return;
    }

    if (
      (req.method === "GET" || req.method === "POST") &&
      urlObj.pathname.startsWith("/api/matches/") &&
      urlObj.pathname.endsWith("/ai-prediction")
    ) {
      const id = decodeURIComponent(urlObj.pathname.replace("/api/matches/", "").replace("/ai-prediction", ""));
      const payload = req.method === "POST" ? parseJsonBody(bodyText) : {};
      const fromCache = cache.matches.find((m) => m.id === id) || null;
      let match = fromCache;
      if (!match && db && selectLatestByIdStmt) {
        const row = selectLatestByIdStmt.get(id);
        if (row) match = mapDbSearchRow(row);
      }

      if (!match) {
        json(res, 404, { ok: false, error: "match_not_found", id });
        return;
      }

      let analysis = cache.analysisById[id] || buildAnalysisFromSporttery(match, {});
      let enriched = enrichAnalysisForMatch(match, analysis);
      if (normText(match.source) === "sporttery-webapi" && normText(match.sourceId)) {
        const advPack = await fetchAdvancedMatchPack(match.sourceId);
        enriched = applyAdvancedPackToAnalysis(match, enriched, advPack);
      }
      if (!isPreMatchStatus(match.status)) {
        const archiveEntry =
          getPredictionArchive(id) || tryLockPredictionArchive(match, enriched, cache.analysisById[id] || null, fromCache);
        if (archiveEntry) enriched = mergeLockedForecastIntoAnalysis(enriched, archiveEntry);
      }
      cache.analysisById[id] = enriched;
      if (!fromCache) {
        cache.matches.push(match);
      }

      try {
        const prediction = await buildOrGetDailyAiPrediction(match, enriched, payload.modelId || urlObj.searchParams.get("modelId") || "");
        json(res, 200, { ok: true, id, prediction });
      } catch (error) {
        json(res, 400, { ok: false, id, error: String(error.message || error) });
      }
      return;
    }

    if (req.method === "POST" && urlObj.pathname === "/api/ai/analyze") {
      const payload = parseJsonBody(bodyText);
      const modelId = payload.modelId || AI_MODELS[0].id;
      const model = AI_MODELS.find((x) => x.id === modelId);
      if (!model) {
        json(res, 404, { ok: false, error: "model_not_found", modelId });
        return;
      }
      const prompt = String(payload.prompt || "").trim();
      if (!prompt) {
        json(res, 400, { ok: false, error: "prompt_required" });
        return;
      }
      const maxTokens = toPositiveInt(payload.maxTokens, 1200);
      const temperature = Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.35;
      const systemPrompt =
        typeof payload.systemPrompt === "string" && payload.systemPrompt.trim()
          ? payload.systemPrompt.trim()
          : "你是足球赛事数据分析助手。输出中文、结构化、可解释结论，不提供任何投注建议。";
      try {
        const result = await callAiProvider(model, { prompt, systemPrompt, maxTokens, temperature });
        json(res, 200, {
          ok: true,
          modelId: model.id,
          provider: model.provider,
          modelName: model.name,
          text: result.text || "",
          usage: result.raw?.usage || null,
        });
      } catch (error) {
        json(res, 400, {
          ok: false,
          modelId: model.id,
          provider: model.provider,
          error: String(error.message || error),
        });
      }
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/matches") {
      const league = urlObj.searchParams.get("league") || "";
      const status = urlObj.searchParams.get("status") || "";
      const list = filterMatches({ league, status });
      json(res, 200, { ok: true, updatedAt: cache.updatedAt, count: list.length, matches: list });
      return;
    }

    if (req.method === "GET" && urlObj.pathname.startsWith("/api/matches/") && urlObj.pathname.endsWith("/analysis")) {
      const id = decodeURIComponent(urlObj.pathname.replace("/api/matches/", "").replace("/analysis", ""));
      const fromCache = cache.matches.find((m) => m.id === id) || null;
      let match = fromCache;
      if (!match && db && selectLatestByIdStmt) {
        const row = selectLatestByIdStmt.get(id);
        if (row) {
          match = mapDbSearchRow(row);
        }
      }

      if (!match) {
        json(res, 404, { ok: false, error: "match_not_found", id });
        return;
      }

      let analysis = cache.analysisById[id];
      if (!analysis) {
        analysis = buildAnalysisFromSporttery(match, {});
      }

      let enriched = enrichAnalysisForMatch(match, analysis);
      if (normText(match.source) === "sporttery-webapi" && normText(match.sourceId)) {
        const advPack = await fetchAdvancedMatchPack(match.sourceId);
        enriched = applyAdvancedPackToAnalysis(match, enriched, advPack);
      }
      if (!isPreMatchStatus(match.status)) {
        const archiveEntry =
          getPredictionArchive(id) || tryLockPredictionArchive(match, enriched, cache.analysisById[id] || null, fromCache);
        if (archiveEntry) {
          enriched = mergeLockedForecastIntoAnalysis(enriched, archiveEntry);
        }
      }
      cache.analysisById[id] = enriched;
      if (!fromCache) {
        cache.matches.push(match);
      }

      if (!enriched) {
        json(res, 404, { ok: false, error: "analysis_not_found", id });
        return;
      }
      json(res, 200, { ok: true, id, analysis: enriched });
      return;
    }

    if ((req.method === "POST" || req.method === "GET") && urlObj.pathname === "/api/refresh") {
      refreshAllData().catch(() => {});
      json(res, 202, { ok: true, message: "refresh_started" });
      return;
    }

    json(res, 404, { ok: false, error: "not_found" });
    return;
  }

  if (urlObj.pathname === "/" || urlObj.pathname === "/index.html") {
    serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }
  serveStatic(res, path.join(PUBLIC_DIR, urlObj.pathname));
});

initDatabase();
loadCache();
loadAiPredictionCache();
loadCloudSnapshot()
  .then((payload) => {
    if (payload && Array.isArray(payload.matches) && payload.matches.length) {
      importSnapshotPayload(payload);
    }
  })
  .catch((error) => {
    cache.lastError = cache.lastError || String(error.message || error);
  })
  .finally(() => {
    refreshAllData().catch(() => {});
  });
setInterval(() => {
  refreshAllData().catch(() => {});
}, REFRESH_MINUTES * 60 * 1000);

function hasLiveRefreshDemand() {
  const now = Date.now();
  const soonMs = 2 * 60 * 60 * 1000;
  return cache.matches.some((match) => {
    if (match?.status === "LIVE") return true;
    const t = Date.parse(match?.datetime || "");
    return Number.isFinite(t) && t >= now - 30 * 60 * 1000 && t <= now + soonMs;
  });
}

setInterval(() => {
  if (hasLiveRefreshDemand()) {
    refreshAllData().catch(() => {});
  }
}, Math.max(15, LIVE_REFRESH_SECONDS) * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[football-analysis-web] running at http://${HOST}:${PORT}`);
  console.log(`[football-analysis-web] source=${cache.source}, refresh=${REFRESH_MINUTES}m, live=${LIVE_REFRESH_SECONDS}s`);
});
