# Pi Agent Loop 重试与错误处理机制

## 一、错误处理的三层架构

Pi 的错误处理分布在三个层次，各司其职：

```
┌────────────────────────────────────────────────────┐
│ 第 1 层：AgentSession（应用层重试 + 压缩恢复）       │
│   - 可恢复错误的自动重试（指数退避）                  │
│   - 上下文溢出的 compress-and-retry                  │
│   - UI 通知（重试开始/结束事件）                      │
├────────────────────────────────────────────────────┤
│ 第 2 层：Agent + agentLoop（运行时异常处理）          │
│   - 运行失败的错误消息合成                           │
│   - 中止（abort）信号传播                            │
│   - 工具执行异常捕获                                 │
├────────────────────────────────────────────────────┤
│ 第 3 层：LLM Provider（协议级错误编码）              │
│   - 错误编码为流事件（不抛异常）                      │
│   - 统一的 stopReason 语义                          │
└────────────────────────────────────────────────────┘
```

---

## 二、第 3 层：Provider 协议级——错误不抛异常

### 核心契约

LLM Provider（`packages/ai/src/providers/*.ts`）的 `streamSimple` 函数有一个关键契约：

> **永远不要 throw 或返回 rejected promise。所有错误必须编码到返回的 `AssistantMessageEventStream` 中。**

这意味着：
- 网络超时、API key 无效、速率限制、服务端错误……全部转化为流中的 `error` 事件
- 上层代码可以安全地用 `for await` 消费流，不会因为未捕获异常而崩溃

### stopReason 的五种值

```typescript
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

| stopReason | 含义 | 典型场景 |
|------------|------|---------|
| `stop` | 正常完成 | 模型自然结束回复 |
| `length` | 达到最大 token 数 | 回复被截断 |
| `toolUse` | 模型请求调用工具 | 需要执行工具 |
| `error` | 请求出错 | API 错误、网络问题 |
| `aborted` | 用户/系统取消 | AbortSignal 触发 |

错误消息存储在 `AssistantMessage.errorMessage` 字段中。

### 错误编码流程

```
Provider SDK 抛出异常
  │
  ▼
Provider 实现的 catch 块
  │
  ├── 创建 AssistantMessage {
  │     stopReason: "error",
  │     errorMessage: "500 Internal Server Error from Anthropic",
  │     usage: { input: 0, output: 0, ... },  // 零值
  │     content: []                              // 空内容
  │   }
  │
  ├── 流推入 { type: "error", reason: "error", error: message }
  │
  └── 流结束 stream.end(message)
```

---

## 三、第 2 层：agentLoop 运行时——错误捕获与传播

### 3.1 流式响应中的错误处理

`streamAssistantResponse` 函数（`agent-loop.ts:275-368`）消费 provider 返回的事件流：

```typescript
for await (const event of response) {
    switch (event.type) {
        case "done":
        case "error": {
            // 统一处理：无论成功还是失败，都拿到最终的 AssistantMessage
            const finalMessage = await response.result();
            // 更新上下文中的最后一条消息
            // 发射 message_end 事件
            return finalMessage;
        }
    }
}
```

关键点：`done` 和 `error` 两种终止事件的处理逻辑完全一致——都从流中提取最终消息，更新上下文，通知监听者。

### 3.2 Agent 类的错误处理

`Agent` 类的 `runWithLifecycle` 方法（`agent.ts:451-474`）包裹了整个运行：

```typescript
try {
    await executor(abortController.signal);
} catch (error) {
    await this.handleRunFailure(error, abortController.signal.aborted);
} finally {
    this.finishRun();  // 清理运行时状态
}
```

`handleRunFailure` 的策略：**将异常合成为一条错误消息**，走正常的事件流发射出去：

```typescript
private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        stopReason: aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        // ...
    };
    // 模拟正常的事件序列：message_start → message_end → turn_end → agent_end
    await this.processEvents({ type: "message_start", message: failureMessage });
    await this.processEvents({ type: "message_end", message: failureMessage });
    await this.processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
    await this.processEvents({ type: "agent_end", messages: [failureMessage] });
}
```

这确保了**即使发生意外异常，监听者也能收到完整的事件序列**，UI 不会卡在加载状态。

### 3.3 工具执行中的错误处理

工具执行有独立的错误捕获，不阻断循环：

```typescript
async function executePreparedToolCall(prepared, signal, emit) {
    try {
        const result = await prepared.tool.execute(/* ... */);
        return { result, isError: false };
    } catch (error) {
        // 工具抛出的异常被捕获，转化为错误结果
        return {
            result: { content: [{ type: "text", text: error.message }], details: {} },
            isError: true,
        };
    }
}
```

工具错误被编码为 `ToolResultMessage`（`isError: true`），发送回 LLM，让模型决定下一步。循环不会中断。

### 3.4 中止（Abort）信号传播

```
用户按 Escape
  │
  ▼
Agent.abort() → abortController.abort()
  │
  ▼ signal 传播到：
  ├── agentLoop 的 signal 参数
  ├── streamAssistantResponse → 传给 streamSimple → 传给 Provider SDK
  ├── executeToolCalls → 传给 tool.execute()
  └── prepareToolCall 的 beforeToolCall 钩子
```

中止后，provider 在流中推入 `{ type: "error", reason: "aborted", ... }`，最终产生一条 `stopReason: "aborted"` 的 AssistantMessage。

### 3.5 组合中止信号（combineAbortSignals）

`packages/ai/src/utils/abort-signals.ts`（新增文件，41 行）提供了 `combineAbortSignals` 工具函数，用于将多个 `AbortSignal` 合并为单一信号：

```typescript
interface CombinedAbortSignal {
    signal?: AbortSignal;
    cleanup: () => void;
}

function combineAbortSignals(signals: readonly (AbortSignal | undefined)[]): CombinedAbortSignal;
```

**优化策略**：
- 过滤掉 `undefined` 信号
- 0 个活跃信号：返回空 `cleanup`（无操作）
- 1 个活跃信号：直接复用，无需创建新 `AbortController`
- 多个活跃信号：创建新 `AbortController`，注册一次性 `abort` 事件监听，任一信号触发即传播中止；返回 `cleanup` 用于移除监听器

**使用场景**：在 OpenAI Codex Responses provider（`openai-codex-responses.ts`）中，用于合并用户中止信号和内部 header-timeout 信号，确保任一超时或用户操作都能中止正在进行的 HTTP 请求。

---

## 四、第 1 层：AgentSession——自动重试机制

### 4.1 整体流程

```
agent.prompt(messages)
  │
  ▼
_runAgentPrompt(messages)
  │
  ├── await agent.prompt(messages)        ← 第一次执行
  │
  └── while (await _handlePostAgentRun()) ← 检查是否需要重试/压缩
        │
        └── await agent.continue()        ← 重试或压缩后继续
```

`_handlePostAgentRun` 是重试和压缩的决策核心：

```typescript
private async _handlePostAgentRun(): Promise<boolean> {
    const msg = this._lastAssistantMessage;
    this._lastAssistantMessage = undefined;
    if (!msg) return false;

    // 优先级 1：如果是可重试错误，准备重试
    if (this._isRetryableError(msg) && await this._prepareRetry(msg)) {
        return true;  // → 调用方会执行 agent.continue()
    }

    // 如果重试耗尽，通知 UI
    if (msg.stopReason === "error" && this._retryAttempt > 0) {
        this._emit({ type: "auto_retry_end", success: false, ... });
        this._retryAttempt = 0;
    }

    // 优先级 2：检查是否需要压缩
    return await this._checkCompaction(msg);
}
```

### 4.2 哪些错误可重试

`_isRetryableError` 通过正则匹配错误消息判断（`agent-session.ts:2465-2478`）：

```typescript
private _isRetryableError(message: AssistantMessage): boolean {
    if (message.stopReason !== "error" || !message.errorMessage) return false;

    // 上下文溢出由压缩处理，不重试
    if (isContextOverflow(message, contextWindow)) return false;

    // 配额/计费错误不可重试
    if (this._isNonRetryableProviderLimitError(message.errorMessage)) return false;

    const err = message.errorMessage;
    return /overloaded|provider.?returned.?error|rate.?limit|too many requests|
            429|500|502|503|504|service.?unavailable|server.?error|
            internal.?error|network.?error|connection.?error|
            connection.?refused|connection.?lost|websocket.?closed|
            websocket.?error|other side closed|fetch failed|
            upstream.?connect|reset before headers|socket hang up|
            ended without|stream ended before message_stop|
            http2 request did not get a response|timed? out|timeout|
            terminated|retry delay/i.test(err);
}
```

**可重试的错误类型**：
- 服务端过载（`overloaded`、`500`、`502`、`503`、`504`、`server error`、`internal error`）
- 速率限制（`rate limit`、`429`、`too many requests`、`retry delay`）
- 网络问题（`connection error`、`connection refused`、`connection lost`、`fetch failed`、`websocket closed`、`websocket error`、`other side closed`、`upstream connect`、`reset before headers`、`socket hang up`）
- 超时（`timeout`、`timed out`）
- 流中断（`ended without`、`stream ended before message_stop`、`terminated`）
- HTTP/2 问题（`http2 request did not get a response`）
- Provider 返回错误（`provider returned error`）

**不可重试的错误**：
- 上下文溢出（由压缩处理）
- 认证失败（API key 无效）
- 请求格式错误（400）
- **配额/计费耗尽**（新增 `_isNonRetryableProviderLimitError` 方法，`agent-session.ts:2455-2458`）：匹配 `GoUsageLimitError`、`FreeUsageLimitError`、`Monthly usage limit reached`、`available balance`、`insufficient_quota`、`out of budget`、`quota exceeded`、`billing` 等模式——这些错误重试也无法解决

### 4.3 指数退避重试

`_prepareRetry` 实现指数退避（`agent-session.ts:2484-2533`）：

```
默认配置：
  maxRetries: 3
  baseDelayMs: 2000ms (2秒)

退避序列：
  第 1 次重试：2000ms * 2^0 = 2 秒
  第 2 次重试：2000ms * 2^1 = 4 秒
  第 3 次重试：2000ms * 2^2 = 8 秒
```

**重试准备步骤**：

```
1. 递增 _retryAttempt 计数器
2. 计算退避延迟：baseDelayMs * 2^(attempt-1)
3. 发射 auto_retry_start 事件（通知 UI 显示重试状态）
4. 从 agent 状态中移除错误消息（保留在 session 文件中用于历史记录）
5. 使用可取消的 sleep 等待（支持用户随时中断）
6. 返回 true → 调用方执行 agent.continue()
```

**关键设计**：错误消息从 agent 状态中移除但不从 session 中删除。这意味着：
- LLM 不会看到之前的错误（避免在重试时浪费上下文窗口）
- 用户仍然可以在历史记录中看到错误

### 4.4 重试计数器与溢出恢复标志重置

重试计数器在**每次成功的 LLM 响应后立即重置**（`agent-session.ts:531-544`）：

```typescript
// 在 _handleAgentEvent 的 message_end 处理中
if (event.message.role === "assistant") {
    const assistantMsg = event.message as AssistantMessage;
    if (assistantMsg.stopReason !== "error") {
        this._overflowRecoveryAttempted = false;  // 同时重置溢出恢复标志
    }

    if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
        this._emit({ type: "auto_retry_end", success: true, attempt: this._retryAttempt });
        this._retryAttempt = 0;
    }
}
```

这意味着：如果 agent 在一次 prompt 中执行了 3 次 LLM 调用（工具调用链），第 1 次失败重试成功后，第 2 次调用失败时重试计数从 0 重新开始。**重试次数不会在一次 prompt 中累积**。

此外，**溢出恢复标志 `_overflowRecoveryAttempted` 也在任何非错误响应时重置**。这确保了如果用户切换到一个更大的上下文模型后继续对话，溢出恢复限制不会错误地阻止后续的正常溢出恢复流程。

### 4.5 用户可取消重试

```typescript
async abort(): Promise<void> {
    this.abortRetry();      // 取消退避等待
    this.agent.abort();     // 取消当前 LLM 调用
    await this.agent.waitForIdle();
}

abortRetry(): void {
    this._retryAbortController?.abort();  // 中断 sleep
}
```

sleep 被中断后，`_prepareRetry` catch 块发射 `auto_retry_end` 事件并返回 false，重试终止。

---

## 五、上下文溢出恢复：compress-and-retry

### 5.1 溢出检测

`isContextOverflow`（`packages/ai/src/utils/overflow.ts`）检测三种溢出模式，共包含 22 个 `OVERFLOW_PATTERNS` 正则和 3 个 `NON_OVERFLOW_PATTERNS` 排除正则：

**模式 1：错误消息匹配**（绝大多数 provider）
- Anthropic: `"prompt is too long: 213462 tokens > 200000 maximum"` 或 `"request_too_large"`（HTTP 413）
- Amazon Bedrock: `"input is too long for requested model"`
- OpenAI: `"Your input exceeds the context window"` 或 `"exceeds the model's maximum context length of X tokens"`
- Google: `"input token count exceeds the maximum"`
- xAI: `"maximum prompt length is X but request contains Y"`
- Groq: `"reduce the length of the messages"`
- OpenRouter: `"maximum context length is X tokens"` 或 `"exceeds the maximum allowed input length of Y tokens"`
- Together AI: `"input (X tokens) is longer than the model's context length (Y tokens)"`
- Mistral: `"Prompt contains X tokens ... too large for model with Y maximum context length"`
- GitHub Copilot: `"prompt token count of X exceeds the limit of Y"`
- MiniMax: `"context window exceeds limit"`
- Kimi For Coding: `"exceeded model token limit"`
- Cerebras: 400/413 状态码（无 body）
- Ollama: `"prompt too long; exceeded max context length"`
- z.ai: `"model_context_window_exceeded"`（非标准 finish_reason 转为错误文本）
- llama.cpp / LM Studio / LiteLLM 等兼容格式

**模式 2：静默溢出**（z.ai 风格）
- `stopReason === "stop"` 但 `usage.input > contextWindow`
- provider 不报错，但输入已超出窗口

**模式 3：长度截断溢出**（Xiaomi MiMo 风格）
- `stopReason === "length"` + `output === 0` + 输入填满 99% 上下文窗口
- 服务端截断输入，没有空间生成输出

**排除项（NON_OVERFLOW_PATTERNS）**：以下模式即使也匹配溢出关键词，也会被排除，不视为溢出：
- AWS Bedrock 节流/服务不可用前缀（`"Throttling error:"` / `"Service unavailable:"`）
- 速率限制（`rate limit`）
- HTTP 429 风格（`too many requests`）

此外，模块还导出 `getOverflowPatterns()` 函数用于测试目的，返回 `OVERFLOW_PATTERNS` 的副本。

### 5.2 溢出恢复流程

```
agent_end 事件
  │
  ▼
_handlePostAgentRun()
  │
  ├── _isRetryableError → false（溢出不可重试）
  │
  └── _checkCompaction(msg)
        │
        ├── 检查：sameModel？（溢出消息来自当前模型）
        ├── 检查：isContextOverflow？
        │
        └── 是 → _runAutoCompaction("overflow", willRetry=true)
              │
              ├── 1. 移除 agent 状态中的错误消息
              ├── 2. 发射 compaction_start 事件
              ├── 3. 扩展 session_before_compact 钩子
              │     └── 扩展可提供自定义压缩或取消
              ├── 4. 调用 compact() 生成摘要
              │     └── 使用 LLM 将历史对话总结为摘要
              ├── 5. 将摘要写入 session，更新 agent 状态
              └── 6. 返回 true → agent.continue() 自动重试
```

**只尝试一次**：`_overflowRecoveryAttempted` 标志确保溢出恢复只执行一次。如果压缩后仍然溢出，不再重试，向用户报告：

> "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model."

### 5.3 阈值压缩（非溢出的常规压缩）

除了溢出恢复，还有基于阈值的自动压缩：

```typescript
// 检查是否超过阈值
const contextTokens = calculateContextTokens(assistantMessage.usage);
const threshold = contextWindow - reserveTokens;  // reserveTokens 默认 16384
if (contextTokens > threshold) {
    await _runAutoCompaction("threshold", willRetry=false);
}
```

阈值压缩与溢出恢复的区别：
- **不自动重试**（`willRetry=false`）：压缩后用户需要手动发送下一条消息
- **错误消息也触发**：对于错误响应（没有 usage 数据），使用 `estimateContextTokens` 从最后成功的响应估算

### 5.4 压缩实现

压缩过程（`packages/coding-agent/src/core/compaction/compaction.ts`）：

1. **准备**：确定要压缩的消息范围、保留最近的消息
2. **提取文件操作**：扫描工具调用，记录读了/改了哪些文件
3. **序列化**：将消息转为纯文本
4. **LLM 总结**：调用 `completeSimple`（非流式）生成摘要
5. **创建 CompactionSummaryMessage**：替换原有消息

```
保留参数：
  reserveTokens: 16384    ← 为回复预留的 token 空间
  keepRecentTokens: 20000 ← 保留最近 N 个 token 的消息不压缩
```

---

## 六、错误事件流总览

```
用户输入 → AgentSession.prompt()
  │
  ▼
Agent.prompt() → runAgentLoop()
  │
  ├─→ streamAssistantResponse()
  │     │
  │     ├─→ Provider 返回正常响应
  │     │     → stopReason: "stop" / "toolUse" / "length"
  │     │     → 正常事件流: message_start → message_update* → message_end
  │     │
  │     ├─→ Provider 返回可重试错误
  │     │     → stopReason: "error", errorMessage 含 "500"/"rate limit" 等
  │     │     → turn_end → agent_end (willRetry: true)
  │     │     → AgentSession 捕获，执行指数退避重试
  │     │
  │     ├─→ Provider 返回溢出错误
  │     │     → stopReason: "error", errorMessage 含 "prompt is too long" 等
  │     │     → turn_end → agent_end (willRetry: false)
  │     │     → _checkCompaction 识别为溢出 → compress-and-retry
  │     │
  │     ├─→ 用户中止
  │     │     → stopReason: "aborted"
  │     │     → turn_end → agent_end
  │     │     → 不触发重试，不触发压缩
  │     │
  │     └─→ 意外异常（Agent 层 catch）
  │           → 合成为 stopReason: "error" 的消息
  │           → 模拟完整事件序列
  │
  ├─→ executeToolCalls()
  │     │
  │     ├─→ 工具正常返回
  │     │     → ToolResultMessage, isError: false
  │     │
  │     ├─→ 工具抛异常
  │     │     → ToolResultMessage, isError: true
  │     │     → 发回 LLM，由模型决定下一步
  │     │
  │     ├─→ beforeToolCall 阻止
  │     │     → ToolResultMessage, isError: true, reason: "blocked"
  │     │
  │     └─→ 中止
  │           → ToolResultMessage, isError: true, "Operation aborted"
  │
  └─→ 事后处理（_handlePostAgentRun）
        │
        ├── 可重试错误？ → 指数退避 → agent.continue()
        ├── 溢出错误？ → 压缩 → agent.continue()
        ├── 超过阈值？ → 压缩（不重试）
        └── 正常结束
```

---

## 七、关键设计总结

| 设计决策 | 原因 |
|---------|------|
| **Provider 不抛异常** | 流式场景下异常难以正确处理；编码为流事件保证消费者总能正常消费 |
| **错误消息的 stopReason 语义** | 统一的终止原因让上层无需关心 provider 差异 |
| **重试在 AgentSession 层而非 agentLoop 层** | agentLoop 是无状态函数，重试需要管理状态（计数、退避、UI 通知） |
| **指数退避可取消** | 长时间等待时用户不应被阻塞 |
| **重试计数器在成功响应后重置** | 避免 agent 一次 prompt 中的多次 LLM 调用累积重试计数 |
| **溢出错误不重试，走压缩路径** | 重试同样的上下文只会再次溢出，必须先压缩
| **溢出恢复只尝试一次** | 防止压缩→溢出→压缩→溢出的无限循环 |
| **错误消息从 agent 状态移除但保留在 session** | 重试时 LLM 不看到错误（省 token），用户能在历史中看到（可调试） |
| **工具错误发回 LLM 而非中断循环** | 让模型决定如何处理失败（重试、换策略、告知用户） |
| **压缩保留最近的 N 个 token** | 保证模型始终有最近的上下文可用 |
| **阈值压缩不自动重试** | 压缩本身不意味着需要重新发送消息，用户自然继续即可 |
| **中止跳过压缩检查** | 用户主动取消不应触发任何自动操作 |
