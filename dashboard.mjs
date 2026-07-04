#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(__dirname, "guard.mjs");
const DEFAULT_PORT = 8787;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    args[item.slice(2)] = argv[i + 1] ?? "";
    i += 1;
  }
  return args;
}

function runGuard(args, input = "") {
  const proc = spawnSync(process.execPath, [GUARD, ...args, "--format", "json"], {
    input,
    encoding: "utf8"
  });
  if (proc.status !== 0) {
    return {
      ok: false,
      status: proc.status,
      error: proc.stderr || proc.stdout || "guard command failed"
    };
  }
  try {
    return { ok: true, data: JSON.parse(proc.stdout) };
  } catch {
    return { ok: false, error: "guard returned invalid JSON", raw: proc.stdout };
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({ _invalid_json: body });
      }
    });
  });
}

function commonArgs(query) {
  const args = ["--agent", query.agent || "hermes", "--session-id", query.session || "dashboard"];
  args.push("--audit-dir", auditDirFromQuery(query));
  if (query.rules) args.push("--rules", query.rules);
  if (query.casesFile) args.push("--cases-file", query.casesFile);
  return args;
}

function hasAuditSession(auditDir) {
  if (!auditDir || !fs.existsSync(auditDir)) return false;
  const pointer = path.join(auditDir, ".current_session");
  if (fs.existsSync(pointer) && fs.readFileSync(pointer, "utf8").trim()) return true;
  return fs.readdirSync(auditDir).some((name) => name.endsWith(".state.json"));
}

function auditLatestTime(auditDir) {
  if (!auditDir || !fs.existsSync(auditDir)) return 0;
  let latest = 0;
  const pointer = path.join(auditDir, ".current_session");
  if (fs.existsSync(pointer)) latest = Math.max(latest, fs.statSync(pointer).mtimeMs);
  for (const name of fs.readdirSync(auditDir)) {
    if (!name.endsWith(".state.json")) continue;
    latest = Math.max(latest, fs.statSync(path.join(auditDir, name)).mtimeMs);
  }
  return latest;
}

function addAuditCandidate(candidates, candidate) {
  if (!candidate) return;
  const full = path.resolve(candidate);
  if (!candidates.includes(full)) candidates.push(full);
}

function auditCandidates() {
  const candidates = [];
  const configFile = path.join(__dirname, "audit_dir.txt");
  if (fs.existsSync(configFile)) addAuditCandidate(candidates, fs.readFileSync(configFile, "utf8").trim());
  addAuditCandidate(candidates, process.env.HERMES_GUARD_AUDIT_DIR);
  addAuditCandidate(candidates, path.join(__dirname, "audit"));
  addAuditCandidate(candidates, path.join(path.dirname(__dirname), "audit"));
  if (process.env.USERPROFILE) addAuditCandidate(candidates, path.join(process.env.USERPROFILE, ".hermes-guard", "audit"));

  const roots = new Set([path.parse(__dirname).root]);
  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(root)) roots.add(root);
    }
  }

  for (const root of roots) {
    addAuditCandidate(candidates, path.join(root, "hermes-data", "hermes-guard", "audit"));
    addAuditCandidate(candidates, path.join(root, "hermes-data", "hermes_guard", "audit"));
    addAuditCandidate(candidates, path.join(root, "hermes-guard", "audit"));
    addAuditCandidate(candidates, path.join(root, "hermes_guard", "audit"));

    const hermesData = path.join(root, "hermes-data");
    if (fs.existsSync(hermesData)) {
      for (const entry of fs.readdirSync(hermesData, { withFileTypes: true })) {
        if (entry.isDirectory() && /hermes.*guard/i.test(entry.name)) {
          addAuditCandidate(candidates, path.join(hermesData, entry.name, "audit"));
        }
      }
    }
  }

  return candidates;
}

function resolveAuditDir() {
  const active = auditCandidates()
    .filter(hasAuditSession)
    .map((candidate) => ({ candidate, latest: auditLatestTime(candidate) }))
    .sort((a, b) => b.latest - a.latest)[0];
  if (active) return active.candidate;
  return process.env.HERMES_GUARD_AUDIT_DIR || path.join(__dirname, "audit");
}

function auditDirFromQuery(query) {
  return query.auditDir || resolveAuditDir();
}

function currentSessionFromAudit(auditDir, fallback = "dashboard") {
  const pointer = path.join(auditDir, ".current_session");
  if (fs.existsSync(pointer)) {
    const sid = fs.readFileSync(pointer, "utf8").trim();
    if (sid) return sid;
  }
  if (fs.existsSync(auditDir)) {
    const latest = fs.readdirSync(auditDir)
      .filter((name) => name.endsWith(".state.json"))
      .map((name) => ({
        name,
        file: path.join(auditDir, name),
        mtime: fs.statSync(path.join(auditDir, name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    if (latest) return latest.name.slice(0, -".state.json".length);
  }
  return fallback;
}

function listSessions(query) {
  const auditDir = auditDirFromQuery(query);
  const result = runGuard(["sessions", "list", "--audit-dir", auditDir, "--format", "json"]);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      ...result.data,
      current_session: currentSessionFromAudit(auditDir, query.session || "dashboard")
    }
  };
}

function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hermes Guard Dashboard</title>
  <style>
    :root { color-scheme: light; font-family: Arial, "Microsoft YaHei", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #1f2933; }
    header { background: #ffffff; border-bottom: 1px solid #d9dee7; padding: 14px 20px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    h1 { font-size: 20px; margin: 0; }
    main { padding: 18px; display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; }
    section { background: #ffffff; border: 1px solid #d9dee7; border-radius: 8px; padding: 14px; min-width: 0; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    label { display: block; font-size: 12px; color: #526070; margin: 8px 0 4px; }
    input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #c8d0dc; border-radius: 6px; padding: 8px; font: inherit; background: #fff; }
    textarea { min-height: 86px; resize: vertical; }
    button { border: 1px solid #1f6feb; background: #1f6feb; color: white; border-radius: 6px; padding: 8px 10px; cursor: pointer; margin-top: 10px; }
    button.secondary { background: #fff; color: #1f2933; border-color: #c8d0dc; }
    pre { background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; overflow: auto; max-height: 420px; }
    .metric { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .metric div { background: #f1f4f8; border-radius: 6px; padding: 10px; }
    .metric strong { display: block; font-size: 22px; }
    .row { display: flex; gap: 8px; align-items: end; }
    .row > div { flex: 1; }
    .unsupported-list { display: grid; gap: 8px; }
    .unsupported-item { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; background: #fbfcfe; }
    .unsupported-item strong { display: block; margin-bottom: 4px; }
    .muted { color: #64748b; font-size: 12px; }
    @media (max-width: 900px) { .span-4, .span-6, .span-8 { grid-column: span 12; } }
  </style>
</head>
<body>
  <header>
    <h1>Hermes Guard Dashboard</h1>
    <div class="row" style="flex:1">
      <div><label>Session</label><input id="session" value=""></div>
      <div><label>Known</label><select id="knownSessions" onchange="selectKnownSession()"><option value="">auto</option></select></div>
      <div><label>Agent</label><select id="agent"><option>hermes</option><option>codex</option><option>claude-code</option><option>generic</option></select></div>
      <button onclick="refresh()">刷新</button>
    </div>
  </header>
  <main>
    <section class="span-4">
      <h2>状态</h2>
      <div class="metric">
        <div><span>轮数</span><strong id="turns">0</strong></div>
        <div><span>证据</span><strong id="evidence">0</strong></div>
        <div><span>未支持</span><strong id="unsupported">0</strong></div>
      </div>
      <label>当前任务</label>
      <input id="objective" placeholder="例如：核验论文真实性">
      <button onclick="setTask()">设置任务</button>
      <button class="secondary" onclick="clearTask()">清除任务</button>
    </section>

    <section class="span-4">
      <h2>输入前 Guard</h2>
      <label>用户消息</label>
      <textarea id="userMessage">请核对这篇论文是不是真的</textarea>
      <button onclick="wrapMessage()">包装消息</button>
    </section>

    <section class="span-4">
      <h2>回复前检查</h2>
      <label>助手回复</label>
      <textarea id="assistantResponse">测试通过。</textarea>
      <button onclick="checkResponse()">检查回复</button>
    </section>

    <section class="span-6">
      <h2>登记证据</h2>
      <div class="row">
        <div><label>类型</label><select id="evidenceKind"><option>test_passed</option><option>file_read</option><option>file_write</option><option>command_run</option><option>web_verified</option><option>manual_review</option></select></div>
        <div><label>状态</label><input id="evidenceStatus" value="passed"></div>
      </div>
      <label>摘要</label>
      <input id="evidenceSummary" value="manual evidence">
      <label>引用/命令/URL</label>
      <input id="evidenceRef">
      <button onclick="addEvidence()">登记证据</button>
    </section>

    <section class="span-6">
      <h2>失误样本</h2>
      <label>标题</label><input id="caseTitle" value="未支持声明">
      <label>触发</label><input id="caseTrigger" value="测试通过">
      <label>错误行为</label><input id="badBehavior" value="没有证据时声称测试通过">
      <label>正确行为</label><input id="correctBehavior" value="先登记 test_passed 证据">
      <button onclick="addCase()">记录 Case</button>
    </section>

    <section class="span-12">
      <h2>未支持详情</h2>
      <div id="unsupportedDetails" class="unsupported-list"><div class="muted">暂无未支持声明。</div></div>
    </section>

    <section class="span-12">
      <h2>输出</h2>
      <pre id="output">等待操作...</pre>
    </section>
  </main>
  <script>
    function params() {
      return new URLSearchParams({ session: session.value, agent: agent.value }).toString();
    }
    async function api(path, body) {
      const res = await fetch(path + "?" + params(), {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      const json = await res.json();
      output.textContent = JSON.stringify(json, null, 2);
      return json;
    }
    async function refresh() {
      await loadSessions();
      const json = await api("/api/report");
      turns.textContent = json.turn_index || 0;
      evidence.textContent = json.all_evidence_count || 0;
      unsupported.textContent = json.audit_summary?.unsupported_response_checks || 0;
      objective.value = json.current_objective || "";
      renderUnsupportedDetails(json.audit_summary?.latest_unsupported || []);
    }
    function renderUnsupportedDetails(items) {
      unsupportedDetails.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "暂无未支持声明。";
        unsupportedDetails.appendChild(empty);
        return;
      }
      for (const item of items.slice().reverse()) {
        const box = document.createElement("div");
        box.className = "unsupported-item";
        const title = document.createElement("strong");
        title.textContent = (item.risk || "unknown") + " · " + (item.matches || []).join(", ");
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = item.created_at || "";
        const excerpt = document.createElement("div");
        excerpt.textContent = item.response_excerpt || "";
        box.appendChild(title);
        box.appendChild(meta);
        box.appendChild(excerpt);
        unsupportedDetails.appendChild(box);
      }
    }
    async function loadSessions() {
      const res = await fetch("/api/sessions?" + params(), { cache: "no-store" });
      const json = await res.json();
      const current = json.current_session || session.value || "dashboard";
      if (!session.value || session.value === "dashboard") session.value = current;
      knownSessions.innerHTML = '<option value="">auto</option>';
      for (const item of json.sessions || []) {
        const opt = document.createElement("option");
        opt.value = item.session_id;
        opt.textContent = item.session_id + " · turns " + item.turn_index + " · evidence " + item.evidence_count;
        if (item.session_id === session.value) opt.selected = true;
        knownSessions.appendChild(opt);
      }
    }
    function selectKnownSession() {
      if (knownSessions.value) {
        session.value = knownSessions.value;
        refresh();
      }
    }
    function setTask() { api("/api/task/set", { objective: objective.value }); }
    function clearTask() { api("/api/task/clear", {}); }
    function wrapMessage() { api("/api/wrap", { message: userMessage.value }); }
    function checkResponse() { api("/api/check-response", { response: assistantResponse.value }); }
    function addEvidence() { api("/api/evidence/add", { kind: evidenceKind.value, status: evidenceStatus.value, summary: evidenceSummary.value, ref: evidenceRef.value }); }
    function addCase() { api("/api/cases/add", { title: caseTitle.value, trigger: caseTrigger.value, badBehavior: badBehavior.value, correctBehavior: correctBehavior.value }); }
    refresh();
  </script>
</body>
</html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
    return;
  }

  const query = Object.fromEntries(url.searchParams.entries());
  const body = req.method === "POST" ? await readBody(req) : {};
  let result;

  if (url.pathname === "/api/report") {
    if (!query.session || query.session === "dashboard") {
      query.session = currentSessionFromAudit(auditDirFromQuery(query), "dashboard");
    }
    result = runGuard(["report", "session", ...commonArgs(query)]);
  } else if (url.pathname === "/api/sessions") {
    result = listSessions(query);
  } else if (url.pathname === "/api/task/set") {
    const common = commonArgs(query);
    result = runGuard(["task", "set", ...common, "--objective", body.objective || ""]);
  } else if (url.pathname === "/api/task/clear") {
    const common = commonArgs(query);
    result = runGuard(["task", "clear", ...common]);
  } else if (url.pathname === "/api/wrap") {
    const common = commonArgs(query);
    result = runGuard(["wrap", ...common, "--stdin"], body.message || "");
  } else if (url.pathname === "/api/check-response") {
    const common = commonArgs(query);
    result = runGuard(["check-response", ...common, "--stdin"], body.response || "");
  } else if (url.pathname === "/api/evidence/add") {
    const common = commonArgs(query);
    result = runGuard([
      "evidence", "add", ...common,
      "--kind", body.kind || "manual_review",
      "--status", body.status || "passed",
      "--summary", body.summary || "",
      "--ref", body.ref || ""
    ]);
  } else if (url.pathname === "/api/cases/add") {
    const common = commonArgs(query);
    result = runGuard([
      "cases", "add", ...common,
      "--title", body.title || "",
      "--trigger", body.trigger || "",
      "--bad-behavior", body.badBehavior || "",
      "--correct-behavior", body.correctBehavior || ""
    ]);
  } else {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  sendJson(res, result.ok ? 200 : 500, result.ok ? result.data : result);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || process.env.HERMES_GUARD_DASHBOARD_PORT || DEFAULT_PORT);
  const host = args.host || "127.0.0.1";
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => sendJson(res, 500, { ok: false, error: String(error?.stack || error) }));
  });
  server.listen(port, host, () => {
    console.log(`Hermes Guard Dashboard: http://${host}:${port}`);
  });
}

main();
