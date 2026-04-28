const fs = require("fs");
const path = require("path");

const targetBase = process.env.RENDER_BASE_URL || process.argv[2] || "";
const token = process.env.ADMIN_SYNC_TOKEN || process.argv[3] || "";
const localBase = process.env.LOCAL_BASE_URL || "http://127.0.0.1:8787";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function snapshotFromLocalServer() {
  try {
    await fetchJson(`${localBase}/api/refresh`, { method: "POST" });
    await sleep(8000);
    const boot = await fetchJson(`${localBase}/api/bootstrap`);
    if (boot?.ok && Array.isArray(boot.matches) && boot.matches.length) {
      return {
        source: "external-sync-local",
        updatedAt: boot.updatedAt || new Date().toISOString(),
        matches: boot.matches,
        news: Array.isArray(boot.news) ? boot.news : [],
        analysisById: {},
      };
    }
  } catch {
    // Fall back to the local snapshot file below.
  }
  return null;
}

function snapshotFromFile() {
  const file = path.join(__dirname, "..", "server-cache", "snapshot.json");
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  return {
    source: "external-sync-file",
    updatedAt: parsed.updatedAt || new Date().toISOString(),
    matches: Array.isArray(parsed.matches) ? parsed.matches : [],
    news: Array.isArray(parsed.news) ? parsed.news : [],
    analysisById: parsed.analysisById && typeof parsed.analysisById === "object" ? parsed.analysisById : {},
  };
}

async function main() {
  if (!targetBase || !/^https?:\/\//.test(targetBase)) {
    throw new Error("Set RENDER_BASE_URL or pass the Render URL as the first argument.");
  }
  if (!token) {
    throw new Error("Set ADMIN_SYNC_TOKEN or pass the token as the second argument.");
  }

  const snapshot = (await snapshotFromLocalServer()) || snapshotFromFile();
  if (!snapshot.matches.length) throw new Error("No matches found in local snapshot.");

  const res = await fetchJson(`${targetBase.replace(/\/$/, "")}/api/admin/snapshot-import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(snapshot),
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
