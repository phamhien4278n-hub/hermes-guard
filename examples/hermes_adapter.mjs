import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GUARD = path.resolve(__dirname, "..", "guard.mjs");

function runJson(guardPath, args, input = "") {
  const proc = spawnSync(process.execPath, [guardPath, ...args, "--format", "json"], {
    input,
    encoding: "utf8"
  });
  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout || `guard exited with status ${proc.status}`);
  }
  return JSON.parse(proc.stdout);
}

export function createHermesGuard(options = {}) {
  const guardPath = options.guardPath || DEFAULT_GUARD;
  const agent = options.agent || "hermes";
  const sessionId = options.sessionId || "hermes-default";
  const auditDir = options.auditDir || "";
  const rules = options.rules || "";

  function commonArgs() {
    const args = ["--agent", agent, "--session-id", sessionId];
    if (auditDir) args.push("--audit-dir", auditDir);
    if (rules) args.push("--rules", rules);
    return args;
  }

  return {
    setTask(objective, status = "active") {
      return runJson(guardPath, [
        "task",
        "set",
        ...commonArgs(),
        "--objective",
        objective,
        "--status",
        status
      ]);
    },

    showTask() {
      return runJson(guardPath, ["task", "show", ...commonArgs()]);
    },

    clearTask() {
      return runJson(guardPath, ["task", "clear", ...commonArgs()]);
    },

    wrapUserMessage(message) {
      const payload = runJson(guardPath, ["wrap", ...commonArgs(), "--stdin"], message);
      return payload.guarded_message;
    },

    wrapUserMessagePayload(message) {
      return runJson(guardPath, ["wrap", ...commonArgs(), "--stdin"], message);
    },

    recordEvidence({
      kind,
      status = "passed",
      summary = "",
      subject = "",
      ref = "",
      metadata = {}
    }) {
      return runJson(guardPath, [
        "evidence",
        "add",
        ...commonArgs(),
        "--kind",
        kind,
        "--status",
        status,
        "--summary",
        summary,
        "--subject",
        subject,
        "--ref",
        ref,
        "--metadata",
        JSON.stringify(metadata)
      ]);
    },

    checkAssistantResponse(response) {
      return runJson(guardPath, ["check-response", ...commonArgs(), "--stdin"], response);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const guard = createHermesGuard({ sessionId: "hermes-adapter-demo" });
  guard.setTask("核验论文真实性");
  const wrapped = guard.wrapUserMessage("请核对这篇论文是不是真的：Line of Duty");
  console.log(wrapped);
}
