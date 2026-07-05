# Hermes Guard（赫墨斯守卫）

> 你的 AI 助手刚说完"测试通过，准确率 92.3%"
> 它真的跑过测试吗？它真的量过准确率吗？
>
> **Hermes Guard 替你先问一句：证据呢？**

> Your AI agent just said "tests passed, 92.3% accuracy."
> Did it actually run the tests? Did it actually measure anything?
>
> **Hermes Guard asks the question your agent won't: where's the evidence?**

---

AI 助手会自信地说谎。不是故意——而是大语言模型的天性。
它说"文件保存好了"，也许根本没碰磁盘。
它说"根据最新研究表明"，也许脑子里什么都没查。
它说"回头我补上"，然后转头就忘。

Hermes Guard 是一个**外部证据检查层**，蹲在你和 AI 之间。
它不信任 AI。它只认证据。

AI agents confidently lie. Not out of malice — it's inherent to how LLMs work.
They say "file saved" before touching disk. They quote "studies show" from
thin air. They promise "I'll fix that later" and forget immediately.

Hermes Guard is an **external evidence layer** that sits between you and your
agent. It doesn't trust the agent. It demands proof.

```
                          ┌──────────────────┐
                          │   Your Message    │
                          │   你的消息          │
                          └────────┬─────────┘
                                   ▼
                    ┌──────────────────────────┐
                    │   Guard wraps context    │
                    │   Guard 注入规则提醒       │
                    │   "Claims need evidence" │
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │   LLM Agent responds     │
                    │   AI 回复 "99.7%!"        │
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │   Guard scans response   │
                    │   Guard 扫描回复           │
                    │   ⚠ HIGH: no evidence    │
                    │   → Appends warning      │
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │   Agent uses tool        │
                    │   → Auto-registers proof │
                    │   → Guard 自动登记证据     │
                    └──────────────────────────┘
```

---

## Before / After · 装前装后对比

| Without Guard · 没装 | With Guard · 装了 |
|---|---|
| Agent: "File saved. Done." / "搞定了" | Agent: "File saved. Done." / "搞定了" |
| You: _trusts it_ / 你信了 | `[Guard] ⚠ HIGH — no file_write evidence` |
| — | You: "Show me the file." / "给我看文件" |
| Agent: "Accuracy 99.7%" / "准确率99.7%" | Agent: "Accuracy 99.7%" / "准确率99.7%" |
| Nothing happens / 什么都没发生 | `[Guard] ⚠ HIGH — needs web_verified` |
| You quote it in a report / 你写进报告 | You ask for the source first / 你先翻来源 |

---

## What It Catches · 能抓什么

| Type · 类型 | Examples · 触发示例 | Risk · 风险 |
|---|---|---|
| 🔢 Numeric / 数字排名 | "MMLU-Pro 92.3%" "成功率99.7%" "排名第1" | HIGH · 高 |
| ✅ Completion / 完成声明 | "Tests passed" "File saved" "已经验证" | HIGH · 高 |
| 🀄 Chinese completion / 中文完成 | "搞定了" "保存好了" "都弄完了" "没问题了" | HIGH · 高 |
| 📄 Source claims / 来源声明 | "Studies show…" "论文表明…" | MEDIUM · 中 |
| ⏰ Future promises / 空头承诺 | "I'll fix that later" "记下了" "下次提醒" | MEDIUM · 中 |

**It does not prove truth. It enforces evidence discipline.**
**它不负责证明真假。它只负责追问：你说你做完了——证据呢？**

---

## 30-Second Quick Start · 30秒上手

```bash
# 1. Node.js >= 20
node --version

# 2. Clone
git clone https://github.com/phamhien4278n-hub/hermes-guard.git
cd hermes-guard

# 3. Windows: double-click · 双击
START_HERE.bat

# Or CLI · 或者命令行
node guard.mjs check-response --format readable --response "MMLU-Pro 92.3%"
```

You'll see · 马上看到：

```
HIGH | unsupported_numeric_benchmark_claim
  "MMLU-Pro 92.3%"
  Reason · 原因: 回复出现分数/百分比/排名时需要网页核验或人工证据
  Required evidence · 需要: web_verified, manual_review
```

---

## Hermes Hook Integration · 接入 Hermes

If you use [Hermes Agent](https://hermes-agent.nousresearch.com), add to `config.yaml`:
如果你用的是 Hermes Agent，在 config.yaml 加上：

```yaml
hooks:
  pre_llm_call:
    - command: "path/to/hermes-guard/hermes-hook-bridge.cmd"
      timeout: 20
  transform_llm_output:
    - command: "path/to/hermes-guard/hermes-hook-bridge.cmd"
      timeout: 20
  post_tool_call:
    - command: "path/to/hermes-guard/hermes-hook-bridge.cmd"
      timeout: 20
```

Every response scanned. Every tool call logged. Zero manual steps.
每条回复自动扫描，每次工具调用自动登记。零手动。

---

## Evidence Model · 证据体系

Six evidence types tracked per session · 六种证据类型：

| Type · 类型 | How It's Earned · 怎么来的 |
|---|---|
| `web_verified` | Agent searches/extracts web · AI 搜网页 |
| `file_read` | Agent reads a file · AI 读文件 |
| `file_write` | Agent writes or patches a file · AI 写文件 |
| `command_run` | Agent runs a terminal command · AI 跑命令 |
| `test_passed` | Agent runs a test suite · AI 跑测试 |
| `manual_review` | **You** confirm it · **你亲手**确认 |

Three hard rules · 三条硬规矩：
- **Failed tools don't count. · 失败的不算。** Exit ≠ 0 → evidence marked `failed`.
- **Unrelated evidence doesn't help. · 无关的不顶用。** Reading a file won't satisfy a numeric benchmark claim (strict subject matching).
- **No auto-passes. · 没有自动通行证。** `skill_view → manual_review` loophole closed. Only you create `manual_review`.

---

## Built-in Safety · 内置安全

- **Deployment manifest · 部署校验** — SHA-256 catches partial upgrades (e.g. copying `guard.mjs` but forgetting rule files)
- **Bridge health monitor · 健康监控** — detects silent hook failures
- **JSONL corruption detection · 损坏检测** — sidecar `.errors.jsonl` instead of silent swallowing
- **Atomic state writes · 原子写** — temp-file-then-rename prevents half-written state
- **Timeout protection · 超时保护** — 10s guard timeout, never blocks the agent

---

## CLI Panel · 命令面板

Double-click `START_HERE.bat` or run `npm start`:
双击 START_HERE.bat 或运行 npm start：

A bilingual (中/EN) text panel. Choose by number:
中英双语文字面板，按数字选：

```
1. Health check · 健康检查
2. Check a response · 检查回复
3. Latest risk details · 风险详情
4. Session report · 会话报告
...
11. System check · 系统检查
```

---

## Project Structure · 项目结构

```
guard.mjs                  Core CLI · 核心运行时
cli_panel.mjs              Bilingual text panel · 双语面板
dashboard.mjs              Optional browser UI · 可选浏览器控制台
hermes_hook_bridge.mjs     Hermes shell hook adapter · Hook适配器
rules.json + rules.d/      Rule packs · 规则库
tests/guard.test.mjs       48 automated tests · 48项测试
VERSION_MANIFEST.json      Deployment integrity · 部署完整性清单
```

---

## FAQ · 常见问题

**Does it send my data anywhere? · 会把我数据发出去吗？**
No. Runs entirely on your machine. Audit logs stay local.
不会。完全本地运行，审计日志留在你机器上。

**Does it slow down my agent? · 会拖慢AI吗？**
~100-300ms per hook check. The 10s timeout is a safety ceiling.
每次检查约100-300ms。10秒超时是安全上限。

**Can my agent learn to bypass it? · AI能学会绕过吗？**
Yes. If the agent knows the rules, it can rephrase (e.g. "搞定了" → "做完了").
That's why rules must expand — Guard is a **layer**, not a solution.
能。AI知道规则就能换说法。所以规则要持续扩充——Guard是一层防线，不替代判断。

**Is this a truth oracle? · 它能判断真相吗？**
No. Guard checks evidence discipline, not truth. A malicious agent can still
register real evidence for a false claim. Guard raises the cost of lying —
it doesn't make lying impossible.
不。Guard检查证据纪律，不是真相。恶意AI还是可以为假声明注册真证据。Guard提高说谎的成本——不让说谎变得不可能。

---

## Roadmap · 路线图

See [ROADMAP.md](docs/ROADMAP.md). Next priorities · 下阶段重点：
- Claim-ID evidence binding · 声明ID绑定证据
- Cross-process file locking · 跨进程文件锁
- More rule packs · 更多规则包

---

## Recent Updates · 近期更新

**2026-07-05 — Feedback Loop · 出口检查回灌**
Guard's export check results now feed back to the agent's next turn. When Guard
detects a high-risk unsupported claim, it writes a result file that the pipeline
picks up on the next `pre_llm_call`, injecting a corrective reminder into the
agent's context. The agent now sees what Guard caught last time — not just the user.

Guard 的出口检查结果现在会回灌给 AI 的下一轮对话。高风险声明被拦截后，结果文件在下次
`pre_llm_call` 时注入 AI 上下文——AI 自己能看到了，不再只靠用户提醒。

**2026-07-04 — Sound Alerts · 声音提醒**
Replaced popup dialogs (unreliable on Windows subprocess) with system beep alerts
for cleaner, more reliable notification.

弹窗方案替换为系统提示音——Windows 子进程弹窗不可靠，音频更稳定。

---

## License · 许可证

AGPL-3.0. See [LICENSE](LICENSE).

---

_Built by someone who got tired of watching AI agents say "done" before
doing anything. If your agent hates Hermes Guard, it's probably working._

_由一个被AI说"做好了"骗了太多次的人打造。
如果你的AI助手讨厌Hermes Guard，说明它在起作用。_
