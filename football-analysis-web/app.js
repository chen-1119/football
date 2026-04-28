const ANALYSIS_BY_MATCH = {};
const FALLBACK_LEAGUES = ["ALL"];
const FALLBACK_MATCHES = [];

const STORAGE_KEYS = {
  favorites: "football_dashboard_favorites",
  history: "football_dashboard_history",
  prefs: "football_dashboard_prefs_v2",
};

const MODEL_TABS = [
  { key: "jy-recommend", label: "骄英推荐" },
  { key: "recommend", label: "推荐模型" },
  { key: "mine", label: "我的模型" },
  { key: "diff", label: "差异分析" },
];

const ANALYSIS_TABS = [
  { key: "fundamentals", label: "球队基本面", subTabs: ["history", "attackDefense", "squad"] },
  { key: "tactical", label: "情境与战术", subTabs: ["tactical", "environment", "h2h"] },
  { key: "market", label: "外部与市场", subTabs: ["psychology", "odds"] },
  { key: "model", label: "综合预测模型", subTabs: ["factors", "weights", "output", "kelly"] },
];

const TAB_LABELS = {
  history: "历史表现",
  attackDefense: "进攻与防守",
  squad: "人员与阵容",
  tactical: "战术风格匹配",
  environment: "比赛环境",
  h2h: "历史交锋",
  psychology: "心理与热度",
  odds: "赔率分析",
  factors: "因素量化",
  weights: "权重分配",
  output: "模型输出",
  kelly: "边际价值",
};

const STRATEGY_DEFS = [
  { id: "corners-over-8.5", name: "大角8.5（保守版）", support: "unsupported", reason: "当前官方接口暂无角球数据" },
  { id: "first-half-goal", name: "上半场有球", support: "unsupported", reason: "当前官方接口暂无半场进球拆分数据" },
  { id: "home-not-lose", name: "主不败", support: "full", reason: "" },
  { id: "away-not-lose", name: "客不败", support: "full", reason: "" },
  { id: "reverse-0-1", name: "0-1反波胆", support: "full", reason: "" },
  { id: "reverse-0-2", name: "0-2反波胆", support: "full", reason: "" },
  { id: "at-least-2-goals", name: "至少进2球", support: "full", reason: "" },
  { id: "second-half-goal", name: "下半场有进球", support: "unsupported", reason: "当前官方接口暂无下半场进球拆分数据" },
  { id: "exclude-0-0-a", name: "0-0排除模型推荐一", support: "full", reason: "" },
  { id: "exclude-0-0-b", name: "0-0排除模型推荐二", support: "full", reason: "" },
  { id: "second-half-corner-chase", name: "下半场追角球", support: "unsupported", reason: "当前官方接口暂无下半场角球数据" },
  { id: "second-half-card-chase", name: "下半场追牌", support: "unsupported", reason: "当前官方接口暂无下半场牌数数据" },
];

const STATUS_MAP = {
  ALL: "全部",
  SELL: "已开售",
  LIVE: "进行中",
  RESULT: "已完场",
  WAIT: "未开赛",
};

const app = document.querySelector("#app");
const themeToggle = document.querySelector("#theme-toggle");
const API_BASE = window.location.protocol === "file:" ? localStorage.getItem("football_api_base") || "http://127.0.0.1:8787" : "";
const AI_FEATURE_ENABLED = false;
const SEARCH_PAGE_SIZE = 50;

const state = {
  page: "home",
  matches: FALLBACK_MATCHES,
  leagues: ["全部", ...FALLBACK_LEAGUES.filter((x) => x !== "全部")],
  news: [],
  analysisById: { ...ANALYSIS_BY_MATCH },
  selectedMatchId: FALLBACK_MATCHES[0]?.id || "",
  source: "fallback-mock",
  updatedAt: null,
  scheduler: null,
  loading: false,
  matchTab: "live",
  matchLeague: "全部",
  searchQuery: "",
  searchStatus: "ALL",
  searchDateFrom: "",
  searchDateTo: "",
  searchPage: 1,
  searchTotal: 0,
  searchTotalPages: 0,
  searchResults: [],
  searchLoading: false,
  modelTab: "jy-recommend",
  aiCatalog: null,
  selectedModelId: "",
  selectedScenarioId: "deep",
  estimate: null,
  estimateInputTokens: 8800,
  estimateOutputTokens: 3200,
  estimateCalls: 1,
  aiPromptTemplateId: "",
  aiPrompt: "",
  aiOutput: "",
  aiLoading: false,
  matchAiPredictions: {},
  matchAiLoading: {},
  matchAiError: {},
  mainTab: "fundamentals",
  subTabs: {
    fundamentals: "history",
    tactical: "tactical",
    market: "psychology",
    model: "factors",
  },
  favorites: new Set(loadJson(STORAGE_KEYS.favorites, [])),
  history: loadJson(STORAGE_KEYS.history, []),
  prefs: {
    theme: "light",
    defaultLeague: "全部",
    ...loadJson(STORAGE_KEYS.prefs, {}),
  },
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

document.body.dataset.theme = state.prefs.theme;
state.matchLeague = state.prefs.defaultLeague || "全部";

function fmtDate(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function pct(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return "--";
  return `${Math.round(v * 100)}%`;
}

function statusLabel(match) {
  return STATUS_MAP[match.status] || match.statusName || "未开赛";
}

function oddsText(odds, matchStatus = "") {
  if (!odds || !odds.home || !odds.draw || !odds.away) {
    if (matchStatus === "WAIT") return "待开售，暂无赔率";
    if (matchStatus === "SELL") return "已开售，赔率待更新";
    return "官方未提供";
  }
  return `${odds.home} / ${odds.draw} / ${odds.away}`;
}

function getMatchById(id) {
  return state.matches.find((m) => m.id === id) || null;
}

function addHistory(matchId) {
  state.history = [matchId, ...state.history.filter((id) => id !== matchId)].slice(0, 16);
  saveJson(STORAGE_KEYS.history, state.history);
}

function safeProbabilityFromOdds(match) {
  const odds = match?.odds?.oneXTwo;
  if (!odds || !odds.home || !odds.draw || !odds.away) return { home: 0.36, draw: 0.29, away: 0.35 };
  const invH = 1 / odds.home;
  const invD = 1 / odds.draw;
  const invA = 1 / odds.away;
  const total = invH + invD + invA;
  if (!total) return { home: 0.36, draw: 0.29, away: 0.35 };
  return { home: invH / total, draw: invD / total, away: invA / total };
}

function derivedMetrics(match, analysisRaw) {
  const analysis = normalizeAnalysis(analysisRaw);
  const p = analysis.prediction?.probabilities || safeProbabilityFromOdds(match);
  const lambdaHome = Number(analysis.prediction?.poissonLambda?.home || 1.2);
  const lambdaAway = Number(analysis.prediction?.poissonLambda?.away || 1.1);
  const btts = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));
  const totalLambda = lambdaHome + lambdaAway;
  const p0 = Math.exp(-totalLambda);
  const p1 = totalLambda * Math.exp(-totalLambda);
  const p2 = (Math.pow(totalLambda, 2) / 2) * Math.exp(-totalLambda);
  const o25 = Math.max(0, Math.min(1, 1 - (p0 + p1 + p2)));
  return {
    home: p.home,
    draw: p.draw,
    away: p.away,
    btts,
    o25,
    score: analysis.prediction?.conclusion?.predictedScore || "-",
  };
}

function scoreText(match) {
  const h = match?.score?.fullTime?.home;
  const a = match?.score?.fullTime?.away;
  if (Number.isFinite(h) && Number.isFinite(a)) return `${h} - ${a}`;
  return "VS";
}

function updateBottomNav() {
  const page = state.page === "analysis" ? "matches" : state.page;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.page === page);
  });
}

function statusLine() {
  const refresh = state.scheduler?.refreshMinutes ?? 5;
  return `
    <div class="status-line">
      <span>数据源：${state.source}</span>
      <span>更新时间：${fmtDate(state.updatedAt)}</span>
      <span>同步周期：${refresh} 分钟</span>
    </div>
  `;
}

function matchFilterForTab(tab) {
  if (tab === "live") return (m) => m.status === "LIVE" || m.status === "SELL";
  if (tab === "result") return (m) => m.status === "RESULT";
  if (tab === "schedule") return (m) => m.status === "WAIT";
  return () => true;
}

function topFocusMatches() {
  const list = [...state.matches];
  list.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  return list.slice(0, 8);
}

function renderHomePage() {
  const focus = topFocusMatches();
  const liveCount = state.matches.filter((m) => m.status === "LIVE").length;
  const resultCount = state.matches.filter((m) => m.status === "RESULT").length;

  const focusCards = focus.slice(0, 4).map((match) => {
    const d = derivedMetrics(match, state.analysisById[match.id]);
    return `
      <article class="focus-card" data-action="open-analysis" data-match-id="${match.id}">
        <div class="focus-top">
          <span>${fmtDate(match.datetime)}</span>
          <span class="pill">${statusLabel(match)}</span>
        </div>
        <div class="focus-main">
          <strong>${match.home.name}</strong>
          <strong class="score">${scoreText(match)}</strong>
          <strong>${match.away.name}</strong>
        </div>
        <div class="probability-bar">
          <span style="width:${Math.round(d.home * 100)}%" class="home"></span>
          <span style="width:${Math.round(d.draw * 100)}%" class="draw"></span>
          <span style="width:${Math.round(d.away * 100)}%" class="away"></span>
        </div>
      </article>
    `;
  });

  const aiCards = focus.slice(0, 6).map((match) => {
    const d = derivedMetrics(match, state.analysisById[match.id]);
    return `
      <article class="mini-match-card">
        <div class="mini-head"><span>${match.league}</span><span>${fmtDate(match.datetime)}</span></div>
        <h4>${match.home.short} vs ${match.away.short}</h4>
        <p>AI 概率：主胜 ${pct(d.home)} / 平 ${pct(d.draw)} / 客胜 ${pct(d.away)}</p>
        <div class="card-row">
          <button class="action-btn" data-action="open-analysis" data-match-id="${match.id}" type="button">查看分析</button>
          <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${state.favorites.has(match.id) ? "取消关注" : "关注"}</button>
        </div>
      </article>
    `;
  });

  const marketCards = focus.slice(0, 4).map((match) => {
    const d = derivedMetrics(match, state.analysisById[match.id]);
    return `
      <article class="market-card" data-action="open-analysis" data-match-id="${match.id}">
        <div class="mini-head"><span>${match.home.short} vs ${match.away.short}</span><span>${statusLabel(match)}</span></div>
        <div class="market-values">
          <span class="tag">BTTS ${Math.round(d.btts * 100)}%</span>
          <span class="tag">O2.5 ${Math.round(d.o25 * 100)}%</span>
          <span class="tag">比分 ${d.score}</span>
        </div>
      </article>
    `;
  });

  const newsHtml = state.news.length
    ? state.news
        .slice(0, 6)
        .map(
          (item) => `
          <a class="news-row" href="${item.url}" target="_blank" rel="noreferrer">
            <strong>${item.title}</strong>
            <span>${item.date || "--"}</span>
          </a>
        `
        )
        .join("")
    : '<p class="empty-tip">暂无官方资讯</p>';

  return `
    <section class="hero-panel">
      <div class="hero-title">
        <h2>今日焦点</h2>
        <p>今日：${state.matches.length} 场 | 进行中 ${liveCount} 场 | 已完场 ${resultCount} 场</p>
      </div>
      <div class="focus-grid">
        ${focusCards.join("") || '<p class="empty-tip">暂无赛事</p>'}
      </div>
    </section>

    <section class="soft-panel panel-blue">
      <div class="section-head">
        <h3>AI分析</h3>
        <button class="text-btn" data-action="nav" data-page="models" type="button">进入模型页</button>
      </div>
      <p class="section-desc">查看带 AI 标签的比赛，体验基于数据的结构化解读</p>
      <div class="mini-grid">${aiCards.join("")}</div>
    </section>

    <section class="soft-panel panel-cyan">
      <div class="section-head"><h3>BTTS / Over2.5 热门场次</h3></div>
      <div class="market-grid">${marketCards.join("")}</div>
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>中国体育彩票资讯</h3></div>
      ${newsHtml}
    </section>

    <section class="note-panel">
      ${statusLine()}
      <p>说明：页面只做数据分析，不提供任何投注入口或建议。</p>
    </section>
  `;
}

function strategyDataByModel() {
  const modelSeed = state.selectedModelId || "default-model";
  return STRATEGY_NAMES.map((name, idx) => {
    const base = seedVal(`${modelSeed}-${name}`, 55, 94);
    const weekHit = seedVal(`${name}-week-hit`, 6, 90);
    const weekRec = seedVal(`${name}-week-rec`, weekHit + 1, weekHit + 18);
    const monthHit = seedVal(`${name}-month-hit`, 20, 700);
    const monthRec = seedVal(`${name}-month-rec`, monthHit + 5, monthHit + 220);
    const allHit = seedVal(`${name}-all-hit`, 120, 9000);
    const allRec = seedVal(`${name}-all-rec`, allHit + 20, allHit + 2800);
    return {
      name,
      tone: (idx % 5) + 1,
      week: { rate: Math.max(48, Math.min(98, base - 4 + (idx % 7))), rec: weekRec, hit: weekHit },
      month: { rate: Math.max(52, Math.min(99, base + (idx % 6) - 1)), rec: monthRec, hit: monthHit },
      all: { rate: Math.max(50, Math.min(99, base + 1)), rec: allRec, hit: allHit },
    };
  });
}

function renderGauge(title, rate, rec, hit, dateLabel) {
  const fail = Math.max(0, rec - hit);
  return `
    <article class="gauge-card">
      <h5>${title}</h5>
      <div class="gauge" style="--value:${Math.max(0, Math.min(100, rate))};">
        <div class="gauge-inner">${rate}%</div>
      </div>
      <div class="gauge-stat">推荐 ${rec}场</div>
      <div class="gauge-stat good">成功 ${hit}场</div>
      <div class="gauge-stat bad">失误 ${fail}场</div>
      <div class="gauge-date">${dateLabel}</div>
    </article>
  `;
}

function renderModelPage() {
  const catalog = state.aiCatalog;
  if (!catalog) return '<section class="soft-panel"><p class="empty-tip">正在加载模型目录...</p></section>';

  const selectedModel = catalog.models.find((m) => m.id === state.selectedModelId) || catalog.models[0];
  const strategies = strategyDataByModel();
  const tabs = MODEL_TABS.map(
    (tab) => `<button class="tab-btn ${tab.key === state.modelTab ? "is-active" : ""}" data-action="model-tab" data-model-tab="${tab.key}" type="button">${tab.label}</button>`
  ).join("");

  const providers = catalog.providers
    .map(
      (p) => `
      <div class="provider-chip ${p.enabled ? "ok" : "off"}">
        <strong>${p.name}</strong>
        <span>${p.enabled ? "已配置" : `未配置 ${p.envKey}`}</span>
      </div>
    `
    )
    .join("");

  const estimate = state.estimate;
  const estimateHtml = estimate
    ? `
      <div class="estimate-grid">
        <div><span>API 成本</span><strong>$${estimate.apiCostUsd}</strong></div>
        <div><span>成本折合</span><strong>¥${estimate.apiCostCny}</strong></div>
        <div><span>建议售价</span><strong>¥${estimate.suggestedPriceCny}</strong></div>
        <div><span>毛利率估算</span><strong>${estimate.grossMarginEstimate}%</strong></div>
      </div>
    `
    : '<p class="muted">暂无价格估算</p>';

  const templateRows = (catalog.promptTemplates || [])
    .map(
      (item) => `
      <article class="template-row">
        <div>
          <h5>${item.name}</h5>
          <p>${item.prompt}</p>
        </div>
        <button class="ghost-btn" data-action="use-template" data-template-id="${item.id}" type="button">填入输入框</button>
      </article>
    `
    )
    .join("");

  let strategyHtml = "";
  if (state.modelTab === "diff") {
    const peer = catalog.models.find((m) => m.id !== selectedModel.id) || selectedModel;
    strategyHtml = `
      <section class="soft-panel panel-cream">
        <div class="section-head"><h3>模型差异（${selectedModel.name} vs ${peer.name}）</h3></div>
        <div class="mini-grid">
          <article class="mini-match-card"><h4>输入单价对比</h4><p>${selectedModel.inputUsdPerMTok} vs ${peer.inputUsdPerMTok} USD/MTok</p></article>
          <article class="mini-match-card"><h4>输出单价对比</h4><p>${selectedModel.outputUsdPerMTok} vs ${peer.outputUsdPerMTok} USD/MTok</p></article>
          <article class="mini-match-card"><h4>适用策略</h4><p>${selectedModel.tier}模型适合深度赛前分析，轻量模型适合高频快评。</p></article>
        </div>
      </section>
    `;
  } else {
    const limit = state.modelTab === "mine" ? 5 : 8;
    strategyHtml = strategies
      .slice(0, limit)
      .map(
        (item) => `
        <section class="strategy-panel tone-${item.tone}">
          <div class="section-head">
            <h3>${item.name}</h3>
            <button class="action-btn" type="button">匹配参数</button>
          </div>
          <div class="gauge-row">
            ${renderGauge("本周成绩", item.week.rate, item.week.rec, item.week.hit, "自2026年04月20日")}
            ${renderGauge("本月成绩", item.month.rate, item.month.rec, item.month.hit, "自2026年04月01日")}
            ${renderGauge("历史成绩", item.all.rate, item.all.rec, item.all.hit, "自2025年04月15日")}
          </div>
        </section>
      `
      )
      .join("");
  }

  return `
    <section class="soft-panel panel-lavender">
      <div class="section-head"><h2>模型中心</h2></div>
      <div class="provider-grid">${providers}</div>
      <div class="controls-row">
        <label>模型选择
          <select id="model-select">
            ${catalog.models
              .map((m) => `<option value="${m.id}" ${m.id === selectedModel.id ? "selected" : ""}>${m.name}（${m.provider}）</option>`)
              .join("")}
          </select>
        </label>
        <label>定价方案
          <select id="scenario-select">
            ${(catalog.pricingScenarios || [])
              .map((s) => `<option value="${s.id}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${s.name}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <div class="tab-row">${tabs}</div>
    </section>

    ${strategyHtml}

    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>API 成本定价</h3></div>
      <div class="controls-row cost-inputs">
        <label>输入 Token
          <input id="estimate-input-tokens" type="number" min="1" value="${state.estimateInputTokens}" />
        </label>
        <label>输出 Token
          <input id="estimate-output-tokens" type="number" min="1" value="${state.estimateOutputTokens}" />
        </label>
        <label>调用次数
          <input id="estimate-calls" type="number" min="1" value="${state.estimateCalls}" />
        </label>
      </div>
      ${estimateHtml}
      <div class="source-links">
        ${(catalog.pricingSources || [])
          .map((source) => `<a href="${source.url}" target="_blank" rel="noreferrer">${source.provider} 价格页（核对日 ${source.checkedAt}）</a>`)
          .join("")}
      </div>
    </section>

    <section class="soft-panel panel-cyan">
      <div class="section-head"><h3>PRD 专业提示词模板</h3></div>
      ${templateRows}
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>多模型调用测试（可选）</h3></div>
      <textarea id="ai-prompt-input" class="prompt-input" placeholder="输入分析问题，例如：基于当前赛程给出五大联赛今日重点场次的风险分层">${state.aiPrompt}</textarea>
      <div class="card-row">
        <button class="action-btn" data-action="run-ai" type="button" ${state.aiLoading ? "disabled" : ""}>${state.aiLoading ? "调用中..." : "调用模型"}</button>
        <span class="muted">未配置 Key 时会返回 provider_not_configured</span>
      </div>
      <pre class="ai-output">${state.aiOutput || "尚未调用"}</pre>
    </section>
  `;
}

function getFinalScore(match) {
  const h = Number(match?.score?.fullTime?.home);
  const a = Number(match?.score?.fullTime?.away);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: h, away: a, total: h + a };
}

function isResultMatch(match) {
  return match?.status === "RESULT" && getFinalScore(match);
}

function evaluateStrategyByMatch(strategyId, match, metrics, analysis) {
  const unsupported = STRATEGY_DEFS.find((x) => x.id === strategyId)?.support !== "full";
  if (unsupported) return { supported: false, recommended: false, hit: false };

  const score = getFinalScore(match);
  const totalLambda = Number(analysis?.prediction?.poissonLambda?.home || 1) + Number(analysis?.prediction?.poissonLambda?.away || 1);

  let recommended = false;
  let hit = false;

  if (strategyId === "home-not-lose") {
    recommended = metrics.home + metrics.draw >= 0.62;
    hit = Boolean(score && score.home >= score.away);
  } else if (strategyId === "away-not-lose") {
    recommended = metrics.away + metrics.draw >= 0.62;
    hit = Boolean(score && score.away >= score.home);
  } else if (strategyId === "reverse-0-1") {
    recommended = metrics.away >= 0.4 && metrics.home <= 0.33;
    hit = Boolean(score && score.home === 0 && score.away === 1);
  } else if (strategyId === "reverse-0-2") {
    recommended = metrics.away >= 0.5 && metrics.home <= 0.28;
    hit = Boolean(score && score.home === 0 && score.away === 2);
  } else if (strategyId === "at-least-2-goals") {
    recommended = metrics.o25 >= 0.58 || totalLambda >= 2.4;
    hit = Boolean(score && score.total >= 2);
  } else if (strategyId === "exclude-0-0-a") {
    recommended = metrics.o25 >= 0.54 && metrics.btts >= 0.45;
    hit = Boolean(score && !(score.home === 0 && score.away === 0));
  } else if (strategyId === "exclude-0-0-b") {
    recommended = metrics.o25 >= 0.62 || Math.max(metrics.home, metrics.away) >= 0.46;
    hit = Boolean(score && !(score.home === 0 && score.away === 0));
  }

  return { supported: true, recommended, hit };
}

function summarizeStrategyWindow(evaluations, days = null) {
  const now = Date.now();
  const inWindow = evaluations.filter((item) => {
    if (!item.isResult) return false;
    if (days == null) return true;
    return now - item.kickoffTs <= days * 24 * 60 * 60 * 1000;
  });
  const rec = inWindow.filter((item) => item.recommended).length;
  const hit = inWindow.filter((item) => item.recommended && item.hit).length;
  const miss = Math.max(0, rec - hit);
  const rate = rec ? Math.round((hit / rec) * 100) : null;
  return { rec, hit, miss, rate };
}

function buildStrategyStats() {
  return STRATEGY_DEFS.map((def, idx) => {
    const evaluations = state.matches.map((match) => {
      const analysis = normalizeAnalysis(state.analysisById[match.id]);
      const metrics = derivedMetrics(match, analysis);
      const result = evaluateStrategyByMatch(def.id, match, metrics, analysis);
      return {
        match,
        metrics,
        supported: result.supported,
        recommended: result.recommended,
        hit: result.hit,
        isResult: Boolean(isResultMatch(match)),
        kickoffTs: new Date(match.datetime).getTime() || 0,
      };
    });

    const upcoming = evaluations
      .filter((item) => item.supported && item.recommended && item.match.status !== "RESULT")
      .sort((a, b) => new Date(a.match.datetime) - new Date(b.match.datetime))
      .slice(0, 3)
      .map((item) => ({
        id: item.match.id,
        league: item.match.league,
        time: fmtDate(item.match.datetime),
        pair: `${item.match.home.name} vs ${item.match.away.name}`,
      }));

    return {
      id: def.id,
      name: def.name,
      support: def.support,
      reason: def.reason,
      tone: (idx % 5) + 1,
      week: summarizeStrategyWindow(evaluations, 7),
      month: summarizeStrategyWindow(evaluations, 30),
      all: summarizeStrategyWindow(evaluations, null),
      upcoming,
    };
  });
}

function renderGauge(title, stat, dateLabel) {
  const hasSample = stat.rec > 0 && stat.rate !== null;
  const value = hasSample ? stat.rate : 0;
  const rateText = hasSample ? `${stat.rate}%` : "--";
  return `
    <article class="gauge-card">
      <h5>${title}</h5>
      <div class="gauge" style="--value:${Math.max(0, Math.min(100, value))};">
        <div class="gauge-inner">${rateText}</div>
      </div>
      <div class="gauge-stat">推荐 ${stat.rec}场</div>
      <div class="gauge-stat good">成功 ${stat.hit}场</div>
      <div class="gauge-stat bad">失误 ${stat.miss}场</div>
      <div class="gauge-date">${dateLabel}</div>
    </article>
  `;
}

function renderStrategySection(item) {
  const unsupportedTip =
    item.support !== "full" ? `<p class="muted">数据状态：${item.reason}</p>` : `<p class="muted">数据状态：基于体彩实盘赛果实时统计</p>`;
  const upcomingHtml = item.upcoming.length
    ? item.upcoming
        .map(
          (x) => `
      <button class="history-row" data-action="open-analysis" data-match-id="${x.id}" type="button">
        <strong>${x.pair}</strong>
        <span>${x.league} · ${x.time}</span>
      </button>
    `
        )
        .join("")
    : '<p class="empty-tip">暂无满足条件的待开赛场次</p>';

  return `
    <section class="strategy-panel tone-${item.tone}">
      <div class="section-head">
        <h3>${item.name}</h3>
        <span class="tag">${item.support === "full" ? "实盘统计" : "数据受限"}</span>
      </div>
      ${unsupportedTip}
      <div class="gauge-row">
        ${renderGauge("近7天", item.week, "已完场样本")}
        ${renderGauge("近30天", item.month, "已完场样本")}
        ${renderGauge("历史", item.all, "当前拉取范围")}
      </div>
      <div class="news-list">${upcomingHtml}</div>
    </section>
  `;
}

function renderModelPage() {
  const catalog = state.aiCatalog;
  if (!catalog) return '<section class="soft-panel"><p class="empty-tip">正在加载模型目录...</p></section>';

  const selectedModel = catalog.models.find((m) => m.id === state.selectedModelId) || catalog.models[0];
  const strategyStats = buildStrategyStats();
  const tabs = MODEL_TABS.map(
    (tab) => `<button class="tab-btn ${tab.key === state.modelTab ? "is-active" : ""}" data-action="model-tab" data-model-tab="${tab.key}" type="button">${tab.label}</button>`
  ).join("");

  const providers = catalog.providers
    .map(
      (p) => `
      <div class="provider-chip ${p.enabled ? "ok" : "off"}">
        <strong>${p.name}</strong>
        <span>${p.enabled ? "已配置" : `未配置 ${p.envKey}`}</span>
      </div>
    `
    )
    .join("");

  const estimate = state.estimate;
  const estimateHtml = estimate
    ? `
      <div class="estimate-grid">
        <div><span>API 成本</span><strong>$${estimate.apiCostUsd}</strong></div>
        <div><span>成本折合</span><strong>¥${estimate.apiCostCny}</strong></div>
        <div><span>建议售价</span><strong>¥${estimate.suggestedPriceCny}</strong></div>
        <div><span>毛利率估算</span><strong>${estimate.grossMarginEstimate}%</strong></div>
      </div>
    `
    : '<p class="muted">暂无价格估算</p>';

  const templateRows = (catalog.promptTemplates || [])
    .map(
      (item) => `
      <article class="template-row">
        <div>
          <h5>${item.name}</h5>
          <p>${item.prompt}</p>
        </div>
        <button class="ghost-btn" data-action="use-template" data-template-id="${item.id}" type="button">填入输入框</button>
      </article>
    `
    )
    .join("");

  let strategyHtml = "";
  if (state.modelTab === "diff") {
    const peer = catalog.models.find((m) => m.id !== selectedModel.id) || selectedModel;
    const supported = strategyStats.filter((x) => x.support === "full");
    const best = [...supported].sort((a, b) => (b.all.rate || 0) - (a.all.rate || 0))[0];
    strategyHtml = `
      <section class="soft-panel panel-cream">
        <div class="section-head"><h3>模型差异（${selectedModel.name} vs ${peer.name}）</h3></div>
        <div class="mini-grid">
          <article class="mini-match-card"><h4>输入单价</h4><p>${selectedModel.inputUsdPerMTok} vs ${peer.inputUsdPerMTok} USD / MTok</p></article>
          <article class="mini-match-card"><h4>输出单价</h4><p>${selectedModel.outputUsdPerMTok} vs ${peer.outputUsdPerMTok} USD / MTok</p></article>
          <article class="mini-match-card"><h4>当前实盘最佳策略</h4><p>${best ? `${best.name}（命中率 ${best.all.rate ?? "--"}%）` : "样本不足"}</p></article>
        </div>
      </section>
    `;
  } else {
    let list = strategyStats;
    if (state.modelTab === "jy-recommend") {
      list = [...strategyStats].sort((a, b) => (b.all.rate || 0) - (a.all.rate || 0)).slice(0, 8);
    } else if (state.modelTab === "mine") {
      list = strategyStats
        .filter((x) => x.support === "full" && x.all.rec >= 3)
        .sort((a, b) => (b.month.rate || 0) - (a.month.rate || 0))
        .slice(0, 5);
      if (!list.length) list = strategyStats.filter((x) => x.support === "full").slice(0, 5);
    }
    strategyHtml = list.map(renderStrategySection).join("");
  }

  return `
    <section class="soft-panel panel-lavender">
      <div class="section-head"><h2>模型中心</h2></div>
      <div class="provider-grid">${providers}</div>
      <div class="controls-row">
        <label>模型选择
          <select id="model-select">
            ${catalog.models
              .map((m) => `<option value="${m.id}" ${m.id === selectedModel.id ? "selected" : ""}>${m.name}（${m.provider}）</option>`)
              .join("")}
          </select>
        </label>
        <label>定价方案
          <select id="scenario-select">
            ${(catalog.pricingScenarios || [])
              .map((s) => `<option value="${s.id}" ${s.id === state.selectedScenarioId ? "selected" : ""}>${s.name}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <div class="tab-row">${tabs}</div>
      <p class="muted">命中率仅统计已完场真实赛果；官方接口缺失的数据会标记为受限。</p>
    </section>

    ${strategyHtml}

    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>API 成本定价</h3></div>
      <div class="controls-row cost-inputs">
        <label>输入 Token
          <input id="estimate-input-tokens" type="number" min="1" value="${state.estimateInputTokens}" />
        </label>
        <label>输出 Token
          <input id="estimate-output-tokens" type="number" min="1" value="${state.estimateOutputTokens}" />
        </label>
        <label>调用次数
          <input id="estimate-calls" type="number" min="1" value="${state.estimateCalls}" />
        </label>
      </div>
      ${estimateHtml}
      <div class="source-links">
        ${(catalog.pricingSources || [])
          .map((source) => `<a href="${source.url}" target="_blank" rel="noreferrer">${source.provider} 价格页（核对日 ${source.checkedAt}）</a>`)
          .join("")}
      </div>
    </section>

    <section class="soft-panel panel-cyan">
      <div class="section-head"><h3>PRD 专业提示词模板</h3></div>
      ${templateRows}
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>多模型调用测试（可选）</h3></div>
      <textarea id="ai-prompt-input" class="prompt-input" placeholder="输入分析问题，例如：基于当前赛程给出重点场次的风险分层">${state.aiPrompt}</textarea>
      <div class="card-row">
        <button class="action-btn" data-action="run-ai" type="button" ${state.aiLoading ? "disabled" : ""}>${state.aiLoading ? "调用中..." : "调用模型"}</button>
        <span class="muted">未配置 Key 时会返回 provider_not_configured</span>
      </div>
      <pre class="ai-output">${state.aiOutput || "尚未调用"}</pre>
    </section>
  `;
}

function renderMatchCard(match) {
  const metrics = derivedMetrics(match, state.analysisById[match.id]);
  const fav = state.favorites.has(match.id);
  return `
    <article class="match-row-card">
      <div class="match-row-top">
        <span>${match.league}</span>
        <span>${fmtDate(match.datetime)}</span>
      </div>
      <div class="match-row-main">
        <strong>${match.home.name}</strong>
        <span class="status-pill">${statusLabel(match)}</span>
        <strong>${match.away.name}</strong>
      </div>
      <div class="match-row-tags">
        <span class="tag">${match.matchNumStr || "竞彩"}</span>
        <span class="tag">BTTS ${Math.round(metrics.btts * 100)}%</span>
        <span class="tag">O2.5 ${Math.round(metrics.o25 * 100)}%</span>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="open-analysis" data-match-id="${match.id}" type="button">分析</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${fav ? "取消关注" : "关注"}</button>
      </div>
    </article>
  `;
}

function renderMatchesPage() {
  const tabFilters = [
    { key: "live", label: "即时" },
    { key: "result", label: "完场" },
    { key: "schedule", label: "赛程" },
  ];

  const matches = state.matches
    .filter(matchFilterForTab(state.matchTab))
    .filter((m) => state.matchLeague === "全部" || m.league === state.matchLeague)
    .slice(0, 1200);

  return `
    <section class="soft-panel panel-lavender">
      <div class="tab-row">
        ${tabFilters
          .map((item) => `<button class="tab-btn ${item.key === state.matchTab ? "is-active" : ""}" data-action="match-tab" data-match-tab="${item.key}" type="button">${item.label}</button>`)
          .join("")}
      </div>
      <div class="controls-row">
        <label>联赛筛选
          <select id="match-league-select">
            ${state.leagues.map((l) => `<option value="${l}" ${l === state.matchLeague ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
      </div>
      ${statusLine()}
    </section>

    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>赛事列表</h3><span class="muted">${matches.length} 场</span></div>
      <div class="match-list">${matches.map(renderMatchCard).join("") || '<p class="empty-tip">暂无赛事</p>'}</div>
    </section>
  `;
}

function renderFavoritesPage() {
  const list = state.matches.filter((m) => state.favorites.has(m.id));
  return `
    <section class="soft-panel panel-cyan">
      <div class="section-head"><h2>我的关注</h2><span class="muted">${list.length} 场</span></div>
      <div class="match-list">${list.map(renderMatchCard).join("") || '<p class="empty-tip">还没有关注的比赛</p>'}</div>
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>最近浏览</h3></div>
      <div class="news-list">
        ${
          state.history
            .map((id) => getMatchById(id))
            .filter(Boolean)
            .map(
              (m) => `
            <button class="history-row" data-action="open-analysis" data-match-id="${m.id}" type="button">
              <strong>${m.home.short} vs ${m.away.short}</strong>
              <span>${m.league} · ${fmtDate(m.datetime)}</span>
            </button>
          `
            )
            .join("") || '<p class="empty-tip">暂无浏览记录</p>'
        }
      </div>
    </section>
  `;
}

function renderSearchPage() {
  const q = state.searchQuery.trim().toLowerCase();
  const list = state.matches.filter((m) => {
    if (!q) return true;
    const text = `${m.league} ${m.competition} ${m.home.name} ${m.away.name} ${m.matchNumStr || ""}`.toLowerCase();
    return text.includes(q);
  });
  return `
    <section class="soft-panel panel-cream">
      <div class="section-head"><h2>搜索</h2></div>
      <input id="search-input" class="search-input" type="search" placeholder="球队 / 联赛 / 竞彩编号" value="${state.searchQuery}" />
      <p class="muted">共 ${list.length} 条结果</p>
      <div class="match-list">${list.slice(0, 80).map(renderMatchCard).join("")}</div>
    </section>
  `;
}

function normalizeAnalysis(raw) {
  const fallback = {
    fundamentals: {
      history: { recentForm: { home: ["W", "D", "W", "L", "W"], away: ["L", "D", "W", "L", "D"] }, standing: { home: {}, away: {} } },
      attackDefense: {
        xg: { home: 1.2, away: 1.1 },
        xga: { home: 1.0, away: 1.1 },
        shots: { home: 11, away: 10 },
        onTarget: { home: 4, away: 3 },
        possession: { home: 52, away: 48 },
        passAccuracy: { home: 84, away: 81 },
      },
      squad: { injuries: { home: [], away: [] }, lineup: { home: "4-3-3", away: "4-2-3-1" } },
    },
    context: {
      tactical: {
        matchup: "双方在中场压迫强度上接近，边路推进效率决定比赛走向。",
        keyDuel: "边锋与边后卫对位",
        styleConflictIndex: 62,
        styleHomeText: "主队偏高位逼抢。",
        styleAwayText: "客队偏稳守反击。",
        conflictAnalysis: "节奏快慢转换是关键。",
      },
      environment: { weather: "官方天气源待接入", fatigue: { home: 42, away: 48 } },
      h2h: { last5: { homeWin: 2, draw: 1, awayWin: 2 }, note: "历史交锋接近，心理优势不明显。" },
    },
    market: {
      psychology: {
        motivation: { home: 78, away: 72 },
        publicSentiment: { home: 56, away: 44 },
        mediaHeat: 68,
        analysisText: "市场关注度略偏主队，需警惕临场波动。",
      },
      odds: { oneXTwo: { home: null, draw: null, away: null }, trend: [] },
    },
    prediction: {
      factors: [
        { name: "近期状态", home: 83, away: 76, weight: 0.2 },
        { name: "攻防质量", home: 79, away: 74, weight: 0.22 },
        { name: "主客场因素", home: 81, away: 69, weight: 0.16 },
        { name: "阵容完整度", home: 75, away: 71, weight: 0.14 },
        { name: "市场强度", home: 70, away: 68, weight: 0.14 },
        { name: "战术匹配", home: 78, away: 73, weight: 0.14 },
      ],
      probabilities: { home: 0.41, draw: 0.3, away: 0.29 },
      poissonLambda: { home: 1.4, away: 1.2 },
      scoreMatrix: [
        { score: "1-0", probability: 0.14 },
        { score: "1-1", probability: 0.13 },
        { score: "2-1", probability: 0.11 },
        { score: "2-0", probability: 0.09 },
      ],
      kelly: [
        { market: "主胜", modelProb: 0.41, impliedProb: 0.37, edge: 0.04, verdict: "value" },
        { market: "平局", modelProb: 0.3, impliedProb: 0.29, edge: 0.01, verdict: "slight-value" },
        { market: "客胜", modelProb: 0.29, impliedProb: 0.34, edge: -0.05, verdict: "no-value" },
      ],
      conclusion: { predictedScore: "1-0", confidence: "medium" },
    },
  };

  return {
    fundamentals: raw?.fundamentals || fallback.fundamentals,
    context: raw?.context || fallback.context,
    market: raw?.market || fallback.market,
    prediction: raw?.prediction || fallback.prediction,
  };
}

function dualBar(label, home, away, suffix = "") {
  const h = Number(home || 0);
  const a = Number(away || 0);
  const total = h + a || 1;
  const hPct = (h / total) * 100;
  const aPct = 100 - hPct;
  return `
    <div class="bar-row">
      <div class="bar-row-head"><span>${label}</span><span>${home ?? "--"}${suffix} / ${away ?? "--"}${suffix}</span></div>
      <div class="dual-bar"><span class="bar-home" style="width:${hPct}%"></span><span class="bar-away" style="width:${aPct}%"></span></div>
    </div>
  `;
}

function formDots(form = []) {
  return form.map((x) => `<span class="form-dot form-dot-${String(x).toLowerCase()}">${x}</span>`).join("");
}

function renderAnalysisContent(analysis, match) {
  if (state.mainTab === "fundamentals") {
    const section = state.subTabs.fundamentals;
    if (section === "history") {
      return `
        <section class="analysis-card">
          <h3>历史表现</h3>
          <div class="two-col">
            <div><p class="muted">${match.home.name}</p><div class="form-track">${formDots(analysis.fundamentals.history.recentForm.home)}</div></div>
            <div><p class="muted">${match.away.name}</p><div class="form-track">${formDots(analysis.fundamentals.history.recentForm.away)}</div></div>
          </div>
          <div class="mini-grid">
            <article class="mini-data"><span>联赛排名</span><strong>${analysis.fundamentals.history.standing.home.rank ?? "-"} / ${analysis.fundamentals.history.standing.away.rank ?? "-"}</strong></article>
            <article class="mini-data"><span>积分</span><strong>${analysis.fundamentals.history.standing.home.points ?? "-"} / ${analysis.fundamentals.history.standing.away.points ?? "-"}</strong></article>
            <article class="mini-data"><span>净胜球</span><strong>${analysis.fundamentals.history.standing.home.goalDiff ?? "-"} / ${analysis.fundamentals.history.standing.away.goalDiff ?? "-"}</strong></article>
          </div>
        </section>
      `;
    }
    if (section === "attackDefense") {
      const ad = analysis.fundamentals.attackDefense;
      return `
        <section class="analysis-card">
          <h3>进攻与防守</h3>
          ${dualBar("xG", ad.xg.home, ad.xg.away)}
          ${dualBar("xGA", ad.xga.home, ad.xga.away)}
          ${dualBar("射门", ad.shots.home, ad.shots.away)}
          ${dualBar("射正", ad.onTarget.home, ad.onTarget.away)}
          ${dualBar("控球率", ad.possession.home, ad.possession.away, "%")}
          ${dualBar("传球成功率", ad.passAccuracy.home, ad.passAccuracy.away, "%")}
        </section>
      `;
    }
    return `
      <section class="analysis-card">
        <h3>人员与阵容</h3>
        <div class="mini-grid">
          <article class="mini-data"><span>主队阵型</span><strong>${analysis.fundamentals.squad.lineup.home || "-"}</strong></article>
          <article class="mini-data"><span>客队阵型</span><strong>${analysis.fundamentals.squad.lineup.away || "-"}</strong></article>
        </div>
        <div class="two-col">
          <div>
            <p class="muted">主队伤停</p>
            ${
              (analysis.fundamentals.squad.injuries.home || [])
                .map((x) => `<div class="list-row"><strong>${x.player || x.playerName || "球员"}</strong><span>${x.issue || "信息待补充"} · ${x.status || "-"}</span></div>`)
                .join("") || '<p class="empty-tip">暂无官方伤停明细</p>'
            }
          </div>
          <div>
            <p class="muted">客队伤停</p>
            ${
              (analysis.fundamentals.squad.injuries.away || [])
                .map((x) => `<div class="list-row"><strong>${x.player || x.playerName || "球员"}</strong><span>${x.issue || "信息待补充"} · ${x.status || "-"}</span></div>`)
                .join("") || '<p class="empty-tip">暂无官方伤停明细</p>'
            }
          </div>
        </div>
      </section>
    `;
  }

  if (state.mainTab === "tactical") {
    const section = state.subTabs.tactical;
    if (section === "tactical") {
      return `
        <section class="analysis-card">
          <h3>战术风格对比</h3>
          <p class="lead">${analysis.context.tactical.matchup}</p>
          <p class="muted">关键对位：${analysis.context.tactical.keyDuel}</p>
          <div class="mini-grid">
            <article class="mini-data"><span>主队倾向</span><p>${analysis.context.tactical.styleHomeText}</p></article>
            <article class="mini-data"><span>客队倾向</span><p>${analysis.context.tactical.styleAwayText}</p></article>
          </div>
          <article class="mini-data"><span>冲突指数</span><strong>${analysis.context.tactical.styleConflictIndex}</strong><p>${analysis.context.tactical.conflictAnalysis}</p></article>
        </section>
      `;
    }
    if (section === "environment") {
      return `
        <section class="analysis-card">
          <h3>比赛环境</h3>
          <div class="mini-grid">
            <article class="mini-data"><span>天气</span><strong>${analysis.context.environment.weather}</strong></article>
            <article class="mini-data"><span>疲劳指数</span><strong>${analysis.context.environment.fatigue.home} / ${analysis.context.environment.fatigue.away}</strong></article>
          </div>
        </section>
      `;
    }
    return `
      <section class="analysis-card">
        <h3>历史交锋</h3>
        <div class="mini-grid">
          <article class="mini-data"><span>主队胜</span><strong>${analysis.context.h2h.last5.homeWin}</strong></article>
          <article class="mini-data"><span>平局</span><strong>${analysis.context.h2h.last5.draw}</strong></article>
          <article class="mini-data"><span>客队胜</span><strong>${analysis.context.h2h.last5.awayWin}</strong></article>
        </div>
        <p class="lead">${analysis.context.h2h.note}</p>
      </section>
    `;
  }

  if (state.mainTab === "market") {
    const section = state.subTabs.market;
    if (section === "psychology") {
      return `
        <section class="analysis-card">
          <h3>心理与热度</h3>
          ${dualBar("战意动机", analysis.market.psychology.motivation.home, analysis.market.psychology.motivation.away)}
          ${dualBar("舆情热度", analysis.market.psychology.publicSentiment.home, analysis.market.psychology.publicSentiment.away)}
          <article class="mini-data"><span>分析解读</span><p>${analysis.market.psychology.analysisText}</p></article>
        </section>
      `;
    }
    return `
      <section class="analysis-card">
        <h3>赔率与市场</h3>
        <article class="mini-data"><span>1X2</span><strong>${oddsText(analysis.market.odds.oneXTwo, match?.status)}</strong></article>
        <div>
          ${
            (analysis.market.odds.trend || [])
              .map((x) => `<div class="list-row"><strong>${x.time}</strong><span>主胜 ${x.home} · 平 ${x.draw} · 客胜 ${x.away}</span></div>`)
              .join("") || '<p class="empty-tip">暂无赔率轨迹</p>'
          }
        </div>
      </section>
    `;
  }

  const section = state.subTabs.model;
  if (section === "factors") {
    return `
      <section class="analysis-card">
        <h3>因素量化</h3>
        ${(analysis.prediction.factors || []).map((factor) => `<div class="factor-item">${dualBar(factor.name, factor.home, factor.away)}</div>`).join("")}
      </section>
    `;
  }
  if (section === "weights") {
    return `
      <section class="analysis-card">
        <h3>权重分配</h3>
        ${(analysis.prediction.factors || []).map((factor) => `<div class="list-row"><strong>${factor.name}</strong><span>${Math.round((factor.weight || 0) * 100)}%</span></div>`).join("")}
      </section>
    `;
  }
  if (section === "output") {
    return `
      <section class="analysis-card">
        <h3>模型输出</h3>
        <div class="mini-grid">
          <article class="mini-data"><span>主胜</span><strong>${pct(analysis.prediction.probabilities.home)}</strong></article>
          <article class="mini-data"><span>平局</span><strong>${pct(analysis.prediction.probabilities.draw)}</strong></article>
          <article class="mini-data"><span>客胜</span><strong>${pct(analysis.prediction.probabilities.away)}</strong></article>
          <article class="mini-data"><span>泊松参数</span><strong>${analysis.prediction.poissonLambda.home} / ${analysis.prediction.poissonLambda.away}</strong></article>
        </div>
        <div class="matrix-grid">
          ${(analysis.prediction.scoreMatrix || []).map((x) => `<article class="matrix-item"><span>${x.score}</span><strong>${pct(x.probability)}</strong></article>`).join("")}
        </div>
      </section>
    `;
  }

  return `
    <section class="analysis-card">
      <h3>边际价值（Kelly）</h3>
      ${(analysis.prediction.kelly || [])
        .map(
          (row) => `
          <div class="list-row">
            <strong>${row.market}</strong>
            <span>模型 ${pct(row.modelProb)} · 市场 ${row.impliedProb == null ? "--" : pct(row.impliedProb)} · Edge ${(Number(row.edge || 0) * 100).toFixed(1)}%</span>
            <em class="tag tag-${row.verdict || "no-value"}">${row.verdict || "no-value"}</em>
          </div>
        `
        )
        .join("")}
    </section>
  `;
}

function renderAnalysisPage() {
  const match = getMatchById(state.selectedMatchId);
  if (!match) return '<section class="soft-panel"><p class="empty-tip">暂无可分析比赛</p></section>';

  const analysis = normalizeAnalysis(state.analysisById[match.id]);
  const tab = ANALYSIS_TABS.find((item) => item.key === state.mainTab) || ANALYSIS_TABS[0];

  return `
    <section class="analysis-hero">
      <div class="analysis-top-row">
        <button class="ghost-btn" data-action="nav" data-page="matches" type="button">返回比赛</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${state.favorites.has(match.id) ? "已关注" : "关注"}</button>
      </div>
      <div class="analysis-header-grid">
        <div>
          <p class="muted">${match.league} · ${match.matchNumStr || ""}</p>
          <h2>${match.home.name} VS ${match.away.name}</h2>
          <p class="muted">${fmtDate(match.datetime)} · ${statusLabel(match)} · ${match.venue || "场地待补充"}</p>
        </div>
        <div class="kpi-row">
          <article class="mini-data"><span>主胜</span><strong>${pct(analysis.prediction.probabilities.home)}</strong></article>
          <article class="mini-data"><span>平局</span><strong>${pct(analysis.prediction.probabilities.draw)}</strong></article>
          <article class="mini-data"><span>客胜</span><strong>${pct(analysis.prediction.probabilities.away)}</strong></article>
          <article class="mini-data"><span>预测比分</span><strong>${analysis.prediction.conclusion.predictedScore || "-"}</strong></article>
        </div>
      </div>
      ${statusLine()}
    </section>

    <section class="soft-panel panel-lavender">
      <div class="tab-row">
        ${ANALYSIS_TABS.map((item) => `<button class="tab-btn ${item.key === state.mainTab ? "is-active" : ""}" data-action="main-tab" data-main-tab="${item.key}" type="button">${item.label}</button>`).join("")}
      </div>
      <div class="chip-row">
        ${tab.subTabs
          .map((sub) => `<button class="chip ${state.subTabs[state.mainTab] === sub ? "is-active" : ""}" data-action="sub-tab" data-sub-tab="${sub}" type="button">${TAB_LABELS[sub]}</button>`)
          .join("")}
      </div>
    </section>

    ${renderAnalysisContent(analysis, match)}
    <section class="note-panel"><p>风险提示：仅用于赛事数据分析展示，不构成任何投资建议。</p></section>
  `;
}

function render() {
  updateBottomNav();
  if (state.loading && !state.matches.length) {
    app.innerHTML = '<section class="soft-panel"><p class="empty-tip">正在同步数据...</p></section>';
    return;
  }
  if (!state.selectedMatchId && state.matches[0]?.id) state.selectedMatchId = state.matches[0].id;
  if (state.page === "home") app.innerHTML = renderHomePage();
  if (state.page === "models") app.innerHTML = renderModelPage();
  if (state.page === "matches") app.innerHTML = renderMatchesPage();
  if (state.page === "favorites") app.innerHTML = renderFavoritesPage();
  if (state.page === "search") app.innerHTML = renderSearchPage();
  if (state.page === "analysis") app.innerHTML = renderAnalysisPage();
}

function setPage(page) {
  state.page = page;
  render();
}

async function fetchJson(url, options = {}) {
  const endpoint = `${API_BASE}${url}`;
  const res = await fetch(endpoint, options);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

async function loadBootstrap() {
  state.loading = true;
  render();
  try {
    const payload = await fetchJson("/api/bootstrap");
    if (payload.ok) {
      state.source = payload.source || state.source;
      state.updatedAt = payload.updatedAt || state.updatedAt;
      state.scheduler = payload.scheduler || state.scheduler;
      state.matches = Array.isArray(payload.matches) && payload.matches.length ? payload.matches : state.matches;
      const leagues = Array.isArray(payload.leagues) ? payload.leagues.map((x) => x.name || x.code) : [];
      state.leagues = leagues.length ? leagues : state.leagues;
      state.news = Array.isArray(payload.news) ? payload.news : [];
      if (!state.leagues.includes(state.matchLeague)) state.matchLeague = "全部";
      if (!state.selectedMatchId || !state.matches.some((m) => m.id === state.selectedMatchId)) state.selectedMatchId = state.matches[0]?.id || "";
    }
  } catch {
    // keep fallback
  } finally {
    state.loading = false;
    render();
  }
}

async function loadAnalysis(matchId) {
  try {
    const payload = await fetchJson(`/api/matches/${encodeURIComponent(matchId)}/analysis`);
    if (payload.ok && payload.analysis) state.analysisById[matchId] = payload.analysis;
  } catch {
    // ignore; keep existing local analysis if remote call fails
  }
}

async function loadMatchAiPrediction(matchId) {
  if (!matchId || state.matchAiPredictions[matchId] || state.matchAiLoading[matchId]) return;
  state.matchAiLoading[matchId] = true;
  state.matchAiError[matchId] = "";
  render();
  try {
    const payload = await fetchJson(`/api/matches/${encodeURIComponent(matchId)}/ai-prediction`);
    if (payload.ok && payload.prediction) {
      state.matchAiPredictions[matchId] = payload.prediction;
    } else {
      state.matchAiError[matchId] = payload.error || "AI预测生成失败";
    }
  } catch (error) {
    state.matchAiError[matchId] = String(error.message || error);
  } finally {
    state.matchAiLoading[matchId] = false;
    render();
  }
}

async function loadAiCatalog() {
  try {
    const payload = await fetchJson("/api/ai/models");
    if (!payload.ok) return;
    state.aiCatalog = payload;
    if (!state.selectedModelId) state.selectedModelId = payload.models?.[0]?.id || "";
    if (!state.aiPromptTemplateId) state.aiPromptTemplateId = payload.promptTemplates?.[0]?.id || "";
    const scenario = payload.pricingScenarios?.find((x) => x.id === state.selectedScenarioId) || payload.pricingScenarios?.[0];
    if (scenario) {
      state.selectedScenarioId = scenario.id;
      state.estimateInputTokens = scenario.inputTokens;
      state.estimateOutputTokens = scenario.outputTokens;
      state.estimateCalls = scenario.calls;
    }
    await refreshEstimate();
  } catch {
    state.aiCatalog = null;
  }
}

async function refreshEstimate() {
  if (!state.selectedModelId) return;
  try {
    const params = new URLSearchParams({
      modelId: state.selectedModelId,
      inputTokens: String(state.estimateInputTokens),
      outputTokens: String(state.estimateOutputTokens),
      calls: String(state.estimateCalls),
    });
    const payload = await fetchJson(`/api/ai/estimate?${params.toString()}`);
    if (payload.ok) state.estimate = payload.estimate;
  } catch {
    state.estimate = null;
  } finally {
    render();
  }
}

async function runAiAnalyze() {
  if (!state.selectedModelId || !state.aiPrompt.trim()) return;
  state.aiLoading = true;
  render();
  try {
    const res = await fetchJson("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: state.selectedModelId, prompt: state.aiPrompt }),
    });
    state.aiOutput = res.ok ? res.text || "模型已返回空内容" : JSON.stringify(res, null, 2);
  } catch (error) {
    state.aiOutput = `调用失败：${String(error.message || error)}`;
  } finally {
    state.aiLoading = false;
    render();
  }
}

function statusLine() {
  const refresh = state.scheduler?.refreshMinutes ?? 5;
  const liveRefresh = state.scheduler?.liveRefreshSeconds ?? 60;
  const hint =
    state.source === "fallback-mock"
      ? `<span class="warn">当前为离线示例数据，请先启动本地服务：${API_BASE || window.location.origin}</span>`
      : "";
  return `
    <div class="status-line">
      <span>数据源：${state.source}</span>
      <span>更新时间：${fmtDate(state.updatedAt)}</span>
      <span>同步周期：${refresh} 分钟</span>
      <span>即时赛况：${liveRefresh} 秒检测</span>
      ${hint}
    </div>
  `;
}

function strategyDataByModel() {
  return buildStrategyStats();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  if (action === "nav") return setPage(target.dataset.page);
  if (action === "match-tab") {
    state.matchTab = target.dataset.matchTab;
    render();
    return;
  }
  if (action === "open-analysis") {
    const matchId = target.dataset.matchId;
    if (!matchId) return;
    state.selectedMatchId = matchId;
    const targetMatch = getMatchById(matchId);
    if (targetMatch && (targetMatch.status === "WAIT" || targetMatch.status === "SELL")) {
      state.mainTab = "fundamentals";
      state.subTabs.fundamentals = "squad";
    }
    addHistory(matchId);
    await loadAnalysis(matchId);
    loadMatchAiPrediction(matchId).catch(() => {});
    setPage("analysis");
    return;
  }
  if (action === "toggle-favorite") {
    const matchId = target.dataset.matchId;
    if (!matchId) return;
    if (state.favorites.has(matchId)) state.favorites.delete(matchId);
    else state.favorites.add(matchId);
    saveJson(STORAGE_KEYS.favorites, Array.from(state.favorites));
    render();
    return;
  }
  if (action === "main-tab") {
    state.mainTab = target.dataset.mainTab;
    render();
    return;
  }
  if (action === "sub-tab") {
    state.subTabs[state.mainTab] = target.dataset.subTab;
    render();
    return;
  }
  if (action === "model-tab") {
    state.modelTab = target.dataset.modelTab;
    render();
    return;
  }
  if (action === "run-ai") return runAiAnalyze();
  if (action === "use-template") {
    const id = target.dataset.templateId;
    const template = state.aiCatalog?.promptTemplates?.find((x) => x.id === id);
    if (template) {
      state.aiPromptTemplateId = id;
      state.aiPrompt = template.prompt;
      render();
    }
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.id === "search-input") {
    state.searchQuery = target.value;
    render();
    return;
  }
  if (target.id === "ai-prompt-input") {
    state.aiPrompt = target.value;
    return;
  }
  if (target.id === "estimate-input-tokens") {
    state.estimateInputTokens = Math.max(1, Number(target.value || 1));
    refreshEstimate();
    return;
  }
  if (target.id === "estimate-output-tokens") {
    state.estimateOutputTokens = Math.max(1, Number(target.value || 1));
    refreshEstimate();
    return;
  }
  if (target.id === "estimate-calls") {
    state.estimateCalls = Math.max(1, Number(target.value || 1));
    refreshEstimate();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "match-league-select") {
    state.matchLeague = target.value;
    state.prefs.defaultLeague = target.value;
    saveJson(STORAGE_KEYS.prefs, state.prefs);
    render();
    return;
  }
  if (target.id === "model-select") {
    state.selectedModelId = target.value;
    refreshEstimate();
    return;
  }
  if (target.id === "scenario-select") {
    state.selectedScenarioId = target.value;
    const scenario = state.aiCatalog?.pricingScenarios?.find((x) => x.id === target.value);
    if (scenario) {
      state.estimateInputTokens = scenario.inputTokens;
      state.estimateOutputTokens = scenario.outputTokens;
      state.estimateCalls = scenario.calls;
      refreshEstimate();
      render();
    }
  }
});

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    state.prefs.theme = state.prefs.theme === "light" ? "dark" : "light";
    document.body.dataset.theme = state.prefs.theme;
    saveJson(STORAGE_KEYS.prefs, state.prefs);
  });
}

async function refreshNow() {
  try {
    await fetchJson("/api/refresh", { method: "POST" });
  } catch {
    // ignore
  }
  await loadBootstrap();
}

async function runHistorySearch(page = 1) {
  state.searchLoading = true;
  state.searchPage = Math.max(1, page);
  render();
  try {
    const params = new URLSearchParams({
      q: state.searchQuery || "",
      status: state.searchStatus === "ALL" ? "" : state.searchStatus,
      dateFrom: state.searchDateFrom || "",
      dateTo: state.searchDateTo || "",
      page: String(state.searchPage),
      pageSize: String(SEARCH_PAGE_SIZE),
    });
    const payload = await fetchJson(`/api/history/search?${params.toString()}`);
    if (payload.ok) {
      state.searchResults = Array.isArray(payload.rows) ? payload.rows : [];
      state.searchTotal = Number(payload.total || 0);
      state.searchTotalPages = Number(payload.totalPages || 0);
      state.updatedAt = payload.updatedAt || state.updatedAt;
      state.source = payload.source || state.source;
    }
  } catch {
    state.searchResults = [];
    state.searchTotal = 0;
    state.searchTotalPages = 0;
  } finally {
    state.searchLoading = false;
    render();
  }
}

function renderHomePage() {
  const focus = topFocusMatches().slice(0, 8);
  const liveCount = state.matches.filter((m) => m.status === "LIVE").length;
  const resultCount = state.matches.filter((m) => m.status === "RESULT").length;
  const focusCards = focus.slice(0, 6).map(renderMatchCard).join("") || '<p class="empty-tip">暂无赛事</p>';

  const newsHtml = state.news.length
    ? state.news
        .slice(0, 10)
        .map(
          (item) => `
          <a class="news-row" href="${item.url}" target="_blank" rel="noreferrer">
            <strong>${item.title}</strong>
            <span>${item.date || "--"}</span>
          </a>
        `
        )
        .join("")
    : '<p class="empty-tip">暂无官方资讯</p>';

  return `
    <section class="hero-panel">
      <div class="hero-title">
        <h2>今日焦点</h2>
        <p>今日：${state.matches.length} 场 | 进行中 ${liveCount} 场 | 完场 ${resultCount} 场</p>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="manual-refresh" type="button">立即更新数据</button>
      </div>
      ${statusLine()}
    </section>

    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>比赛列表</h3></div>
      <div class="match-list">${focusCards}</div>
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>中国体育彩票资讯</h3></div>
      ${newsHtml}
    </section>
  `;
}

function renderMatchCard(match) {
  const fav = state.favorites.has(match.id);
  const score = scoreText(match);
  const scoreOrStatus = score === "VS" ? statusLabel(match) : score;
  return `
    <article class="match-row-card">
      <div class="match-row-top">
        <span>${match.league || "未分类联赛"}</span>
        <span>${fmtDate(match.datetime)}</span>
      </div>
      <div class="match-row-main">
        <strong>${match.home?.name || "主队"}</strong>
        <span class="status-pill">${scoreOrStatus}</span>
        <strong>${match.away?.name || "客队"}</strong>
      </div>
      <div class="match-row-tags">
        <span class="tag">${match.matchNumStr || "竞彩"}</span>
        <span class="tag">${match.competition || match.league || "足球赛事"}</span>
        <span class="tag">${match.round || "场次待更新"}</span>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="open-analysis" data-match-id="${match.id}" type="button">详情</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${fav ? "取消关注" : "关注"}</button>
      </div>
    </article>
  `;
}

function renderSearchPage() {
  const statusOptions = ["ALL", "SELL", "LIVE", "RESULT", "WAIT"];
  const list = state.searchResults;
  const pager = `
    <div class="card-row">
      <button class="ghost-btn" data-action="search-prev" type="button" ${state.searchPage <= 1 ? "disabled" : ""}>上一页</button>
      <span class="muted">第 ${state.searchPage} / ${Math.max(1, state.searchTotalPages)} 页</span>
      <button class="ghost-btn" data-action="search-next" type="button" ${state.searchPage >= Math.max(1, state.searchTotalPages) ? "disabled" : ""}>下一页</button>
    </div>
  `;

  return `
    <section class="soft-panel panel-cream">
      <div class="section-head"><h2>历史搜索</h2></div>
      <div class="controls-row">
        <label>关键词
          <input id="search-input" class="search-input" type="search" placeholder="球队 / 联赛 / 竞彩编号" value="${state.searchQuery}" />
        </label>
        <label>状态
          <select id="search-status-select">
            ${statusOptions.map((x) => `<option value="${x}" ${x === state.searchStatus ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label>开始日期
          <input id="search-date-from" type="date" value="${state.searchDateFrom}" />
        </label>
        <label>结束日期
          <input id="search-date-to" type="date" value="${state.searchDateTo}" />
        </label>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="search-history" type="button" ${state.searchLoading ? "disabled" : ""}>${state.searchLoading ? "搜索中..." : "搜索历史"}</button>
        <button class="ghost-btn" data-action="manual-refresh" type="button">刷新最新数据</button>
      </div>
      <p class="muted">共 ${state.searchTotal} 条记录</p>
      ${pager}
      <div class="match-list">${list.length ? list.map(renderMatchCard).join("") : '<p class="empty-tip">暂无匹配数据</p>'}</div>
    </section>
  `;
}

function renderAnalysisPage() {
  const match = getMatchById(state.selectedMatchId);
  if (!match) return '<section class="soft-panel"><p class="empty-tip">暂无可查看比赛</p></section>';

  const analysis = normalizeAnalysis(state.analysisById[match.id]);
  const tabs = AI_FEATURE_ENABLED ? ANALYSIS_TABS : ANALYSIS_TABS.filter((x) => x.key !== "model");
  if (!tabs.some((x) => x.key === state.mainTab)) {
    state.mainTab = "fundamentals";
  }
  const tab = tabs.find((item) => item.key === state.mainTab) || tabs[0];
  const score = scoreText(match);
  const odds = oddsText(match?.odds?.oneXTwo || analysis?.market?.odds?.oneXTwo, match?.status);

  return `
    <section class="analysis-hero">
      <div class="analysis-top-row">
        <button class="ghost-btn" data-action="nav" data-page="matches" type="button">返回比赛</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${state.favorites.has(match.id) ? "已关注" : "关注"}</button>
      </div>
      <div class="analysis-header-grid">
        <div>
          <p class="muted">${match.league} · ${match.matchNumStr || ""}</p>
          <h2>${match.home.name} VS ${match.away.name}</h2>
          <p class="muted">${fmtDate(match.datetime)} · ${statusLabel(match)} · ${match.venue || "场地待补充"}</p>
        </div>
        <div class="kpi-row">
          <article class="mini-data"><span>比分</span><strong>${score}</strong></article>
          <article class="mini-data"><span>1X2</span><strong>${odds}</strong></article>
          <article class="mini-data"><span>联赛</span><strong>${match.competition || match.league}</strong></article>
          <article class="mini-data"><span>编号</span><strong>${match.matchNumStr || "-"}</strong></article>
        </div>
      </div>
      ${statusLine()}
    </section>

    <section class="soft-panel panel-lavender">
      <div class="tab-row">
        ${tabs.map((item) => `<button class="tab-btn ${item.key === state.mainTab ? "is-active" : ""}" data-action="main-tab" data-main-tab="${item.key}" type="button">${item.label}</button>`).join("")}
      </div>
      <div class="chip-row">
        ${tab.subTabs
          .map((sub) => `<button class="chip ${state.subTabs[state.mainTab] === sub ? "is-active" : ""}" data-action="sub-tab" data-sub-tab="${sub}" type="button">${TAB_LABELS[sub]}</button>`)
          .join("")}
      </div>
    </section>

    ${renderAnalysisContent(analysis, match)}
    <section class="note-panel"><p>仅用于赛事数据展示与分析，不构成任何投资建议。</p></section>
  `;
}

function renderModelPage() {
  return `
    <section class="soft-panel panel-cream">
      <div class="section-head"><h2>AI 预测模块暂时隐藏</h2></div>
      <p class="muted">当前阶段先优化数据质量、抓取完整性和历史检索能力。AI 预测会在下一阶段恢复。</p>
      <div class="card-row">
        <button class="action-btn" data-action="nav" data-page="home" type="button">返回首页</button>
      </div>
    </section>
  `;
}

async function loadAiCatalog() {
  if (!AI_FEATURE_ENABLED) {
    state.aiCatalog = null;
    return;
  }
  try {
    const payload = await fetchJson("/api/ai/models");
    if (!payload.ok) return;
    state.aiCatalog = payload;
    if (!state.selectedModelId) state.selectedModelId = payload.models?.[0]?.id || "";
    if (!state.aiPromptTemplateId) state.aiPromptTemplateId = payload.promptTemplates?.[0]?.id || "";
    const scenario = payload.pricingScenarios?.find((x) => x.id === state.selectedScenarioId) || payload.pricingScenarios?.[0];
    if (scenario) {
      state.selectedScenarioId = scenario.id;
      state.estimateInputTokens = scenario.inputTokens;
      state.estimateOutputTokens = scenario.outputTokens;
      state.estimateCalls = scenario.calls;
    }
    await refreshEstimate();
  } catch {
    state.aiCatalog = null;
  }
}

function setPage(page) {
  if (!AI_FEATURE_ENABLED && page === "models") {
    state.page = "home";
  } else {
    state.page = page;
  }
  if (state.page === "search" && !state.searchResults.length && !state.searchLoading) {
    runHistorySearch(1).catch(() => {});
  }
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "manual-refresh") {
    refreshNow().catch(() => {});
    return;
  }
  if (action === "search-history") {
    runHistorySearch(1).catch(() => {});
    return;
  }
  if (action === "search-prev") {
    if (state.searchPage > 1) runHistorySearch(state.searchPage - 1).catch(() => {});
    return;
  }
  if (action === "search-next") {
    if (state.searchPage < Math.max(1, state.searchTotalPages)) runHistorySearch(state.searchPage + 1).catch(() => {});
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "search-status-select") {
    state.searchStatus = target.value || "ALL";
    return;
  }
  if (target.id === "search-date-from") {
    state.searchDateFrom = target.value || "";
    return;
  }
  if (target.id === "search-date-to") {
    state.searchDateTo = target.value || "";
  }
});

function hideAiNav() {
  if (AI_FEATURE_ENABLED) return;
  const aiNav = document.querySelector('.nav-btn[data-page="models"]');
  if (aiNav) aiNav.style.display = "none";
}

async function bootstrap() {
  hideAiNav();
  render();
  await Promise.all([loadBootstrap(), loadAiCatalog()]);
  setInterval(() => {
    loadBootstrap().catch(() => {});
  }, 60 * 1000);
}

bootstrap();

// ---- 2026-04-23 hotfix: home-date query + detail fallback ----
function toInputDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayInputDate() {
  return toInputDate(new Date());
}

function ensureHomeState() {
  if (!state.homeDate) state.homeDate = todayInputDate();
  if (!Array.isArray(state.homeRows)) state.homeRows = [];
  if (!state.homeQueriedDate) state.homeQueriedDate = state.homeDate;
  if (!Number.isFinite(state.homeTotal)) state.homeTotal = 0;
  if (typeof state.homeLoading !== "boolean") state.homeLoading = false;
}

function normalizeMatchRow(row) {
  if (!row || !row.id) return null;
  return {
    ...row,
    home: row.home || { name: "主队", short: "HOM" },
    away: row.away || { name: "客队", short: "AWY" },
    score: row.score || { fullTime: { home: null, away: null } },
    odds: row.odds || { oneXTwo: { home: null, draw: null, away: null } },
  };
}

function mergeMatchesIntoState(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const map = new Map(state.matches.map((m) => [m.id, m]));
  rows.forEach((row) => {
    const normalized = normalizeMatchRow(row);
    if (!normalized) return;
    map.set(normalized.id, { ...(map.get(normalized.id) || {}), ...normalized });
  });
  state.matches = Array.from(map.values()).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
}

function liveSortValue(match) {
  const order = { LIVE: 0, SELL: 1, WAIT: 2, RESULT: 3 };
  return order[match?.status] ?? 9;
}

function matchStatusTag(match) {
  if (match?.status === "LIVE") return '<span class="tag tag-live">实时</span>';
  if (match?.status === "RESULT") return '<span class="tag tag-result">完场</span>';
  if (match?.status === "SELL") return '<span class="tag tag-sell">已开售</span>';
  if (match?.status === "WAIT") return '<span class="tag tag-wait">未开赛</span>';
  return `<span class="tag">${statusLabel(match)}</span>`;
}

function getInstantMatches() {
  return state.matches
    .filter((m) => m.status === "LIVE" || m.status === "SELL")
    .sort((a, b) => liveSortValue(a) - liveSortValue(b) || new Date(a.datetime) - new Date(b.datetime));
}

function getMatchById(id) {
  if (!id) return null;
  const main = state.matches.find((m) => m.id === id);
  if (main) return main;

  const fromSearch = (state.searchResults || []).find((m) => m.id === id);
  if (fromSearch) {
    mergeMatchesIntoState([fromSearch]);
    return state.matches.find((m) => m.id === id) || normalizeMatchRow(fromSearch);
  }

  const fromHome = (state.homeRows || []).find((m) => m.id === id);
  if (fromHome) {
    mergeMatchesIntoState([fromHome]);
    return state.matches.find((m) => m.id === id) || normalizeMatchRow(fromHome);
  }
  return null;
}

async function runHistorySearch(page = 1) {
  state.searchLoading = true;
  state.searchPage = Math.max(1, page);
  render();
  try {
    const params = new URLSearchParams({
      q: state.searchQuery || "",
      status: state.searchStatus === "ALL" ? "" : state.searchStatus,
      dateFrom: state.searchDateFrom || "",
      dateTo: state.searchDateTo || "",
      page: String(state.searchPage),
      pageSize: String(SEARCH_PAGE_SIZE),
    });
    const payload = await fetchJson(`/api/history/search?${params.toString()}`);
    if (payload.ok) {
      state.searchResults = Array.isArray(payload.rows) ? payload.rows : [];
      state.searchTotal = Number(payload.total || 0);
      state.searchTotalPages = Number(payload.totalPages || 0);
      state.updatedAt = payload.updatedAt || state.updatedAt;
      state.source = payload.source || state.source;
      mergeMatchesIntoState(state.searchResults);
    }
  } catch {
    state.searchResults = [];
    state.searchTotal = 0;
    state.searchTotalPages = 0;
  } finally {
    state.searchLoading = false;
    render();
  }
}

async function runHomeDateSearch() {
  ensureHomeState();
  const selected = state.homeDate || todayInputDate();
  const today = todayInputDate();
  if (selected === today) {
    state.homeQueriedDate = selected;
    state.homeRows = getInstantMatches();
    state.homeTotal = state.homeRows.length || state.matches.filter((m) => toInputDate(m.datetime) === selected).length;
    render();
    return;
  }

  state.homeLoading = true;
  render();
  try {
    const params = new URLSearchParams({
      dateFrom: selected,
      dateTo: selected,
      page: "1",
      pageSize: "200",
    });
    const payload = await fetchJson(`/api/history/search?${params.toString()}`);
    if (payload.ok) {
      state.homeRows = Array.isArray(payload.rows) ? payload.rows : [];
      state.homeTotal = Number(payload.total || state.homeRows.length || 0);
      state.homeQueriedDate = selected;
      state.updatedAt = payload.updatedAt || state.updatedAt;
      state.source = payload.source || state.source;
      mergeMatchesIntoState(state.homeRows);
    }
  } catch {
    state.homeRows = [];
    state.homeTotal = 0;
    state.homeQueriedDate = selected;
  } finally {
    state.homeLoading = false;
    render();
  }
}

function buildHomeList() {
  ensureHomeState();
  const selected = state.homeDate || todayInputDate();
  const today = todayInputDate();
  if (selected === today) {
    const instant = getInstantMatches();
    if (instant.length) return instant;
    return state.matches
      .filter((m) => toInputDate(m.datetime) === today)
      .sort((a, b) => liveSortValue(a) - liveSortValue(b) || new Date(a.datetime) - new Date(b.datetime));
  }
  if (state.homeQueriedDate !== selected) {
    return [];
  }
  return [...(state.homeRows || [])].sort((a, b) => liveSortValue(a) - liveSortValue(b) || new Date(a.datetime) - new Date(b.datetime));
}

function renderHomePage() {
  ensureHomeState();
  const selected = state.homeDate || todayInputDate();
  const today = todayInputDate();
  const list = buildHomeList();
  const instantCount = getInstantMatches().length;
  const liveCount = list.filter((m) => m.status === "LIVE").length;
  const sellCount = list.filter((m) => m.status === "SELL").length;
  const waitCount = list.filter((m) => m.status === "WAIT").length;
  const resultCount = list.filter((m) => m.status === "RESULT").length;
  const needsQuery = selected !== today && state.homeQueriedDate !== selected;
  const isInstantMode = selected === today && instantCount > 0;
  const dateLabel = isInstantMode ? "即时赛事池" : selected === today ? "今日赛况" : selected;
  const liveNote =
    isInstantMode
      ? "当前展示全量数据中的进行中/已开售比赛，不受当天日期过滤。"
      : selected === today && liveCount === 0
      ? "当前暂无进行中或已开售比赛，先展示今日已完成/待开赛场次。"
      : "首页默认展示当天即时赛况，进行中比赛优先；比分、开赛状态和完场赛果随上游接口刷新。";
  const listHtml = list.length
    ? list.slice(0, 80).map(renderMatchCard).join("")
    : `<p class="empty-tip">${needsQuery ? "已切换日期，请点击“查询该日比赛”加载历史数据" : "该日期暂无比赛数据"}</p>`;

  const newsHtml = state.news.length
    ? state.news
        .slice(0, 10)
        .map(
          (item) => `
          <a class="news-row" href="${item.url}" target="_blank" rel="noreferrer">
            <strong>${item.title}</strong>
            <span>${item.date || "--"}</span>
          </a>
        `
        )
        .join("")
    : '<p class="empty-tip">暂无官方资讯</p>';

  return `
    <section class="hero-panel">
      <div class="hero-title">
        <h2>${selected === today ? "即时比赛" : "历史赛程"}</h2>
        <p>${dateLabel}：${list.length} 场 | 进行中 ${liveCount} 场 | 已开售 ${sellCount} 场 | 未开赛 ${waitCount} 场 | 完场 ${resultCount} 场</p>
      </div>
      <div class="controls-row">
        <label>比赛日期
          <input id="home-date-input" type="date" value="${selected}" />
        </label>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="home-query" type="button" ${state.homeLoading ? "disabled" : ""}>
          ${state.homeLoading ? "查询中..." : selected === today ? "查看即时比赛" : "查询该日比赛"}
        </button>
        <button class="ghost-btn" data-action="home-reset-today" type="button" ${selected === today ? "disabled" : ""}>回到今天</button>
        <button class="ghost-btn" data-action="manual-refresh" type="button">更新最新数据</button>
      </div>
      <p class="muted">${liveNote}</p>
      ${statusLine()}
    </section>

    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>${selected === today ? "即时赛况" : "比赛列表"}</h3><span class="muted">${isInstantMode ? "LIVE / SELL" : "进行中优先"}</span></div>
      <div class="match-list">${listHtml}</div>
    </section>

    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>中国体育彩票资讯</h3></div>
      ${newsHtml}
    </section>
  `;
}

function renderMatchCard(match) {
  const item = normalizeMatchRow(match);
  if (!item) return "";
  const fav = state.favorites.has(item.id);
  const score = scoreText(item);
  const scoreOrStatus = score === "VS" ? statusLabel(item) : score;
  return `
    <article class="match-row-card">
      <div class="match-row-top">
        <span>${item.league || "未分类联赛"}</span>
        <span>${fmtDate(item.datetime)}</span>
      </div>
      <div class="match-row-main">
        <strong>${item.home?.name || "主队"}</strong>
        <span class="status-pill">${scoreOrStatus}</span>
        <strong>${item.away?.name || "客队"}</strong>
      </div>
      <div class="match-row-tags">
        ${matchStatusTag(item)}
        <span class="tag">${item.matchNumStr || "竞彩"}</span>
        <span class="tag">${item.competition || item.league || "足球赛事"}</span>
        <span class="tag">${item.round || "场次待更新"}</span>
      </div>
      <div class="card-row">
        <button class="action-btn" data-action="open-analysis" data-match-id="${item.id}" type="button">详情</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${item.id}" type="button">${fav ? "取消关注" : "关注"}</button>
      </div>
    </article>
  `;
}

function isResultMatch(match) {
  if (!match || match.status !== "RESULT") return false;
  const h = Number(match?.score?.fullTime?.home);
  const a = Number(match?.score?.fullTime?.away);
  return Number.isFinite(h) && Number.isFinite(a);
}

function outcomeByScore(match) {
  if (!isResultMatch(match)) return null;
  const h = Number(match.score.fullTime.home);
  const a = Number(match.score.fullTime.away);
  if (h > a) return "home";
  if (h < a) return "away";
  return "draw";
}

function outcomeByProbabilities(probabilities) {
  const p = probabilities || {};
  const home = Number(p.home || 0);
  const draw = Number(p.draw || 0);
  const away = Number(p.away || 0);
  if (home >= draw && home >= away) return "home";
  if (away >= home && away >= draw) return "away";
  return "draw";
}

function outcomeLabelByKey(key) {
  if (key === "home") return "主胜";
  if (key === "away") return "客胜";
  if (key === "draw") return "平局";
  return "待定";
}

function trendTextFromForm(formArr = []) {
  const arr = Array.isArray(formArr) ? formArr : [];
  let w = 0;
  let d = 0;
  let l = 0;
  for (const x of arr) {
    if (x === "W") w += 1;
    if (x === "D") d += 1;
    if (x === "L") l += 1;
  }
  const streak = [];
  for (const x of arr) {
    if (x !== "W" && x !== "D" && x !== "L") break;
    if (!streak.length || streak[0] === x) streak.unshift(x);
    else break;
  }
  const streakText = streak.length ? `，当前${streak.length}连${streak[0] === "W" ? "胜" : streak[0] === "L" ? "负" : "平"}` : "";
  return `${arr.length}场: ${w}胜${d}平${l}负${streakText}`;
}

function computeGlobalPredictionHit(windowSize = 200) {
  const finished = [...state.matches]
    .filter(isResultMatch)
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
    .slice(0, windowSize);

  let total = 0;
  let hit1x2 = 0;
  let hitO25 = 0;
  let hitBtts = 0;

  for (const match of finished) {
    const analysis = normalizeAnalysis(state.analysisById[match.id]);
    const m = derivedMetrics(match, analysis);
    const actual = outcomeByScore(match);
    const predicted = outcomeByProbabilities(analysis?.prediction?.probabilities);
    if (!actual) continue;
    total += 1;
    if (predicted === actual) hit1x2 += 1;

    const hs = Number(match?.score?.fullTime?.home || 0);
    const as = Number(match?.score?.fullTime?.away || 0);
    const actualOver25 = hs + as >= 3;
    const actualBtts = hs > 0 && as > 0;
    const predOver25 = Number(m.o25 || 0) >= 0.5;
    const predBtts = Number(m.btts || 0) >= 0.5;
    if (predOver25 === actualOver25) hitO25 += 1;
    if (predBtts === actualBtts) hitBtts += 1;
  }

  const rate = (n) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "--");
  return {
    sample: total,
    hit1x2,
    hitO25,
    hitBtts,
    rate1x2: rate(hit1x2),
    rateO25: rate(hitO25),
    rateBtts: rate(hitBtts),
  };
}

function renderPreMatchPanel(match, analysis) {
  const probs = analysis?.prediction?.probabilities || {};
  const d = derivedMetrics(match, analysis);
  const locked = Boolean(analysis?.predictionArchive?.locked);
  const lockedAt = analysis?.predictionArchive?.lockedAt || "";
  const headHint = locked ? `赛前预测已封存 · ${fmtDate(lockedAt)}` : "开赛前模型估计";
  const predictedOutcome = outcomeByProbabilities(probs);
  const scoreTop = (analysis?.prediction?.scoreMatrix || []).slice(0, 3);
  const scoresText = scoreTop.length
    ? scoreTop.map((x) => `${x.score}(${pct(Number(x.probability || 0))})`).join(" / ")
    : "暂无";
  const analysisText = analysis?.market?.psychology?.analysisText || "暂无赛前解读";
  const tacticalText = analysis?.context?.tactical?.matchup || "暂无战术对位说明";

  return `
    <section class="soft-panel panel-blue">
      <div class="section-head"><h3>赛前预测总览</h3><span class="muted">${headHint}</span></div>
      <div class="mini-grid">
        <article class="mini-data"><span>胜平负概率</span><strong>主 ${pct(Number(probs.home || 0))} / 平 ${pct(Number(probs.draw || 0))} / 客 ${pct(Number(probs.away || 0))}</strong></article>
        <article class="mini-data"><span>倾向结果</span><strong>${outcomeLabelByKey(predictedOutcome)}</strong></article>
        <article class="mini-data"><span>比分预估</span><strong>${analysis?.prediction?.conclusion?.predictedScore || "-"}</strong></article>
        <article class="mini-data"><span>大小球（2.5）</span><strong>大 ${Math.round((Number(d.o25 || 0)) * 100)}% / 小 ${Math.round((1 - Number(d.o25 || 0)) * 100)}%</strong></article>
        <article class="mini-data"><span>双方进球（BTTS）</span><strong>${Math.round((Number(d.btts || 0)) * 100)}%</strong></article>
        <article class="mini-data"><span>候选比分Top3</span><strong>${scoresText}</strong></article>
      </div>
      <div class="two-col">
        <article class="mini-data"><span>赛前分析</span><p>${analysisText}</p></article>
        <article class="mini-data"><span>战术对位</span><p>${tacticalText}</p></article>
      </div>
    </section>
  `;
}

function renderPostMatchPanel(match, analysis) {
  if (!isResultMatch(match)) {
    return `
      <section class="soft-panel panel-cream">
        <div class="section-head"><h3>赛后复盘</h3><span class="muted">完场后自动生成</span></div>
        <p class="muted">当前状态：${statusLabel(match)}。完场后将展示胜负趋势、预测命中率和复盘结论。</p>
      </section>
    `;
  }

  const probs = analysis?.prediction?.probabilities || {};
  const predictedOutcome = outcomeByProbabilities(probs);
  const actualOutcome = outcomeByScore(match);
  const actualScore = scoreText(match);
  const predictedScore = analysis?.prediction?.conclusion?.predictedScore || "-";
  const predictedScoreHit = predictedScore === actualScore;

  const d = derivedMetrics(match, analysis);
  const hs = Number(match?.score?.fullTime?.home || 0);
  const as = Number(match?.score?.fullTime?.away || 0);
  const total = hs + as;
  const actualOver25 = total >= 3;
  const actualBtts = hs > 0 && as > 0;
  const predOver25 = Number(d.o25 || 0) >= 0.5;
  const predBtts = Number(d.btts || 0) >= 0.5;

  const homeTrend = trendTextFromForm(analysis?.fundamentals?.history?.recentForm?.home || []);
  const awayTrend = trendTextFromForm(analysis?.fundamentals?.history?.recentForm?.away || []);
  const global = computeGlobalPredictionHit(200);
  const lockInfo =
    analysis?.predictionArchive?.locked && analysis?.predictionArchive?.lockedAt
      ? `赛前预测封存于 ${fmtDate(analysis.predictionArchive.lockedAt)}`
      : "赛前预测未封存，当前按最新数据计算";

  const hitText = (ok) => (ok ? "命中" : "未命中");
  return `
    <section class="soft-panel panel-cream">
      <div class="section-head"><h3>赛后复盘</h3><span class="muted">基于真实完场赛果</span></div>
      <p class="muted">${lockInfo}</p>
      <div class="mini-grid">
        <article class="mini-data"><span>赛果</span><strong>${actualScore}（${outcomeLabelByKey(actualOutcome)}）</strong></article>
        <article class="mini-data"><span>预测结果</span><strong>${outcomeLabelByKey(predictedOutcome)}（${hitText(predictedOutcome === actualOutcome)}）</strong></article>
        <article class="mini-data"><span>预测比分</span><strong>${predictedScore}（${hitText(predictedScoreHit)}）</strong></article>
        <article class="mini-data"><span>大小球(2.5)</span><strong>${actualOver25 ? "大球" : "小球"}（${hitText(predOver25 === actualOver25)}）</strong></article>
        <article class="mini-data"><span>BTTS</span><strong>${actualBtts ? "是" : "否"}（${hitText(predBtts === actualBtts)}）</strong></article>
        <article class="mini-data"><span>总进球</span><strong>${total} 球</strong></article>
      </div>
      <div class="two-col">
        <article class="mini-data"><span>${match.home?.name || "主队"}胜负趋势</span><p>${homeTrend}</p></article>
        <article class="mini-data"><span>${match.away?.name || "客队"}胜负趋势</span><p>${awayTrend}</p></article>
      </div>
      <div class="mini-grid">
        <article class="mini-data"><span>全局1X2命中率</span><strong>${global.rate1x2}</strong><p>近${global.sample}场，命中${global.hit1x2}场</p></article>
        <article class="mini-data"><span>全局大/小2.5命中率</span><strong>${global.rateO25}</strong><p>近${global.sample}场，命中${global.hitO25}场</p></article>
        <article class="mini-data"><span>全局BTTS命中率</span><strong>${global.rateBtts}</strong><p>近${global.sample}场，命中${global.hitBtts}场</p></article>
      </div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDailyAiPredictionPanel(match) {
  const prediction = state.matchAiPredictions[match.id];
  const loading = Boolean(state.matchAiLoading[match.id]);
  const error = state.matchAiError[match.id] || "";

  if (loading && !prediction) {
    return `
      <section class="soft-panel panel-lavender">
        <div class="section-head"><h3>AI赛前预测</h3><span class="muted">每日生成一次</span></div>
        <p class="muted">正在生成本场结构化预测，生成后当天重复打开会直接读取缓存。</p>
      </section>
    `;
  }

  if (!prediction) {
    return `
      <section class="soft-panel panel-lavender">
        <div class="section-head"><h3>AI赛前预测</h3><span class="muted">每日生成一次</span></div>
        <p class="muted">${error ? `暂未生成：${escapeHtml(error)}` : "打开详情后自动生成；如未出现，请刷新本场详情。"}</p>
        <div class="card-row">
          <button class="action-btn" data-action="reload-match-ai" data-match-id="${match.id}" type="button">生成AI预测</button>
        </div>
      </section>
    `;
  }

  const source = prediction.providerConfigured
    ? `${prediction.modelName || prediction.modelId || "AI模型"}${prediction.cached ? " · 今日缓存" : " · 刚生成"}`
    : "本地结构化降级分析 · 未配置外部模型";

  return `
    <section class="soft-panel panel-lavender">
      <div class="section-head"><h3>AI赛前预测</h3><span class="muted">${source}</span></div>
      <p class="muted">生成时间：${fmtDate(prediction.generatedAt)}。同一场比赛当天只生成一次，减少模型请求。</p>
      <pre class="ai-match-output">${escapeHtml(prediction.text || "暂无内容")}</pre>
      <div class="card-row">
        <button class="ghost-btn" data-action="reload-match-ai" data-match-id="${match.id}" type="button" ${loading ? "disabled" : ""}>${loading ? "生成中..." : "重新读取"}</button>
      </div>
    </section>
  `;
}

function renderAnalysisPage() {
  const match = getMatchById(state.selectedMatchId);
  if (!match) return '<section class="soft-panel"><p class="empty-tip">未找到比赛详情，请返回列表重新选择。</p></section>';

  const analysis = normalizeAnalysis(state.analysisById[match.id]);
  const tabs = AI_FEATURE_ENABLED ? ANALYSIS_TABS : ANALYSIS_TABS.filter((x) => x.key !== "model");
  if (!tabs.some((x) => x.key === state.mainTab)) {
    state.mainTab = "fundamentals";
  }
  const tab = tabs.find((item) => item.key === state.mainTab) || tabs[0];
  const score = scoreText(match);
  const odds = oddsText(match?.odds?.oneXTwo || analysis?.market?.odds?.oneXTwo, match?.status);

  return `
    <section class="analysis-hero">
      <div class="analysis-top-row">
        <button class="ghost-btn" data-action="nav" data-page="matches" type="button">返回比赛</button>
        <button class="ghost-btn" data-action="toggle-favorite" data-match-id="${match.id}" type="button">${state.favorites.has(match.id) ? "已关注" : "关注"}</button>
      </div>
      <div class="analysis-header-grid">
        <div>
          <p class="muted">${match.league} · ${match.matchNumStr || ""}</p>
          <h2>${match.home.name} VS ${match.away.name}</h2>
          <p class="muted">${fmtDate(match.datetime)} · ${statusLabel(match)} · ${match.venue || "场地待补充"}</p>
        </div>
        <div class="kpi-row">
          <article class="mini-data"><span>比分</span><strong>${score}</strong></article>
          <article class="mini-data"><span>1X2</span><strong>${odds}</strong></article>
          <article class="mini-data"><span>联赛</span><strong>${match.competition || match.league}</strong></article>
          <article class="mini-data"><span>编号</span><strong>${match.matchNumStr || "-"}</strong></article>
        </div>
      </div>
      ${statusLine()}
    </section>

    ${renderPreMatchPanel(match, analysis)}
    ${renderDailyAiPredictionPanel(match)}
    ${renderPostMatchPanel(match, analysis)}

    <section class="soft-panel panel-lavender">
      <div class="tab-row">
        ${tabs.map((item) => `<button class="tab-btn ${item.key === state.mainTab ? "is-active" : ""}" data-action="main-tab" data-main-tab="${item.key}" type="button">${item.label}</button>`).join("")}
      </div>
      <div class="chip-row">
        ${tab.subTabs
          .map((sub) => `<button class="chip ${state.subTabs[state.mainTab] === sub ? "is-active" : ""}" data-action="sub-tab" data-sub-tab="${sub}" type="button">${TAB_LABELS[sub]}</button>`)
          .join("")}
      </div>
    </section>

    ${renderAnalysisContent(analysis, match)}
    <section class="note-panel"><p>仅用于赛事数据展示与分析，不构成任何投资建议。</p></section>
  `;
}

function setPage(page) {
  if (!AI_FEATURE_ENABLED && page === "models") {
    state.page = "home";
  } else {
    state.page = page;
  }
  if (state.page === "search" && !state.searchResults.length && !state.searchLoading) {
    runHistorySearch(1).catch(() => {});
  }
  ensureHomeState();
  render();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "home-query") {
    runHomeDateSearch().catch(() => {});
    return;
  }
  if (action === "home-reset-today") {
    ensureHomeState();
    state.homeDate = todayInputDate();
    state.homeQueriedDate = state.homeDate;
    state.homeRows = [];
    state.homeTotal = 0;
    render();
    return;
  }
  if (action === "reload-match-ai") {
    const matchId = target.dataset.matchId || state.selectedMatchId;
    if (matchId) {
      delete state.matchAiPredictions[matchId];
      loadMatchAiPrediction(matchId).catch(() => {});
    }
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id === "home-date-input") {
    ensureHomeState();
    state.homeDate = target.value || todayInputDate();
    render();
  }
});

const __renderAnalysisContentBase = renderAnalysisContent;
function injuryStatusLabel(status) {
  const map = {
    injured: "伤病",
    suspended: "停赛",
    available: "可用",
    questionable: "出战成疑",
    doubtful: "大概率缺阵",
  };
  return map[String(status || "").toLowerCase()] || status || "-";
}

renderAnalysisContent = function patchedRenderAnalysisContent(analysis, match) {
  if (state.mainTab === "fundamentals" && state.subTabs.fundamentals === "history") {
    const homeStanding = analysis?.fundamentals?.history?.standing?.home || {};
    const awayStanding = analysis?.fundamentals?.history?.standing?.away || {};
    const homeForm = analysis?.fundamentals?.history?.recentForm?.home || [];
    const awayForm = analysis?.fundamentals?.history?.recentForm?.away || [];
    const h2hNote = analysis?.context?.h2h?.note || "暂无可用交锋数据";

    return `
      <section class="analysis-card">
        <h3>历史表现（近10场）</h3>
        <div class="two-col">
          <div>
            <p class="muted">${match.home.name}</p>
            <div class="form-track">${formDots(homeForm)}</div>
          </div>
          <div>
            <p class="muted">${match.away.name}</p>
            <div class="form-track">${formDots(awayForm)}</div>
          </div>
        </div>
        <div class="mini-grid">
          <article class="mini-data"><span>近10场积分</span><strong>${homeStanding.points ?? "-"} / ${awayStanding.points ?? "-"}</strong></article>
          <article class="mini-data"><span>近10场净胜球</span><strong>${homeStanding.goalDiff ?? "-"} / ${awayStanding.goalDiff ?? "-"}</strong></article>
          <article class="mini-data"><span>近10场胜平负</span><strong>${homeStanding.record ?? "-"} / ${awayStanding.record ?? "-"}</strong></article>
          <article class="mini-data"><span>近10场进失球</span><strong>${homeStanding.gf ?? "-"}:${homeStanding.ga ?? "-"} / ${awayStanding.gf ?? "-"}:${awayStanding.ga ?? "-"}</strong></article>
        </div>
        <p class="muted" style="margin-top:10px;">${h2hNote}</p>
      </section>
    `;
  }
  if (state.mainTab === "fundamentals" && state.subTabs.fundamentals === "squad") {
    const lineup = analysis?.fundamentals?.squad?.lineup || {};
    const injuries = analysis?.fundamentals?.squad?.injuries || {};
    const renderInjuryRows = (rows = []) =>
      rows.length
        ? rows
            .map((x) => `<div class="list-row"><strong>${x.player || "球员"}</strong><span>${x.issue || "-"} · ${injuryStatusLabel(x.status)}</span></div>`)
            .join("")
        : '<p class="empty-tip">暂无官方伤停记录</p>';
    return `
      <section class="analysis-card">
        <h3>人员与阵容</h3>
        <div class="two-col">
          <div>
            <p class="muted">${match.home.name} 预计首发</p>
            <p class="lead" style="font-size:14px;line-height:1.6;">${lineup.home || "首发未公布"}</p>
            <p class="muted">伤病/停赛</p>
            ${renderInjuryRows(injuries.home || [])}
          </div>
          <div>
            <p class="muted">${match.away.name} 预计首发</p>
            <p class="lead" style="font-size:14px;line-height:1.6;">${lineup.away || "首发未公布"}</p>
            <p class="muted">伤病/停赛</p>
            ${renderInjuryRows(injuries.away || [])}
          </div>
        </div>
      </section>
    `;
  }
  return __renderAnalysisContentBase(analysis, match);
};
