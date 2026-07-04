# Hermes Guard 普通用户说明

## 先点哪个？

最推荐双击：

```text
START_HERE.bat
```

它会直接打开 Hermes Guard 通用面板。面板支持中文和英文，不需要你手写命令。

如果你想明确打开面板，也可以双击：

```text
START_CLI_PANEL.bat
```

## 面板能做什么？

- 健康检查：看当前 Hermes/Codex/Claude 会话是否连上、轮数是多少、证据有多少、有没有未支持声明。
- 检查一段回复：把 agent 的一句回复粘进去，Guard 会判断它是否缺少证据。
- 查看风险详情：解释最近一次风险命中了哪条规则、为什么命中、下一步怎么办。
- 会话报告：查看当前会话的轮数、任务、证据和审计日志摘要。
- 最近会话：多开 Hermes 窗口时，从最近的审计会话里选择一个。
- 任务管理：设置当前任务目标，让证据和任务绑定。
- 添加人工证据：登记“我本人已经确认过”的证据，例如网页链接、文件路径、命令输出。对于数字成绩、排名、benchmark 这类声明，请写清楚这条证据支持的具体声明，例如 `MMLU-Pro 99.7%`。
- 设置：修改提醒冷却、每个会话最多提醒次数、多久没活动算过期。
- 规则库：查看、增加、删除、启用、禁用、校验规则。
- Dashboard：打开浏览器控制台，用来可视化查看和管理。
- 系统检查：检查 Node.js 并运行自动测试。

## 第一次使用

1. 解压 zip。
2. 进入解压后的文件夹。可以放在移动硬盘，也可以放在本机硬盘。
3. 双击 `START_HERE.bat`。
4. 如果提示缺少 Node.js，请安装 Node.js LTS：https://nodejs.org/
5. 安装后再次双击 `START_HERE.bat`。

## 多开 Hermes 怎么办？

如果 Hermes hook bridge 已经部署好，Guard 会优先读取 `audit/.current_session` 来自动识别当前活跃会话。

如果自动检测不到：

1. 在面板里选择“最近会话”，从列表里选一个。
2. 或选择“切换 Agent / 会话 / 审计目录”，手动输入 session id。
3. 如果你的 Hermes 审计目录不在本程序目录下，也可以手动输入 audit 目录。

## 不建议双击什么？

普通用户不要直接双击这些文件：

```text
guard.mjs
dashboard.mjs
overlay.ps1
guard.py
```

优先双击：

```text
START_HERE.bat
START_CLI_PANEL.bat
```

悬浮窗 overlay 仍然保留，但它现在是 legacy 方案，不再作为主线推荐。

---

# Hermes Guard For Normal Users

## What should I click first?

Recommended:

```text
START_HERE.bat
```

It opens the Hermes Guard universal panel. The panel supports Chinese and English, and you do not need to type commands manually.

You can also open the panel directly:

```text
START_CLI_PANEL.bat
```

## What can the panel do?

- Health check: see whether the current session is connected, its turn count, evidence count, and unsupported-claim count.
- Check a response: paste one agent reply sentence and see whether it needs evidence.
- Latest risk details: explain the matched rule, reason, and suggested next action.
- Session report: show turns, task, evidence, and audit summary.
- Recent sessions: choose a session when multiple Hermes windows are open.
- Task management: set the current objective so evidence is tied to the task.
- Manual evidence: record something you personally verified, such as a URL, file path, or command output. For numeric scores, rankings, or benchmark claims, write the exact claim this evidence supports, such as `MMLU-Pro 99.7%`.
- Settings: change cooldown, max warnings per session, and stale-session minutes.
- Rules: list, add, delete, enable, disable, and validate rules.
- Dashboard: open the browser visual console.
- System check: check Node.js and run automated tests.

## First Use

1. Unzip the package.
2. Open the extracted folder. It can live on an external drive or local drive.
3. Double-click `START_HERE.bat`.
4. If Node.js is missing, install Node.js LTS: https://nodejs.org/
5. Double-click `START_HERE.bat` again.

## Multiple Hermes Windows

If Hermes hook bridge is installed, Guard reads `audit/.current_session` first and auto-detects the active session.

If auto-detection fails:

1. Choose "Recent sessions" in the panel.
2. Or choose "Change Agent / session / audit folder" and enter a session id manually.
3. If your Hermes audit folder is elsewhere, enter the audit folder manually.

## Do Not Double-Click These

Normal users should not directly double-click:

```text
guard.mjs
dashboard.mjs
overlay.ps1
guard.py
```

Use these instead:

```text
START_HERE.bat
START_CLI_PANEL.bat
```

The floating overlay is kept as a legacy option, but it is no longer the recommended path.
