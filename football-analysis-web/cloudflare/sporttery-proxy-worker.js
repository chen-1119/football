const SPORTTERY_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001";

export default {
  async fetch(request, env) {
    const token = env.SPORTTERY_PROXY_TOKEN || "";
    const url = new URL(request.url);
    if (token && url.searchParams.get("token") !== token) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const response = await fetch(SPORTTERY_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        referer: "https://m.sporttery.cn/mjc/zqsj/",
        origin: "https://m.sporttery.cn",
        accept: "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
      },
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  },
};
