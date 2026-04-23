const http = require("http");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 5);
const SPORTTERY_BASE = "https://webapi.sporttery.cn";
const PUBLIC_DIR = __dirname;
const CACHE_DIR = path.join(__dirname, "server-cache");
const CACHE_FILE = path.join(CACHE_DIR, "snapshot.json");
const SNAPSHOT_HISTORY_DIR = path.join(CACHE_DIR, "history");
const DB_FILE = path.join(CACHE_DIR, "matches.sqlite");
const MAX_SNAPSHOT_HISTORY = Number(process.env.MAX_SNAPSHOT_HISTORY || 48);

const SPORTTERY_METHODS = ["concern", "live", "result", "all"];
const SPORTTERY_PAGE_SIZE = Number(process.env.SPORTTERY_PAGE_SIZE || 80);
const SPORTTERY_PAGE_DEPTH = Number(process.env.SPORTTERY_PAGE_DEPTH || 16);
const DETAIL_ENRICH_LIMIT = Number(process.env.DETAIL_ENRICH_LIMIT || 60);
const FX_USD_CNY = Number(process.env.FX_USD_CNY || 7.2);

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

    CREATE INDEX IF NOT EXISTS idx_match_latest_datetime ON match_latest(match_time);
    CREATE INDEX IF NOT EXISTS idx_match_latest_league ON match_latest(league);
    CREATE INDEX IF NOT EXISTS idx_match_latest_status ON match_latest(status);
    CREATE INDEX IF NOT EXISTS idx_match_history_match ON match_history(match_id);
    CREATE INDEX IF NOT EXISTS idx_match_history_snapshot ON match_history(snapshot_at);
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
  if (!fs.existsSync(CACHE_FILE)) return;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw);
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

function saveCache() {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(snapshotPayload(), null, 2), "utf8");
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
    updatedAt: cache.updatedAt,
    lastAttemptAt: cache.lastAttemptAt,
    lastSuccessAt: cache.lastSuccessAt,
    nextRefreshAt: cache.nextRefreshAt,
    refreshCount: cache.refreshCount,
    lastDurationMs: cache.lastDurationMs,
    lastSnapshotFile: cache.lastSnapshotFile,
    matchCount: cache.matches.length,
    analysisCount: Object.keys(cache.analysisById).length,
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

function toShortName(name) {
  if (!name) return "---";
  if (name.length <= 3) return name.toUpperCase();
  return name.slice(0, 3).toUpperCase();
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
          home: [homeScore > awayScore ? "W" : "D", "W", "D", "L", "W"],
          away: [awayScore > homeScore ? "W" : "D", "L", "W", "D", "L"],
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
          home: [{ player: "官方数据待补充", issue: "伤停名单未公开", status: "unknown" }],
          away: [{ player: "官方数据待补充", issue: "伤停名单未公开", status: "unknown" }],
        },
        lineup: { home: "4-3-3", away: "4-2-3-1" },
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
  const lists = await Promise.all(SPORTTERY_METHODS.map((method) => fetchMatchListByMethod(method)));
  const merged = dedupeMatches(lists.flat());
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

  cache.source = "sporttery-webapi";
  cache.matches = merged;
  cache.analysisById = analysisById;
  cache.news = news;
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
    await refreshFromSporttery();
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
      cache.source = "sporttery-webapi-stale";
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
  return cache.matches.filter((m) => {
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
  const byStatus = cache.matches.reduce((acc, match) => {
    const key = match.status || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byLeagueMap = cache.matches.reduce((acc, match) => {
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
    totalMatches: cache.matches.length,
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
      json(res, 200, { ok: true, source: cache.source, ...schedulerStatus() });
      return;
    }

    if (req.method === "GET" && urlObj.pathname === "/api/bootstrap") {
      const leagues = ["全部", ...Array.from(new Set(cache.matches.map((m) => m.league)))];
      json(res, 200, {
        ok: true,
        source: cache.source,
        updatedAt: cache.updatedAt,
        scheduler: schedulerStatus(),
        leagues: leagues.map((name) => ({ code: name === "全部" ? "ALL" : name, name })),
        matches: cache.matches,
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

      const enriched = enrichAnalysisForMatch(match, analysis);
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
refreshAllData().catch(() => {});
setInterval(() => {
  refreshAllData().catch(() => {});
}, REFRESH_MINUTES * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`[football-analysis-web] running at http://${HOST}:${PORT}`);
  console.log(`[football-analysis-web] source=${cache.source}, refresh=${REFRESH_MINUTES}m`);
});
