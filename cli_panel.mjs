#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(ROOT, "guard.mjs");
const DEFAULT_AUDIT_DIR = path.join(ROOT, "audit");
const isWindows = process.platform === "win32";

const state = {
  language: "zh",
  agent: "hermes",
  sessionId: "",
  auditDir: ""
};

const text = {
  zh: {
    title: "Hermes Guard 通用面板",
    subtitle: "不用记命令，按数字选择功能即可。",
    agent: "Agent",
    session: "会话",
    auditDir: "审计目录",
    auto: "自动检测",
    none: "未找到",
    default: "默认",
    choice: "请输入数字后按 Enter",
    back: "返回",
    exit: "退出",
    enterContinue: "按 Enter 回到菜单...",
    menuHealth: "健康检查：看当前会话是否连接、是否过期、是否有风险",
    menuCheck: "检查一段回复：粘贴 Hermes/Codex/Claude 的一句回复，看是否需要证据",
    menuDetails: "查看最近风险详情：显示命中的规则、原因、建议动作",
    menuReport: "查看当前会话报告：轮数、证据、任务、未支持声明",
    menuSessions: "列出最近会话：从审计记录里选择会话",
    menuTask: "任务管理：设置/查看/清除当前任务目标",
    menuEvidence: "添加人工证据：登记你已经亲自确认过的依据",
    menuSettings: "设置：查看或修改冷却、提醒次数、过期时间",
    menuRules: "规则库：查看、增加、删除、启用、禁用、校验规则",
    menuDashboard: "打开 Dashboard：可视化查看与管理",
    menuSystem: "系统检查：检查 Node.js 并运行测试",
    menuContext: "切换 Agent / 会话 / 审计目录",
    menuLanguage: "Switch to English",
    pasteResponse: "请粘贴要检查的一句回复。长回复建议先测关键句。",
    responsePrompt: "回复内容",
    noInput: "没有输入，已取消。",
    activeSessionMissing: "没有检测到活动会话。若 hook 已部署，请先让 Hermes 发送一轮消息；也可以手动设置会话 ID。",
    latestSessions: "最近会话",
    chooseSession: "输入序号选择会话，或直接按 Enter 返回",
    selectedSession: "已选择会话",
    taskMenu: "任务管理",
    taskShow: "查看当前任务",
    taskSet: "设置任务",
    taskClear: "清除任务",
    objectivePrompt: "请输入任务目标",
    evidenceSummary: "证据摘要，例如：我已打开网页确认论文存在",
    evidenceSubject: "这条证据支持哪条声明/主题，例如：MMLU-Pro 99.7%",
    evidenceRef: "证据来源 URL、文件路径或命令输出摘要",
    evidenceHint: "人工证据表示“你本人确认过”。它不会自动证明事实，只是让 Guard 知道有人工背书。",
    settingsMenu: "设置",
    settingsShow: "查看设置",
    settingsCooldown: "修改 cooldown_turns：同类提醒冷却轮数",
    settingsMaxWarnings: "修改 max_warnings_per_session：每个会话最多提醒次数",
    settingsStale: "修改 stale_session_minutes：多久没活动算过期",
    settingsReset: "重置全部设置",
    newValue: "请输入新数值",
    rulesMenu: "规则库",
    rulesList: "查看规则",
    rulesAdd: "新增规则",
    rulesDelete: "删除规则",
    rulesEnable: "启用规则",
    rulesDisable: "禁用规则",
    rulesValidate: "校验规则库",
    ruleKind: "规则类型：1=输入规则，2=回复规则",
    ruleId: "规则 ID（英文、数字、下划线，例如 unsupported_price_claim）",
    rulePatterns: "匹配词/短语，多个用 | 分隔",
    ruleRisk: "风险等级：none / low / medium / high，默认 medium",
    ruleZh: "中文解释：这条规则为什么拦截",
    ruleEn: "English explanation",
    confirmDelete: "确认删除这条规则？输入 DELETE 继续",
    ruleDeletedCancelled: "未输入 DELETE，已取消删除。",
    contextMenu: "上下文设置",
    setAgent: "设置 Agent 名称",
    setSession: "设置会话 ID",
    clearSession: "清除手动会话 ID，改回自动检测",
    setAudit: "设置审计目录",
    clearAudit: "清除审计目录，改回默认",
    agentPrompt: "Agent 名称，默认 hermes",
    sessionPrompt: "会话 ID，留空表示自动检测",
    auditPrompt: "审计目录路径，留空表示默认",
    dashboardStarted: "Dashboard 已尝试启动。如果浏览器没打开，请手动访问 http://127.0.0.1:8787",
    dashboardFailed: "Dashboard 启动失败，请先运行系统检查。",
    systemNode: "Node.js 版本",
    systemManifest: "正在检查部署完整性...",
    systemRules: "正在校验规则库...",
    systemTests: "正在运行测试...",
    commandExit: "命令退出码",
    selfTestOk: "CLI panel self-test OK"
  },
  en: {
    title: "Hermes Guard Universal Panel",
    subtitle: "No command memorization needed. Pick a number.",
    agent: "Agent",
    session: "Session",
    auditDir: "Audit folder",
    auto: "auto",
    none: "not found",
    default: "default",
    choice: "Choose a number then press Enter",
    back: "Back",
    exit: "Exit",
    enterContinue: "Press Enter to return to the menu...",
    menuHealth: "Health check: connection, staleness, and risk",
    menuCheck: "Check a response: paste one reply sentence and see whether evidence is needed",
    menuDetails: "Latest risk details: matched rules, reason, and suggested actions",
    menuReport: "Current session report: turns, evidence, task, unsupported claims",
    menuSessions: "Recent sessions: choose from audit records",
    menuTask: "Task management: set, show, or clear current objective",
    menuEvidence: "Add manual evidence: record something you personally verified",
    menuSettings: "Settings: cooldown, warning limit, stale-session threshold",
    menuRules: "Rules: list, add, delete, enable, disable, validate",
    menuDashboard: "Open Dashboard: visual console",
    menuSystem: "System check: Node.js and tests",
    menuContext: "Change Agent / session / audit folder",
    menuLanguage: "切换到中文",
    pasteResponse: "Paste one response line to check. For long replies, test the key sentence first.",
    responsePrompt: "Response",
    noInput: "No input; cancelled.",
    activeSessionMissing: "No active session was found. If the hook is installed, send one Hermes message first, or set a session ID manually.",
    latestSessions: "Recent sessions",
    chooseSession: "Enter a number to select a session, or press Enter to go back",
    selectedSession: "Selected session",
    taskMenu: "Task Management",
    taskShow: "Show current task",
    taskSet: "Set task",
    taskClear: "Clear task",
    objectivePrompt: "Task objective",
    evidenceSummary: "Evidence summary, e.g. I opened the web page and confirmed the paper exists",
    evidenceSubject: "Which claim/topic does this evidence support? e.g. MMLU-Pro 99.7%",
    evidenceRef: "Evidence URL, file path, or command-output summary",
    evidenceHint: "Manual evidence means you personally verified it. It is a record, not automatic proof.",
    settingsMenu: "Settings",
    settingsShow: "Show settings",
    settingsCooldown: "Change cooldown_turns: reminder cooldown in turns",
    settingsMaxWarnings: "Change max_warnings_per_session: warning limit per session",
    settingsStale: "Change stale_session_minutes: inactive minutes before stale",
    settingsReset: "Reset all settings",
    newValue: "New value",
    rulesMenu: "Rules",
    rulesList: "List rules",
    rulesAdd: "Add rule",
    rulesDelete: "Delete rule",
    rulesEnable: "Enable rule",
    rulesDisable: "Disable rule",
    rulesValidate: "Validate rules",
    ruleKind: "Rule type: 1=input rule, 2=response rule",
    ruleId: "Rule ID, letters/numbers/underscore, e.g. unsupported_price_claim",
    rulePatterns: "Words/phrases to match, separated by |",
    ruleRisk: "Risk: none / low / medium / high, default medium",
    ruleZh: "Chinese explanation",
    ruleEn: "English explanation: why this rule blocks",
    confirmDelete: "Confirm deletion by typing DELETE",
    ruleDeletedCancelled: "DELETE was not entered; cancelled.",
    contextMenu: "Context Settings",
    setAgent: "Set Agent name",
    setSession: "Set session ID",
    clearSession: "Clear manual session ID and return to auto detection",
    setAudit: "Set audit folder",
    clearAudit: "Clear audit folder and return to default",
    agentPrompt: "Agent name, default hermes",
    sessionPrompt: "Session ID; empty means auto detection",
    auditPrompt: "Audit folder path; empty means default",
    dashboardStarted: "Dashboard launch attempted. If the browser did not open, visit http://127.0.0.1:8787",
    dashboardFailed: "Dashboard failed to start. Please run System check first.",
    systemNode: "Node.js version",
    systemManifest: "Checking deployment integrity...",
    systemRules: "Validating rule library...",
    systemTests: "Running tests...",
    commandExit: "Command exit code",
    selfTestOk: "CLI panel self-test OK"
  }
};

function t(key) {
  return text[state.language][key] || text.en[key] || key;
}

function clearScreen() {
  if (!process.env.NO_COLOR) process.stdout.write("\x1Bc");
}

function auditDir() {
  return state.auditDir || DEFAULT_AUDIT_DIR;
}

function currentSessionFromDisk() {
  const dir = auditDir();
  const pointer = path.join(dir, ".current_session");
  try {
    if (fs.existsSync(pointer)) {
      const value = fs.readFileSync(pointer, "utf8").trim();
      if (value) return value;
    }
  } catch {
    // Continue to scan fallback.
  }

  try {
    if (!fs.existsSync(dir)) return "";
    const candidates = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".state.json") || name.endsWith(".evidence.jsonl") || name.endsWith(".jsonl"))
      .map((name) => {
        const sessionId = name
          .replace(/\.state\.json$/, "")
          .replace(/\.evidence\.jsonl$/, "")
          .replace(/\.jsonl$/, "");
        const fullPath = path.join(dir, name);
        return { sessionId, mtimeMs: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.sessionId || "";
  } catch {
    return "";
  }
}

function shownSession() {
  if (state.sessionId) return state.sessionId;
  const current = currentSessionFromDisk();
  return current ? `${current} (${t("auto")})` : `${t("auto")} / ${t("none")}`;
}

function commonArgs({ resolveSession = false } = {}) {
  const args = ["--agent", state.agent];
  if (state.auditDir) args.push("--audit-dir", state.auditDir);
  const sessionId = state.sessionId || (resolveSession ? currentSessionFromDisk() : "");
  if (sessionId) args.push("--session-id", sessionId);
  return args;
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" }
  });
  if (options.capture) return result;
  if (result.error) {
    console.error(result.error.message);
    return result;
  }
  if (result.status && !options.quietExitCode) {
    console.log("");
    console.log(`${t("commandExit")}: ${result.status}`);
  }
  return result;
}

function runGuard(args, options = {}) {
  return runNode([GUARD, ...args], options);
}

function jsonGuard(args) {
  const result = runGuard([...args, "--format", "json"], { capture: true, quietExitCode: true });
  if (result.error) throw result.error;
  const raw = `${result.stdout || ""}`.trim();
  if (!raw) throw new Error(result.stderr || "No JSON output.");
  return JSON.parse(raw);
}

async function pause(rl) {
  await rl.question(t("enterContinue"));
}

async function ask(rl, key, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const value = await rl.question(`${t(key)}${suffix}: `);
  return value.trim() || fallback;
}

function printHeader() {
  clearScreen();
  console.log(`=== ${t("title")} ===`);
  console.log(t("subtitle"));
  console.log("");
  console.log(`${t("agent")}: ${state.agent}`);
  console.log(`${t("session")}: ${shownSession()}`);
  console.log(`${t("auditDir")}: ${state.auditDir || `${DEFAULT_AUDIT_DIR} (${t("default")})`}`);
  console.log("");
}

async function health(rl) {
  printHeader();
  runGuard(["health", ...commonArgs()], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function checkResponse(rl) {
  printHeader();
  console.log(t("pasteResponse"));
  console.log("");
  const response = await ask(rl, "responsePrompt");
  if (!response) {
    console.log(t("noInput"));
    await pause(rl);
    return;
  }
  console.log("");
  runGuard(["check-response", ...commonArgs({ resolveSession: true }), "--format", "readable", "--response", response], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function latestDetails(rl) {
  printHeader();
  runGuard(["details", "latest", ...commonArgs({ resolveSession: true })], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function sessionReport(rl) {
  printHeader();
  runGuard(["report", "session", ...commonArgs({ resolveSession: true })], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

function recentSessions(limit = 10) {
  try {
    const result = jsonGuard(["sessions", "list", ...(state.auditDir ? ["--audit-dir", state.auditDir] : [])]);
    return (result.sessions || [])
      .sort((a, b) => {
        const at = a.latest_event?.created_at || "";
        const bt = b.latest_event?.created_at || "";
        return bt.localeCompare(at) || b.session_id.localeCompare(a.session_id);
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function chooseSession(rl) {
  printHeader();
  const sessions = recentSessions(10);
  console.log(t("latestSessions"));
  console.log("");
  if (!sessions.length) {
    console.log(t("activeSessionMissing"));
    console.log("");
    await pause(rl);
    return;
  }
  sessions.forEach((item, index) => {
    const latest = item.latest_event?.created_at || "none";
    console.log(`${index + 1}. ${item.session_id} | turns=${item.turn_index} | evidence=${item.evidence_count} | unsupported=${item.unsupported_response_checks} | latest=${latest}`);
  });
  console.log("");
  const choice = await rl.question(`${t("chooseSession")}: `);
  const index = Number(choice.trim()) - 1;
  if (Number.isInteger(index) && sessions[index]) {
    state.sessionId = sessions[index].session_id;
    console.log(`${t("selectedSession")}: ${state.sessionId}`);
    await pause(rl);
  }
}

async function taskMenu(rl) {
  for (;;) {
    printHeader();
    console.log(`=== ${t("taskMenu")} ===`);
    console.log(`1. ${t("taskShow")}`);
    console.log(`2. ${t("taskSet")}`);
    console.log(`3. ${t("taskClear")}`);
    console.log(`0. ${t("back")}`);
    console.log("");
    const choice = await rl.question(`${t("choice")}: `);
    if (choice.trim() === "0") return;
    printHeader();
    if (choice.trim() === "1") {
      runGuard(["task", "show", ...commonArgs({ resolveSession: true })], { quietExitCode: true });
    } else if (choice.trim() === "2") {
      const objective = await ask(rl, "objectivePrompt");
      if (objective) runGuard(["task", "set", ...commonArgs({ resolveSession: true }), "--objective", objective], { quietExitCode: true });
    } else if (choice.trim() === "3") {
      runGuard(["task", "clear", ...commonArgs({ resolveSession: true })], { quietExitCode: true });
    }
    console.log("");
    await pause(rl);
  }
}

async function addManualEvidence(rl) {
  printHeader();
  console.log(t("evidenceHint"));
  console.log("");
  const summary = await ask(rl, "evidenceSummary");
  if (!summary) {
    console.log(t("noInput"));
    await pause(rl);
    return;
  }
  const subject = await ask(rl, "evidenceSubject");
  const ref = await ask(rl, "evidenceRef");
  console.log("");
  runGuard([
    "evidence", "add",
    ...commonArgs({ resolveSession: true }),
    "--kind", "manual_review",
    "--status", "passed",
    "--summary", summary,
    "--subject", subject,
    "--ref", ref
  ], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function settingsMenu(rl) {
  for (;;) {
    printHeader();
    console.log(`=== ${t("settingsMenu")} ===`);
    console.log(`1. ${t("settingsShow")}`);
    console.log(`2. ${t("settingsCooldown")}`);
    console.log(`3. ${t("settingsMaxWarnings")}`);
    console.log(`4. ${t("settingsStale")}`);
    console.log(`5. ${t("settingsReset")}`);
    console.log(`0. ${t("back")}`);
    console.log("");
    const choice = await rl.question(`${t("choice")}: `);
    if (choice.trim() === "0") return;
    printHeader();
    if (choice.trim() === "1") {
      runGuard(["settings", "get", "--format", "text"], { quietExitCode: true });
    } else if (["2", "3", "4"].includes(choice.trim())) {
      const key = {
        2: "cooldown_turns",
        3: "max_warnings_per_session",
        4: "stale_session_minutes"
      }[choice.trim()];
      const value = await ask(rl, "newValue");
      if (value) runGuard(["settings", "set", key, value, "--format", "text"], { quietExitCode: true });
    } else if (choice.trim() === "5") {
      runGuard(["settings", "reset", "--format", "text"], { quietExitCode: true });
    }
    console.log("");
    await pause(rl);
  }
}

async function rulesMenu(rl) {
  for (;;) {
    printHeader();
    console.log(`=== ${t("rulesMenu")} ===`);
    console.log(`1. ${t("rulesList")}`);
    console.log(`2. ${t("rulesAdd")}`);
    console.log(`3. ${t("rulesDelete")}`);
    console.log(`4. ${t("rulesEnable")}`);
    console.log(`5. ${t("rulesDisable")}`);
    console.log(`6. ${t("rulesValidate")}`);
    console.log(`0. ${t("back")}`);
    console.log("");
    const choice = await rl.question(`${t("choice")}: `);
    if (choice.trim() === "0") return;
    if (choice.trim() === "1") await listRules(rl);
    else if (choice.trim() === "2") await addRule(rl);
    else if (choice.trim() === "3") await deleteRule(rl);
    else if (choice.trim() === "4") await setRuleEnabled(rl, true);
    else if (choice.trim() === "5") await setRuleEnabled(rl, false);
    else if (choice.trim() === "6") await validateRules(rl);
  }
}

async function listRules(rl) {
  printHeader();
  runGuard(["rules", "list", "--format", "text"], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function addRule(rl) {
  printHeader();
  const kindChoice = await ask(rl, "ruleKind", "2");
  const kind = kindChoice.trim() === "1" ? "input" : "response";
  const id = await ask(rl, "ruleId");
  const patterns = await ask(rl, "rulePatterns");
  const risk = await ask(rl, "ruleRisk", "medium");
  const descriptionZh = await ask(rl, "ruleZh");
  const descriptionEn = await ask(rl, "ruleEn");
  if (!id || !patterns) {
    console.log(t("noInput"));
    await pause(rl);
    return;
  }
  const instruction = descriptionZh || descriptionEn || "Manual rule added from CLI panel.";
  console.log("");
  runGuard([
    "rules", "add",
    "--kind", kind,
    "--id", id,
    "--patterns", patterns,
    "--risk", risk,
    "--instruction", instruction,
    "--description-zh", descriptionZh,
    "--description-en", descriptionEn,
    "--format", "text"
  ], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function deleteRule(rl) {
  printHeader();
  const id = await ask(rl, "ruleId");
  if (!id) {
    console.log(t("noInput"));
    await pause(rl);
    return;
  }
  const confirm = await ask(rl, "confirmDelete");
  if (confirm !== "DELETE") {
    console.log(t("ruleDeletedCancelled"));
    await pause(rl);
    return;
  }
  console.log("");
  runGuard(["rules", "delete", "--id", id, "--format", "text"], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function setRuleEnabled(rl, enabled) {
  printHeader();
  const id = await ask(rl, "ruleId");
  if (!id) {
    console.log(t("noInput"));
    await pause(rl);
    return;
  }
  console.log("");
  runGuard(["rules", enabled ? "enable" : "disable", "--id", id, "--format", "text"], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function validateRules(rl) {
  printHeader();
  runGuard(["rules", "validate"], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function openDashboard(rl) {
  printHeader();
  try {
    if (isWindows) {
      spawn("cmd.exe", ["/c", "start", "", path.join(ROOT, "START_DASHBOARD.bat")], {
        cwd: ROOT,
        detached: true,
        stdio: "ignore"
      }).unref();
    } else {
      spawn(process.execPath, [path.join(ROOT, "dashboard.mjs")], {
        cwd: ROOT,
        detached: true,
        stdio: "ignore"
      }).unref();
    }
    console.log(t("dashboardStarted"));
  } catch {
    console.log(t("dashboardFailed"));
  }
  console.log("");
  await pause(rl);
}

async function systemCheck(rl) {
  printHeader();
  console.log(`${t("systemNode")}:`);
  runNode(["--version"], { quietExitCode: true });
  console.log("");
  console.log(t("systemManifest"));
  runGuard(["manifest", "check", "--format", "text"], { quietExitCode: true });
  console.log("");
  console.log(t("systemRules"));
  runGuard(["rules", "validate"], { quietExitCode: true });
  console.log("");
  console.log(t("systemTests"));
  runNode(["--test"], { quietExitCode: true });
  console.log("");
  await pause(rl);
}

async function contextMenu(rl) {
  for (;;) {
    printHeader();
    console.log(`=== ${t("contextMenu")} ===`);
    console.log(`1. ${t("setAgent")}`);
    console.log(`2. ${t("setSession")}`);
    console.log(`3. ${t("clearSession")}`);
    console.log(`4. ${t("setAudit")}`);
    console.log(`5. ${t("clearAudit")}`);
    console.log(`0. ${t("back")}`);
    console.log("");
    const choice = await rl.question(`${t("choice")}: `);
    if (choice.trim() === "0") return;
    if (choice.trim() === "1") state.agent = await ask(rl, "agentPrompt", "hermes");
    else if (choice.trim() === "2") state.sessionId = await ask(rl, "sessionPrompt");
    else if (choice.trim() === "3") state.sessionId = "";
    else if (choice.trim() === "4") state.auditDir = await ask(rl, "auditPrompt");
    else if (choice.trim() === "5") state.auditDir = "";
  }
}

function printMenu() {
  printHeader();
  const items = [
    t("menuHealth"),
    t("menuCheck"),
    t("menuDetails"),
    t("menuReport"),
    t("menuSessions"),
    t("menuTask"),
    t("menuEvidence"),
    t("menuSettings"),
    t("menuRules"),
    t("menuDashboard"),
    t("menuSystem"),
    t("menuContext"),
    t("menuLanguage")
  ];
  items.forEach((item, index) => console.log(`${index + 1}. ${item}`));
  console.log(`0. ${t("exit")}`);
  console.log("");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log(t("selfTestOk"));
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      printMenu();
      const choice = await rl.question(`${t("choice")}: `);
      const normalized = choice.trim();
      if (normalized === "0") return;
      if (normalized === "1") await health(rl);
      else if (normalized === "2") await checkResponse(rl);
      else if (normalized === "3") await latestDetails(rl);
      else if (normalized === "4") await sessionReport(rl);
      else if (normalized === "5") await chooseSession(rl);
      else if (normalized === "6") await taskMenu(rl);
      else if (normalized === "7") await addManualEvidence(rl);
      else if (normalized === "8") await settingsMenu(rl);
      else if (normalized === "9") await rulesMenu(rl);
      else if (normalized === "10") await openDashboard(rl);
      else if (normalized === "11") await systemCheck(rl);
      else if (normalized === "12") await contextMenu(rl);
      else if (normalized === "13") state.language = state.language === "zh" ? "en" : "zh";
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
