# 足球赛事分析平台（中国体育彩票数据版）

基于中国体育彩票官方移动端接口（`webapi.sporttery.cn`）构建的赛事分析网站，默认每 5 分钟自动同步数据，并提供多模型选择、API 成本估算和模型页可视化。

## 已实现能力

- 体彩足球赛事数据拉取与聚合（`concern/live/result/all`）
- 默认每 5 分钟定时刷新（可用环境变量覆盖）
- 5 个底部导航：`首页 / 模型 / 比赛 / 关注 / 搜索`
- 分析页四大模块：`基本面 / 战术 / 市场 / 模型`
- AI 模型目录与价格估算：
- 模型列表（OpenAI / Anthropic / Gemini / DeepSeek）
- 成本估算（按输入/输出 token 与调用次数）
- 建议售价与毛利率估算
- PRD 分析提示词模板预留
- 模型页策略统计改为真实赛果统计（不再使用随机模拟数据）
- 对官方接口缺失维度（角球/牌/半场拆分）明确标记“数据受限”
- 多模型调用入口（需配置对应 API Key）

## 启动

```powershell
cd C:\Users\ASUS\Documents\Playground\football-analysis-web
npm run start
```

打开：

- [http://127.0.0.1:8787](http://127.0.0.1:8787)

说明：请使用 `http://` 访问，`file://` 打开会无法请求后端接口。

## 主要接口

- `GET /api/status`：数据源、刷新状态、统计
- `GET /api/bootstrap`：联赛 + 赛事 + 资讯
- `GET /api/matches?league=...&status=...`：赛事筛选
- `GET /api/matches/{matchId}/analysis`：单场分析
- `POST /api/refresh`：手动触发刷新

AI 相关：

- `GET /api/ai/models`：模型目录、价格来源、提示词模板
- `GET /api/ai/estimate?modelId=...&inputTokens=...&outputTokens=...&calls=...`：成本与定价估算
- `POST /api/ai/analyze`：调用指定模型（需 API Key）

## 环境变量

```powershell
$env:PORT='8787'
$env:REFRESH_MINUTES='5'
$env:FX_USD_CNY='7.2'
$env:SPORTTERY_PAGE_SIZE='80'
$env:SPORTTERY_PAGE_DEPTH='16'
$env:DETAIL_ENRICH_LIMIT='60'

# 可选：配置后启用对应模型调用
$env:OPENAI_API_KEY='...'
$env:ANTHROPIC_API_KEY='...'
$env:GEMINI_API_KEY='...'
$env:DEEPSEEK_API_KEY='...'
```

## 定价来源（核对日：2026-04-23）

- OpenAI: https://developers.openai.com/api/docs/pricing
- Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/

## UI 参考方向

- Sofascore: https://www.sofascore.com/
- FotMob: https://www.fotmob.com/
- OneFootball: https://onefootball.com/
- Flashscore: https://www.flashscore.com/
- 中国体育彩票: https://m.sporttery.cn/

## 合规提示

仅用于赛事数据分析展示，不提供投注入口，不构成任何投资建议。

## 2026-04-23 ���ݴ洢������������

- �������� SQLite �洢��`server-cache/matches.sqlite`
- ÿ��ץȡˢ�¶���д�룺
  - `match_latest`��ÿ����������״̬��
  - `match_history`��״̬�仯��ʷ��
- ������ʷ�����ӿڣ�
  - `GET /api/history/search?q=&status=&dateFrom=&dateTo=&page=&pageSize=`
  - `GET /api/history/timeline?matchId=&limit=`
- �Ѳ�������곡�ȷ֣�����ʹ�ùٷ��ֶ� `sectionsNo999/sectionsNo1` �����ȷ֡�
- ��ǰ�׶� AI Ԥ��ǰ����������أ��Ⱦ۽����������������������
