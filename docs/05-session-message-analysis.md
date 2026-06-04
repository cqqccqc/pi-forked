# Pi Agent Session 与 Message 处理机制深入分析

## 一、Session 持久化：JSONL 树结构

### 1.1 存储格式

Session 以 **JSONL**（每行一个 JSON 对象）格式存储在 `~/.pi/agent/sessions/<encoded-cwd>/` 下：

```
2026-05-22T10-30-00-000Z_abc12345.jsonl
```

文件内容示例：

```jsonl
{"type":"session","version":3,"id":"abc12345","timestamp":"2026-05-22T10:30:00.000Z","cwd":"/Users/user/project"}
{"type":"message","id":"f8a1b2c3","parentId":null,"timestamp":"2026-05-22T10:30:01.000Z","message":{"role":"user","content":[{"type":"text","text":"Read main.ts"}],"timestamp":1747898401000}}
{"type":"message","id":"e7d9c0b1","parentId":"f8a1b2c3","timestamp":"2026-05-22T10:30:05.000Z","message":{"role":"assistant","content":[...],"stopReason":"toolUse",...}}
{"type":"message","id":"a6c8d2e4","parentId":"e7d9c0b1","timestamp":"2026-05-22T10:30:05.100Z","message":{"role":"toolResult","toolCallId":"tc_1","toolName":"read",...}}
{"type":"message","id":"b5f7a3c6","parentId":"a6c8d2e4","timestamp":"2026-05-22T10:30:08.000Z","message":{"role":"assistant","content":[...],"stopReason":"stop",...}}
```

### 1.2 树结构

Session 不是线性数组，而是一棵**多分支树**：

```
null (root)
 └── f8a1b2c3 (user: "Read main.ts")
      └── e7d9c0b1 (assistant: tool use)
           └── a6c8d2e4 (toolResult)
                ├── b5f7a3c6 (assistant: "main.ts contains...")  ← leaf
                └── c4e6b7d8 (assistant: "Let me also...")  ← 分支（从 toolResult 分叉）
```

每个 entry 有 `id` 和 `parentId`：
- `parentId: null` → 根节点
- `parentId: string` → 指向父节点
- `leafId` → 当前所在的叶节点（决定上下文）

### 1.3 Entry 类型

```typescript
type SessionEntry =
  | SessionMessageEntry      // 消息（user/assistant/toolResult）
  | ThinkingLevelChangeEntry  // 思考等级变更
  | ModelChangeEntry          // 模型变更
  | CompactionEntry<T>        // 上下文压缩边界（T 为扩展数据类型）
  | BranchSummaryEntry<T>     // 分支切换摘要（T 为扩展数据类型）
  | CustomEntry<T>            // 扩展私有数据（不进 LLM 上下文）
  | CustomMessageEntry<T>     // 扩展注入的消息（进 LLM 上下文）
  | LabelEntry                // 用户书签/标签
  | SessionInfoEntry          // session 元信息（名称等）
```

**扩展数据字段**（`CompactionEntry`、`BranchSummaryEntry`、`CustomEntry`、`CustomMessageEntry` 支持）：
- `details?: T` — 扩展私有数据（不发送给 LLM）
- `fromHook?: boolean` — 标识是否由扩展 hook 生成（仅 `CompactionEntry` 和 `BranchSummaryEntry`）

**关键区分**：
- `CustomEntry`：扩展私有数据，不参与 LLM 上下文，用于跨 reload 保持状态
- `CustomMessageEntry`：扩展注入的消息，**参与** LLM 上下文，在 `buildSessionContext` 中转为 user 消息

### 1.4 只追加、不修改

Session 文件是 **append-only** 的：
- 新消息作为当前 leaf 的子节点追加
- 分支通过移动 `leafId` 指针实现，不修改已有数据
- 压缩生成新的 `CompactionEntry`，不删除旧消息

追加策略（`_persist` 方法）：
- 在收到第一个 assistant 消息前，entry 暂存内存不写磁盘
- 第一个 assistant 到达后，批量写入所有积攒的 entry
- 之后每条 entry 实时追加到文件

### 1.5 Session 版本迁移

```
v1 → v2: 为每个 entry 添加 id/parentId（线性变树形）
         compaction 的 firstKeptEntryIndex → firstKeptEntryId
v2 → v3: hookMessage role → custom role
```

迁移在加载时原地修改 entry 数组，然后整文件重写。

### 1.6 启动迁移（migrations.ts）

`migrations.ts` 处理 session 文件格式之外的全局配置迁移，在每次启动时运行：

```
runMigrations(cwd)
  ├── migrateAuthToAuthJson()
  │     → 将 oauth.json 和 settings.json 中的 apiKeys 合并到 auth.json
  │     → 迁移后重命名 oauth.json 为 .migrated，从 settings.json 删除 apiKeys
  │
  ├── migrateExplicitEnvVarConfigValues()
  │     → auth.json 中 api_key 的 key 字段：旧纯字符串 → $ENV_VAR 显式语法
  │     → models.json 中 apiKey 和 headers 同理
  │     → 打印 warning 列出所有变更
  │
  ├── migrateSessionsFromAgentRoot()
  │     → 修复 v0.30.0 bug：session 文件误存 ~/.pi/agent/*.jsonl
  │     → 根据 header.cwd 移动到正确的 ~/.pi/agent/sessions/<encoded-cwd>/
  │
  ├── migrateToolsToBin()
  │     → fd/rg 二进制从 tools/ 移动到 bin/
  │
  ├── migrateKeybindingsConfigFile()
  │     → 处理 keybindings.json 的格式迁移
  │
  └── migrateExtensionSystem(cwd)
        ├── migrateCommandsToPrompts() → commands/ 重命名为 prompts/
        └── checkDeprecatedExtensionDirs() → 警告 hooks/ 和 tools/ 目录
```

---

## 二、上下文构建：buildSessionContext

`buildSessionContext` 将树形 session 还原为线性 `AgentMessage[]`，供 agent 使用。

### 2.1 路径遍历

```
leafId 指向 → e7d9c0b1
  │
  从 leaf 向根遍历：
  e7d9c0b1 → f8a1b2c3 → null (root)
  
  反转得到路径：[f8a1b2c3, e7d9c0b1]
```

### 2.2 压缩边界处理

如果路径中存在 `CompactionEntry`：

```
路径：[user_msg_1, assistant_1, COMPACTION, user_msg_2, assistant_2]
                    ↑ 压缩边界

输出消息：
  1. CompactionSummaryMessage（摘要）
  2. COMPACTION.firstKeptEntryId 及之后的消息（保留部分）
  3. COMPACTION 之后的所有消息
```

`firstKeptEntryId` 标记压缩时保留的第一条消息——之前的消息被摘要替代，之后的保持原样。

### 2.3 非 Message Entry 的处理

```
buildSessionContext 中的 appendMessage：
├── "message"         → 直接 push entry.message
├── "custom_message"  → 转为 CustomMessage，push
├── "branch_summary"  → 有 entry.summary 时转为 BranchSummaryMessage，push（空摘要跳过）
├── "compaction"      → 转为 CompactionSummaryMessage，作为边界（在 appendMessage 外部处理）
├── "thinking_level_change" → 忽略（只更新 thinkingLevel 变量）
├── "model_change"    → 忽略（只更新 model 变量）
├── "custom"          → 忽略（不参与上下文）
├── "label"           → 忽略（纯 UI 数据）
└── "session_info"    → 忽略（纯元信息）
```

---

## 三、Message 类型体系

### 3.1 三层消息架构

```
┌─────────────────────────────────────────────────────┐
│ AgentMessage（agent 层看到的）                       │
│   = Message（LLM 标准消息）                          │
│   + BashExecutionMessage                            │
│   + CustomMessage                                   │
│   + BranchSummaryMessage                            │
│   + CompactionSummaryMessage                        │
├─────────────────────────────────────────────────────┤
│ Message（LLM 层理解的）                              │
│   = UserMessage | AssistantMessage | ToolResultMessage
├─────────────────────────────────────────────────────┤
│ SessionEntry（持久化层存储的）                        │
│   = SessionMessageEntry | CompactionEntry | ...     │
└─────────────────────────────────────────────────────┘
```

### 3.2 Declaration Merging 扩展机制

Pi 使用 TypeScript 的 declaration merging 在不修改核心代码的情况下扩展消息类型：

```typescript
// packages/agent/types.ts 定义扩展点
interface CustomAgentMessages {
  // 空 —— 等待应用层填充
}

// packages/coding-agent/messages.ts 填充具体类型
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}

// 最终类型自动合并
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]
// = Message | BashExecutionMessage | CustomMessage | BranchSummaryMessage | CompactionSummaryMessage
```

### 3.3 每种自定义消息的角色

**BashExecutionMessage** — 用户通过 `!` 前缀执行的 bash 命令：

```typescript
interface BashExecutionMessage {
  role: "bashExecution";
  command: string;       // 命令文本
  output: string;        // 输出
  exitCode: number | undefined;
  cancelled: boolean;    // 是否被用户取消
  truncated: boolean;    // 输出是否被截断
  fullOutputPath?: string; // 完整输出文件路径
  timestamp: number;     // 时间戳（毫秒）
  excludeFromContext?: boolean; // !! 前缀时不进 LLM 上下文
}
```

转换为 LLM 消息时：
- `excludeFromContext: false` → 转为 user 消息 `"Ran \`{command}\`\n\`\`\`\n{output}\n\`\`\`"`
- `excludeFromContext: true` → 过滤掉（`!!` 执行的命令只记录不发给 LLM）

**CustomMessage** — 扩展通过 `sendMessage()` 注入的消息：

```typescript
interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;    // 扩展标识
  content: string | (TextContent | ImageContent)[];
  display: boolean;      // 是否在 TUI 显示
  details?: T;           // 扩展元数据（不发给 LLM）
  timestamp: number;     // 时间戳（毫秒）
}
```

转为 LLM 消息时变为 user 消息，内容保持不变。

**CompactionSummaryMessage** — 压缩摘要：

```typescript
interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;       // LLM 生成的结构化摘要
  tokensBefore: number;  // 压缩前的 token 数
  timestamp: number;     // 摘要生成时间戳（毫秒）
}
```

转为 LLM 消息时包裹在 XML 标签中：

```
The conversation history before this point was compacted into the following summary:

<summary>
[结构化摘要内容]
</summary>
```

**BranchSummaryMessage** — 分支切换摘要：

```typescript
interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;        // 来源分支的 entry ID
  timestamp: number;     // 摘要生成时间戳（毫秒）
}
```

转为 LLM 消息时包裹在 XML 标签中：

```
The following is a summary of a branch that this conversation came back from:

<summary>
[摘要内容]
</summary>
```

---

## 四、convertToLlm：消息转换边界

`convertToLlm` 是 agent 内部消息与 LLM 之间的翻译层：

```typescript
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.map(m => {
    switch (m.role) {
      case "user":
      case "assistant":
      case "toolResult":
        return m;                    // 标准消息直接传递
      case "bashExecution":
        if (m.excludeFromContext) return undefined;  // 过滤
        return { role: "user", content: bashExecutionToText(m) };
      case "custom":
        return { role: "user", content: m.content };
      case "branchSummary":
        return { role: "user", content: `<summary>...` };
      case "compactionSummary":
        return { role: "user", content: `<summary>...` };
      default:
        return undefined;            // 未知类型过滤
    }
  }).filter(m => m !== undefined);
}
```

**设计要点**：
- 所有自定义消息都转为 **user** 角色（LLM 视角下这些都是"系统提供的信息"）
- `excludeFromContext` 的 bash 命令完全过滤（LLM 不知道用户执行过这个命令）
- `default` 分支的 exhaustive check 确保新增消息类型时不会遗忘处理

---

## 五、Compaction 详细机制

### 5.1 触发条件

```
每次 agent_end 后，_checkCompaction 检查：

跳过条件（任意满足则不检查）：
  - settings.enabled = false（自动压缩关闭）
  - assistantMessage 是 aborted（用户取消，skipAbortedCheck=true 时）
  - assistantMessage 来自不同 model（用户换了模型，旧模型的 overflow 不应触发新模型的压缩）
  - assistantMessage.timestamp 早于最新 CompactionEntry（旧消息，不等新压缩触发）

1. 溢出触发：sameModel && isContextOverflow(msg) → compress-and-retry（仅一次）
2. 阈值触发：contextTokens > contextWindow - reserveTokens → compress（不 retry）
   - 正常消息：从 assistantMessage.usage 精确计算
   - error 消息：从最近一次有效的 assistant usage 估算（让持续 API 错误的 session 也能压缩）

默认值：
  reserveTokens: 16384    （为回复预留 ~16k token）
  keepRecentTokens: 20000  （保留最近 ~20k token 的消息）
```

另外，在 `prompt()` 提交前也会调用 `_checkCompaction(lastAssistant, false)`，
此时 `skipAbortedCheck=false`，即使上一条是 aborted 也会检查（用于处理 aborted 回复后仍需压缩的场景）。

### 5.2 压缩流程

```
prepareCompaction(pathEntries, settings)
  │
  ├── 1. 找到上一次压缩边界（如果有）
  │     → 获取 previousSummary（用于增量更新）
  │
  ├── 2. 估算当前上下文 token 数
  │     → estimateContextTokens(messages)
  │     → 优先使用最后一次 assistant response 的 usage.totalTokens
  │     → 后续消息用 chars/4 估算
  │
  ├── 3. 寻找切割点
  │     → findCutPoint(entries, boundaryStart, boundaryEnd, keepRecentTokens)
  │     → 从最新消息向前累积 token，达到 keepRecentTokens 时停止
  │     → 只在有效切割点切割（user/assistant/bashExecution/custom）
  │     → 永远不在 toolResult 处切割（必须跟在 toolCall 后）
  │
  ├── 4. 处理切割 Turn
  │     → 如果切割点落在 assistant 消息（非 user），说明切在 turn 中间
  │     → 找到 turn 起始的 user 消息
  │     → turn 前缀单独总结（generateTurnPrefixSummary）
  │
  ├── 5. 提取文件操作
  │     → 扫描被总结的消息中的工具调用
  │     → 记录 read/write/edit 了哪些文件
  │     → 继承上次压缩的文件列表
  │
  └── 返回 CompactionPreparation
        ├── messagesToSummarize: 将被总结的消息
        ├── turnPrefixMessages: turn 前缀消息（如有）
        ├── firstKeptEntryId: 保留的第一条 entry
        └── fileOps: 文件操作记录
```

### 5.3 LLM 总结生成

`compact()` 函数位于 `packages/coding-agent/src/core/compaction/compaction.ts`：

```
compact(preparation, model, apiKey, headers, customInstructions, signal, thinkingLevel, streamFn)
  │
  ├── 如果是分割 Turn：
  │     → 并行生成历史摘要 + turn 前缀摘要（Promise.all）
  │     → 合并为一个摘要（追加 "Turn Context (split turn)" 段落）
  │
  ├── 如果是正常切割：
  │     → 只生成历史摘要
  │
  ├── 摘要生成过程（generateSummary）：
  │     convertToLlm(messages) → 序列化为文本
  │     → 包裹在 <conversation> 标签中
  │     → 如果有 previousSummary → 使用增量更新 prompt（UPDATE_SUMMARIZATION_PROMPT）
  │     → 否则使用初始总结 prompt（SUMMARIZATION_PROMPT）
  │     → 通过 streamFn 或 completeSimple 调用 LLM（非流式）
  │
  ├── 追加文件操作信息：
  │     summary += formatFileOperations(readFiles, modifiedFiles)
  │
  └── 返回 CompactionResult（含 details: { readFiles, modifiedFiles }）
```

`streamFn` 参数用于支持自定义 stream 函数（如 RPC 模式代理），默认使用 `completeSimple`。

### 5.4 摘要的结构化格式

LLM 被要求按以下格式生成摘要：

```markdown
## Goal
[用户要完成什么？]

## Constraints & Preferences
- [限制和偏好]

## Progress
### Done
- [x] 已完成的任务

### In Progress
- [ ] 进行中的工作

### Blocked
- [阻塞项]

## Key Decisions
- **[决策]**: [理由]

## Next Steps
1. [下一步]

## Critical Context
- [关键数据、路径、错误消息]
```

增量更新时会保留之前的摘要内容，合并新的进展。

### 5.5 Token 估算策略

```typescript
function estimateTokens(message: AgentMessage): number {
  // 简单的 chars / 4 启发式
  // 保守估计（倾向高估）

  user:         text.length / 4
  assistant:    (text + thinking + toolCall args).length / 4
  toolResult:   text.length / 4
  bashExecution: (command + output).length / 4
  image:        固定 1200 tokens
  compaction/branch summary: summary.length / 4
}
```

优先使用 LLM 返回的 `usage.totalTokens`（精确值），只在最后一段没有 usage 数据的消息上使用估算。

---

## 六、Session 树操作

### 6.1 分支（branch）

```typescript
// 移动 leafId 到目标 entry，下次追加就在那里分叉
branch(branchFromId: string): void {
  this.leafId = branchFromId;
}
```

不修改任何已有数据，只移动指针。旧的分支路径仍然存在于文件中。

```
操作前：
  A → B → C → D (leaf)
         ↑ branch(B)

操作后：
  A → B → C → D
       └── E (新追加) (leaf)
```

### 6.1.1 重置叶节点（resetLeaf）

```typescript
// 将 leafId 重置为 null（第一个 entry 之前）
resetLeaf(): void {
  this.leafId = null;
}
```

用于导航到重新编辑第一条用户消息的场景。下次 `appendXXX()` 调用将创建新的根 entry（`parentId = null`）。

### 6.2 带摘要的分支

```typescript
branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string {
  this.leafId = branchFromId;
  // 追加 BranchSummaryEntry 作为分支的第一个节点
  // parentId = branchFromId（null 时成为新的根 entry）
  const entry = { type: "branch_summary", summary, fromId: branchFromId ?? "root", details, fromHook, ... };
  this._appendEntry(entry);
  return entry.id;
}
```

```
A → B → C → D
     └── [BranchSummary: "之前做了X"] → E (新追加) (leaf)

null → [BranchSummary: "回到起点"] → F (新追加) (leaf, 从根开始)
```

BranchSummary 会被转为 `BranchSummaryMessage`，在 LLM 上下文中表现为一段 XML 包裹的摘要文本。

**参数说明**：
- `branchFromId` — 分支起始 entry ID（`null` 表示从根开始，摘要成为新的根 entry）
- `details?: T` — 扩展私有数据（不发送给 LLM）
- `fromHook?: boolean` — 标识是否由扩展 hook 生成

### 6.3 Fork（创建新 session 文件）

```typescript
createBranchedSession(leafId: string): string | undefined {
  // 1. 从 root 到 leafId 提取路径（过滤掉 LabelEntry）
  // 2. 创建新 session 文件，新 ID
  // 3. 收集路径上所有 entry 的 labels
  // 4. 写入新 header + 路径上的 entries + 重建的 labels
  // 5. 返回新文件路径（非持久化模式返回 undefined）
}
```

Fork 将树中的一条路径提取为独立的线性 session 文件，原始文件保持不变。

**改进点**：
- LabelEntry 被过滤掉，然后从 `labelsById` 映射重建为独立的 entry 链
- 确保新 session 文件的写入时机与 `newSession()` 一致（只有包含 assistant 消息时才写入磁盘）

### 6.4 跨项目 Fork（forkFrom）

```typescript
static forkFrom(sourcePath: string, targetCwd: string, sessionDir?: string, options?: NewSessionOptions): SessionManager {
  // 1. 加载源 session 文件
  // 2. 创建新 session 文件，新 ID（可通过 options.id 指定），使用目标 cwd
  // 3. 新 header 的 parentSession 指向源文件路径
  // 4. 复制所有非 header entries 到新文件
  // 5. 返回新的 SessionManager 实例
}
```

将一个项目目录的 session fork 到当前项目，保留完整历史记录。新 session 的 `parentSession` 字段指向源文件路径。可通过 `options.id` 自定义新 session 的 ID（必须符合 `assertValidSessionId` 校验）。

---

## 七、AgentSession 事件协调

### 7.1 Agent 与 SessionManager 的桥梁

`AgentSession` 是 `Agent`（运行时）和 `SessionManager`（持久化）之间的协调者：

```
Agent 事件                      AgentSession 处理               SessionManager 操作
──────────                      ────────────────               ──────────────────
message_start (user)            更新 steering/followUp 队列,     —
                                清除 overflowRecoveryAttempted
message_start (assistant)       —                               —
message_end (user)              —                               appendMessage
message_end (assistant)         非 error 时重置重试计数、          appendMessage
                                清除 overflowRecoveryAttempted
message_end (toolResult)        —                               appendMessage
message_end (custom)            —                               appendCustomMessageEntry
turn_end                        扩展 turn_end 事件                —
agent_end                       检查重试/压缩                     —
```

### 7.2 消息持久化时机

每条消息在 `message_end` 事件时立即持久化：

```typescript
// _handleAgentEvent 中的 message_end 处理
if (event.message.role === "assistant") {
  this._lastAssistantMessage = event.message;  // 缓存用于后续检查
  // 成功时重置重试计数
  if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
    this._emit({ type: "auto_retry_end", success: true, attempt: this._retryAttempt });
    this._retryAttempt = 0;
  }
}
// 统一持久化
this.sessionManager.appendMessage(event.message);
```

### 7.3 Bash 消息的特殊处理

用户通过 `!` 执行的 bash 命令有特殊的持久化逻辑：

```typescript
executeBash(command) {
  const result = await executeBashWithOperations(command, cwd, ...);

  if (this.isStreaming) {
    // agent 正在工作 → 延迟追加（避免破坏 toolUse/toolResult 的配对）
    this._pendingBashMessages.push(bashMessage);
  } else {
    // agent 空闲 → 立即追加
    this.agent.state.messages.push(bashMessage);
    this.sessionManager.appendMessage(bashMessage);
  }
}

// agent 工作结束后刷新
_flushPendingBashMessages() {
  for (const bashMessage of this._pendingBashMessages) {
    this.agent.state.messages.push(bashMessage);
    this.sessionManager.appendMessage(bashMessage);
  }
  this._pendingBashMessages = [];
}
```

**为什么要延迟？** LLM 要求 toolResult 必须紧跟在对应的 assistant（toolUse）消息之后。如果在 toolUse 和 toolResult 之间插入一条 bashExecution 消息，LLM 协议会被破坏。

### 7.4 sendCustomMessage 的三种投递模式

`sendCustomMessage()` 支持三种投递模式，通过 `options.deliverAs` 指定：

| 模式 | agent 状态 | 行为 |
|------|-----------|------|
| `"steer"`（默认） | streaming | 通过 `agent.steer()` 排队，在当前 turn 的工具调用完成后投递 |
| `"followUp"` | streaming | 通过 `agent.followUp()` 排队，在所有 steering 消息处理完后投递 |
| `"nextTurn"` | 任意 | 存入 `_pendingNextTurnMessages`，在下一次 `prompt()` 时作为上下文注入 |

`nextTurn` 模式特殊之处：消息不立即加入 agent state，而是在下次用户发出 prompt 时，在 user message 之后、`before_agent_start` 扩展 custom messages 之前注入。这让扩展可以在用户不知情的情况下，将上下文附加到下一轮对话。

### 7.5 压缩后的状态重建

压缩完成后，需要重建 agent 的内存状态：

```typescript
// 压缩成功后
this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook);
const sessionContext = this.sessionManager.buildSessionContext();
this.agent.state.messages = sessionContext.messages;  // 用新的消息列表替换
```

**参数说明**：
- `details?: T` — 扩展私有数据（不发送给 LLM）
- `fromHook?: boolean` — 标识是否由扩展 hook 生成

旧的内存消息被丢弃，用 `buildSessionContext` 从 session 树中重新构建（包含压缩摘要 + 保留的最近消息）。

---

## 八、数据流完整示例

### 8.1 一次完整 Prompt 的生命周期

```
用户输入: "Read main.ts and fix the bug"
  │
  ▼ AgentSession.prompt()
  │
  ├── 1. 检查扩展命令（不是 / 开头 → 跳过，是的话执行 handler 后返回）
  ├── 2. 发射 input 事件给扩展
  │     ├── action = "handled" → 扩展已处理，返回（不发送给 LLM）
  │     └── action = "transform" → 替换 text/images，继续流程
  ├── 3. 展开 skill 命令（/skill:name args）和 prompt template
  ├── 4. 如果 agent 正在 streaming：
  │     └── 根据 streamingBehavior 调用 steer() 或 followUp() 排队，返回
  ├── 5. 刷新 pending bash messages（确保消息顺序正确）
  ├── 6. 验证 model 已选择
  ├── 7. 验证 API key / OAuth 已配置
  ├── 8. 检查是否需要压缩（pre-prompt check，skipAbortedCheck=false）
  │     └── 如果需要压缩 → 执行压缩后 continue agent
  ├── 9. 构建 messages 数组
  │     ├── 创建 user message: { role: "user", content: [...], timestamp: ... }
  │     └── 注入 pending nextTurn messages（extensions 通过 sendCustomMessage + deliverAs: "nextTurn" 添加）
  ├── 10. 发射 before_agent_start 给扩展
  │     ├── 扩展可修改 systemPrompt
  │     ├── 扩展可返回 custom messages（注入到 messages 数组）
  │     └── 扩展可返回 modified systemPrompt（覆盖 baseSystemPrompt）
  ├── 11. 调用 preflightResult(true)（通知 RPC 模式 prompt 已接受）
  │
  ▼ _runAgentPrompt(messages)
  │
  ├── Agent.prompt(messages)
  │     │
  │     ▼ runAgentLoop()
  │     │
  │     ├── emit agent_start
  │     │     → _handleAgentEvent: 转发给扩展和 UI
  │     │
  │     ├── emit message_start (user)
  │     │     → _handleAgentEvent: 清除 overflowRecoveryAttempted, 检查队列, 转发
  │     │
  │     ├── emit message_end (user)
  │     │     → _handleAgentEvent: sessionManager.appendMessage(userMsg)
  │     │       → JSONL 文件追加一行
  │     │
  │     ├── streamAssistantResponse()
  │     │     ├── convertToLlm(messages) → 转为 LLM 格式
  │     │     ├── streamSimple(model, context, options) → 调用 LLM
  │     │     │
  │     │     │  LLM 流式返回:
  │     │     │    start → partial assistant message
  │     │     │    text_delta → "Let me read the file..."
  │     │     │    toolcall_delta → { name: "read", arguments: { path: "main.ts" } }
  │     │     │    toolcall_end → complete tool call
  │     │     │    done → stopReason: "toolUse"
  │     │     │
  │     │     ├── emit message_start (assistant partial)
  │     │     │     → _handleAgentEvent: 转发给扩展和 UI
  │     │     ├── emit message_update (每个 delta)
  │     │     │     → _handleAgentEvent: 转发给扩展和 UI
  │     │     └── emit message_end (assistant final)
  │     │           → _handleAgentEvent: sessionManager.appendMessage(assistantMsg)
  │     │
  │     ├── executeToolCalls()
  │     │     ├── emit tool_execution_start
  │     │     │     → _handleAgentEvent: 转发给扩展
  │     │     ├── beforeToolCall 钩子（扩展可阻止）
  │     │     ├── tool.execute("read", { path: "main.ts" })
  │     │     │     → 读取文件内容
  │     │     ├── afterToolCall 钩子（扩展可修改结果）
  │     │     ├── emit tool_execution_end
  │     │     │     → _handleAgentEvent: 转发给扩展
  │     │     └── 创建 ToolResultMessage
  │     │           → emit message_start/end
  │     │           → sessionManager.appendMessage(toolResult)
  │     │
  │     ├── emit turn_end (assistant, toolResults)
  │     │     → _handleAgentEvent: 转发给扩展
  │     │
  │     ├── 继续循环 → streamAssistantResponse() (第二次 LLM 调用)
  │     │     LLM 返回: "The bug is on line 42..."
  │     │     stopReason: "stop"
  │     │
  │     ├── emit turn_end
  │     └── emit agent_end
  │           → _handleAgentEvent:
  │             1. 转发给扩展
  │             2. 通知 UI（带 willRetry 标志）
  │
  ▼ _handlePostAgentRun()
  │
  ├── 检查重试：stopReason != "error" → 不需要
  ├── 检查压缩：contextTokens < threshold → 不需要
  ├── 检查 agent 是否有排队消息 → 有的话 continue
  └── 返回 false → 结束
```

---

## 九、关键设计总结

| 设计决策 | 原因 |
|---------|------|
| **JSONL 树形存储** | append-only 写入高效；分支通过 parentId 天然支持；崩溃恢复只需读取完整行 |
| **延迟持久化（等第一个 assistant）** | 避免用户只输入了 prompt 但 agent 还没回复时产生"孤儿"session 文件 |
| **四类自定义消息** | 每种有不同的 LLM 交互方式：bash 转为 user、custom 转为 user、summary 包裹 XML、exclude 完全过滤 |
| **convertToLlm 在 LLM 调用边界执行** | agent 内部可以自由使用任何消息类型，只在需要时转换；不同模式（TUI/RPC）可以有不同的转换逻辑 |
| **Declaration merging** | agent 核心包不知道 coding-agent 的消息类型，保持零依赖；coding-agent 通过 TS 类型系统注入 |
| **Bash 消息延迟追加** | LLM 协议要求 toolResult 紧跟 assistant，不能在中间插入其他消息 |
| **压缩使用增量更新** | 多次压缩时不从头总结，而是基于上一次摘要更新，减少 token 消耗和语义丢失 |
| **文件操作追踪** | 压缩后 LLM 仍然知道之前读过/改过哪些文件，避免重复操作 |
| **Turn 分割处理** | 切割点可能在 turn 中间（如多个工具调用），前缀单独总结保证后续消息有上下文 |
| **leafId 指针** | 移动指针即可分支/切换，O(1) 操作；不需要复制或修改任何已有数据 |
