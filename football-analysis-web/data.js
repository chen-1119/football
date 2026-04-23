export const LEAGUES = ["全部", "英超", "西甲", "意甲", "德甲", "法甲", "欧冠"];

export const MATCHES = [
  {
    id: "epl-ars-mci",
    league: "英超",
    competition: "Premier League",
    round: "Round 34",
    datetime: "2026-04-21T18:30:00Z",
    venue: "Emirates Stadium",
    city: "London",
    home: { id: "ars", name: "阿森纳", short: "ARS", color: "#D10A2A", rank: 2 },
    away: { id: "mci", name: "曼城", short: "MCI", color: "#58A6FF", rank: 1 },
  },
  {
    id: "lal-rma-bar",
    league: "西甲",
    competition: "LaLiga",
    round: "Round 31",
    datetime: "2026-04-24T20:00:00Z",
    venue: "Santiago Bernabeu",
    city: "Madrid",
    home: { id: "rma", name: "皇家马德里", short: "RMA", color: "#C7A341", rank: 1 },
    away: { id: "bar", name: "巴塞罗那", short: "BAR", color: "#0B3A85", rank: 3 },
  },
  {
    id: "sa-int-juv",
    league: "意甲",
    competition: "Serie A",
    round: "Round 33",
    datetime: "2026-04-25T18:45:00Z",
    venue: "San Siro",
    city: "Milan",
    home: { id: "int", name: "国际米兰", short: "INT", color: "#164194", rank: 1 },
    away: { id: "juv", name: "尤文图斯", short: "JUV", color: "#232323", rank: 4 },
  },
  {
    id: "bl1-bay-bvb",
    league: "德甲",
    competition: "Bundesliga",
    round: "Round 30",
    datetime: "2026-04-26T16:30:00Z",
    venue: "Allianz Arena",
    city: "Munich",
    home: { id: "bay", name: "拜仁慕尼黑", short: "BAY", color: "#CB0F3E", rank: 1 },
    away: { id: "bvb", name: "多特蒙德", short: "BVB", color: "#F4D50A", rank: 3 },
  },
  {
    id: "fl1-psg-om",
    league: "法甲",
    competition: "Ligue 1",
    round: "Round 31",
    datetime: "2026-04-27T19:00:00Z",
    venue: "Parc des Princes",
    city: "Paris",
    home: { id: "psg", name: "巴黎圣日耳曼", short: "PSG", color: "#2B68FF", rank: 1 },
    away: { id: "om", name: "马赛", short: "MAR", color: "#0B6EA9", rank: 5 },
  },
  {
    id: "ucl-psg-liv",
    league: "欧冠",
    competition: "UEFA Champions League",
    round: "Quarter-final 1st Leg",
    datetime: "2026-04-28T19:00:00Z",
    venue: "Parc des Princes",
    city: "Paris",
    home: { id: "psg", name: "巴黎圣日耳曼", short: "PSG", color: "#2B68FF", rank: 1 },
    away: { id: "liv", name: "利物浦", short: "LIV", color: "#F93A4A", rank: 2 },
  },
];

const makeDefaultAnalysis = (homeName, awayName) => ({
  fundamentals: {
    history: {
      recentForm: {
        home: ["W", "W", "D", "W", "L", "W", "W", "D", "W", "W"],
        away: ["L", "W", "W", "D", "L", "W", "D", "W", "L", "W"],
      },
      standing: {
        home: { rank: 1, points: 72, goalDiff: 38 },
        away: { rank: 2, points: 68, goalDiff: 31 },
      },
      homeAway: {
        homeWinRate: 0.76,
        awayWinRate: 0.62,
      },
    },
    attackDefense: {
      xg: { home: 2.1, away: 1.61 },
      xga: { home: 0.96, away: 1.28 },
      shots: { home: 16.5, away: 13.1 },
      onTarget: { home: 6.9, away: 5.2 },
      possession: { home: 60, away: 54 },
      passAccuracy: { home: 89, away: 85 },
    },
    squad: {
      injuries: {
        home: [
          { player: "主力后腰A", issue: "腿筋拉伤", status: "out", impact: "high" },
          { player: "轮换边锋B", issue: "肌肉疲劳", status: "doubtful", impact: "medium" },
        ],
        away: [{ player: "中卫C", issue: "膝盖不适", status: "doubtful", impact: "high" }],
      },
      lineup: {
        home: "4-3-3",
        away: "4-2-2-2",
      },
      keyPlayers: {
        home: [
          { name: `${homeName} 射手`, form: "4 场 3 球" },
          { name: `${homeName} 中场`, form: "场均关键传球 2.9" },
        ],
        away: [
          { name: `${awayName} 射手`, form: "4 场 2 球 1 助" },
          { name: `${awayName} 后卫`, form: "解围成功率 88%" },
        ],
      },
    },
  },
  context: {
    tactical: {
      matchup: "高位压迫 vs 快速反击",
      keyDuel: "主队左边锋 vs 客队右后卫",
      styleConflictIndex: 74,
      buildUpSpeed: { home: 68, away: 52 },
      pressingIntensity: { home: 71, away: 64 },
    },
    environment: {
      weather: "12°C 多云，微风",
      fatigue: { home: 22, away: 36 },
      restDays: { home: 5, away: 3 },
      travelDistanceKm: { home: 0, away: 821 },
    },
    h2h: {
      last5: { homeWin: 2, draw: 1, awayWin: 2 },
      note: "双方近 5 次交手势均力敌，先手进球的一方胜率显著更高。",
    },
  },
  market: {
    psychology: {
      motivation: { home: 92, away: 78 },
      publicSentiment: { home: 64, away: 36 },
      mediaHeat: 81,
    },
    odds: {
      oneXTwo: { home: 2.08, draw: 3.42, away: 3.35 },
      asian: { line: -0.25, homeOdds: 1.93, awayOdds: 1.95 },
      overUnder: { line: 2.75, overOdds: 1.88, underOdds: 1.96 },
      trend: [
        { time: "48h前", home: 2.16, draw: 3.36, away: 3.22 },
        { time: "24h前", home: 2.11, draw: 3.38, away: 3.31 },
        { time: "当前", home: 2.08, draw: 3.42, away: 3.35 },
      ],
    },
  },
  prediction: {
    factors: [
      { name: "近期状态", home: 84, away: 68, weight: 0.22, direction: "home" },
      { name: "攻防效率", home: 79, away: 64, weight: 0.24, direction: "home" },
      { name: "阵容完整度", home: 70, away: 62, weight: 0.18, direction: "home" },
      { name: "赛程体能", home: 76, away: 59, weight: 0.16, direction: "home" },
      { name: "市场信息", home: 62, away: 58, weight: 0.2, direction: "home" },
    ],
    probabilities: { home: 0.5, draw: 0.24, away: 0.26 },
    poissonLambda: { home: 1.65, away: 0.85 },
    scoreMatrix: [
      { score: "1-0", probability: 0.18 },
      { score: "2-1", probability: 0.16 },
      { score: "1-1", probability: 0.13 },
      { score: "2-0", probability: 0.12 },
      { score: "0-0", probability: 0.08 },
    ],
    kelly: [
      { market: "主胜", impliedProb: 0.47, modelProb: 0.5, edge: 0.03, verdict: "value" },
      { market: "平局", impliedProb: 0.29, modelProb: 0.24, edge: -0.05, verdict: "no-value" },
      { market: "客胜", impliedProb: 0.3, modelProb: 0.26, edge: -0.04, verdict: "no-value" },
      { market: "小 2.75", impliedProb: 0.51, modelProb: 0.56, edge: 0.05, verdict: "slight-value" },
    ],
    conclusion: {
      predictedScore: "1-0",
      confidence: "medium",
    },
  },
});

export const ANALYSIS_BY_MATCH = {
  "epl-ars-mci": makeDefaultAnalysis("ARS", "MCI"),
  "lal-rma-bar": makeDefaultAnalysis("RMA", "BAR"),
  "sa-int-juv": makeDefaultAnalysis("INT", "JUV"),
  "bl1-bay-bvb": makeDefaultAnalysis("BAY", "BVB"),
  "fl1-psg-om": makeDefaultAnalysis("PSG", "MAR"),
  "ucl-psg-liv": makeDefaultAnalysis("PSG", "LIV"),
};
