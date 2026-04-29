const SPORTTERY_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001";

const targetBase = process.env.RENDER_BASE_URL || "";
const token = process.env.ADMIN_SYNC_TOKEN || "";
const sourceUrls = [
  SPORTTERY_URL,
  ...(process.env.SPORTTERY_SOURCE_URLS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  process.env.SPORTTERY_PROXY_URL || "",
].filter(Boolean);

function normText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toShortName(name) {
  const s = normText(name, "---");
  return s.length <= 3 ? s : s.slice(0, 3);
}

function parseDateTime(dateStr, timeStr) {
  const date = normText(dateStr);
  const time = normText(timeStr);
  if (!date) return new Date().toISOString();
  if (!time) return `${date}T00:00:00+08:00`;
  const hhmm = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : "00:00:00";
  return `${date}T${hhmm}+08:00`;
}

function toStatusBucket(matchStatus, sellStatus) {
  const raw = String(sellStatus || matchStatus || "").toLowerCase();
  if (raw === "2" || raw === "selling" || raw === "sold") return "SELL";
  if (raw === "define" || raw === "oddsin") return "WAIT";
  if (raw === "playing" || raw === "live") return "LIVE";
  if (raw === "finished" || raw === "result") return "RESULT";
  return "WAIT";
}

function statusName(matchStatus, sellStatus) {
  const status = toStatusBucket(matchStatus, sellStatus);
  if (status === "SELL") return "已开售";
  if (status === "WAIT") return "待开售";
  if (status === "LIVE") return "进行中";
  if (status === "RESULT") return "已完场";
  return normText(matchStatus);
}

function sanitizeOdds(raw) {
  const home = toNum(raw?.home, null);
  const draw = toNum(raw?.draw, null);
  const away = toNum(raw?.away, null);
  if (home > 1.01 && draw > 1.01 && away > 1.01) return { home, draw, away };
  return { home: null, draw: null, away: null };
}

function oddsFromList(oddsList, poolCode = "HAD") {
  const rows = Array.isArray(oddsList) ? oddsList : [];
  const row = rows.find((item) => String(item?.poolCode || "").toUpperCase() === poolCode) || {};
  return sanitizeOdds({ home: row.h, draw: row.d, away: row.a });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const data = await res.json();
  if (data?.success === false) throw new Error(`sporttery_api_${data.errorCode || "unknown"}:${data.errorMessage || ""}`);
  return data;
}

function sportteryHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Referer: "https://m.sporttery.cn/mjc/zqsj/",
    Origin: "https://m.sporttery.cn",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
  };
}

async function fetchSportteryPayload() {
  const errors = [];
  for (const url of sourceUrls) {
    try {
      const payload = await fetchJson(url, { headers: sportteryHeaders() });
      const count = payload?.value?.totalCount || payload?.value?.matchInfoList?.reduce((sum, day) => sum + (day.subMatchList?.length || 0), 0) || 0;
      if (count > 0) {
        console.log(`Sporttery source ok: ${url} (${count} matches)`);
        return { payload, sourceUrl: url };
      }
      errors.push(`${url} -> empty`);
    } catch (error) {
      errors.push(`${url} -> ${error.message || error}`);
    }
  }
  throw new Error(`All Sporttery sources failed: ${errors.join(" | ")}`);
}

function mapSportteryMatch(row) {
  return {
    id: `sporttery-${row.matchId}`,
    sourceId: String(row.matchId || ""),
    source: "sporttery-webapi",
    sourceMethod: "cloud-current",
    matchNumStr: normText(row.matchNumStr),
    leagueCode: String(row.leagueId || ""),
    league: normText(row.leagueAbbName || row.leagueAllName, "未知联赛"),
    competition: normText(row.leagueAllName || row.leagueAbbName, "足球赛事"),
    round: normText(row.matchNumStr),
    datetime: parseDateTime(row.matchDate, row.matchTime),
    venue: "官方未提供",
    city: "",
    status: toStatusBucket(row.matchStatus, row.sellStatus),
    statusCode: String(row.sellStatus || row.matchStatus || ""),
    statusName: statusName(row.matchStatus, row.sellStatus),
    home: {
      id: String(row.homeTeamId || ""),
      name: normText(row.homeTeamAllName || row.homeTeamAbbName, "主队"),
      short: toShortName(row.homeTeamAbbName || row.homeTeamAllName || "主队"),
      color: "#2B68FF",
      rank: null,
    },
    away: {
      id: String(row.awayTeamId || ""),
      name: normText(row.awayTeamAllName || row.awayTeamAbbName, "客队"),
      short: toShortName(row.awayTeamAbbName || row.awayTeamAllName || "客队"),
      color: "#F93A4A",
      rank: null,
    },
    odds: { oneXTwo: oddsFromList(row.oddsList, "HAD") },
    score: { fullTime: { home: null, away: null } },
  };
}

function flatten(payload) {
  const days = payload?.value?.matchInfoList || [];
  const matches = [];
  for (const day of days) {
    for (const row of day.subMatchList || []) matches.push(mapSportteryMatch(row));
  }
  return matches.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

async function main() {
  if (!targetBase || !/^https?:\/\//.test(targetBase)) throw new Error("Set RENDER_BASE_URL.");
  if (!token) throw new Error("Set ADMIN_SYNC_TOKEN.");

  const { payload, sourceUrl } = await fetchSportteryPayload();
  const matches = flatten(payload);
  if (!matches.length) throw new Error("Sporttery returned no matches.");

  const snapshot = {
    source: sourceUrl === SPORTTERY_URL ? "sporttery-cloud-sync" : "sporttery-cloud-sync-proxy",
    updatedAt: new Date().toISOString(),
    matches,
    analysisById: {},
    news: [],
  };

  const res = await fetchJson(`${targetBase.replace(/\/$/, "")}/api/admin/snapshot-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(snapshot),
  });
  console.log(JSON.stringify({ imported: matches.length, render: res }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
