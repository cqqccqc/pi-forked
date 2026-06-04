# Pi Agent 消息队列机制分析

## 概述

Pi agent 实现了一套双层消息队列系统（Steering 队列和 Follow-up 队列），用于在 agent 运行期间动态注入用户消息。这套机制允许用户在不中断正在进行的 LLM 调用的情况下，提前排队下一条指令，实现"流式对话"体验。

**核心设计理念**：
- **Steering 队列**：用于"引导"正在进行的任务，在当前工具调用执行完成后立即注入
- **Follow-up 队列**：用于"跟进"任务，仅在 agent 自然停止时才处理

---

## 1. PendingMessageQueue 实现

### 1.1 数据结构定义

**位置**: `packages/agent/src/agent.ts` (行 118-152)

```typescript
class PendingMessageQueue {
    private messages: AgentMessage[] = [];
    public mode: QueueMode;

    constructor(mode: QueueMode) {
        this.mode = mode;
    }
}
```

### 1.2 队列模式 (QueueMode)

**位置**: `packages/agent/src/types.ts` (行 38-44)

```typescript
export type QueueMode = "all" | "one-at-a-time";
```

| 模式 | 行为 | 使用场景 |
|------|------|----------|
| `all` | 一次清空并注入所有排队消息 | 批量任务处理 |
| `one-at-a-time` | 每次仅取出最旧的一条消息 | 保持对话节奏，逐条处理 |

### 1.3 核心方法实现

#### drain() - 取出消息

```typescript
drain(): AgentMessage[] {
    if (this.mode === "all") {
        const drained = this.messages.slice();
        this.messages = [];
        return drained;
    }

    const first = this.messages[0];
    if (!first) {
        return [];
    }
    this.messages = this.messages.slice(1);
    return [first];
}
```

**关键设计**：
- `all` 模式：原子性清空队列，返回所有消息的副本
- `one-at-a-time` 模式：FIFO（先进先出）语义，仅移除头部元素

#### enqueue() - 添加消息

```typescript
enqueue(message: AgentMessage): void {
    this.messages.push(message);
}
```

简单追加到数组末尾，保持插入顺序。

---

## 2. Agent 类的队列集成

### 2.1 队列实例化

**位置**: `packages/agent/src/agent.ts` (行 169-170, 212-213)

```typescript
export class Agent {
    private readonly steeringQueue: PendingMessageQueue;
    private readonly followUpQueue: PendingMessageQueue;

    constructor(options: AgentOptions = {}) {
        // ...
        this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
        this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
    }
}
```

**默认行为**：两个队列都默认使用 `one-at-a-time` 模式。

### 2.2 公共 API

#### steer() - 注入引导消息

```typescript
steer(message: AgentMessage): void {
    this.steeringQueue.enqueue(message);
}
```

**语义**：在当前 assistant 轮次完成后（工具调用已执行），但下一轮 LLM 调用之前注入。

#### followUp() - 注入跟进消息

```typescript
followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
}
```

**语义**：仅在 agent 自然停止（无更多工具调用且无 steering 消息）时才处理。

---

## 3. Agent Loop 中的队列消费

### 3.1 主循环结构

**位置**: `packages/agent/src/agent-loop.ts` (行 155-269)

```typescript
async function runLoop(
    initialContext: AgentContext,
    newMessages: AgentMessage[],
    initialConfig: AgentLoopConfig,
    signal: AbortSignal | undefined,
    emit: AgentEventSink,
    streamFn?: StreamFn,
): Promise<void> {
    let currentContext = initialContext;
    let config = initialConfig;
    let firstTurn = true;

    // 初始化：检查是否有用户在等待时输入的 steering 消息
    let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

    // 外层循环：处理 follow-up 消息
    while (true) {
        let hasMoreToolCalls = true;

        // 内层循环：处理工具调用和 steering 消息
        while (hasMoreToolCalls || pendingMessages.length > 0) {
            // ... 处理 pendingMessages，流式 assistant 响应，执行工具 ...

            // 轮次结束后，检查是否有新的 steering 消息
            pendingMessages = (await config.getSteeringMessages?.()) || [];
        }

        // Agent 将在此停止。检查 follow-up 消息。
        const followUpMessages = (await config.getFollowUpMessages?.()) || [];
        if (followUpMessages.length > 0) {
            pendingMessages = followUpMessages;
            continue;  // 继续外层循环
        }

        break;  // 无更多消息，退出
    }
}
```

### 3.2 控制流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agent Loop 入口                              │
│  (runAgentLoop / runAgentLoopContinue)                              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │ 初始化：检查 steering │
                  │ 队列 (用户等待时输入) │
                  └─────────┬───────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │   外层循环开始       │
                  │  while (true)       │
                  └─────────┬───────────┘
                            │
                  ┌─────────▼───────────┐
                  │   内层循环开始       │
                  │  while (hasToolCalls │
                  │    || pending)       │
                  └─────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
      ┌─────────────┐ ┌─────────────┐ ┌───────────────────┐
      │ pending > 0?│ │流式 Assistant │ │  执行工具调用     │
      │ 注入消息    │ │  响应        │ │  (sequential/     │
      └─────┬───────┘ └──────┬──────┘ │   parallel)       │
            │                │        └─────────┬─────────┘
            │                │                  │
            │                ▼                  │
            │         ┌─────────────┐           │
            │         │ emit events │           │
            │         │ (message_*  │           │
            │         │  turn_end)  │           │
            │         └──────┬──────┘           │
            │                │                  │
            │                └──────────┬───────┘
            │                           │
            │                           ▼
            │                  ┌─────────────────┐
            │                  │ prepareNextTurn │
            │                  │ (hook)          │
            │                  └─────────┬───────┘
            │                            │
            │                            ▼
            │                  ┌─────────────────┐
            │                  │ shouldStopAfter │
            │                  │ Turn? (hook)    │
            │                  └─────────┬───────┘
            │                            │
            │                ┌───────────┴───────────┐
            │                │                       │
            │                ▼                       ▼
            │         ┌─────────────┐        ┌──────────────┐
            │         │ 返回 false:  │        │ 返回 true:   │
            │         │ 继续         │        │ 发送 agent_end│
            │         └──────┬──────┘        │ 并退出       │
            │                │               └──────┬───────┘
            │                │                       │
            │                ▼                       │
            │         ┌─────────────────┐            │
            │         │ getSteeringMessages│         │
            │         │ (drain steering queue)       │
            │         └─────────┬───────┘            │
            │                   │                    │
            │         ┌─────────┴─────────┐          │
            │         │                   │          │
            │         ▼                   ▼          │
            │   ┌─────────────┐     ┌─────────────┐ │
            │   │ 有消息       │     │ 无消息       │ │
            │   │ pending = [] │     │ hasMoreTool  │ │
            │   │ 继续内层循环 │     │ Calls = false│ │
            │   └─────────────┘     └──────┬──────┘ │
            │                                 │        │
            └─────────────────────────────────┘        │
                                                      │
                      ┌──────────────┐                │
                      │ 内层循环退出   │                │
                      │ (hasMore=false│                │
                      │  && pending=0) │                │
                      └──────────┬─────┘                │
                                 │                      │
                                 ▼                      │
                      ┌─────────────────────┐          │
                      │ getFollowUpMessages  │          │
                      │ (drain follow-up queue)         │
                      └──────────┬──────────┘          │
                                 │                     │
                      ┌──────────┴──────────┐          │
                      │                     │          │
                      ▼                     ▼          │
              ┌─────────────┐       ┌─────────────┐    │
              │ 有消息       │       │ 无消息       │    │
              │ pending = [] │       │ break 外层   │    │
              │ continue 外层│       │ 循环         │    │
              └─────────────┘       └──────┬──────┘    │
                                             │         │
                                             ▼         │
                                   ┌─────────────────┐ │
                                   │ emit agent_end  ◄─┘
                                   │ 返回 newMessages │
                                   └─────────────────┘
```

### 3.3 关键注入点

| 阶段 | 队列 | 注入时机 | 说明 |
|------|------|----------|------|
| 初始化 | steering | loop 开始前 | 用户在等待时输入的消息 |
| 轮次间 | steering | `turn_end` 后 | 当前工具调用完成后、下一 LLM 调用前 |
| 自然停止 | follow-up | 内层循环退出后 | 无工具调用且无 steering 消息时 |

---

## 4. AgentSession 层的路由机制

### 4.1 用户输入路由

**位置**: `packages/coding-agent/src/core/agent-session.ts` (行 961-1117)

```typescript
async prompt(text: string, options?: PromptOptions): Promise<void> {
    // ...

    // 若 agent 正在流式输出
    if (this.isStreaming) {
        if (!options?.streamingBehavior) {
            throw new Error(
                "Agent is already processing. Specify streamingBehavior " +
                "('steer' or 'followUp') to queue the message."
            );
        }
        if (options.streamingBehavior === "followUp") {
            await this._queueFollowUp(expandedText, currentImages);
        } else {
            await this._queueSteer(expandedText, currentImages);
        }
        return;
    }

    // 非 streaming 状态，正常发送 prompt
    await this._runAgentPrompt(messages);
}
```

### 4.2 队列操作封装

```typescript
private async _queueSteer(text: string, images?: ImageContent[]): Promise<void> {
    this._steeringMessages.push(text);  // UI 显示用
    this._emitQueueUpdate();
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    if (images) {
        content.push(...images);
    }
    this.agent.steer({
        role: "user",
        content,
        timestamp: Date.now(),
    });
}

private async _queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
    this._followUpMessages.push(text);  // UI 显示用
    this._emitQueueUpdate();
    // ... 类似 _queueSteer
    this.agent.followUp({ /* ... */ });
}
```

**双重追踪**：
- `Agent._steeringMessages` / `_followUpMessages`：UI 显示用的文本副本
- `Agent.steeringQueue` / `followUpQueue`：实际的消息对象队列

### 4.3 队列状态同步

当消息开始处理时（`message_start` 事件），从 UI 追踪数组中移除：

```typescript
// _handleAgentEvent 中
if (event.type === "message_start" && event.message.role === "user") {
    const messageText = this._getUserMessageText(event.message);
    if (messageText) {
        const steeringIndex = this._steeringMessages.indexOf(messageText);
        if (steeringIndex !== -1) {
            this._steeringMessages.splice(steeringIndex, 1);
            this._emitQueueUpdate();
        } else {
            const followUpIndex = this._followUpMessages.indexOf(messageText);
            if (followUpIndex !== -1) {
                this._followUpMessages.splice(followUpIndex, 1);
                this._emitQueueUpdate();
            }
        }
    }
}
```

---

## 5. 队列配置与持久化

### 5.1 队列模式设置

**位置**: `packages/coding-agent/src/core/agent-session.ts` (行 1583-1599)

```typescript
setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.agent.steeringMode = mode;
    this.settingsManager.setSteeringMode(mode);  // 持久化到设置
}

setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.agent.followUpMode = mode;
    this.settingsManager.setFollowUpMode(mode);  // 持久化到设置
}
```

### 5.2 队列清理

```typescript
clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this._steeringMessages];
    const followUp = [...this._followUpMessages];
    this._steeringMessages = [];
    this._followUpMessages = [];
    this.agent.clearAllQueues();
    this._emitQueueUpdate();
    return { steering, followUp };
}
```

**用途**：用户中止时恢复未发送消息到编辑器。

---

## 6. 特殊场景处理

### 6.1 continue() 中的队列检查

**位置**: `packages/agent/src/agent.ts` (行 338-365)

```typescript
async continue(): Promise<void> {
    // ...

    const lastMessage = this._state.messages[this._state.messages.length - 1];
    if (lastMessage.role === "assistant") {
        // 优先检查 steering 队列
        const queuedSteering = this.steeringQueue.drain();
        if (queuedSteering.length > 0) {
            await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
            return;
        }

        // 其次检查 follow-up 队列
        const queuedFollowUps = this.followUpQueue.drain();
        if (queuedFollowUps.length > 0) {
            await this.runPromptMessages(queuedFollowUps);
            return;
        }

        throw new Error("Cannot continue from message role: assistant");
    }

    await this.runContinuation();
}
```

**设计意图**：允许用户在 assistant 消息后通过 `continue()` 触发排队消息的处理。

### 6.2 队列消息与扩展命令

扩展命令（`/command`）不能被排队，必须立即执行：

```typescript
async steer(text: string, images?: ImageContent[]): Promise<void> {
    if (text.startsWith("/")) {
        this._throwIfExtensionCommand(text);
    }
    // ...
}
```

---

## 7. 并发安全性分析

### 7.1 当前实现

**无显式并发控制**：
- `enqueue()` 直接修改 `messages` 数组
- `drain()` 读取并修改 `messages` 数组
- 无锁或互斥机制

### 7.2 安全性保障

**单一异步执行上下文**：
- Agent loop 在单一事件流中运行
- `steer()`/`followUp()` 从事件处理器调用（同步）
- JavaScript 单线程特性确保原子性

**潜在风险场景**（理论）：
- 若未来支持多线程或 worker 线程，需要添加互斥锁
- 当前设计假设所有调用来自主事件循环

### 7.3 AbortSignal 传播

```typescript
get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
}

abort(): void {
    this.activeRun?.abortController.abort();
}
```

**中断处理**：队列操作本身不可中断，但队列消费的 loop 会响应 abort 信号。

---

## 8. 关键设计总结

| 方面 | 设计选择 | 权衡考虑 |
|------|----------|----------|
| **双队列 vs 单队列** | 分离 steering/follow-up | 语义明确：引导 vs 跟进；控制注入时机 |
| **队列模式** | `all` / `one-at-a-time` | 平衡批量效率与对话节奏 |
| **消费顺序** | steering → follow-up | steering 优先级更高，更即时 |
| **并发安全** | 无锁，依赖单线程 | 简单高效，适合当前 JS 运行时 |
| **UI 追踪** | 双重数组（文本 + 对象） | 文本用于显示，对象用于实际处理 |
| **状态持久化** | 设置管理器保存模式 | 用户偏好跨会话保持 |
| **扩展命令** | 不允许排队 | 命令需立即执行，有副作用 |

---

## 9. 使用场景示例

### 9.1 场景 A：实时引导

```
用户: 分析 /src/foo.ts
Agent: [开始分析...]
用户: [agent 运行中] 同时检查 bar.ts  (steer)
Agent: [完成 foo.ts 分析] → [立即检查 bar.ts]
```

**流程**：
1. 用户发送 prompt，agent 开始处理
2. 用户输入第二条消息，指定 `streamingBehavior: "steer"`
3. 第二条消息进入 steering 队列
4. Agent 完成 foo.ts 的工具调用后
5. 在下一 LLM 调用前，注入 bar.ts 请求
6. Agent 继续处理 bar.ts

### 9.2 场景 B：任务排队

```
用户: 实现 feature X
Agent: [实现 feature X...]
用户: [agent 运行中] 之后测试 feature X  (followUp)
用户: [agent 运行中] 然后部署到 staging  (followUp)
Agent: [完成 feature X] → [停止]
     [自动继续] 测试 feature X → [停止]
     [自动继续] 部署到 staging
```

**流程**：
1. 用户发送主任务
2. 用户输入两个 follow-up 消息
3. 两条消息都进入 follow-up 队列
4. Agent 完成 feature X 后自然停止
5. 外层循环检测到 follow-up 消息，继续处理测试任务
6. 测试完成后再次停止，处理部署任务
7. 部署完成后，队列清空，真正停止

### 9.3 场景 C：批量模式

```typescript
agent.steeringMode = "all";
agent.steer({ role: "user", content: "任务 1" });
agent.steer({ role: "user", content: "任务 2" });
agent.steer({ role: "user", content: "任务 3" });
// 下一轮将一次性注入所有三个任务
```

---

## 10. 扩展点与限制

### 10.1 当前限制

1. **无优先级**：FIFO 语义，无法插队
2. **无去重**：相同内容可能多次排队
3. **无过期**：消息永久保留直到处理
4. **无容量限制**：理论上可无限累积

### 10.2 潜在扩展方向

1. **优先级队列**：基于消息类型或用户标记
2. **去重策略**：内容哈希或消息 ID
3. **TTL 机制**：超时自动丢弃
4. **容量上限**：满队列策略（拒绝/覆盖/分片）
5. **条件注入**：基于 agent 状态的智能注入

---

## 附录：完整消息流时序图

```
用户输入                     AgentSession              Agent                  AgentLoop
   │                             │                        │                        │
   │ prompt("任务A")             │                        │                        │
   ├────────────────────────────►│                        │                        │
   │                             │ agent.prompt()         │                        │
   │                             ├───────────────────────►│                        │
   │                             │                        │ runAgentLoop()         │
   │                             │                        ├───────────────────────►│
   │                             │                        │                        │ [开始处理]
   │                             │                        │                        │
   │ [用户输入 "任务B"]           │                        │                        │
   │ steer("任务B")              │                        │                        │
   ├────────────────────────────►│                        │                        │
   │                             │ agent.steer()          │                        │
   │                             ├───────────────────────►│                        │
   │                             │                        │ [入 steering 队列]      │
   │                             │                        │                        │
   │                             │                        │                        │ [turn_end]
   │                             │                        │                        │ getSteeringMessages()
   │                             │                        │                        ├──── [drain 队列]
   │                             │                        │                        │
   │                             │                        │                        │ [注入 "任务B"]
   │                             │                        │                        │
   │                             │                        │                        │ [继续处理]
   │                             │                        │                        │
   │                             │                        │                        │ [无工具调用]
   │                             │                        │                        │
   │                             │                        │                        │ getFollowUpMessages()
   │                             │                        │                        ├──── [返回空]
   │                             │                        │                        │
   │                             │                        │                        │ [退出循环]
   │                             │                        │                        │
   │                             │ agent_end event       │                        │
   │                             │◄───────────────────────┤─────────────────────────┤
```

---

**文档版本**: 1.0
**最后更新**: 2026-05-22
**分析范围**: `packages/agent/src/agent.ts`, `packages/agent/src/agent-loop.ts`, `packages/coding-agent/src/core/agent-session.ts`
