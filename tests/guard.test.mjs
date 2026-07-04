import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const guard = path.join(root, "guard.mjs");
const dashboard = path.join(root, "dashboard.mjs");
const bridge = path.join(root, "hermes_hook_bridge.mjs");
const adapterModule = path.join(root, "examples", "hermes_adapter.mjs");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hermes-guard-"));
}

function runGuard(args, input) {
  return execFileSync(process.execPath, [guard, ...args], {
    input,
    encoding: "utf8"
  });
}

function runGuardWithEnv(args, env, input) {
  return execFileSync(process.execPath, [guard, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function runNodeScript(script, input) {
  return execFileSync(process.execPath, [script], {
    input,
    encoding: "utf8",
    cwd: root
  });
}

function runGuardLoose(args, input) {
  return spawnSync(process.execPath, [guard, ...args], {
    input,
    encoding: "utf8"
  });
}

function tempRulesFile() {
  const dir = tmpDir();
  const target = path.join(dir, "rules.json");
  fs.copyFileSync(path.join(root, "rules.json"), target);
  return target;
}

describe("Hermes Guard MVP", () => {
  it("matches paper verification for Hermes", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "t1",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "请核对这篇论文是不是真的：Mind the Gap EACL 2026"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.agent, "hermes");
    assert.equal(payload.risk, "high");
    assert.ok(payload.matches.includes("paper_verification"));
    assert.match(payload.guarded_message, /必须逐条给出可访问来源/);
  });

  it("matches time and context from stdin", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "t2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--stdin"
    ], "现在几点？上下文还剩多少？");
    const payload = JSON.parse(out);
    assert.ok(payload.matches.includes("real_time"));
    assert.ok(payload.matches.includes("context_usage"));
    assert.equal(payload.risk, "high");
  });

  it("increments turn counter per session", () => {
    const auditDir = tmpDir();
    const first = JSON.parse(runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "turns",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "你好"
    ]));
    const second = JSON.parse(runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "turns",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "再来一次"
    ]));
    assert.equal(first.turn_index, 1);
    assert.equal(second.turn_index, 2);
  });

  it("detects unsupported completion claims", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "r1",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "我已经验证了，测试通过。"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.equal(payload.matches[0].id, "unsupported_completion_claim");
  });

  it("detects unsupported numeric benchmark claims", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "numeric1",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "MMLU-Pro 92.3%。"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.equal(payload.matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("normalizes zero-width characters before matching response rules", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zero-width",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "MMLU\u200B-Pro 92.3%"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.equal(payload.matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("detects Chinese numeric score and success-rate claims", () => {
    const auditDir = tmpDir();
    const score = JSON.parse(runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-numeric-score",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "测试得分92.3%"
    ]));
    assert.equal(score.risk, "high");
    assert.equal(score.matches[0].id, "unsupported_numeric_benchmark_claim");

    const successRate = JSON.parse(runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-numeric-success",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "成功率99.7%"
    ]));
    assert.equal(successRate.risk, "high");
    assert.equal(successRate.matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("detects Chinese natural-language completion claims", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-completion-natural",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "搞定了，文件保存好了，测试跑过了。"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.ok(payload.matches.some((item) => item.id === "unsupported_zh_completion_claim"));

    const colloquial = JSON.parse(runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-completion-colloquial",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "都搞完了。"
    ]));
    assert.equal(colloquial.risk, "high");
    assert.ok(colloquial.matches.some((item) => item.id === "unsupported_zh_completion_claim"));
  });

  it("does not allow old unrelated evidence to support Chinese completion claims", () => {
    const auditDir = tmpDir();
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "zh-completion-old-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "command_run",
      "--status", "passed",
      "--summary", "v1.7.8 deployment command completed",
      "--subject", "v1.7.8 deployment"
    ]);
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "zh-completion-old-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "test_passed",
      "--status", "passed",
      "--summary", "v1.7.8 regression tests passed",
      "--subject", "v1.7.8 deployment"
    ]);

    const unsupported = JSON.parse(runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-completion-old-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "改好了，测试跑过了。"
    ]));
    assert.equal(unsupported.risk, "high");
    assert.ok(unsupported.matches.some((item) => item.id === "unsupported_zh_completion_claim"));

    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "zh-completion-old-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "test_passed",
      "--status", "passed",
      "--summary", "改好了，测试跑过了。",
      "--subject", "改好了 测试跑过了"
    ]);
    const supported = JSON.parse(runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "zh-completion-old-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "改好了，测试跑过了。"
    ]));
    assert.equal(supported.risk, "none");
    assert.ok(supported.supported_matches.some((item) => item.id === "unsupported_zh_completion_claim"));
  });

  it("prints readable CLI warnings for unsupported response claims", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "readable1",
      "--audit-dir", auditDir,
      "--format", "readable",
      "--response", "MMLU-Pro 92.3%"
    ]);
    assert.match(out, /HIGH \| unsupported_numeric_benchmark_claim/);
    assert.match(out, /"MMLU-Pro 92\.3%"/);
    assert.match(out, /Required evidence: web_verified, manual_review/);
    assert.match(out, /Details: node guard\.mjs details latest/);
  });

  it("does not treat fenced code block content as an unsupported response claim", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "codeblock-safe",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "Example only:\n```text\nMMLU-Pro 92.3%\n```\nNo factual claim is being made."
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "none");
    assert.equal(payload.matches.length, 0);
  });

  it("still detects unsupported response claims outside fenced code blocks", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "codeblock-outside",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "```text\nexample\n```\nMMLU-Pro 92.3%"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.equal(payload.matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("detects narrow future commitment claims", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "future-commitment",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "I will handle it later."
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "medium");
    assert.equal(payload.matches[0].id, "unsupported_future_commitment");
  });

  it("does not treat a plain acknowledgement as a future commitment", () => {
    const auditDir = tmpDir();
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "future-ack",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "ok"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "none");
    assert.equal(payload.matches.length, 0);
  });

  it("allows numeric benchmark claims when manual evidence exists", () => {
    const auditDir = tmpDir();
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "numeric2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "manual_review",
      "--status", "passed",
      "--summary", "manual MMLU-Pro 92.3% benchmark source checked",
      "--subject", "MMLU-Pro 92.3%"
    ]);
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "numeric2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "MMLU-Pro 92.3%。"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "none");
    assert.equal(payload.supported_matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("does not allow numeric benchmark claims with unrelated manual evidence", () => {
    const auditDir = tmpDir();
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "numeric-unrelated-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "manual_review",
      "--status", "passed",
      "--summary", "manual source checked for an unrelated file write issue",
      "--subject", "file write verification"
    ]);
    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "numeric-unrelated-evidence",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "MMLU-Pro 99.7%"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.risk, "high");
    assert.equal(payload.matches[0].id, "unsupported_numeric_benchmark_claim");
  });

  it("allows completion claims when matching evidence exists", () => {
    const auditDir = tmpDir();
    const addOut = runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "r2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "test_passed",
      "--status", "passed",
      "--summary", "node --test passed",
      "--subject", "测试通过",
      "--ref", "node --test"
    ]);
    const addPayload = JSON.parse(addOut);
    assert.equal(addPayload.evidence.kind, "test_passed");

    const checkOut = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "r2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "测试通过。"
    ]);
    const checkPayload = JSON.parse(checkOut);
    assert.equal(checkPayload.risk, "none");
    assert.equal(checkPayload.matches.length, 0);
    assert.equal(checkPayload.supported_matches[0].id, "unsupported_completion_claim");
  });

  it("lists registered evidence", () => {
    const auditDir = tmpDir();
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "r3",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "file_write",
      "--status", "passed",
      "--summary", "wrote output file"
    ]);
    const out = runGuard([
      "evidence",
      "list",
      "--agent", "hermes",
      "--session-id", "r3",
      "--audit-dir", auditDir,
      "--format", "json"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.evidence_count, 1);
    assert.equal(payload.summary.by_kind.file_write, 1);
  });

  it("binds evidence to current objective", () => {
    const auditDir = tmpDir();
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task1",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "修复 guard 测试"
    ]);
    const addOut = runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "task1",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "test_passed",
      "--status", "passed",
      "--summary", "node --test passed"
    ]);
    const addPayload = JSON.parse(addOut);
    assert.equal(addPayload.evidence.objective, "修复 guard 测试");

    const showOut = runGuard([
      "task",
      "show",
      "--agent", "hermes",
      "--session-id", "task1",
      "--audit-dir", auditDir,
      "--format", "json"
    ]);
    const showPayload = JSON.parse(showOut);
    assert.equal(showPayload.current_objective, "修复 guard 测试");
    assert.equal(showPayload.evidence_summary.count, 1);
  });

  it("does not use evidence from a different objective", () => {
    const auditDir = tmpDir();
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "旧任务"
    ]);
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "task2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "test_passed",
      "--status", "passed",
      "--summary", "old tests passed"
    ]);
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "新任务"
    ]);

    const out = runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "task2",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "测试通过。"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.current_objective, "新任务");
    assert.equal(payload.evidence_count, 0);
    assert.equal(payload.risk, "high");
  });

  it("injects current objective into wrapped messages", () => {
    const auditDir = tmpDir();
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task3",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "核验论文"
    ]);
    const out = runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "task3",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "请核对这篇论文"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.external_facts.current_objective, "核验论文");
    assert.match(payload.guarded_message, /current_objective: 核验论文/);
  });

  it("resets task creation time when objective changes", () => {
    const auditDir = tmpDir();
    const first = JSON.parse(runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task4",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "任务 A"
    ]));
    const second = JSON.parse(runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "task4",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "任务 B"
    ]));
    assert.notEqual(second.task.objective, first.task.objective);
    assert.equal(second.task.created_at, second.task.updated_at);
  });

  it("adds and lists custom rules", () => {
    const rulesFile = tempRulesFile();
    const addOut = runGuard([
      "rules",
      "add",
      "--rules", rulesFile,
      "--format", "json",
      "--kind", "input",
      "--id", "custom_rule_test",
      "--patterns", "自定义触发|custom trigger",
      "--instruction", "自定义规则命中。"
    ]);
    const addPayload = JSON.parse(addOut);
    assert.equal(addPayload.added.id, "custom_rule_test");

    const listOut = runGuard([
      "rules",
      "list",
      "--rules", rulesFile,
      "--format", "json",
      "--kind", "input"
    ]);
    const listPayload = JSON.parse(listOut);
    assert.ok(listPayload.rules.some((rule) => rule.id === "custom_rule_test"));
  });

  it("lists bilingual rule explanations", () => {
    const listOut = runGuard([
      "rules",
      "list",
      "--format", "json",
      "--kind", "response"
    ]);
    const listPayload = JSON.parse(listOut);
    const completion = listPayload.rules.find((rule) => rule.id === "unsupported_completion_claim");
    assert.match(completion.explanation_zh, /完成/);
    assert.match(completion.explanation_en, /completion/i);
  });

  it("deletes custom rules", () => {
    const rulesFile = tempRulesFile();
    runGuard([
      "rules",
      "add",
      "--rules", rulesFile,
      "--format", "json",
      "--kind", "input",
      "--id", "delete_rule_test",
      "--patterns", "delete-me-pattern",
      "--instruction", "delete me"
    ]);
    const deleteOut = runGuard([
      "rules",
      "delete",
      "--rules", rulesFile,
      "--format", "json",
      "--id", "delete_rule_test"
    ]);
    const deletePayload = JSON.parse(deleteOut);
    assert.equal(deletePayload.deleted.id, "delete_rule_test");

    const listOut = runGuard([
      "rules",
      "list",
      "--rules", rulesFile,
      "--format", "json"
    ]);
    const listPayload = JSON.parse(listOut);
    assert.ok(!listPayload.rules.some((rule) => rule.id === "delete_rule_test"));
  });

  it("disabled custom rules do not match", () => {
    const rulesFile = tempRulesFile();
    const auditDir = tmpDir();
    runGuard([
      "rules",
      "add",
      "--rules", rulesFile,
      "--format", "json",
      "--kind", "input",
      "--id", "disable_rule_test",
      "--patterns", "不要命中我",
      "--instruction", "should not match"
    ]);
    runGuard([
      "rules",
      "disable",
      "--rules", rulesFile,
      "--format", "json",
      "--id", "disable_rule_test"
    ]);
    const out = runGuard([
      "wrap",
      "--rules", rulesFile,
      "--agent", "hermes",
      "--session-id", "disable-rule",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "不要命中我"
    ]);
    const payload = JSON.parse(out);
    assert.ok(!payload.matches.includes("disable_rule_test"));
  });

  it("validates duplicate rule ids", () => {
    const rulesFile = tempRulesFile();
    const dupFile = path.join(path.dirname(rulesFile), "rules.d", "dup.json");
    fs.mkdirSync(path.dirname(dupFile), { recursive: true });
    fs.writeFileSync(dupFile, JSON.stringify({
      version: "test",
      input_rules: [
        {
          id: "real_time",
          patterns: ["duplicate"],
          instruction: "duplicate"
        }
      ]
    }), "utf8");
    const proc = runGuardLoose([
      "rules",
      "validate",
      "--rules", rulesFile,
      "--format", "json"
    ]);
    assert.equal(proc.status, 1);
    const payload = JSON.parse(proc.stdout);
    assert.equal(payload.validation.ok, false);
    assert.ok(payload.validation.errors.some((error) => error.code === "duplicate_id"));
  });

  it("supports at least 1000 custom rules", () => {
    const rulesFile = tempRulesFile();
    const auditDir = tmpDir();
    const bulkFile = path.join(path.dirname(rulesFile), "rules.d", "bulk.json");
    fs.mkdirSync(path.dirname(bulkFile), { recursive: true });
    fs.writeFileSync(bulkFile, JSON.stringify({
      version: "bulk-test",
      input_rules: Array.from({ length: 1000 }, (_, index) => ({
        id: `bulk_rule_${index}`,
        enabled: true,
        level: "L1",
        risk: "medium",
        patterns: [`bulk-pattern-${index}`],
        instruction: `bulk rule ${index}`
      }))
    }), "utf8");

    const stats = JSON.parse(runGuard([
      "rules",
      "stats",
      "--rules", rulesFile,
      "--format", "json"
    ]));
    assert.ok(stats.stats.total_rules >= 1000);
    assert.equal(stats.ok, true);

    const out = runGuard([
      "wrap",
      "--rules", rulesFile,
      "--agent", "hermes",
      "--session-id", "bulk-match",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "please check bulk-pattern-999"
    ]);
    const payload = JSON.parse(out);
    assert.ok(payload.matches.includes("bulk_rule_999"));
  });

  it("allows scale warning thresholds to be raised", () => {
    const rulesFile = tempRulesFile();
    const bulkFile = path.join(path.dirname(rulesFile), "rules.d", "bulk-threshold.json");
    fs.mkdirSync(path.dirname(bulkFile), { recursive: true });
    fs.writeFileSync(bulkFile, JSON.stringify({
      version: "bulk-threshold-test",
      input_rules: Array.from({ length: 1000 }, (_, index) => ({
        id: `threshold_rule_${index}`,
        enabled: true,
        level: "L1",
        risk: "medium",
        patterns: [`threshold-pattern-${index}`],
        instruction: `threshold rule ${index}`
      }))
    }), "utf8");

    const lowThreshold = JSON.parse(runGuard([
      "rules",
      "validate",
      "--rules", rulesFile,
      "--format", "json",
      "--recommended-rules", "500"
    ]));
    assert.ok(lowThreshold.validation.warnings.some((warning) => warning.code === "large_rule_count"));

    const raisedThreshold = JSON.parse(runGuard([
      "rules",
      "validate",
      "--rules", rulesFile,
      "--format", "json",
      "--recommended-rules", "5000"
    ]));
    assert.ok(!raisedThreshold.validation.warnings.some((warning) => warning.code === "large_rule_count"));
  });

  it("gets, sets, and resets CLI settings", () => {
    const settingsFile = path.join(tmpDir(), "settings.json");
    const defaults = JSON.parse(runGuard([
      "settings",
      "get",
      "--settings-file", settingsFile,
      "--format", "json"
    ]));
    assert.equal(defaults.settings.cooldown_turns, 3);

    const changed = JSON.parse(runGuard([
      "settings",
      "set",
      "cooldown_turns",
      "4",
      "--settings-file", settingsFile,
      "--format", "json"
    ]));
    assert.equal(changed.settings.cooldown_turns, 4);

    const reset = JSON.parse(runGuard([
      "settings",
      "reset",
      "--settings-file", settingsFile,
      "--format", "json"
    ]));
    assert.equal(reset.settings.cooldown_turns, 3);
  });

  it("checks deployment manifest integrity", () => {
    const out = runGuard([
      "manifest",
      "check",
      "--format", "json"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.ok, true);
    assert.equal(payload.version, "1.7.9");
  });

  it("detects deployment manifest mismatches", () => {
    const dir = tmpDir();
    const manifest = {
      version: "1.7.9",
      files: [
        {
          path: "rules.d/numeric_claims.json",
          sha256: "0000"
        }
      ]
    };
    const manifestFile = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    const proc = runGuardLoose([
      "manifest",
      "check",
      "--manifest", manifestFile,
      "--format", "json"
    ]);
    assert.equal(proc.status, 1);
    const payload = JSON.parse(proc.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.errors.some((error) => error.code === "sha256_mismatch"));
  });

  it("reports CLI health for a fresh session", () => {
    const auditDir = tmpDir();
    runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "health-session",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "hello"
    ]);
    const out = runGuard([
      "health",
      "--agent", "hermes",
      "--session-id", "health-session",
      "--audit-dir", auditDir,
      "--format", "json"
    ]);
    const payload = JSON.parse(out);
    assert.equal(payload.session_id, "health-session");
    assert.equal(payload.has_state, true);
    assert.equal(payload.turn_index, 1);
    assert.equal(payload.risk, "none");
  });

  it("reports jsonl parse errors instead of silently swallowing corrupt lines", () => {
    const auditDir = tmpDir();
    const auditFile = path.join(auditDir, "jsonl-bad.jsonl");
    fs.writeFileSync(auditFile, [
      JSON.stringify({ type: "input", created_at: "2026-01-01T00:00:00+00:00", turn_index: 1 }),
      "{bad json",
      ""
    ].join("\n"), "utf8");
    const report = JSON.parse(runGuard([
      "report",
      "session",
      "--agent", "hermes",
      "--session-id", "jsonl-bad",
      "--audit-dir", auditDir,
      "--format", "json"
    ]));
    assert.equal(report.audit_summary.total_events, 1);
    assert.equal(fs.existsSync(`${auditFile}.errors.jsonl`), true);

    const health = JSON.parse(runGuard([
      "health",
      "--agent", "hermes",
      "--session-id", "jsonl-bad",
      "--audit-dir", auditDir,
      "--format", "json"
    ]));
    assert.ok(health.warnings.includes("jsonl_parse_errors"));
    assert.equal(health.jsonl_errors.count, 1);
  });

  it("garbage-collects old audit sessions only when apply is true", () => {
    const auditDir = tmpDir();
    runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "old-session",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "old"
    ]);
    const oldTime = new Date("2020-01-01T00:00:00Z");
    for (const suffix of [".jsonl", ".state.json"]) {
      fs.utimesSync(path.join(auditDir, `old-session${suffix}`), oldTime, oldTime);
    }

    const dryRun = JSON.parse(runGuard([
      "audit",
      "gc",
      "--audit-dir", auditDir,
      "--days", "1",
      "--format", "json"
    ]));
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.candidate_count, 1);
    assert.equal(fs.existsSync(path.join(auditDir, "old-session.jsonl")), true);

    const applied = JSON.parse(runGuard([
      "audit",
      "gc",
      "--audit-dir", auditDir,
      "--days", "1",
      "--apply", "true",
      "--format", "json"
    ]));
    assert.equal(applied.dry_run, false);
    assert.equal(applied.candidate_count, 1);
    assert.equal(fs.existsSync(path.join(auditDir, "old-session.jsonl")), false);
    assert.equal(fs.existsSync(path.join(auditDir, "old-session.state.json")), false);
  });

  it("recovers state from audit log when state json is corrupt", () => {
    const auditDir = tmpDir();
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "state-recover",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "recover objective"
    ]);
    runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "state-recover",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "hello"
    ]);
    runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "state-recover",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "again"
    ]);
    fs.writeFileSync(path.join(auditDir, "state-recover.state.json"), "{bad json", "utf8");
    const report = JSON.parse(runGuard([
      "report",
      "session",
      "--agent", "hermes",
      "--session-id", "state-recover",
      "--audit-dir", auditDir,
      "--format", "json"
    ]));
    assert.equal(report.turn_index, 2);
    assert.equal(report.current_objective, "recover objective");
    assert.equal(report.current_task.objective, "recover objective");
  });

  it("explains the latest unsupported response in CLI details", () => {
    const auditDir = tmpDir();
    runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "details-session",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "MMLU-Pro 92.3%"
    ]);
    const proc = runGuardLoose([
      "details",
      "latest",
      "--agent", "hermes",
      "--session-id", "details-session",
      "--audit-dir", auditDir,
      "--format", "json"
    ]);
    assert.equal(proc.status, 1);
    const payload = JSON.parse(proc.stdout);
    assert.equal(payload.risk, "high");
    assert.equal(payload.latest_unsupported.matches[0], "unsupported_numeric_benchmark_claim");
    assert.match(payload.matched_rules[0].explanation_en, /benchmark/i);
  });

  it("supports the Hermes adapter lifecycle", async () => {
    const { createHermesGuard } = await import(pathToFileUrl(adapterModule));
    const auditDir = tmpDir();
    const hermes = createHermesGuard({
      sessionId: "adapter-life",
      auditDir
    });
    const task = hermes.setTask("运行 Hermes guard 测试");
    assert.equal(task.task.objective, "运行 Hermes guard 测试");

    const wrapped = hermes.wrapUserMessage("请核对这篇论文");
    assert.match(wrapped, /current_objective: 运行 Hermes guard 测试/);
    assert.match(wrapped, /paper_verification/);

    const before = hermes.checkAssistantResponse("测试通过。");
    assert.equal(before.risk, "high");

    hermes.recordEvidence({
      kind: "test_passed",
      summary: "adapter lifecycle test evidence",
      subject: "测试通过"
    });
    const after = hermes.checkAssistantResponse("测试通过。");
    assert.equal(after.risk, "none");
  });

  it("records cases and promotes candidate rules", () => {
    const rulesFile = tempRulesFile();
    const auditDir = tmpDir();
    const casesFile = path.join(tmpDir(), "cases.jsonl");
    const addOut = runGuard([
      "cases",
      "add",
      "--cases-file", casesFile,
      "--format", "json",
      "--id", "case_test_001",
      "--title", "论文核验失误",
      "--trigger", "请核验论文",
      "--bad-behavior", "未搜索即确认论文存在",
      "--correct-behavior", "搜索并给出来源",
      "--kind", "input",
      "--rule-id", "case_rule_paper_check",
      "--patterns", "case-paper-trigger",
      "--instruction", "命中 case 规则，必须核验来源。"
    ]);
    const addPayload = JSON.parse(addOut);
    assert.equal(addPayload.case.id, "case_test_001");

    const listPayload = JSON.parse(runGuard([
      "cases",
      "list",
      "--cases-file", casesFile,
      "--format", "json"
    ]));
    assert.equal(listPayload.count, 1);

    const promotePayload = JSON.parse(runGuard([
      "cases",
      "promote",
      "--cases-file", casesFile,
      "--rules", rulesFile,
      "--format", "json",
      "--id", "case_test_001"
    ]));
    assert.equal(promotePayload.added_rule.id, "case_rule_paper_check");

    const wrapped = JSON.parse(runGuard([
      "wrap",
      "--rules", rulesFile,
      "--agent", "hermes",
      "--session-id", "case-promote",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "case-paper-trigger"
    ]));
    assert.ok(wrapped.matches.includes("case_rule_paper_check"));
  });

  it("reports session status with unsupported response checks", () => {
    const auditDir = tmpDir();
    const casesFile = path.join(tmpDir(), "cases.jsonl");
    runGuard([
      "task",
      "set",
      "--agent", "hermes",
      "--session-id", "report-session",
      "--audit-dir", auditDir,
      "--format", "json",
      "--objective", "生成最终报告"
    ]);
    runGuard([
      "check-response",
      "--agent", "hermes",
      "--session-id", "report-session",
      "--audit-dir", auditDir,
      "--format", "json",
      "--response", "测试通过。"
    ]);
    runGuard([
      "cases",
      "add",
      "--cases-file", casesFile,
      "--format", "json",
      "--id", "case_report_001",
      "--title", "未支持声明",
      "--trigger", "测试通过",
      "--bad-behavior", "没有证据时声称测试通过",
      "--correct-behavior", "先登记 test_passed 证据"
    ]);

    const report = JSON.parse(runGuard([
      "report",
      "session",
      "--agent", "hermes",
      "--session-id", "report-session",
      "--audit-dir", auditDir,
      "--cases-file", casesFile,
      "--format", "json"
    ]));
    assert.equal(report.current_objective, "生成最终报告");
    assert.equal(report.audit_summary.unsupported_response_checks, 1);
    assert.match(report.audit_summary.latest_unsupported[0].response_excerpt, /\S/);
    assert.equal(report.cases_summary.total_cases, 1);
    assert.equal(report.risk, "high");
  });

  it("lists sessions discovered in the audit directory", () => {
    const auditDir = tmpDir();
    runGuard([
      "wrap",
      "--agent", "hermes",
      "--session-id", "session-a",
      "--audit-dir", auditDir,
      "--format", "json",
      "--message", "hello"
    ]);
    runGuard([
      "evidence",
      "add",
      "--agent", "hermes",
      "--session-id", "session-b",
      "--audit-dir", auditDir,
      "--format", "json",
      "--kind", "manual_review",
      "--summary", "session b evidence"
    ]);
    const out = runGuard([
      "sessions",
      "list",
      "--audit-dir", auditDir,
      "--format", "json"
    ]);
    const payload = JSON.parse(out);
    const ids = payload.sessions.map((item) => item.session_id);
    assert.ok(ids.includes("session-a"));
    assert.ok(ids.includes("session-b"));
  });

  it("uses HERMES_GUARD_AUDIT_DIR as the shared default audit directory", () => {
    const auditDir = tmpDir();
    const env = { HERMES_GUARD_AUDIT_DIR: auditDir };
    runGuardWithEnv([
      "wrap",
      "--agent", "hermes",
      "--session-id", "shared-session",
      "--format", "json",
      "--message", "hello"
    ], env);
    const out = runGuardWithEnv([
      "sessions",
      "list",
      "--format", "json"
    ], env);
    const payload = JSON.parse(out);
    assert.ok(payload.sessions.some((item) => item.session_id === "shared-session"));
  });

  it("serves the dashboard report endpoint", async () => {
    const port = 9876 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, [dashboard, "--port", String(port)], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      await waitForServer(`http://127.0.0.1:${port}/api/report?session=dashboard-test&agent=hermes`);
      const res = await fetch(`http://127.0.0.1:${port}/api/report?session=dashboard-test&agent=hermes`);
      const json = await res.json();
      assert.equal(json.agent, "hermes");
      assert.equal(json.session_id, "dashboard-test");
    } finally {
      child.kill();
    }
  });

  it("Hermes hook bridge injects pre_llm context", () => {
    const out = runNodeScript(bridge, JSON.stringify({
      hook_event_name: "pre_llm_call",
      session_id: "bridge-pre",
      extra: {
        user_message: "请核对这篇论文",
        conversation_history: [{ role: "user", content: "hello" }],
        is_first_turn: false
      }
    }));
    const payload = JSON.parse(out);
    assert.match(payload.context, /<external_guard>/);
    assert.match(payload.context, /session_id: bridge-pre/);
    assert.match(payload.context, /history_message_count: 1/);
  });

  it("Hermes hook bridge writes current session pointer", () => {
    const sid = `bridge-pointer-${Date.now()}`;
    runNodeScript(bridge, JSON.stringify({
      hook_event_name: "pre_llm_call",
      session_id: sid,
      extra: {
        user_message: "hello",
        conversation_history: [],
        is_first_turn: true
      }
    }));
    const pointer = path.join(root, "audit", ".current_session");
    assert.equal(fs.readFileSync(pointer, "utf8").trim(), sid);
    const status = JSON.parse(fs.readFileSync(path.join(root, "audit", ".bridge_status.json"), "utf8"));
    assert.equal(status.ok, true);
    assert.equal(status.session_id, sid);
  });

  it("Hermes hook bridge transforms unsupported response claims", () => {
    const out = runNodeScript(bridge, JSON.stringify({
      hook_event_name: "transform_llm_output",
      session_id: "bridge-transform",
      extra: {
        response_text: "测试通过。"
      }
    }));
    assert.match(out, /Hermes Guard/);
    assert.match(out, /unsupported_completion_claim/);
  });

  it("Hermes hook bridge stdout is ASCII safe for Windows shell hooks", () => {
    const out = runNodeScript(bridge, JSON.stringify({
      hook_event_name: "transform_llm_output",
      session_id: "bridge-ascii",
      extra: {
        response_text: "A ↔ B，测试通过。"
      }
    }));
    assert.equal([...out].every((ch) => ch.charCodeAt(0) < 128), true);
    const payload = JSON.parse(out);
    assert.match(payload.context, /Hermes Guard/);
  });

  it("Hermes hook bridge records failed tool calls as failed evidence", () => {
    const sid = `bridge-failed-tool-${Date.now()}`;
    runNodeScript(bridge, JSON.stringify({
      hook_event_name: "post_tool_call",
      session_id: sid,
      tool_name: "shell_command",
      tool_input: { command: "node --test" },
      status: "failed",
      exit_code: 1
    }));
    const evidence = JSON.parse(runGuard([
      "evidence",
      "list",
      "--agent", "hermes",
      "--session-id", sid,
      "--format", "json"
    ]));
    assert.equal(evidence.evidence_count, 1);
    assert.equal(evidence.evidence[0].kind, "test_passed");
    assert.equal(evidence.evidence[0].status, "failed");
  });

  it("Hermes hook bridge does not auto-promote skill views to manual review", () => {
    const sid = `bridge-skill-view-${Date.now()}`;
    runNodeScript(bridge, JSON.stringify({
      hook_event_name: "post_tool_call",
      session_id: sid,
      tool_name: "skill_view",
      tool_input: { path: "skills/example/SKILL.md" },
      status: "success"
    }));
    const evidence = JSON.parse(runGuard([
      "evidence",
      "list",
      "--agent", "hermes",
      "--session-id", sid,
      "--format", "json"
    ]));
    assert.equal(evidence.evidence_count, 1);
    assert.equal(evidence.evidence[0].kind, "file_read");
    assert.notEqual(evidence.evidence[0].kind, "manual_review");
  });
});

function pathToFileUrl(file) {
  return new URL(`file:///${file.replace(/\\/g, "/")}`).href;
}

async function waitForServer(url) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server did not start: ${url}`);
}
