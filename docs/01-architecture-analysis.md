# Pi Agent 架构原理分析

## 一、整体架构：四层分离

Pi 采用了严格的分层架构，从底到上依次为：

```
┌─────────────────────────────────────────┐
│  packages/coding-agent                  │  应用层：CLI / TUI / RPC 三种运行模式
├─────────────────────────────────────────┤
│  packages/agent (pi-agent-core)         │  Agent 运行时：循环、工具执行、状态管理
├─────────────────────────────────────────┤
│  packages/ai (pi-ai)                    │  LLM 抽象层：统一多 Provider 流式 API
├─────────────────────────────────────────┤
│  packages/tui (pi-tui)                  │  终端 UI：差分渲染、编辑器组件
└─────────────────────────────────────────┘
```

每一层都是独立的 npm 包，有清晰的职责边界。Agent 运行时不知道终端 UI 的存在，LLM 抽象层也不知道 agent 的概念。

---

## 二、核心原理：Agent Loop（代理循环）

Pi 的核心是一个 **LLM 驱动的 while 循环**，定义在 `packages/agent/src/agent-loop.ts` 的 `runLoop` 函数中。

### 2.1 循环结构

```
while (true) {                          ← 外层循环：处理 follow-up 消息
  while (hasMoreToolCalls || pending) {  ← 内层循环：处理工具调用 + steering 消息
    1. 注入 pending 消息（用户在 agent 工作时输入的内容）
    2. 调用 LLM，流式获取 assistant 响应
    3. 解析响应中的 tool calls
    4. 执行工具（支持并行或串行）
    5. 将工具结果加回上下文
    6. 触发 prepareNextTurn 钩子（compaction、model 切换）
    7. 检查 shouldStopAfterTurn
  }
  检查 followUp 队列，无消息则退出
}
```

关键设计点：

- **双层循环**：内层处理工具调用链（一次 LLM 调用 → 工具执行 → 再调 LLM，直到无工具调用）；外层处理 agent 完成后追加的 follow-up 消息。
- **Steering 消息**：用户可以在 agent 工作的间隙插入新指令，这些指令在下一个 assistant turn 开始前被注入上下文。
- **优雅退出**：通过 `shouldStopAfterTurn` 钩子允许外部在适当的时候中断循环。

### 2.2 Agent 类（有状态包装）

`packages/agent/src/agent.ts` 中的 `Agent` 类是对无状态 `agentLoop` 函数的有状态包装：

```
Agent
├── _state: MutableAgentState      ← 当前状态（消息、工具、模型、是否在流式传输中）
├── listeners: Set<EventListener>  ← 事件订阅者
├── steeringQueue                  ← 用户在工作时插入的消息队列
├── followUpQueue                  ← agent 完成后执行的消息队列
├── activeRun                      ← 当前运行中的 Promise + AbortController
│
├── prompt(input)     → 启动新的 agent 循环
├── continue()        → 从当前上下文继续（如 retry）
├── steer(message)    → 排队 steering 消息
├── followUp(message) → 排队 follow-up 消息
├── abort()           → 取消当前运行
└── subscribe(fn)     → 监听生命周期事件
```

关键设计：

- **队列模式**：`steering` 和 `followUp` 各自支持 `"all"`（一次全部取出）或 `"one-at-a-time"`（一次取一条）两种模式。
- **互斥运行**：同一时刻只能有一个 active run，避免并发状态冲突。
- **事件驱动**：所有状态变更通过事件通知，上层（UI、session）通过订阅事件来响应。

---

## 三、LLM 抽象层：统一多 Provider

### 3.1 Provider 注册机制

`packages/ai` 通过 **API Registry** 模式统一不同的 LLM 提供商：

```
apiProviderRegistry (Map<Api, ApiProvider>)
  ├── "anthropic-messages"    → Anthropic Claude
  ├── "openai-completions"    → OpenAI / 兼容 API
  ├── "openai-responses"      → OpenAI Responses API
  ├── "google-generative-ai"  → Google Gemini
  ├── "google-vertex"         → Google Vertex AI
  ├── "mistral-conversations"  → Mistral
  ├── "bedrock-converse-stream" → AWS Bedrock
  └── ...更多 provider
```

### 3.2 延迟加载（Lazy Loading）

所有 provider 实现都通过动态 `import()` 延迟加载（`register-builtins.ts`）。这意味着：

- Anthropic provider 只在第一次使用 Claude 模型时才加载（包括其 SDK 依赖）
- 内存占用最小化
- 加载失败不会崩溃，而是返回一个 `stopReason: "error"` 的 AssistantMessage

### 3.3 统一流式接口

所有 provider 都实现相同的流式协议（`AssistantMessageEvent`）：

```
start → {text_start, text_delta, text_end}*
      → {thinking_start, thinking_delta, thinking_end}*
      → {toolcall_start, toolcall_delta, toolcall_end}*
      → done | error
```

上层代码（agent loop）只需要处理这一套事件协议，不需要关心不同 provider 的差异。

### 3.4 EventStream（异步迭代器）

`EventStream` 是核心的异步通信原语（`packages/ai/src/utils/event-stream.ts`）：

```typescript
class EventStream<T, R> implements AsyncIterable<T> {
  push(event)   // 生产者推入事件
  end(result)   // 结束流
  result()      // 获取最终结果（Promise）
  [Symbol.asyncIterator]()  // 支持 for-await-of 消费
}
```

这实现了**生产者-消费者解耦**：LLM provider 以事件流的方式逐步产出响应，agent loop 通过 `for await (const event of stream)` 逐步消费，同时保持实时性。

---

## 四、消息体系

### 4.1 双层消息类型

Pi 使用 TypeScript 的 declaration merging 来扩展消息类型：

```
基础层（packages/ai/types.ts）：
  Message = UserMessage | AssistantMessage | ToolResultMessage

扩展层（packages/agent/types.ts + declaration merging）：
  AgentMessage = Message
    | BashExecutionMessage     ← bash 命令执行记录
    | CustomMessage            ← 扩展注入的自定义消息（参与 LLM 上下文）
    | BranchSummaryMessage     ← 分支切换摘要
    | CompactionSummaryMessage ← 上下文压缩摘要

Session 持久化层（packages/coding-agent/src/core/session-manager.ts）：
  SessionEntry（树节点）包括：
    SessionMessageEntry        ← 消息节点（user/assistant/toolResult）
    CustomMessageEntry         ← 扩展自定义消息节点（参与 LLM 上下文）
    CustomEntry                ← 扩展状态持久化节点（不参与 LLM 上下文）
    CompactionEntry            ← 压缩摘要节点
    BranchSummaryEntry         ← 分支摘要节点
    ThinkingLevelChangeEntry   ← 思考等级变更节点
    ModelChangeEntry           ← 模型切换节点
    LabelEntry                 ← 用户书签/标记节点
    SessionInfoEntry           ← 会话元数据节点（如显示名称）
```

### 4.2 消息转换边界

Agent 内部使用 `AgentMessage`，但在调用 LLM 之前需要转换：

```
AgentMessage[] ──transformContext──→ AgentMessage[]   ← 压缩/裁剪上下文
                ──convertToLlm────→ Message[]          ← 转为 LLM 能理解的格式
```

`convertToLlm` 函数负责：
- 过滤掉 LLM 不理解的消息（如 `bashExecution` 的 `!!` 命令、UI-only 消息）
- 将 `compactionSummary` 和 `branchSummary` 转为 user 消息
- 保持标准消息原样传递

---

## 五、工具系统

### 5.1 工具定义与执行

每个工具由两部分组成：

1. **ToolDefinition**：JSON Schema 定义 + UI 渲染元数据（给 LLM 和 UI 使用）
2. **AgentTool**：包含 `execute()` 方法的实际执行器

```
工具工厂函数（如 createReadTool）：
  ├── 定义 JSON Schema（参数验证）
  ├── 实现 execute(toolCallId, params, signal, onUpdate)
  │     → 返回 { content, details, terminate? }
  └── 支持流式更新（onUpdate 回调）
```

### 5.2 七大核心工具

| 工具 | 功能 | 特点 |
|------|------|------|
| `read` | 读取文件 | 支持行范围、图片、PDF |
| `bash` | 执行 shell 命令 | 超时控制、输出截断、工作目录跟踪 |
| `edit` | 精确字符串替换 | unified patch 模式、差异计算 |
| `write` | 写入文件 | 创建新文件或完全重写 |
| `grep` | 搜索文件内容 | 正则、文件过滤 |
| `find` | 查找文件 | glob 模式匹配 |
| `ls` | 列出目录 | 文件信息展示 |

### 5.3 工具执行策略

- **并行执行（默认）**：一次 assistant 响应中的多个工具调用可以同时执行（如同时读取多个文件）
- **串行执行**：某些工具（如 `edit`）标记为 `executionMode: "sequential"`，必须逐个执行
- **钩子**：`beforeToolCall`（可阻止执行）、`afterToolCall`（可修改结果）

### 5.4 文件变更队列

`file-mutation-queue.ts` 确保对同一文件的写操作是串行化的，避免并发写入冲突。

---

## 六、Session 管理与 Compaction

### 6.1 AgentSession

`AgentSession` 是 coding-agent 的核心协调者（`packages/coding-agent/src/core/agent-session.ts`）：

```
AgentSession
├── 持有 Agent 实例
├── 管理 session 持久化（通过 SessionManager）
├── 处理 compaction（手动 & 自动上下文压缩）
├── 管理工具注册/激活（内置工具 + 扩展工具 + SDK 自定义工具）
├── 协调扩展系统（ExtensionRunner 生命周期、事件转发）
├── 构建 system prompt（动态生成，含工具片段、skill、上下文文件）
├── 管理模型和思考等级（切换、循环、支持能力检查）
├── 自动重试（指数退避，可重试错误检测）
├── 管理双队列（steering / followUp 消息追踪）
├── Skill 块解析（/skill:name 命令展开）
├── Prompt 模板展开（文件型模板）
├── sendUserMessage / sendCustomMessage API（供扩展使用）
├── 扩展资源发现（skills、prompts、themes）
└── 对外暴露事件流 (AgentSessionEvent)
```

AgentSession 是 **所有运行模式共享的**——交互模式、打印模式、RPC 模式都通过同一个 AgentSession 工作。

关键设计要点：
- **事件驱动的持久化**：在 `message_end` 事件中自动将消息写入 SessionManager，模式层无需关心持久化逻辑。
- **工具注册分层**：内置工具（read/bash/edit/write 等）、扩展工具（通过 ExtensionRunner 注册）、SDK 自定义工具（通过 config.customTools 传入），统一管理在 `_toolRegistry` 和 `_toolDefinitions` 中。
- **自动重试**：检测可重试错误（overloaded、rate limit、server error 等），按指数退避策略自动重试，最多 N 次，可被中止。
- **队列追踪**：维护 `_steeringMessages` 和 `_followUpMessages` 数组，在消息被 agent 消费时自动移除，同步发出 `queue_update` 事件供 UI 更新。

### 6.2 Compaction（上下文压缩）

当对话历史超过模型的上下文窗口时，Pi 使用 LLM 自身来压缩历史：

1. **检测**：每次 turn 结束后计算 token 用量，超过阈值（`contextWindow - reserveTokens`）触发 compaction；或当 LLM 返回 context overflow 错误时强制触发。
2. **准备**（`prepareCompaction`）：通过 `findCutPoint` 找到合理的切割点（可切割 user/assistant/custom/bashExecution 消息，不可切割 toolResult），计算要保留的最近消息边界。如果切割点落在 turn 中间（split turn），还需要为 turn prefix 生成额外摘要。
3. **文件操作提取**：从要压缩的消息和上一次 compaction 记录中提取文件操作（读了哪些文件、改了哪些文件）。
4. **总结**：调用 LLM 将历史对话总结为结构化摘要，格式为：
   ```
   ## Goal / ## Constraints & Preferences / ## Progress
   ### Done / ### In Progress / ### Blocked
   ## Key Decisions / ## Next Steps / ## Critical Context
   ```
   如果存在上一次 compaction 的摘要，则使用增量更新模式（UPDATE_SUMMARIZATION_PROMPT），合并新旧信息而非从头总结。
5. **文件列表追加**：将提取的文件操作记录追加到摘要末尾。
6. **替换**：通过 `SessionManager.appendCompaction()` 持久化压缩节点，然后用 `CompactionSummaryMessage` + 保留的消息替换 agent 状态中的原有消息。

```
原始上下文（200k tokens）:
  [user, assistant, tool_result, assistant, ...] (50条消息)

压缩后上下文（20k tokens）:
  [compactionSummary: "结构化摘要 + 文件列表", 最近几条消息]
```

**Split Turn 处理**：当切割点位于 assistant 消息（非 user 消息开头）时，该 turn 被拆分为两部分 —— turn prefix（被压缩的部分）和 turn suffix（保留的部分）。此时会并行生成两份摘要：历史摘要 + turn prefix 摘要，合并后作为最终的 compaction summary。

**扩展集成**：通过 `session_before_compact` 钩子，扩展可以取消 compaction、或提供自定义的 compaction 结果（如结构化压缩）。压缩完成后触发 `session_compact` 事件。

### 6.3 分支与会话树

Session 不是线性的，而是一棵树（由 `SessionManager` 管理）：

- 每个 entry 有 `id` 和 `parentId`，通过 `leafId` 指针追踪当前位置。
- 用户可以在任意点创建分支（`branch(fromId)` 或 `branchWithSummary(fromId, summary)`），将 leaf 指针移回历史 entry，下次 append 即形成新分支。
- 切换分支时通过 `BranchSummaryEntry` 提供上下文，支持扩展生成的自定义摘要（`fromHook` 标记）。
- `getTree()` 返回完整的树结构（`SessionTreeNode[]`），包含 children 关系和 resolved labels。
- `getBranch(fromId)` 从指定 entry 走到 root，返回路径上的所有 entry。
- `createBranchedSession(leafId)` 提取单个分支路径到新的 session 文件。
- **标签系统**：通过 `LabelEntry` 为任意 entry 添加用户书签，`getTree()` 返回时自动解析每个节点的 label。
- **会话元数据**：通过 `SessionInfoEntry` 存储会话显示名称等元信息。
- **版本迁移**：session 文件支持 v1->v2->v3 的自动迁移（v1 添加 id/parentId 树结构，v2 添加 firstKeptEntryId，v3 重命名 hookMessage role 为 custom）。

---

## 七、扩展系统

Pi 的扩展系统允许第三方代码注入 agent 的各个生命周期阶段。

### 7.1 扩展钩子点

```
ExtensionRunner 触发的钩子（按生命周期分类）：

Agent 生命周期：
├── before_agent_start    ← 每次 prompt 发出前，可注入 custom message / 修改 system prompt
├── agent_start           ← agent 循环开始
├── agent_end             ← agent 循环结束
├── turn_start            ← 每个 turn 开始（含 turnIndex）
├── turn_end              ← 每个 turn 结束（含 message 和 toolResults）

消息生命周期：
├── message_start         ← 消息开始（user/assistant/toolResult/custom）
├── message_update        ← assistant 消息流式更新（token-by-token）
├── message_end           ← 消息结束，可替换整个消息（保持相同 role）

工具执行：
├── tool_call             ← 工具调用前，可 block 执行或修改参数
├── tool_execution_start  ← 工具开始执行
├── tool_execution_update ← 工具执行过程中的流式更新
├── tool_execution_end    ← 工具执行完成
├── tool_result           ← 工具结果返回后，可修改 content/details/isError

LLM 交互：
├── context               ← 上下文转换（在发送给 LLM 前，可修改消息列表）
├── before_provider_request ← LLM 请求发出前，可修改 payload
├── after_provider_response ← LLM 响应返回后（含 status/headers）

会话管理：
├── session_start         ← 会话启动/恢复/重载
├── session_shutdown      ← 会话关闭（quit/reload/new/resume/fork）
├── session_before_switch ← 切换会话前（可取消）
├── session_before_fork   ← fork 会话前（可取消）
├── session_before_compact ← 压缩前（可取消，或提供自定义 compaction 结果）
├── session_compact       ← 压缩完成后
├── session_before_tree   ← 会话树导航前（可取消，或提供自定义摘要）
├── session_tree          ← 会话树导航后

模型与配置：
├── model_select          ← 模型切换后
├── thinking_level_select ← 思考等级切换后

用户交互：
├── input                 ← 用户输入处理（可 transform 或 handled）
├── user_bash             ← 用户 !/!! bash 命令（可替换执行器或结果）

资源：
└── resources_discover    ← 会话启动/重载后的资源发现（skills/prompts/themes）
```

### 7.2 扩展注册

扩展通过 `ToolDefinition` 和 `RegisteredTool` 注册自定义工具，通过 `RegisteredCommand` 注册斜杠命令，通过事件处理器注入行为。

---

## 八、三种运行模式

### 8.1 交互模式（TUI）

```
packages/coding-agent/src/modes/interactive/
├── 使用 pi-tui 构建终端 UI
├── 差分渲染：只更新屏幕变化的部分
├── 支持 markdown 渲染、语法高亮
├── 快捷键系统（可配置的 keybindings）
└── 实时显示 tool 执行进度
```

### 8.2 RPC 模式

```
packages/coding-agent/src/modes/rpc/
├── JSON-RPC 协议（JSONL 传输）
├── 供编辑器插件、SDK 集成使用
├── 支持多客户端连接
└── 无头模式（不需要终端）
```

### 8.3 CLI/打印模式

非交互式一次性执行，适合管道和自动化场景。

---

## 九、System Prompt 构建

System prompt 是动态构建的（`packages/coding-agent/src/core/system-prompt.ts`）：

```
System Prompt = 基础指令
  + 当前激活工具的使用说明
  + 工具代码片段（示例用法）
  + 项目上下文文件（CLAUDE.md 等）
  + 技能（Skills）描述
  + 附加系统提示（用户配置）
  + 当前日期和工作目录
```

---

## 十、数据流总览

```
用户输入
  │
  ▼
AgentSession.prompt()
  │
  ▼
Agent.prompt() → runAgentLoop()
  │
  ├─→ transformContext()     压缩/裁剪上下文
  ├─→ convertToLlm()         转为 LLM 消息格式
  ├─→ streamSimple()          调用 LLM（流式）
  │     │
  │     ▼ (异步事件流)
  │   AssistantMessageEventStream
  │     ├── text_delta → 实时显示文本
  │     ├── toolcall_end → 触发工具执行
  │     └── done/error → 完成
  │
  ├─→ executeToolCalls()     并行/串行执行工具
  │     ├── beforeToolCall 钩子
  │     ├── tool.execute()
  │     └── afterToolCall 钩子
  │
  ├─→ 将工具结果加回上下文
  │
  └─→ 回到循环顶部（如果还有工具调用）
        或检查 follow-up 队列
        或退出循环
```

---

## 十一、关键设计总结

| 设计决策 | 原因 |
|---------|------|
| **四层独立包** | 关注点分离，每层可独立测试和复用 |
| **无状态 agentLoop 函数** | 逻辑清晰、易于测试、不依赖外部状态 |
| **有状态 Agent 类包装** | 管理队列、生命周期、并发控制 |
| **事件驱动架构** | 解耦生产者（LLM 流）和消费者（UI、持久化） |
| **延迟加载 Provider** | 按需加载 SDK，减少启动时间和内存 |
| **声明合并扩展消息** | 类型安全地扩展消息类型，无需修改核心代码 |
| **LLM 自身做 Compaction** | 利用 LLM 的总结能力压缩上下文，保留语义信息 |
| **双层循环 + 双队列** | 平衡实时响应性（steering）和任务完整性（follow-up） |
| **ToolDefinition / AgentTool 分离** | 定义（给 LLM 的 schema）和实现（执行逻辑）解耦 |
| **文件变更队列** | 并行工具执行时保证文件操作的串行安全 |
