#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(__dirname, "guard.mjs");
const DEFAULT_AGENT = "hermes";
const DEFAULT_AUDIT_DIR = process.env.HERMES_GUARD_AUDIT_DIR || path.join(__dirname, "audit");
const GUARD_TIMEOUT_MS = Number(process.env.HERMES_GUARD_TIMEOUT_MS || 10000);
const POPUP_ENABLED = String(process.env.HERMES_GUARD_POPUP || "1") !== "0";
const POPUP_COOLDOWN_MS = Number(process.env.HERMES_GUARD_POPUP_COOLDOWN_MS || 30000);
const POPUP_SCRIPT = process.env.HERMES_GUARD_POPUP_SCRIPT || path.join(__dirname, "guard_popup.ps1");
const SOUND_SCRIPT = process.env.HERMES_GUARD_SOUND_SCRIPT || path.join(__dirname, "guard_sound.ps1");
const POPUP_DRY_RUN = String(process.env.HERMES_GUARD_POPUP_DRY_RUN || "0") === "1";

function readStdinJson() {
  const raw = fs.readFileSync(0, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function writeJson(value) {
  process.stdout.write(asciiJson(value));
}

function asciiJson(value) {
  return JSON.stringify(value)
    .replace(/[\u007f-\uffff]/g, (char) => {
      const code = char.charCodeAt(0).toString(16).padStart(4, "0");
      return `\\u${code}`;
    });
}

function sessionId(payload) {
  return payload.session_id || payload.extra?.session_id || payload.extra?.parent_session_id || "hermes-unknown";
}

function safeSessionFileName(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
}

function writeCurrentSession(sid) {
  fs.mkdirSync(DEFAULT_AUDIT_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEFAULT_AUDIT_DIR, ".current_session"), sid, "utf8");
}

function writeBridgeStatus(status) {
  try {
    fs.mkdirSync(DEFAULT_AUDIT_DIR, { recursive: true });
    const item = {
      updated_at: new Date().toISOString(),
      bridge: "hermes_hook_bridge.mjs",
      ...status
    };
    fs.writeFileSync(path.join(DEFAULT_AUDIT_DIR, ".bridge_status.json"), JSON.stringify(item, null, 2), "utf8");
    fs.appendFileSync(path.join(DEFAULT_AUDIT_DIR, ".bridge_events.jsonl"), `${JSON.stringify(item)}\n`, "utf8");
  } catch {
    // If the audit directory cannot be written, still return hook output below.
  }
}

function runGuard(args, input = "") {
  const proc = spawnSync(process.execPath, [GUARD, ...args, "--format", "json"], {
    input,
    encoding: "utf8",
    cwd: __dirname,
    timeout: GUARD_TIMEOUT_MS
  });
  if (proc.error) {
    const error = proc.error.code === "ETIMEDOUT"
      ? `guard timed out after ${GUARD_TIMEOUT_MS}ms`
      : proc.error.message;
    writeBridgeStatus({ ok: false, stage: "run_guard", error, args });
    return { ok: false, error };
  }
  if (proc.status !== 0) {
    writeBridgeStatus({ ok: false, stage: "run_guard", exit_code: proc.status, error: proc.stderr || proc.stdout || `guard exited ${proc.status}`, args });
    return {
      ok: false,
      error: proc.stderr || proc.stdout || `guard exited ${proc.status}`
    };
  }
  try {
    return { ok: true, data: JSON.parse(proc.stdout) };
  } catch {
    writeBridgeStatus({ ok: false, stage: "run_guard", error: "invalid guard json", raw: proc.stdout, args });
    return { ok: false, error: "invalid guard json", raw: proc.stdout };
  }
}

function commonArgs(payload) {
  return ["--agent", DEFAULT_AGENT, "--session-id", sessionId(payload)];
}

function responseText(payload) {
  return String(
    payload.extra?.response_text
    || payload.extra?.assistant_response
    || payload.response_text
    || payload.assistant_response
    || payload.output
    || payload.text
    || ""
  );
}

function guardMatchIds(checkData) {
  return (checkData?.matches || []).map((item) => item.id || item);
}

function popupStatePath() {
  return path.join(DEFAULT_AUDIT_DIR, ".popup_state.json");
}

function popupFingerprint(payload, checkData, response) {
  const excerpt = String(response || "").replace(/\s+/g, " ").trim().slice(0, 240);
  return [
    safeSessionFileName(sessionId(payload)),
    checkData?.risk || "unknown",
    guardMatchIds(checkData).join(","),
    excerpt
  ].join("|");
}

function shouldShowPopup(payload, checkData, response) {
  try {
    fs.mkdirSync(DEFAULT_AUDIT_DIR, { recursive: true });
    const now = Date.now();
    const key = popupFingerprint(payload, checkData, response);
    let state = {};
    if (fs.existsSync(popupStatePath())) {
      state = JSON.parse(fs.readFileSync(popupStatePath(), "utf8"));
    }
    if (state.key === key && Number(state.updated_at_ms || 0) + POPUP_COOLDOWN_MS > now) {
      return false;
    }
    fs.writeFileSync(popupStatePath(), JSON.stringify({ key, updated_at_ms: now }, null, 2), "utf8");
    return true;
  } catch {
    return true;
  }
}

function popupMessage(payload, checkData, response, source) {
  const matches = guardMatchIds(checkData).join(", ") || "unknown";
  const excerpt = String(response || "").replace(/\s+/g, " ").trim().slice(0, 360);
  return [
    "Hermes Guard detected unsupported claims.",
    "",
    "Hermes Guard 检测到未被外部证据支撑的声明。",
    "",
    `Risk / 风险: ${checkData?.risk || "unknown"}`,
    `Rules / 规则: ${matches}`,
    `Session / 会话: ${sessionId(payload)}`,
    `Source / 来源: ${source}`,
    "",
    "Excerpt / 片段:",
    excerpt || "(empty)",
    "",
    "Guard has logged this event. Click OK to continue.",
    "Guard 已记录本次事件。点击 OK 继续。"
  ].join("\n");
}

function launchPopupWarning(payload, checkData, response, source) {
  if (!POPUP_ENABLED) return;
  if (process.platform !== "win32") {
    return;
  }
  if (!shouldShowPopup(payload, checkData, response)) {
    writeBridgeStatus({ ok: true, stage: "sound_suppressed", reason: "cooldown", event_source: source, session_id: sessionId(payload) });
    return;
  }
  try {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", SOUND_SCRIPT
    ], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    writeBridgeStatus({ ok: true, stage: "sound_played", event_source: source, session_id: sessionId(payload), risk: checkData?.risk || "unknown", matches: guardMatchIds(checkData) });
  } catch (error) {
    writeBridgeStatus({ ok: false, stage: "sound_failed", event_source: source, session_id: sessionId(payload), error: error.message });
  }
}

function summarizeHistory(payload) {
  const history = payload.extra?.conversation_history;
  if (!Array.isArray(history)) return { count: 0 };
  return {
    count: history.length,
    roles: history.reduce((acc, item) => {
      const role = item?.role || "unknown";
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    }, {})
  };
}

function preLlmCall(payload) {
  const message = payload.extra?.user_message || "";
  const history = summarizeHistory(payload);
  const guard = runGuard(["wrap", ...commonArgs(payload), "--stdin"], message);
  if (!guard.ok) {
    return { context: `[Hermes Guard error: ${guard.error}]` };
  }

  const context = [
    guard.data.guarded_message,
    "",
    "<hermes_session>",
    `session_id: ${sessionId(payload)}`,
    `history_message_count: ${history.count}`,
    `is_first_turn: ${payload.extra?.is_first_turn === true}`,
    "</hermes_session>"
  ].join("\n");
  return { context };
}

function postLlmCall(payload) {
  const response = responseText(payload);
  if (response.trim()) {
    const check = runGuard(["check-response", ...commonArgs(payload), "--stdin"], response);
    if (check.ok && check.data.risk !== "none") {
      launchPopupWarning(payload, check.data, response, "post_llm_call");
    }
  }
  return null;
}

function transformedOutputPayload(text, extra = {}) {
  return {
    context: text,
    response_text: text,
    assistant_response: text,
    output: text,
    text,
    transformed_output: text,
    modified_output: text,
    replacement: text,
    ...extra
  };
}

function writeLastGuardResult(payload, checkData, response) {
  try {
    fs.mkdirSync(DEFAULT_AUDIT_DIR, { recursive: true });
    const excerpt = String(response || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const record = {
      session_id: sessionId(payload),
      timestamp: new Date().toISOString(),
      risk: checkData.risk || "unknown",
      matches: guardMatchIds(checkData),
      excerpt
    };
    fs.writeFileSync(
      path.join(DEFAULT_AUDIT_DIR, ".last_guard_result.json"),
      JSON.stringify(record, null, 2),
      "utf8"
    );
  } catch {
    // best-effort, don't block the main path
  }
}

function transformLlmOutput(payload) {
  const response = responseText(payload);
  if (!response.trim()) return null;

  const check = runGuard(["check-response", ...commonArgs(payload), "--stdin"], response);
  if (!check.ok) {
    const text = response + [
      "",
      "",
      "[Hermes Guard]",
      `Guard check failed: ${check.error}`,
      "Treat this response as unverified until Guard is healthy again."
    ].join("\n");
    return text;
  }
  if (check.data.risk === "none") {
    return null;
  }
  launchPopupWarning(payload, check.data, response, "transform_llm_output");
  writeLastGuardResult(payload, check.data, response);

  return response + [
    "",
    "",
    "[Hermes Guard]",
    "The response contains claims that do not have registered external evidence.",
    `Risk: ${check.data.risk}`,
    `Matches: ${(check.data.matches || []).map((item) => item.id || item).join(", ")}`,
    "Please verify before relying on those claims."
  ].join("\n");
}

function evidenceKindForTool(payload) {
  const toolName = String(payload.tool_name || "").toLowerCase();
  const args = payload.tool_input || payload.extra?.args || {};
  const command = String(args.command || "");

  if (toolName.includes("web") || toolName.includes("fetch") || toolName.includes("browser")) return "web_verified";
  if (toolName.includes("read") || toolName.includes("view") || toolName.includes("skill")) return "file_read";
  if (toolName.includes("write") || toolName.includes("edit")) return "file_write";
  if (/test|pytest|npm\s+test|node\s+--test|cargo\s+test|go\s+test/i.test(command)) return "test_passed";
  if (toolName.includes("terminal") || toolName.includes("shell")) return "command_run";
  return "command_run";
}

function toolCallStatus(payload) {
  const status = String(
    payload.status
    || payload.tool_status
    || payload.extra?.status
    || payload.extra?.tool_status
    || payload.result?.status
    || payload.extra?.result?.status
    || ""
  ).toLowerCase();
  const error = payload.error || payload.tool_error || payload.extra?.error || payload.extra?.tool_error || payload.result?.error || payload.extra?.result?.error;
  const exitCode = payload.exit_code ?? payload.extra?.exit_code ?? payload.result?.exit_code ?? payload.extra?.result?.exit_code;

  if (error) return "failed";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "timeout", "timed_out"].includes(status)) return "failed";
  if (exitCode !== undefined && Number(exitCode) !== 0) return "failed";
  if (["passed", "ok", "success", "succeeded", "completed"].includes(status)) return "passed";
  return "passed";
}

function toolSubject(payload) {
  const args = payload.tool_input || payload.extra?.args || {};
  return String(
    args.subject
    || args.path
    || args.file
    || args.url
    || args.q
    || args.query
    || args.command
    || payload.tool_name
    || ""
  );
}

function postToolCall(payload) {
  const kind = evidenceKindForTool(payload);
  const status = toolCallStatus(payload);
  const summary = [
    payload.tool_name ? `tool=${payload.tool_name}` : "",
    `status=${status}`,
    payload.extra?.duration_ms ? `duration_ms=${payload.extra.duration_ms}` : ""
  ].filter(Boolean).join(" ");
  runGuard([
    "evidence", "add",
    ...commonArgs(payload),
    "--kind", kind,
    "--status", status,
    "--summary", summary || "Hermes tool call completed",
    "--subject", toolSubject(payload),
    "--ref", JSON.stringify(payload.tool_input || payload.extra?.args || {})
  ]);
  return null;
}

function sessionStart(payload) {
  runGuard(["task", "show", ...commonArgs(payload)]);
  return null;
}

function sessionEnd(payload) {
  runGuard(["report", "session", ...commonArgs(payload)]);
  return null;
}

function main() {
  let payload;
  try {
    payload = readStdinJson();
  } catch (error) {
    writeJson({ context: `[Hermes Guard bridge invalid stdin: ${error.message}]` });
    return;
  }

  const event = payload.hook_event_name || "";
  try {
    writeCurrentSession(sessionId(payload));
    writeBridgeStatus({ ok: true, stage: "received", event, session_id: sessionId(payload) });
    let result = null;
    if (event === "pre_llm_call") result = preLlmCall(payload);
    else if (event === "transform_llm_output") result = transformLlmOutput(payload);
    else if (event === "post_llm_call") result = postLlmCall(payload);
    else if (event === "post_tool_call") result = postToolCall(payload);
    else if (event === "on_session_start") result = sessionStart(payload);
    else if (event === "on_session_end" || event === "on_session_finalize") result = sessionEnd(payload);

    if (typeof result === "string") {
      writeBridgeStatus({ ok: true, stage: "completed", event, session_id: sessionId(payload), returned: "string" });
      if (event === "transform_llm_output") {
        process.stdout.write(result);
      } else {
        writeJson({ context: result });
      }
      return;
    }
    if (result && typeof result === "object") {
      writeBridgeStatus({ ok: true, stage: "completed", event, session_id: sessionId(payload), returned: "object" });
      writeJson(result);
      return;
    }
    writeBridgeStatus({ ok: true, stage: "completed", event, session_id: sessionId(payload), returned: "empty" });
    process.stdout.write("");
  } catch (error) {
    writeBridgeStatus({ ok: false, stage: "bridge_error", event, session_id: sessionId(payload), error: error.message });
    writeJson({ context: `[Hermes Guard bridge error: ${error.message}]` });
  }
}

main();
