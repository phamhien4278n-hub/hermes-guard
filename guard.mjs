#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const VERSION = "1.7.9";
const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const DEFAULT_RULES = path.join(ROOT, "rules.json");
const DEFAULT_RULES_DIR = path.join(ROOT, "rules.d");
const DEFAULT_AUDIT_DIR = process.env.HERMES_GUARD_AUDIT_DIR || path.join(ROOT, "audit");
const DEFAULT_CASES_FILE = path.join(ROOT, "cases", "cases.jsonl");
const DEFAULT_SETTINGS_FILE = path.join(ROOT, "settings.json");
const DEFAULT_MANIFEST = path.join(ROOT, "VERSION_MANIFEST.json");
const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 };
const SCALE_LIMITS = {
  recommended_rules: 5000,
  recommended_patterns: 20000,
  max_pattern_length: 200
};
const DEFAULT_SETTINGS = {
  stale_session_minutes: 10,
  cooldown_turns: 3,
  max_warnings_per_session: 5,
  recommended_rules: 5000,
  recommended_patterns: 20000,
  toast_enabled: true,
  show_low_risk: false
};
const EVIDENCE_KINDS = new Set([
  "file_read",
  "file_write",
  "command_run",
  "test_passed",
  "web_verified",
  "manual_review"
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    if (key === "stdin") {
      args.stdin = true;
      continue;
    }
    args[key] = argv[i + 1] ?? "";
    i += 1;
  }
  return args;
}

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function readInput(args, field) {
  if (args[field]) return args[field];
  const file = args[`${field}-file`];
  if (file) return fs.readFileSync(file, "utf8");
  if (args.stdin) return readStdin();
  return "";
}

function fileSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadManifest(file = DEFAULT_MANIFEST) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadRules(file) {
  const base = JSON.parse(fs.readFileSync(file, "utf8"));
  const bundle = {
    version: base.version || VERSION,
    input_rules: annotateRules(base.input_rules || [], file),
    response_rules: annotateRules(base.response_rules || [], file)
  };

  const dir = path.join(path.dirname(file), "rules.d");
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const name of files) {
      const source = path.join(dir, name);
      const extra = JSON.parse(fs.readFileSync(source, "utf8"));
      bundle.input_rules.push(...annotateRules(extra.input_rules || [], source));
      bundle.response_rules.push(...annotateRules(extra.response_rules || [], source));
    }
  }
  return bundle;
}

function annotateRules(rules, source) {
  return rules.map((rule) => ({ enabled: true, ...rule, source }));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSessionId(sessionId) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "default";
}

function nowIso() {
  const date = new Date();
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    offset
  ].join("");
}

function statePath(auditDir, sessionId) {
  return path.join(auditDir, `${safeSessionId(sessionId)}.state.json`);
}

function auditPath(auditDir, sessionId) {
  return path.join(auditDir, `${safeSessionId(sessionId)}.jsonl`);
}

function evidencePath(auditDir, sessionId) {
  return path.join(auditDir, `${safeSessionId(sessionId)}.evidence.jsonl`);
}

function currentSessionPointerPath(auditDir) {
  return path.join(auditDir, ".current_session");
}

function bridgeStatusPath(auditDir) {
  return path.join(auditDir, ".bridge_status.json");
}

function settingsFile(args = {}) {
  return args["settings-file"] || process.env.HERMES_GUARD_SETTINGS_FILE || DEFAULT_SETTINGS_FILE;
}

function coerceSettingValue(key, value) {
  if (!(key in DEFAULT_SETTINGS)) {
    throw new Error(`Unknown setting: ${key}`);
  }
  const current = DEFAULT_SETTINGS[key];
  if (typeof current === "boolean") {
    const lowered = String(value).toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
    throw new Error(`Setting ${key} must be true or false.`);
  }
  if (typeof current === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`Setting ${key} must be a non-negative number.`);
    }
    return number;
  }
  return String(value);
}

function loadSettings(args = {}) {
  const file = settingsFile(args);
  if (!fs.existsSync(file)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(args, settings) {
  const file = settingsFile(args);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
  return file;
}

function newestStateSessionId(auditDir) {
  if (!fs.existsSync(auditDir)) return "";
  const files = fs.readdirSync(auditDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".state.json"))
    .map((entry) => {
      const full = path.join(auditDir, entry.name);
      return {
        id: entry.name.slice(0, -".state.json".length),
        mtimeMs: fs.statSync(full).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.id || "";
}

function currentSessionId(auditDir, fallback = "default") {
  const pointer = currentSessionPointerPath(auditDir);
  if (fs.existsSync(pointer)) {
    const pointed = fs.readFileSync(pointer, "utf8").trim();
    if (pointed && (
      fs.existsSync(statePath(auditDir, pointed))
      || fs.existsSync(auditPath(auditDir, pointed))
      || fs.existsSync(evidencePath(auditDir, pointed))
    )) return pointed;
  }
  return newestStateSessionId(auditDir) || fallback;
}

function latestEventTime(auditDir, sessionId) {
  const candidates = [
    statePath(auditDir, sessionId),
    auditPath(auditDir, sessionId),
    evidencePath(auditDir, sessionId)
  ].filter((file) => fs.existsSync(file));
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((file) => fs.statSync(file).mtimeMs))).toISOString();
}

function loadState(auditDir, sessionId) {
  ensureDir(auditDir);
  const file = statePath(auditDir, sessionId);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      const rebuilt = rebuildStateFromAudit(auditDir, sessionId);
      saveState(auditDir, sessionId, { ...rebuilt, recovered_from_corrupt_state: true });
      return rebuilt;
    }
  }
  const rebuilt = rebuildStateFromAudit(auditDir, sessionId);
  if (Object.keys(rebuilt).length) saveState(auditDir, sessionId, { ...rebuilt, recovered_from_missing_state: true });
  return rebuilt;
}

function saveState(auditDir, sessionId, state) {
  ensureDir(auditDir);
  const target = statePath(auditDir, sessionId);
  atomicWriteJson(target, { ...state, updated_at: nowIso() });
}

function atomicWriteJson(target, data) {
  ensureDir(path.dirname(target));
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

function rebuildStateFromAudit(auditDir, sessionId) {
  const events = readJsonl(auditPath(auditDir, sessionId));
  const state = {};
  let maxTurn = 0;
  for (const event of events) {
    if (event.type === "input" && Number(event.turn_index) > maxTurn) {
      maxTurn = Number(event.turn_index);
    }
    if (event.type === "task_set" && event.task) {
      state.current_task = event.task;
      state.current_objective = event.task.objective || null;
    }
    if (event.type === "task_clear") {
      delete state.current_task;
      delete state.current_objective;
    }
  }
  if (maxTurn > 0) state.turn_index = maxTurn;
  return state;
}

function nextTurnIndex(auditDir, sessionId) {
  const state = loadState(auditDir, sessionId);
  const rebuilt = rebuildStateFromAudit(auditDir, sessionId);
  const turnIndex = Math.max(Number(state.turn_index || 0), Number(rebuilt.turn_index || 0)) + 1;
  saveState(auditDir, sessionId, { ...state, turn_index: turnIndex });
  return turnIndex;
}

function maxRisk(risks) {
  if (!risks.length) return "none";
  return risks.reduce((best, risk) => (RISK_ORDER[risk] > RISK_ORDER[best] ? risk : best), "none");
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const items = [];
  const errors = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      items.push(JSON.parse(line));
    } catch (error) {
      errors.push({
        file,
        line_number: index + 1,
        error: error.message,
        excerpt: line.slice(0, 240),
        detected_at: nowIso()
      });
    }
  });
  writeJsonlErrors(file, errors);
  return items;
}

function jsonlErrorPath(file) {
  return `${file}.errors.jsonl`;
}

function writeJsonlErrors(file, errors) {
  try {
    const sidecar = jsonlErrorPath(file);
    if (!errors.length) {
      if (fs.existsSync(sidecar)) fs.writeFileSync(sidecar, "", "utf8");
      return;
    }
    fs.writeFileSync(sidecar, `${errors.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  } catch {
    // JSONL error reporting should never break primary reads.
  }
}

function jsonlErrorSummary(auditDir, sessionId) {
  const files = [
    jsonlErrorPath(auditPath(auditDir, sessionId)),
    jsonlErrorPath(evidencePath(auditDir, sessionId))
  ];
  const errors = [];
  for (const file of files) {
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) continue;
    errors.push(...readJsonlNoReport(file));
  }
  return {
    count: errors.length,
    files: files.filter((file) => fs.existsSync(file) && fs.statSync(file).size > 0),
    latest: errors.slice(-5)
  };
}

function readJsonlNoReport(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function makeId(prefix) {
  const compactTime = nowIso().replace(/[^0-9]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${compactTime}_${suffix}`;
}

function casesFile(args) {
  return args["cases-file"] || DEFAULT_CASES_FILE;
}

function loadCases(file) {
  return readJsonl(file);
}

function appendCase(file, item) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(item)}\n`, "utf8");
  return file;
}

function loadEvidence(auditDir, sessionId) {
  return readJsonl(evidencePath(auditDir, sessionId));
}

function summarizeEvidence(evidence) {
  const byKind = {};
  for (const item of evidence) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
  }
  return {
    count: evidence.length,
    by_kind: byKind,
    latest: evidence.slice(-5)
  };
}

function currentObjective(state) {
  return state.current_objective || null;
}

function filterEvidenceForObjective(evidence, objective) {
  if (!objective) return evidence;
  return evidence.filter((item) => item.objective === objective);
}

function externalFacts(agent, sessionId, turnIndex, evidence = [], state = {}) {
  return {
    agent,
    session_id: sessionId,
    guard_version: VERSION,
    local_time: nowIso(),
    turn_index: turnIndex,
    context_usage: {
      known: false,
      source: "not_exposed_to_guard_mvp"
    },
    cwd: process.cwd(),
    tool_evidence_required_for: [
      "file_read",
      "file_write",
      "command_run",
      "test_passed",
      "web_verified"
    ],
    current_objective: currentObjective(state),
    evidence: summarizeEvidence(evidence)
  };
}

function matchRules(text, rules) {
  const normalizedText = normalizeForRuleMatch(text);
  const hits = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const matchedPatterns = [];
    for (const pattern of rule.patterns || []) {
      if (normalizedText.includes(normalizeForRuleMatch(pattern))) {
        matchedPatterns.push(pattern);
      }
    }
    for (const regexSpec of rule.regex_patterns || []) {
      const pattern = typeof regexSpec === "string" ? regexSpec : regexSpec.pattern;
      const flags = typeof regexSpec === "string" ? "iu" : (regexSpec.flags || "iu");
      if (!pattern) continue;
      try {
        const regex = new RegExp(pattern, flags.includes("g") ? flags.replaceAll("g", "") : flags);
        if (regex.test(text) || regex.test(normalizedText)) {
          matchedPatterns.push(`regex:${pattern}`);
        }
      } catch {
        // Validation reports invalid regex patterns; matching skips them.
      }
    }
    if (matchedPatterns.length) {
      hits.push({ ...rule, matched_patterns: matchedPatterns });
    }
  }
  return hits;
}

function normalizeForRuleMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u180E\uFE0E\uFE0F]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function stripFencedCodeBlocks(text) {
  const source = String(text || "");
  return source.replace(/```[\s\S]*?```/g, "\n[code block omitted]\n");
}

function responseExcerpt(text, limit = 180) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3))}...`;
}

function requiredEvidenceForRule(rule) {
  const required = [];
  required.push(...(rule.default_required_any || []));
  for (const requirement of rule.evidence_requirements || []) {
    required.push(...(requirement.required_any || []));
  }
  return Array.from(new Set(required.filter(Boolean)));
}

function formatGuardedMessage(message, facts, hits, risk) {
  const lines = [
    "<external_guard>",
    `version: ${VERSION}`,
    `agent: ${facts.agent}`,
    `session_id: ${facts.session_id}`,
    `turn_index: ${facts.turn_index}`,
    `local_time: ${facts.local_time}`,
    `current_objective: ${facts.current_objective || "none"}`,
    "context_usage: unknown unless another external meter provides it",
    `evidence_count: ${facts.evidence.count}`,
    `risk: ${risk}`,
    "matched_blindspots:"
  ];

  if (hits.length) {
    for (const hit of hits) {
      lines.push(`- ${hit.id} (${hit.level || "L?"}, ${hit.risk || "unknown"}): ${hit.instruction}`);
    }
  } else {
    lines.push("- none");
  }

  lines.push(
    "required_behavior:",
    "- Treat the facts above as external evidence.",
    "- Do not claim file, command, test, web, time, context, or memory facts without evidence.",
    "- If evidence is missing, say what is missing and answer only within verified limits.",
    "</external_guard>",
    "",
    "<user_message>",
    message.trim(),
    "</user_message>"
  );
  return lines.join("\n");
}

function appendAudit(auditDir, sessionId, event) {
  ensureDir(auditDir);
  const file = auditPath(auditDir, sessionId);
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  return file;
}

function appendEvidence(auditDir, sessionId, evidence) {
  ensureDir(auditDir);
  const file = evidencePath(auditDir, sessionId);
  fs.appendFileSync(file, `${JSON.stringify(evidence)}\n`, "utf8");
  return file;
}

function hasEvidence(evidence, requiredAny) {
  if (!requiredAny || !requiredAny.length) return false;
  return evidence.some((item) => (
    requiredAny.includes(item.kind)
    && ["passed", "ok", "success", "verified"].includes(String(item.status || "passed").toLowerCase())
  ));
}

function evidenceText(item) {
  return [
    item.summary,
    item.subject,
    item.ref,
    item.claim_text,
    item.claim_id,
    item.metadata ? JSON.stringify(item.metadata) : ""
  ].filter(Boolean).join(" ").toLowerCase();
}

function claimTokens(text, hit) {
  const source = [
    text,
    ...(hit.matched_patterns || []).filter((pattern) => !String(pattern).startsWith("regex:"))
  ].join(" ");
  const tokens = new Set();
  const normalized = String(source || "").toLowerCase();
  const compact = normalizeForRuleMatch(source);
  const cjkPhrases = compact.match(/[\u3400-\u9FFF][\u3400-\u9FFF0-9a-z_.-]{1,24}/gi) || [];
  for (const phrase of cjkPhrases) {
    if (phrase.length >= 2) tokens.add(phrase.toLowerCase());
  }
  const numeric = normalized.match(/\b\d+(?:\.\d+)?\s*%?\b/g) || [];
  for (const token of numeric) tokens.add(token.replace(/\s+/g, ""));
  const named = normalized.match(/\b[a-z][a-z0-9_.-]*(?:[-/][a-z0-9_.-]+)*\b/g) || [];
  const stop = new Set([
    "the", "and", "for", "with", "this", "that", "score", "accuracy", "acc",
    "rank", "ranked", "benchmark", "leaderboard", "pass", "claim", "response"
  ]);
  for (const token of named) {
    if (token.length < 3) continue;
    if (stop.has(token)) continue;
    tokens.add(token);
  }
  return Array.from(tokens);
}

function evidenceMatchesClaim(item, tokens) {
  if (!tokens.length) return false;
  const text = evidenceText(item);
  if (!text) return false;
  return tokens.some((token) => text.includes(token));
}

function supportingEvidence(evidence, requiredAny, hit, responseText = "") {
  if (!requiredAny || !requiredAny.length) return [];
  const candidates = evidence.filter((item) => (
    requiredAny.includes(item.kind)
    && ["passed", "ok", "success", "verified"].includes(String(item.status || "passed").toLowerCase())
  ));
  if (hit.evidence_policy !== "strict_subject") return candidates;
  const tokens = claimTokens(responseText, hit);
  return candidates.filter((item) => evidenceMatchesClaim(item, tokens));
}

function hasSupportingEvidence(evidence, requiredAny, hit, responseText = "") {
  return supportingEvidence(evidence, requiredAny, hit, responseText).length > 0;
}

function evaluateResponseHit(hit, evidence, responseText = "") {
  const requirements = hit.evidence_requirements || [];
  if (!requirements.length) {
    const defaultRequiredAny = hit.default_required_any || [];
    if (defaultRequiredAny.length && hasSupportingEvidence(evidence, defaultRequiredAny, hit, responseText)) {
      return {
        ...hit,
        supported: true,
        supported_claims: (hit.matched_patterns || []).map((pattern) => ({
          pattern,
          required_any: defaultRequiredAny
        })),
        unsupported_claims: []
      };
    }
    return {
      ...hit,
      supported: false,
      unsupported_claims: hit.matched_patterns || []
    };
  }

  const unsupportedClaims = [];
  const supportedClaims = [];
  for (const pattern of hit.matched_patterns || []) {
    const requirement = requirements.find((item) => (
      (item.patterns || []).some((candidate) => String(candidate).toLowerCase() === String(pattern).toLowerCase())
    ));

    if (!requirement) {
      const defaultRequiredAny = hit.default_required_any || [];
      if (hasSupportingEvidence(evidence, defaultRequiredAny, hit, responseText)) {
        supportedClaims.push({ pattern, required_any: defaultRequiredAny });
      } else {
        unsupportedClaims.push(pattern);
      }
      continue;
    }

    const requiredAny = requirement.required_any || [];
    if (hasSupportingEvidence(evidence, requiredAny, hit, responseText)) {
      supportedClaims.push({ pattern, required_any: requiredAny });
    } else {
      unsupportedClaims.push(pattern);
    }
  }

  return {
    ...hit,
    supported: unsupportedClaims.length === 0,
    supported_claims: supportedClaims,
    unsupported_claims: unsupportedClaims
  };
}

function printResult(result, format) {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.added) {
    console.log(`added: ${result.added.id}`);
    console.log(`source: ${result.source}`);
  } else if (result.updated) {
    console.log(`updated: ${result.updated.id}`);
    console.log(`source: ${result.source}`);
  } else if (result.deleted) {
    console.log(`deleted: ${result.deleted.id}`);
    console.log(`source: ${result.source}`);
  } else if (result.id && Object.hasOwn(result, "enabled")) {
    console.log(`${result.enabled ? "enabled" : "disabled"}: ${result.id}`);
    console.log(`source: ${result.source}`);
  } else if (result.command === "check-response") {
    printReadableResponseCheck(result);
  } else if (result.guarded_message) {
    console.log(result.guarded_message);
  } else if (result.matches.length) {
    console.log(`risk: ${result.risk}`);
    for (const hit of result.matches) {
      console.log(`- ${hit.id}: ${hit.instruction}`);
    }
  } else {
    console.log("risk: none");
  }
}

function printReadableResponseCheck(result) {
  if (!result.matches.length) {
    console.log("OK | no unsupported response claims");
    if (result.supported_matches?.length) {
      console.log(`supported: ${result.supported_matches.map((item) => item.id).join(", ")}`);
    }
    return;
  }

  const first = result.matches[0];
  console.log(`${String(result.risk || "unknown").toUpperCase()} | ${first.id}`);
  if (result.response_excerpt) {
    console.log(`  "${result.response_excerpt}"`);
  }
  const reason = first.explanation_zh || first.instruction || "Unsupported claim lacks evidence.";
  console.log(`  Reason: ${reason}`);
  const required = first.required_evidence || [];
  if (required.length) {
    console.log(`  Required evidence: ${required.join(", ")}`);
  }
  console.log("  Suggested actions:");
  console.log("  - Register evidence if the claim is already verified.");
  console.log("  - Rewrite as unverified if evidence is missing.");
  console.log("  - Run the needed check before claiming completion.");
  console.log(`  Details: ${result.detail_command}`);
}

function splitList(value) {
  if (!value) return [];
  const trimmed = String(value).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return trimmed
    .split(/[|,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ruleCollection(kind) {
  if (kind === "input") return "input_rules";
  if (kind === "response") return "response_rules";
  throw new Error(`Unsupported rule kind: ${kind}`);
}

function rulesDirFor(rulesFile) {
  return path.join(path.dirname(rulesFile || DEFAULT_RULES), "rules.d");
}

function customRulesFile(rulesFile) {
  return path.join(rulesDirFor(rulesFile), "custom.json");
}

function loadRuleFile(file) {
  if (!fs.existsSync(file)) {
    return { version: VERSION, input_rules: [], response_rules: [] };
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveRuleFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function ruleFiles(rulesFile) {
  const files = [rulesFile];
  const dir = rulesDirFor(rulesFile);
  if (fs.existsSync(dir)) {
    files.push(...fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(dir, name)));
  }
  return files;
}

function findRuleLocation(rulesFile, id, kind = "") {
  for (const file of ruleFiles(rulesFile)) {
    const data = loadRuleFile(file);
    const collections = kind ? [ruleCollection(kind)] : ["input_rules", "response_rules"];
    for (const collection of collections) {
      const index = (data[collection] || []).findIndex((rule) => rule.id === id);
      if (index >= 0) {
        return { file, data, collection, index, rule: data[collection][index] };
      }
    }
  }
  return null;
}

const RULE_EXPLANATIONS = {
  real_time: {
    zh: "当请求当前时间、今天、最新状态等实时信息时，提醒模型必须使用外部来源或明确说明未核验。",
    en: "Requests about current time, today, or live status require external evidence or an explicit unverified caveat."
  },
  paper_verification: {
    zh: "当用户要求核验论文、作者、会议或 DOI 真实性时，提醒模型逐项核验来源，避免凭记忆确认。",
    en: "Paper, author, venue, or DOI verification should be checked against sources instead of answered from memory."
  },
  context_usage: {
    zh: "当模型谈到上下文、记忆、token 或历史聊天时，提醒它不要声称看见了未暴露的信息。",
    en: "Claims about context, memory, tokens, or hidden chat history must not exceed externally available facts."
  },
  turn_count: {
    zh: "当涉及第几轮、聊了多久等会话计数时，使用 guard 记录的轮数，不凭感觉估计。",
    en: "Turn-count questions should use the guard's recorded count rather than a guess."
  },
  file_access: {
    zh: "当模型声称读写过文件时，要求有实际文件或命令证据。",
    en: "File read/write claims need file or command evidence."
  },
  latest_version: {
    zh: "当涉及最新版本、最新规则或最新资料时，提醒模型核验当前资料。",
    en: "Latest-version claims should be verified against current sources."
  },
  memory_claim: {
    zh: "当模型声称记得、保存了或之后会记住时，要求明确外部记录能力和证据。",
    en: "Memory or persistence claims require a real external record or a clear limitation."
  },
  token_estimate: {
    zh: "当模型估计 token 或剩余上下文时，提醒它标注估计来源和不确定性。",
    en: "Token/context estimates should state their source and uncertainty."
  },
  unsupported_completion_claim: {
    zh: "回复声称已经完成、测试通过、文件已写入等，但当前任务没有对应证据时拦截。",
    en: "Flags completion, testing, or file-write claims when matching evidence is missing."
  },
  unsupported_source_claim: {
    zh: "回复声称论文、研究、官方文档或最新资料支持某结论，但没有来源证据时拦截。",
    en: "Flags source-backed claims when no source evidence is registered."
  },
  unsupported_future_commitment: {
    zh: "回复承诺以后记录、回头补、晚点处理等时提醒：要么现在执行并留证，要么说清只是计划。",
    en: "Flags future promises to record, save, fix, or handle later unless they are completed with evidence or framed as plans."
  },
  unsupported_numeric_benchmark_claim: {
    zh: "回复出现分数、百分比、排名或 benchmark 数字时，要求网页核验或人工证据。",
    en: "Flags benchmark, score, percentage, or ranking claims unless supported by web or manual evidence."
  }
};

function ruleExplanation(rule, language) {
  const key = language === "zh" ? "zh" : "en";
  const customKey = language === "zh" ? "description_zh" : "description_en";
  return rule[customKey] || rule[`explanation_${key}`] || RULE_EXPLANATIONS[rule.id]?.[key] || rule.instruction || "";
}

function scaleLimitsFromArgs(args = {}) {
  return {
    recommended_rules: Number(args["recommended-rules"] || process.env.HERMES_GUARD_RECOMMENDED_RULES || SCALE_LIMITS.recommended_rules),
    recommended_patterns: Number(args["recommended-patterns"] || process.env.HERMES_GUARD_RECOMMENDED_PATTERNS || SCALE_LIMITS.recommended_patterns),
    max_pattern_length: Number(args["max-pattern-length"] || process.env.HERMES_GUARD_MAX_PATTERN_LENGTH || SCALE_LIMITS.max_pattern_length)
  };
}

function validateRulesBundle(bundle, limits = SCALE_LIMITS) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const seenPatterns = new Map();
  const allRules = [
    ...bundle.input_rules.map((rule) => ({ ...rule, kind: "input" })),
    ...bundle.response_rules.map((rule) => ({ ...rule, kind: "response" }))
  ];
  let patternCount = 0;

  for (const rule of allRules) {
    if (!rule.id) {
      errors.push({ code: "missing_id", source: rule.source || "unknown" });
      continue;
    }
    if (seen.has(rule.id)) {
      errors.push({
        code: "duplicate_id",
        id: rule.id,
        first_source: seen.get(rule.id),
        source: rule.source || "unknown"
      });
    } else {
      seen.set(rule.id, rule.source || "unknown");
    }
    const hasPatterns = Array.isArray(rule.patterns) && rule.patterns.length > 0;
    const hasRegexPatterns = Array.isArray(rule.regex_patterns) && rule.regex_patterns.length > 0;
    if (!hasPatterns && !hasRegexPatterns) {
      errors.push({ code: "missing_patterns", id: rule.id, source: rule.source || "unknown" });
    }
    patternCount += Array.isArray(rule.patterns) ? rule.patterns.length : 0;
    patternCount += Array.isArray(rule.regex_patterns) ? rule.regex_patterns.length : 0;
    if (!rule.instruction) {
      warnings.push({ code: "missing_instruction", id: rule.id, source: rule.source || "unknown" });
    }
    if (rule.patterns?.some((pattern) => !String(pattern).trim())) {
      errors.push({ code: "empty_pattern", id: rule.id, source: rule.source || "unknown" });
    }
    for (const pattern of rule.patterns || []) {
      const value = String(pattern);
      const key = `${rule.kind}:${value.toLowerCase()}`;
      if (value.length > limits.max_pattern_length) {
        warnings.push({
          code: "long_pattern",
          id: rule.id,
          pattern_length: value.length,
          max_recommended: limits.max_pattern_length,
          source: rule.source || "unknown"
        });
      }
      if (seenPatterns.has(key)) {
        warnings.push({
          code: "duplicate_pattern",
          id: rule.id,
          pattern: value,
          first_rule: seenPatterns.get(key),
          source: rule.source || "unknown"
        });
      } else {
        seenPatterns.set(key, rule.id);
      }
    }
    for (const regexSpec of rule.regex_patterns || []) {
      const pattern = typeof regexSpec === "string" ? regexSpec : regexSpec.pattern;
      const flags = typeof regexSpec === "string" ? "iu" : (regexSpec.flags || "iu");
      if (!pattern) {
        errors.push({ code: "empty_regex_pattern", id: rule.id, source: rule.source || "unknown" });
        continue;
      }
      try {
        new RegExp(pattern, flags.includes("g") ? flags.replaceAll("g", "") : flags);
      } catch (error) {
        errors.push({
          code: "invalid_regex_pattern",
          id: rule.id,
          pattern,
          error: String(error.message || error),
          source: rule.source || "unknown"
        });
      }
    }
  }

  if (allRules.length > limits.recommended_rules) {
    warnings.push({
      code: "large_rule_count",
      total_rules: allRules.length,
      recommended: limits.recommended_rules
    });
  }
  if (patternCount > limits.recommended_patterns) {
    warnings.push({
      code: "large_pattern_count",
      total_patterns: patternCount,
      recommended: limits.recommended_patterns
    });
  }

  return {
    ok: errors.length === 0,
    stats: {
      input_rules: bundle.input_rules.length,
      response_rules: bundle.response_rules.length,
      total_rules: allRules.length,
      total_patterns: patternCount,
      enabled_rules: allRules.filter((rule) => rule.enabled !== false).length,
      disabled_rules: allRules.filter((rule) => rule.enabled === false).length,
      scale_limits: limits
    },
    errors,
    warnings
  };
}

function rulesList(args) {
  const rulesFile = args.rules || DEFAULT_RULES;
  const bundle = loadRules(rulesFile);
  const kind = args.kind || "all";
  const rows = [];
  if (kind === "all" || kind === "input") {
    rows.push(...bundle.input_rules.map((rule) => ({ kind: "input", ...rule })));
  }
  if (kind === "all" || kind === "response") {
    rows.push(...bundle.response_rules.map((rule) => ({ kind: "response", ...rule })));
  }
  const result = {
    version: VERSION,
    rules: rows.map((rule) => ({
      kind: rule.kind,
      id: rule.id,
      enabled: rule.enabled !== false,
      level: rule.level || "",
      risk: rule.risk || "",
      category: rule.category || "",
      tags: rule.tags || [],
      patterns_count: (rule.patterns || []).length,
      explanation_zh: ruleExplanation(rule, "zh"),
      explanation_en: ruleExplanation(rule, "en"),
      source: rule.source || ""
    })),
    matches: [],
    risk: "none"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log(`rules: ${result.rules.length}`);
    for (const rule of result.rules) {
      console.log(`${rule.enabled ? "ON " : "OFF"} | ${rule.kind} | ${rule.risk || "none"} | ${rule.id}`);
      const explain = rule.explanation_zh || rule.explanation_en;
      if (explain) console.log(`  ${explain}`);
    }
  }
  return 0;
}

function rulesValidate(args) {
  const bundle = loadRules(args.rules || DEFAULT_RULES);
  const result = {
    version: VERSION,
    validation: validateRulesBundle(bundle, scaleLimitsFromArgs(args)),
    matches: [],
    risk: "none"
  };
  printResult(result, args.format || "json");
  return result.validation.ok ? 0 : 1;
}

function rulesStats(args) {
  const bundle = loadRules(args.rules || DEFAULT_RULES);
  const validation = validateRulesBundle(bundle, scaleLimitsFromArgs(args));
  const result = {
    version: VERSION,
    stats: validation.stats,
    warning_count: validation.warnings.length,
    error_count: validation.errors.length,
    ok: validation.ok,
    matches: [],
    risk: "none"
  };
  printResult(result, args.format || "json");
  return validation.ok ? 0 : 1;
}

function manifestCheck(args) {
  const manifestFile = args.manifest || DEFAULT_MANIFEST;
  const manifest = loadManifest(manifestFile);
  if (!manifest) {
    printResult({
      version: VERSION,
      ok: false,
      manifest_file: manifestFile,
      errors: [{ code: "manifest_missing", file: manifestFile }],
      warnings: [],
      matches: ["manifest_missing"],
      risk: "medium"
    }, args.format || "json");
    return 1;
  }

  const errors = [];
  const warnings = [];
  if (manifest.version !== VERSION) {
    errors.push({ code: "version_mismatch", expected: manifest.version, actual: VERSION });
  }
  for (const item of manifest.files || []) {
    const file = path.join(ROOT, item.path);
    if (!fs.existsSync(file)) {
      errors.push({ code: "file_missing", path: item.path });
      continue;
    }
    const actual = fileSha256(file);
    if (item.sha256 && actual !== item.sha256) {
      errors.push({ code: "sha256_mismatch", path: item.path, expected: item.sha256, actual });
    }
  }
  for (const item of manifest.optional_files || []) {
    const file = path.join(ROOT, item.path);
    if (!fs.existsSync(file)) warnings.push({ code: "optional_file_missing", path: item.path });
  }
  const ok = errors.length === 0;
  const result = {
    version: VERSION,
    manifest_version: manifest.version,
    manifest_file: manifestFile,
    ok,
    checked_files: (manifest.files || []).length,
    errors,
    warnings,
    matches: errors.map((error) => error.code),
    risk: ok ? "none" : "high"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log(`manifest: ${ok ? "ok" : "failed"}`);
    console.log(`version: ${VERSION}`);
    for (const error of errors) console.log(`ERROR ${error.code}: ${error.path || ""}`);
    for (const warning of warnings) console.log(`WARN ${warning.code}: ${warning.path || ""}`);
  }
  return ok ? 0 : 1;
}

function rulesAdd(args) {
  const rulesFile = args.rules || DEFAULT_RULES;
  const kind = args.kind || "input";
  const collection = ruleCollection(kind);
  const id = args.id || "";
  if (!id.trim()) {
    console.error("No rule id provided. Use --id.");
    return 2;
  }
  if (findRuleLocation(rulesFile, id)) {
    console.error(`Rule already exists: ${id}`);
    return 2;
  }
  const patterns = splitList(args.patterns || "");
  if (!patterns.length) {
    console.error("No patterns provided. Use --patterns \"a|b\".");
    return 2;
  }
  const target = args["rules-out"] || customRulesFile(rulesFile);
  const data = loadRuleFile(target);
  data[collection] = data[collection] || [];
  const rule = {
    id,
    enabled: args.enabled ? args.enabled !== "false" : true,
    level: args.level || (kind === "input" ? "L1" : ""),
    risk: args.risk || "medium",
    category: args.category || "",
    tags: splitList(args.tags || ""),
    patterns,
    instruction: args.instruction || "",
    description_zh: args["description-zh"] || args.description_zh || "",
    description_en: args["description-en"] || args.description_en || ""
  };
  data[collection].push(rule);
  saveRuleFile(target, data);
  printResult({ version: VERSION, added: rule, source: target, matches: [], risk: "none" }, args.format || "json");
  return 0;
}

function rulesUpdate(args) {
  const rulesFile = args.rules || DEFAULT_RULES;
  const id = args.id || "";
  const location = findRuleLocation(rulesFile, id, args.kind || "");
  if (!location) {
    console.error(`Rule not found: ${id}`);
    return 2;
  }
  const rule = location.rule;
  if (args.patterns) rule.patterns = splitList(args.patterns);
  if (args.instruction) rule.instruction = args.instruction;
  if (args.risk) rule.risk = args.risk;
  if (args.level) rule.level = args.level;
  if (args.category) rule.category = args.category;
  if (args.tags) rule.tags = splitList(args.tags);
  if (args.enabled) rule.enabled = args.enabled !== "false";
  if (args["description-zh"] || args.description_zh) rule.description_zh = args["description-zh"] || args.description_zh;
  if (args["description-en"] || args.description_en) rule.description_en = args["description-en"] || args.description_en;
  location.data[location.collection][location.index] = rule;
  saveRuleFile(location.file, location.data);
  printResult({ version: VERSION, updated: rule, source: location.file, matches: [], risk: "none" }, args.format || "json");
  return 0;
}

function rulesSetEnabled(args, enabled) {
  const rulesFile = args.rules || DEFAULT_RULES;
  const id = args.id || "";
  const location = findRuleLocation(rulesFile, id, args.kind || "");
  if (!location) {
    console.error(`Rule not found: ${id}`);
    return 2;
  }
  location.rule.enabled = enabled;
  location.data[location.collection][location.index] = location.rule;
  saveRuleFile(location.file, location.data);
  printResult({
    version: VERSION,
    id,
    enabled,
    source: location.file,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function rulesDelete(args) {
  const rulesFile = args.rules || DEFAULT_RULES;
  const id = args.id || "";
  const location = findRuleLocation(rulesFile, id, args.kind || "");
  if (!location) {
    console.error(`Rule not found: ${id}`);
    return 2;
  }
  const removed = location.data[location.collection].splice(location.index, 1)[0];
  saveRuleFile(location.file, location.data);
  printResult({
    version: VERSION,
    deleted: removed,
    source: location.file,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function casesAdd(args) {
  const file = casesFile(args);
  const id = args.id || makeId("case");
  const kind = args.kind || "input";
  let candidate_rule = null;
  if (args["rule-id"] || args.patterns || args.instruction) {
    candidate_rule = {
      id: args["rule-id"] || `rule_from_${id}`,
      enabled: false,
      level: args.level || (kind === "input" ? "L1" : ""),
      risk: args.risk || "medium",
      category: args.category || "from_case",
      tags: splitList(args.tags || "case"),
      patterns: splitList(args.patterns || args.trigger || ""),
      instruction: args.instruction || args["correct-behavior"] || "",
      kind
    };
  }

  const item = {
    id,
    type: "case",
    created_at: nowIso(),
    title: args.title || "",
    trigger: args.trigger || "",
    bad_behavior: args["bad-behavior"] || "",
    correct_behavior: args["correct-behavior"] || "",
    notes: args.notes || "",
    status: args.status || "new",
    candidate_rule
  };
  appendCase(file, item);
  printResult({ version: VERSION, case: item, cases_file: file, matches: [], risk: "none" }, args.format || "json");
  return 0;
}

function casesList(args) {
  const file = casesFile(args);
  const status = args.status || "";
  let cases = loadCases(file);
  if (status) {
    cases = cases.filter((item) => item.status === status);
  }
  printResult({
    version: VERSION,
    cases,
    count: cases.length,
    cases_file: file,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function casesPromote(args) {
  const file = casesFile(args);
  const id = args.id || "";
  const item = loadCases(file).find((entry) => entry.id === id);
  if (!item) {
    console.error(`Case not found: ${id}`);
    return 2;
  }
  if (!item.candidate_rule) {
    console.error(`Case has no candidate_rule: ${id}`);
    return 2;
  }

  const rulesFile = args.rules || DEFAULT_RULES;
  const candidate = { ...item.candidate_rule };
  const kind = candidate.kind || args.kind || "input";
  delete candidate.kind;
  candidate.enabled = args.enabled ? args.enabled !== "false" : true;

  if (findRuleLocation(rulesFile, candidate.id)) {
    console.error(`Rule already exists: ${candidate.id}`);
    return 2;
  }
  if (!candidate.patterns || candidate.patterns.length === 0) {
    console.error(`Candidate rule has no patterns: ${candidate.id}`);
    return 2;
  }

  const target = args["rules-out"] || path.join(rulesDirFor(rulesFile), "from_cases.json");
  const data = loadRuleFile(target);
  const collection = ruleCollection(kind);
  data[collection] = data[collection] || [];
  data[collection].push(candidate);
  saveRuleFile(target, data);

  printResult({
    version: VERSION,
    promoted_case: id,
    added_rule: candidate,
    source: target,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function buildSessionReport(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || currentSessionId(auditDir, "default");
  const state = loadState(auditDir, sessionId);
  const objective = currentObjective(state);
  const allEvidence = loadEvidence(auditDir, sessionId);
  const objectiveEvidence = filterEvidenceForObjective(allEvidence, objective);
  const auditEvents = readJsonl(auditPath(auditDir, sessionId));
  const cases = loadCases(casesFile(args));
  const recentLimit = Number(args.limit || 10);

  const responseChecks = auditEvents.filter((event) => event.type === "response_check");
  const unsupportedChecks = responseChecks.filter((event) => (event.matches || []).length > 0);
  const latestUnsupported = unsupportedChecks.slice(-recentLimit).map((event) => ({
    created_at: event.created_at,
    current_objective: event.current_objective || null,
    matches: event.matches || [],
    risk: event.risk || "none",
    response_excerpt: responseExcerpt(event.response || "")
  }));

  const result = {
    version: VERSION,
    agent,
    session_id: sessionId,
    current_objective: objective,
    current_task: state.current_task || null,
    turn_index: state.turn_index || 0,
    evidence_summary: summarizeEvidence(objective ? objectiveEvidence : allEvidence),
    all_evidence_count: allEvidence.length,
    audit_summary: {
      total_events: auditEvents.length,
      response_checks: responseChecks.length,
      unsupported_response_checks: unsupportedChecks.length,
      latest_unsupported: latestUnsupported,
      recent_events: auditEvents.slice(-recentLimit).map((event) => ({
        type: event.type,
        created_at: event.created_at,
        risk: event.risk || "none",
        matches: event.matches || []
      }))
    },
    cases_summary: {
      total_cases: cases.length,
      new_cases: cases.filter((item) => item.status === "new").length,
      promoted_candidates: cases.filter((item) => item.candidate_rule).length
    },
    matches: [],
    risk: unsupportedChecks.length ? "high" : "none"
  };

  return result;
}

function reportSession(args) {
  const result = buildSessionReport(args);
  printResult(result, args.format || "json");
  return 0;
}

function sessionsList(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  ensureDir(auditDir);
  const names = new Set();

  for (const entry of fs.readdirSync(auditDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith(".errors.jsonl")) continue;
    if (name.endsWith(".state.json")) names.add(name.slice(0, -".state.json".length));
    else if (name.endsWith(".evidence.jsonl")) names.add(name.slice(0, -".evidence.jsonl".length));
    else if (name.endsWith(".jsonl")) names.add(name.slice(0, -".jsonl".length));
  }

  const sessions = Array.from(names).sort().map((id) => {
    const state = loadState(auditDir, id);
    const evidence = loadEvidence(auditDir, id);
    const auditEvents = readJsonl(auditPath(auditDir, id));
    const latestEvent = auditEvents.at(-1) || null;
    return {
      session_id: id,
      current_objective: currentObjective(state),
      turn_index: state.turn_index || 0,
      evidence_count: evidence.length,
      audit_events: auditEvents.length,
      unsupported_response_checks: auditEvents.filter((event) => (
        event.type === "response_check" && (event.matches || []).length > 0
      )).length,
      latest_event: latestEvent ? {
        type: latestEvent.type,
        created_at: latestEvent.created_at,
        risk: latestEvent.risk || "none",
        matches: latestEvent.matches || []
      } : null
    };
  });

  printResult({
    version: VERSION,
    audit_dir: auditDir,
    count: sessions.length,
    sessions,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function auditGc(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  ensureDir(auditDir);
  const days = Number(args.days || 30);
  const apply = String(args.apply || "false").toLowerCase() === "true";
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const pointer = currentSessionPointerPath(auditDir);
  const current = fs.existsSync(pointer) ? fs.readFileSync(pointer, "utf8").trim() : "";
  const sessions = JSON.parse(capturePrint(() => sessionsList({ ...args, format: "json" }))).sessions || [];
  const candidates = [];

  for (const session of sessions) {
    if (session.session_id === current) continue;
    const files = [
      statePath(auditDir, session.session_id),
      auditPath(auditDir, session.session_id),
      evidencePath(auditDir, session.session_id),
      jsonlErrorPath(auditPath(auditDir, session.session_id)),
      jsonlErrorPath(evidencePath(auditDir, session.session_id))
    ].filter((file) => fs.existsSync(file));
    if (!files.length) continue;
    const latestMs = Math.max(...files.map((file) => fs.statSync(file).mtimeMs));
    if (latestMs >= cutoffMs) continue;
    candidates.push({
      session_id: session.session_id,
      latest_at: new Date(latestMs).toISOString(),
      files
    });
  }

  const removed = [];
  if (apply) {
    for (const candidate of candidates) {
      for (const file of candidate.files) {
        try {
          fs.rmSync(file, { force: true });
          removed.push(file);
        } catch {
          // Continue cleaning other files; result still lists intended candidates.
        }
      }
    }
  }

  const result = {
    version: VERSION,
    audit_dir: auditDir,
    dry_run: !apply,
    days,
    current_session: current || null,
    candidate_count: candidates.length,
    candidates,
    removed_count: removed.length,
    removed,
    matches: [],
    risk: "none"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log(`audit_gc: ${apply ? "applied" : "dry-run"}`);
    console.log(`days: ${days}`);
    console.log(`candidates: ${candidates.length}`);
    console.log(`removed_files: ${removed.length}`);
  }
  return 0;
}

function capturePrint(fn) {
  const original = console.log;
  const lines = [];
  console.log = (value = "") => lines.push(String(value));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

function settingsGet(args) {
  const settings = loadSettings(args);
  const result = {
    version: VERSION,
    settings,
    settings_file: settingsFile(args),
    matches: [],
    risk: "none"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log(`settings_file: ${result.settings_file}`);
    for (const [key, value] of Object.entries(settings)) {
      console.log(`${key}: ${value}`);
    }
  }
  return 0;
}

function settingsSet(args) {
  const key = args._[2] || args.key || "";
  const value = args._[3] ?? args.value;
  if (!key || value === undefined) {
    console.error("Usage: node guard.mjs settings set <key> <value>");
    return 2;
  }
  let nextValue;
  try {
    nextValue = coerceSettingValue(key, value);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const settings = loadSettings(args);
  settings[key] = nextValue;
  const file = saveSettings(args, settings);
  const result = {
    version: VERSION,
    setting: key,
    value: nextValue,
    settings,
    settings_file: file,
    matches: [],
    risk: "none"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log(`updated: ${key} = ${nextValue}`);
    console.log(`settings_file: ${file}`);
  }
  return 0;
}

function settingsReset(args) {
  const file = saveSettings(args, { ...DEFAULT_SETTINGS });
  const result = {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS },
    settings_file: file,
    matches: [],
    risk: "none"
  };
  if ((args.format || "json") === "json") {
    printResult(result, "json");
  } else {
    console.log("settings reset to defaults");
    console.log(`settings_file: ${file}`);
  }
  return 0;
}

function health(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const auditDirExists = fs.existsSync(auditDir);
  const settings = loadSettings(args);
  const sessionId = args["session-id"] || currentSessionId(auditDir, "default");
  const pointer = currentSessionPointerPath(auditDir);
  const pointerSession = fs.existsSync(pointer) ? fs.readFileSync(pointer, "utf8").trim() : "";
  const hasState = fs.existsSync(statePath(auditDir, sessionId));
  const pointerHasState = pointerSession ? fs.existsSync(statePath(auditDir, pointerSession)) : false;
  const latestAt = latestEventTime(auditDir, sessionId);
  const staleMs = Number(settings.stale_session_minutes) * 60 * 1000;
  const isStale = latestAt ? (Date.now() - Date.parse(latestAt)) > staleMs : true;
  const report = buildSessionReport({ ...args, "session-id": sessionId });
  let bridgeStatus = null;
  try {
    const file = bridgeStatusPath(auditDir);
    if (fs.existsSync(file)) bridgeStatus = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    bridgeStatus = { ok: false, error: "bridge_status_unreadable" };
  }
  const bridgeUpdatedAt = bridgeStatus?.updated_at || null;
  const bridgeStale = bridgeUpdatedAt ? (Date.now() - Date.parse(bridgeUpdatedAt)) > staleMs : false;
  const jsonlErrors = jsonlErrorSummary(auditDir, sessionId);
  const warnings = [];

  if (!auditDirExists) warnings.push("audit_dir_missing");
  if (pointerSession && !pointerHasState) warnings.push("current_session_pointer_without_state");
  if (!hasState) warnings.push("session_state_missing");
  if (isStale) warnings.push("session_stale");
  if (bridgeStatus && bridgeStatus.ok === false) warnings.push("bridge_unhealthy");
  if (bridgeStale) warnings.push("bridge_stale");
  if (jsonlErrors.count > 0) warnings.push("jsonl_parse_errors");
  if (report.audit_summary.unsupported_response_checks > 0) warnings.push("unsupported_response_claims");

  const risk = report.audit_summary.unsupported_response_checks > 0
    ? "high"
    : (warnings.length ? "medium" : "none");
  const result = {
    version: VERSION,
    audit_dir: auditDir,
    agent: args.agent || "hermes",
    session_id: sessionId,
    current_session_pointer: pointerSession || null,
    pointer_has_state: pointerSession ? pointerHasState : null,
    has_state: hasState,
    latest_event_at: latestAt,
    bridge_status: bridgeStatus,
    bridge_updated_at: bridgeUpdatedAt,
    bridge_stale: bridgeStale,
    jsonl_errors: jsonlErrors,
    is_stale: isStale,
    stale_session_minutes: settings.stale_session_minutes,
    turn_index: report.turn_index,
    evidence_count: report.all_evidence_count,
    unsupported_response_checks: report.audit_summary.unsupported_response_checks,
    current_objective: report.current_objective,
    warnings,
    matches: warnings,
    risk
  };

  if ((args.format || "text") === "json") {
    printResult(result, "json");
  } else {
    console.log(`risk: ${risk}`);
    console.log(`session: ${sessionId}`);
    console.log(`audit_dir: ${auditDir}`);
    console.log(`turns: ${result.turn_index}`);
    console.log(`evidence: ${result.evidence_count}`);
    console.log(`unsupported: ${result.unsupported_response_checks}`);
    console.log(`latest_event_at: ${latestAt || "none"}`);
    console.log(`bridge: ${bridgeStatus ? (bridgeStatus.ok === false ? "unhealthy" : "ok") : "unknown"}`);
    console.log(`warnings: ${warnings.length ? warnings.join(", ") : "none"}`);
  }
  return risk === "high" ? 1 : 0;
}

function detailsLatest(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const sessionId = args["session-id"] || currentSessionId(auditDir, "default");
  const report = buildSessionReport({ ...args, "session-id": sessionId, limit: args.limit || 10 });
  const latest = report.audit_summary.latest_unsupported.at(-1) || null;
  const rules = loadRules(args.rules || DEFAULT_RULES);
  const ruleMap = new Map([
    ...rules.input_rules.map((rule) => [rule.id, { kind: "input", ...rule }]),
    ...rules.response_rules.map((rule) => [rule.id, { kind: "response", ...rule }])
  ]);
  const matchedRules = (latest?.matches || []).map((id) => {
    const rule = ruleMap.get(id) || { id };
    return {
      id,
      kind: rule.kind || "",
      risk: rule.risk || "",
      explanation_zh: ruleExplanation(rule, "zh"),
      explanation_en: ruleExplanation(rule, "en"),
      instruction: rule.instruction || "",
      evidence_requirements: rule.evidence_requirements || [],
      default_required_any: rule.default_required_any || []
    };
  });
  const result = {
    version: VERSION,
    agent: args.agent || "hermes",
    session_id: sessionId,
    latest_unsupported: latest,
    matched_rules: matchedRules,
    suggested_actions: latest ? [
      "Register evidence if the claim is already verified.",
      "Rewrite the response as unverified if evidence is missing.",
      "Run the needed command, test, or source check before claiming completion."
    ] : [],
    matches: latest?.matches || [],
    risk: latest?.risk || "none"
  };

  if ((args.format || "text") === "json") {
    printResult(result, "json");
  } else if (!latest) {
    console.log("risk: none");
    console.log("No unsupported response details found for this session.");
  } else {
    console.log(`risk: ${result.risk}`);
    console.log(`session: ${sessionId}`);
    console.log(`time: ${latest.created_at || "unknown"}`);
    console.log(`rules: ${(latest.matches || []).join(", ")}`);
    console.log(`excerpt: ${latest.response_excerpt || ""}`);
    for (const rule of matchedRules) {
      console.log("");
      console.log(`[${rule.id}]`);
      console.log(`zh: ${rule.explanation_zh || rule.instruction}`);
      console.log(`en: ${rule.explanation_en || rule.instruction}`);
      const required = [...(rule.default_required_any || [])];
      for (const requirement of rule.evidence_requirements || []) {
        required.push(...(requirement.required_any || []));
      }
      console.log(`required_evidence: ${required.length ? Array.from(new Set(required)).join(", ") : "unspecified"}`);
    }
    console.log("");
    console.log("suggested_actions:");
    for (const action of result.suggested_actions) console.log(`- ${action}`);
  }
  return result.risk === "high" ? 1 : 0;
}

function wrap(args) {
  const rules = loadRules(args.rules || DEFAULT_RULES);
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const message = readInput(args, "message");

  if (!message.trim()) {
    console.error("No message provided. Use --message, --message-file, or --stdin.");
    return 2;
  }

  const turnIndex = nextTurnIndex(auditDir, sessionId);
  const state = loadState(auditDir, sessionId);
  const evidence = loadEvidence(auditDir, sessionId);
  const facts = externalFacts(agent, sessionId, turnIndex, evidence, state);
  const hits = matchRules(message, rules.input_rules || []);
  const risk = maxRisk(hits.map((hit) => hit.risk || "none"));
  const guardedMessage = formatGuardedMessage(message, facts, hits, risk);
  const auditFile = appendAudit(auditDir, sessionId, {
    type: "input",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    turn_index: turnIndex,
    message,
    matches: hits.map((hit) => hit.id),
    risk
  });

  printResult({
    version: VERSION,
    agent,
    session_id: sessionId,
    turn_index: turnIndex,
    risk,
    matches: hits.map((hit) => hit.id),
    external_facts: facts,
    guarded_message: guardedMessage,
    audit_file: auditFile
  }, args.format || "text");
  return 0;
}

function checkResponse(args) {
  const rules = loadRules(args.rules || DEFAULT_RULES);
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const response = readInput(args, "response");

  if (!response.trim()) {
    console.error("No response provided. Use --response, --response-file, or --stdin.");
    return 2;
  }

  const state = loadState(auditDir, sessionId);
  const objective = currentObjective(state);
  const evidence = filterEvidenceForObjective(loadEvidence(auditDir, sessionId), objective);
  const responseForMatching = stripFencedCodeBlocks(response);
  const evaluatedHits = matchRules(responseForMatching, rules.response_rules || [])
    .map((hit) => evaluateResponseHit(hit, evidence, responseForMatching));
  const hits = evaluatedHits.filter((hit) => !hit.supported);
  const risk = maxRisk(hits.map((hit) => hit.risk || "none"));
  const auditFile = appendAudit(auditDir, sessionId, {
    type: "response_check",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    response,
    response_for_matching: responseForMatching,
    current_objective: objective,
    matches: hits.map((hit) => hit.id),
    risk,
    supported_matches: evaluatedHits.filter((hit) => hit.supported).map((hit) => hit.id)
  });

  printResult({
    version: VERSION,
    command: "check-response",
    agent,
    session_id: sessionId,
    risk,
    response_excerpt: responseExcerpt(response),
    matches: hits.map((hit) => ({
      id: hit.id,
      risk: hit.risk || "unknown",
      instruction: hit.instruction || "",
      explanation_zh: ruleExplanation(hit, "zh"),
      explanation_en: ruleExplanation(hit, "en"),
      required_evidence: requiredEvidenceForRule(hit),
      matched_patterns: hit.matched_patterns || [],
      unsupported_claims: hit.unsupported_claims || []
    })),
    supported_matches: evaluatedHits.filter((hit) => hit.supported).map((hit) => ({
      id: hit.id,
      supported_claims: hit.supported_claims || []
    })),
    current_objective: objective,
    evidence_count: evidence.length,
    detail_command: `node guard.mjs details latest --agent ${agent} --session-id ${sessionId} --audit-dir ${auditDir}`,
    audit_file: auditFile
  }, args.format || "text");
  return 0;
}

function evidenceAdd(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const kind = args.kind || "";
  const status = args.status || "passed";
  const state = loadState(auditDir, sessionId);
  const objective = args.objective || currentObjective(state) || "";

  if (!EVIDENCE_KINDS.has(kind)) {
    console.error(`Unsupported evidence kind: ${kind || "(empty)"}`);
    console.error(`Allowed kinds: ${Array.from(EVIDENCE_KINDS).join(", ")}`);
    return 2;
  }

  let metadata = {};
  if (args.metadata) {
    try {
      metadata = JSON.parse(args.metadata);
    } catch {
      console.error("--metadata must be valid JSON.");
      return 2;
    }
  }

  const evidence = {
    type: "evidence",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    kind,
    status,
    objective,
    summary: args.summary || "",
    subject: args.subject || "",
    ref: args.ref || "",
    metadata
  };
  const file = appendEvidence(auditDir, sessionId, evidence);
  appendAudit(auditDir, sessionId, {
    type: "evidence_add",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    kind,
    status,
    objective,
    summary: evidence.summary,
    subject: evidence.subject,
    ref: evidence.ref
  });

  printResult({
    version: VERSION,
    agent,
    session_id: sessionId,
    evidence,
    evidence_file: file,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function evidenceList(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const evidence = loadEvidence(auditDir, sessionId);
  const result = {
    version: VERSION,
    agent,
    session_id: sessionId,
    evidence_count: evidence.length,
    evidence,
    summary: summarizeEvidence(evidence),
    matches: [],
    risk: "none"
  };
  printResult(result, args.format || "json");
  return 0;
}

function taskSet(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const objective = args.objective || args.message || "";
  if (!objective.trim()) {
    console.error("No objective provided. Use --objective.");
    return 2;
  }

  const state = loadState(auditDir, sessionId);
  const previousTask = state.current_task || null;
  const sameObjective = previousTask?.objective === objective.trim();
  const timestamp = nowIso();
  const task = {
    objective: objective.trim(),
    status: args.status || "active",
    created_at: sameObjective ? previousTask.created_at : timestamp,
    updated_at: timestamp
  };
  saveState(auditDir, sessionId, {
    ...state,
    current_objective: task.objective,
    current_task: task
  });
  appendAudit(auditDir, sessionId, {
    type: "task_set",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    task
  });

  printResult({
    version: VERSION,
    agent,
    session_id: sessionId,
    task,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function taskShow(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const state = loadState(auditDir, sessionId);
  const evidence = filterEvidenceForObjective(loadEvidence(auditDir, sessionId), currentObjective(state));
  printResult({
    version: VERSION,
    agent,
    session_id: sessionId,
    current_objective: currentObjective(state),
    current_task: state.current_task || null,
    evidence_summary: summarizeEvidence(evidence),
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function taskClear(args) {
  const auditDir = args["audit-dir"] || DEFAULT_AUDIT_DIR;
  const agent = args.agent || "hermes";
  const sessionId = args["session-id"] || "default";
  const state = loadState(auditDir, sessionId);
  const previousTask = state.current_task || null;
  const nextState = { ...state };
  delete nextState.current_objective;
  delete nextState.current_task;
  saveState(auditDir, sessionId, nextState);
  appendAudit(auditDir, sessionId, {
    type: "task_clear",
    created_at: nowIso(),
    agent,
    session_id: sessionId,
    previous_task: previousTask
  });
  printResult({
    version: VERSION,
    agent,
    session_id: sessionId,
    previous_task: previousTask,
    matches: [],
    risk: "none"
  }, args.format || "json");
  return 0;
}

function usage() {
  console.error(`Usage:
  node guard.mjs wrap --agent hermes --session-id demo --message "..."
  node guard.mjs wrap --agent hermes --session-id demo --stdin
  node guard.mjs check-response --agent hermes --session-id demo --response "..."
  node guard.mjs evidence add --agent hermes --session-id demo --kind test_passed --summary "node --test passed"
  node guard.mjs evidence list --agent hermes --session-id demo
  node guard.mjs task set --agent hermes --session-id demo --objective "修复测试"
  node guard.mjs task show --agent hermes --session-id demo
  node guard.mjs task clear --agent hermes --session-id demo
  node guard.mjs settings get
  node guard.mjs settings set cooldown_turns 3
  node guard.mjs settings reset
  node guard.mjs health --agent hermes --session-id demo
  node guard.mjs details latest --agent hermes --session-id demo
  node guard.mjs rules list --kind input
  node guard.mjs rules add --kind input --id my_rule --patterns "foo|bar" --instruction "..."
  node guard.mjs rules delete --id my_rule
  node guard.mjs rules validate
  node guard.mjs rules stats
  node guard.mjs cases add --title "论文幻觉" --trigger "核验论文" --bad-behavior "未搜索即确认" --correct-behavior "搜索后标注来源" --rule-id verify_paper --patterns "论文|arXiv" --instruction "必须核验来源"
  node guard.mjs cases list
  node guard.mjs cases promote --id case_...
  node guard.mjs report session --agent hermes --session-id demo
  node guard.mjs sessions list
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === "wrap") return wrap(args);
  if (command === "check-response") return checkResponse(args);
  if (command === "evidence" && args._[1] === "add") return evidenceAdd(args);
  if (command === "evidence" && args._[1] === "list") return evidenceList(args);
  if (command === "task" && args._[1] === "set") return taskSet(args);
  if (command === "task" && args._[1] === "show") return taskShow(args);
  if (command === "task" && args._[1] === "clear") return taskClear(args);
  if (command === "settings" && (!args._[1] || args._[1] === "get")) return settingsGet(args);
  if (command === "settings" && args._[1] === "set") return settingsSet(args);
  if (command === "settings" && args._[1] === "reset") return settingsReset(args);
  if (command === "health") return health(args);
  if (command === "details" && args._[1] === "latest") return detailsLatest(args);
  if (command === "rules" && args._[1] === "list") return rulesList(args);
  if (command === "rules" && args._[1] === "add") return rulesAdd(args);
  if (command === "rules" && args._[1] === "update") return rulesUpdate(args);
  if (command === "rules" && args._[1] === "delete") return rulesDelete(args);
  if (command === "rules" && args._[1] === "enable") return rulesSetEnabled(args, true);
  if (command === "rules" && args._[1] === "disable") return rulesSetEnabled(args, false);
  if (command === "rules" && args._[1] === "validate") return rulesValidate(args);
  if (command === "rules" && args._[1] === "stats") return rulesStats(args);
  if (command === "manifest" && (!args._[1] || args._[1] === "check")) return manifestCheck(args);
  if (command === "cases" && args._[1] === "add") return casesAdd(args);
  if (command === "cases" && args._[1] === "list") return casesList(args);
  if (command === "cases" && args._[1] === "promote") return casesPromote(args);
  if (command === "report" && args._[1] === "session") return reportSession(args);
  if (command === "sessions" && args._[1] === "list") return sessionsList(args);
  if (command === "audit" && args._[1] === "gc") return auditGc(args);
  usage();
  return 2;
}

process.exitCode = main();
