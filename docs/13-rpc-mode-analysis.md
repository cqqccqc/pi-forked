# Pi Agent RPC 模式实现分析

## 目录

- [概述](#概述)
- [整体架构](#整体架构)
- [文件结构](#文件结构)
- [JSON-RPC 协议实现](#json-rpc-协议实现)
- [RPC 接口设计](#rpc-接口设计)
- [多客户端连接管理](#多客户端连接管理)
- [无头模式运行机制](#无头模式运行机制)
- [与 AgentSession 的集成](#与-agentsession-的集成)
- [事件流向](#事件流向)
- [错误处理和连接断开恢复](#错误处理和连接断开恢复)
- [与交互模式的差异](#与交互模式的差异)
- [编辑器插件/SDK 集成](#编辑器插件sdk-集成)
- [关键设计总结](#关键设计总结)

---

## 概述

RPC 模式是 Pi Agent 的无头操作模式，专为嵌入其他应用程序（如编辑器插件、IDE 集成、自定义 UI）而设计。它通过标准输入/输出（stdin/stdout）使用 JSON Lines (JSONL) 协议进行通信，使外部程序能够以编程方式控制 agent 并接收实时事件流。

### 核心特点

- **无头操作**：无终端 UI，纯 JSON 协议通信
- **双向通信**：stdin 接收命令，stdout 发送响应和事件
- **事件流式传输**：实时推送 agent 状态变化
- **类型安全**：完整的 TypeScript 类型定义
- **异步非阻塞**：支持流式响应和长时间运行的操作

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         客户端应用                                    │
│                    (编辑器插件/SDK/自定义程序)                          │
└────────────────────┬────────────────────────────────────────────────┘
                     │ stdin (JSONL 命令)
                     ▼
         ┌───────────────────────┐
         │   RPC 模式服务器       │
         │   (rpc-mode.ts)       │
         └───────────┬───────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    ▼                ▼                ▼
┌─────────┐    ┌──────────┐    ┌──────────┐
│ JSONL   │    │ Extension│    │ Agent    │
│ 解析器   │    │ UI 适配器│    │ Session  │
└─────────┘    └──────────┘    └──────────┘
                     │
                     ▼
            ┌───────────────────┐
            │  核心功能层         │
            │ (AgentSession)    │
            └───────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │    Agent Loop         │
         │  (pi-agent-core)      │
         └───────────────────────┘
                     │
                     ▼
              stdout (JSONL 事件/响应)
```

### 架构层次

1. **传输层** (`jsonl.ts`)
   - JSONL 序列化/反序列化
   - 流式行读取（LF 分隔）
   - 避免 Unicode 分隔符问题

2. **协议层** (`rpc-types.ts`)
   - 命令/响应类型定义
   - 请求-响应关联
   - 扩展 UI 协议

3. **服务器层** (`rpc-mode.ts`)
   - 命令分发和处理
   - 事件转发
   - 会话生命周期管理

4. **客户端层** (`rpc-client.ts`)
   - 进程管理
   - 请求-响应匹配
   - 事件订阅

---

## 文件结构

```
packages/coding-agent/src/modes/rpc/
├── rpc-mode.ts      # RPC 服务器主入口
├── rpc-client.ts    # RPC 客户端实现
├── rpc-types.ts     # 协议类型定义
└── jsonl.ts         # JSONL 传输层实现
```

### 文件职责

| 文件 | 职责 | 导出 |
|------|------|------|
| `rpc-mode.ts` | 服务器实现、命令处理、事件流 | `runRpcMode()` |
| `rpc-client.ts` | 客户端实现、进程管理、类型化 API | `RpcClient` |
| `rpc-types.ts` | 协议类型定义 | 命令/响应/事件类型 |
| `jsonl.ts` | 传输层实现 | `serializeJsonLine()`, `attachJsonlLineReader()` |

---

## JSON-RPC 协议实现

### 协议基础

Pi Agent 使用 **JSON Lines (JSONL)** 而非标准 JSON-RPC 2.0。每行一个独立的 JSON 对象，以换行符（LF `\n`）分隔。

**设计原因**：
1. **流式友好**：支持实时流式输出，无需等待完整响应
2. **简单解析**：避免 JSON-RPC 批量请求的复杂性
3. **Unicode 安全**：仅使用 LF 分隔，避免 U+2028/U+2029 问题

### 传输层实现 (`jsonl.ts`)

```typescript
// 序列化：添加 LF 分隔符
export function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

// 反序列化：LF 分行读取
export function attachJsonlLineReader(
  stream: Readable, 
  onLine: (line: string) => void
): () => void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const onData = (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  };
  
  // ... 事件监听设置
}
```

**关键特性**：
- **仅 LF 分隔**：`buffer.indexOf("\n")` 只查找 LF
- **CR 处理**：行尾的 `\r` 被移除
- **UTF-8 安全**：使用 `StringDecoder` 处理多字节字符边界

### 消息流

```
stdin 客户端 → 服务器:                   {"type":"prompt","message":"Hello","id":"req_1"}\n
stdout 服务器 → 客户端 (响应):             {"type":"response","command":"prompt","success":true,"id":"req_1"}\n
stdout 服务器 → 客户端 (事件流):          {"type":"agent_start"}\n
                                      {"type":"message_start","message":{...}}\n
                                      {"type":"message_update","message":{...}}\n
                                      ...
                                      {"type":"agent_end","messages":[...]}\n
```

---

## RPC 接口设计

### 命令分类

RPC 接口提供约 30 个命令，分为以下类别：

#### 1. 提示词操作

| 命令 | 描述 | 响应 |
|------|------|------|
| `prompt` | 发送用户提示 | 异步（事件流） |
| `steer` | 发送转向消息（中断） | 同步确认 |
| `follow_up` | 发送后续消息 | 同步确认 |
| `abort` | 中断当前操作 | 同步确认 |

#### 2. 会话管理

| 命令 | 描述 | 响应 |
|------|------|------|
| `new_session` | 创建新会话（可选 `parentSession` 参数） | `{cancelled: boolean}` |
| `switch_session` | 切换到已有会话 | `{cancelled: boolean}` |
| `fork` | 从指定消息分叉 | `{text: string, cancelled: boolean}` |
| `clone` | 克隆当前会话 | `{cancelled: boolean}` |
| `get_session_stats` | 获取会话统计 | `SessionStats` |
| `export_html` | 导出为 HTML | `{path: string}` |
| `set_session_name` | 设置会话名称 | 确认 |
| `get_fork_messages` | 获取可分叉的消息 | `{messages: [...]}` |
| `get_last_assistant_text` | 获取最后助手文本 | `{text: string \| null}` |

#### 3. 状态查询

| 命令 | 描述 | 响应 |
|------|------|------|
| `get_state` | 获取当前状态 | `RpcSessionState` |
| `get_messages` | 获取所有消息 | `{messages: AgentMessage[]}` |
| `get_commands` | 获取可用命令 | `{commands: RpcSlashCommand[]}` |

#### 4. 模型管理

| 命令 | 描述 | 响应 |
|------|------|------|
| `set_model` | 设置模型 | `Model` |
| `cycle_model` | 循环切换模型 | `{model, thinkingLevel, isScoped} \| null` |
| `get_available_models` | 获取可用模型 | `{models: Model[]}` |

#### 5. 思考级别

| 命令 | 描述 | 响应 |
|------|------|------|
| `set_thinking_level` | 设置思考级别 | 确认 |
| `cycle_thinking_level` | 循环切换 | `{level: ThinkingLevel} \| null` |

#### 6. 队列模式

| 命令 | 描述 | 响应 |
|------|------|------|
| `set_steering_mode` | 设置转向模式 | 确认 |
| `set_follow_up_mode` | 设置后续模式 | 确认 |

#### 7. 压缩和重试

| 命令 | 描述 | 响应 |
|------|------|------|
| `compact` | 手动压缩会话 | `CompactionResult` |
| `set_auto_compaction` | 设置自动压缩 | 确认 |
| `set_auto_retry` | 设置自动重试 | 确认 |
| `abort_retry` | 中断重试 | 确认 |

#### 8. Bash 操作

| 命令 | 描述 | 响应 |
|------|------|------|
| `bash` | 执行命令 | `BashResult` |
| `abort_bash` | 中断命令 | 确认 |

### 请求-响应关联

每个命令可以包含可选的 `id` 字段用于关联：

```typescript
interface RpcCommand {
  id?: string;  // 客户端生成的唯一 ID
  type: string;
  // ... 命令特定字段
}

interface RpcResponse {
  id?: string;  // 回显请求的 ID
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
```

---

## 多客户端连接管理

Pi Agent 的 RPC 模式设计为**单连接单会话**模型，但支持多个客户端通过不同的 AgentSessionRuntime 实例连接。

### 连接模型

```
┌─────────────┐     stdin/stdout      ┌──────────────┐
│  客户端 A    │ ←───────────────────→ │ Agent 会话 1  │
└─────────────┘                       └──────────────┘

┌─────────────┐     stdin/stdout      ┌──────────────┐
│  客户端 B    │ ←───────────────────→ │ Agent 会话 2  │
└─────────────┘                       └──────────────┘
```

### 并发处理

RPC 模式通过以下机制处理并发：

1. **命令队列化**：stdin 上的命令按顺序处理
2. **异步事件流**：stdout 上的事件独立于命令流
3. **请求 ID 匹配**：响应通过 `id` 字段与请求关联

### 扩展 UI 请求管理

对于需要用户交互的扩展 UI 请求，使用挂起的 Promise Map：

```typescript
const pendingExtensionRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();

// 发起 UI 请求
const id = crypto.randomUUID();
pendingExtensionRequests.set(id, { resolve, reject });
output({ type: "extension_ui_request", id, ...request });

// 响应处理
if (parsed.type === "extension_ui_response") {
  const pending = pendingExtensionRequests.get(parsed.id);
  if (pending) {
    pendingExtensionRequests.delete(parsed.id);
    pending.resolve(parsed);
  }
}
```

---

## 无头模式运行机制

### 无头模式特点

无头模式意味着：

1. **无 TUI 渲染**：不使用 pi-tui 绘制界面
2. **无键盘输入**：不接受交互式键盘命令
3. **纯 JSON 通信**：所有交互通过 JSONL 协议
4. **后台运行**：可作为子进程嵌入其他应用

### 启动流程

```
1. runRpcMode() 入口
   ↓
2. takeOverStdout() - 接管 stdout 输出
   ↓
3. createExtensionUIContext() - 创建无头 UI 上下文
   ↓
4. rebindSession() - 绑定扩展
   ↓
5. registerSignalHandlers() - 注册信号处理器
   ↓
6. attachJsonlLineReader() - 附加 stdin 读取器
   ↓
7. 无限循环等待命令
```

### 无头 UI 上下文

ExtensionUIContext 在无头模式下的适配：

```typescript
const createExtensionUIContext = (): ExtensionUIContext => ({
  // 支持的方法 - 通过 RPC 协议
  select: (title, options, opts) => createDialogPromise(...),
  confirm: (title, message, opts) => createDialogPromise(...),
  input: (title, placeholder, opts) => createDialogPromise(...),
  editor: (title, prefill) => /* RPC 编辑器请求 */,
  notify: (message, type) => output({type:"extension_ui_request", method:"notify"}),
  setStatus: (key, text) => output({type:"extension_ui_request", method:"setStatus"}),
  setWidget: (key, content) => output({type:"extension_ui_request", method:"setWidget"}),
  setTitle: (title) => output({type:"extension_ui_request", method:"setTitle"}),
  setEditorText: (text) => output({type:"extension_ui_request", method:"set_editor_text"}),
  getEditorText: () => "", // 返回空字符串，同步方法无法等待 RPC 响应
  pasteToEditor: (text) => this.setEditorText(text), // 降级到 setEditorText
  
  // 不支持的方法 - TUI 特定功能
  setWorkingMessage: undefined,
  setWorkingVisible: undefined,
  setWorkingIndicator: undefined,
  setHiddenThinkingLabel: undefined,
  setFooter: undefined,
  setHeader: undefined,
  custom: undefined,
  onTerminalInput: () => {}, // 返回空函数而非 undefined
  addAutocompleteProvider: undefined,
  setEditorComponent: undefined,
  getEditorComponent: () => undefined,
  theme, // 只读访问
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: "Theme switching not supported in RPC mode" }),
  getToolsExpanded: () => false,
  setToolsExpanded: undefined,
});
```

---

## 与 AgentSession 的集成

RPC 模式通过 `AgentSessionRuntime` 与核心 `AgentSession` 集成：

### 运行时绑定

```typescript
runtimeHost.setRebindSession(async () => {
  await rebindSession();
});

const rebindSession = async (): Promise<void> => {
  session = runtimeHost.session;
  await session.bindExtensions({
    uiContext: createExtensionUIContext(),
    commandContextActions: {
      waitForIdle: () => session.agent.waitForIdle(),
      newSession: async (options) => runtimeHost.newSession(options),
      fork: async (entryId, forkOptions) => {
        const result = await runtimeHost.fork(entryId, forkOptions);
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await session.navigateTree(targetId, {...});
        return { cancelled: result.cancelled };
      },
      switchSession: async (sessionPath, options) => {
        return runtimeHost.switchSession(sessionPath, options);
      },
      reload: async () => {
        await session.reload();
      },
    },
    shutdownHandler: () => {
      shutdownRequested = true;
    },
    onError: (err) => {
      output({ type: "extension_error", ... });
    },
  });
  
  unsubscribe?.();
  unsubscribeBackpressure?.();
  unsubscribe = session.subscribe((event) => {
    output(event);  // 所有事件转发到 stdout
  });
  // 背压管理：等待 stdout 缓冲区有空间
  unsubscribeBackpressure = session.agent.subscribe(async () => {
    await waitForRawStdoutBackpressure();
  });
};
```

### 提示词预检查

RPC 模式实现了提示词预检查机制，确保在发送响应前验证提示词可接受：

```typescript
case "prompt": {
  let preflightSucceeded = false;
  void session
    .prompt(command.message, {
      images: command.images,
      streamingBehavior: command.streamingBehavior,
      source: "rpc",
      preflightResult: (didSucceed) => {
        if (didSucceed) {
          preflightSucceeded = true;
          output(success(id, "prompt"));
        }
      },
    })
    .catch((e) => {
      if (!preflightSucceeded) {
        output(error(id, "prompt", e.message));
      }
    });
  return undefined;  // 异步响应
}
```

---

## 事件流向

事件从 AgentSession 流向 RPC 客户端的完整路径：

```
1. Agent 内部事件
   ↓
2. Agent.subscribe() → _handleAgentEvent()
   ↓
3. AgentSession._emit() → listeners
   ↓
4. RPC 模式 listener: session.subscribe((event) => output(event))
   ↓
5. writeRawStdout(serializeJsonLine(event))
   ↓
6. stdout JSONL 输出
   ↓
7. 客户端 attachJsonlLineReader() 接收
   ↓
8. 客户端事件监听器
```

### 支持的事件类型

| 事件类别 | 事件类型 | 描述 |
|----------|----------|------|
| Agent | `agent_start`, `agent_end` | Agent 运行周期 |
| 消息 | `message_start`, `message_update`, `message_end` | 消息流式传输 |
| 工具 | `tool_execution_start`, `tool_execution_update`, `tool_execution_end` | 工具调用 |
| 轮次 | `turn_start`, `turn_end` | 对话轮次 |
| 压缩 | `compaction_start`, `compaction_end` | 会话压缩 |
| 重试 | `auto_retry_start`, `auto_retry_end` | 自动重试 |
| 队列 | `queue_update` | 队列状态更新 |
| 会话 | `session_info_changed`, `thinking_level_changed` | 会话状态 |

---

## 错误处理和连接断开恢复

### 错误响应格式

```typescript
{
  id?: string;          // 请求 ID（如果有）
  type: "response";
  command: string;      // 失败的命令
  success: false;
  error: string;        // 错误消息
}
```

### 错误处理策略

1. **命令级错误**：返回错误响应，进程继续运行
2. **会话级错误**：通过 `extension_error` 事件通知
3. **致命错误**：进程退出，客户端通过退出码检测

### 信号处理

```typescript
const registerSignalHandlers = (): void => {
  const signals: NodeJS.Signals[] = ["SIGTERM"];
  if (process.platform !== "win32") {
    signals.push("SIGHUP");
  }
  
  for (const signal of signals) {
    const handler = () => {
      killTrackedDetachedChildren();
      void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
    };
    process.on(signal, handler);
    signalCleanupHandlers.push(() => process.off(signal, handler));
  }
};
```

### 关闭流程

```typescript
async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
  if (shuttingDown) {
    process.exit(exitCode);
  }
  shuttingDown = true;
  
  // 1. 清理信号处理器
  for (const cleanup of signalCleanupHandlers) {
    cleanup();
  }
  
  // 2. 取消事件订阅（包括背压管理）
  unsubscribe?.();
  unsubscribeBackpressure?.();
  
  // 3. 释放运行时资源
  await runtimeHost.dispose();
  
  // 4. 停止输入读取
  detachInput();
  process.stdin.pause();
  
  // 5. 刷新 stdout 缓冲区（SIGTERM 除外）
  if (signal !== "SIGTERM") {
    await flushRawStdout();
  }
  
  // 6. 退出
  process.exit(exitCode);
}
```

### 连接断开检测

客户端通过以下方式检测断开：

1. **进程退出**：子进程 `exit` 事件
2. **超时**：请求响应超时（默认 30 秒）
3. **错误输出**：stderr 内容收集用于调试
4. **stdin 错误**：stdin 写入错误监听器（新增）
5. **进程错误**：子进程错误事件监听器

### 背压管理

RPC 模式实现了 stdout 背压管理机制：

```typescript
// 订阅 agent 事件以管理背压
unsubscribeBackpressure = session.agent.subscribe(async () => {
  await waitForRawStdoutBackpressure();
});

// 命令处理后等待背压释放
output(response);
await waitForRawStdoutBackpressure();
```

这确保在高负载下不会过度填充 stdout 缓冲区。

---

## 与交互模式的差异

### 功能对比

| 功能 | 交互模式 | RPC 模式 |
|------|----------|----------|
| **用户界面** | TUI (pi-tui) | 无（纯 JSON） |
| **输入方式** | 键盘交互 | stdin JSONL |
| **输出方式** | 终端渲染 | stdout JSONL |
| **扩展 UI** | TUI 组件 | RPC UI 协议 |
| **事件通知** | 内部处理 | JSON 事件流 |
| **进程模型** | 主进程 | 子进程/嵌入式 |
| **调试能力** | 内置调试器 | 通过客户端 |

### 扩展 UI 差异

| 方法 | 交互模式实现 | RPC 模式实现 |
|------|-------------|-------------|
| `select()` | `ExtensionSelectorComponent` | `extension_ui_request` |
| `confirm()` | `showExtensionConfirm()` | `extension_ui_request` |
| `input()` | `ExtensionInputComponent` | `extension_ui_request` |
| `editor()` | `ExtensionEditorComponent` | `extension_ui_request` |
| `notify()` | TUI 状态行 | `extension_ui_request` (fire-and-forget) |
| `setWidget()` | TUI 容器插入 | `extension_ui_request` (仅字符串数组) |
| `setWorkingMessage()` | TUI Loader | 不支持 |
| `setTheme()` | 实时主题切换 | 返回错误对象 |
| `getEditorText()` | TUI 编辑器内容 | 返回空字符串 |
| `pasteToEditor()` | TUI 粘贴操作 | 降级到 `setEditorText()` |
| `onTerminalInput()` | 终端输入监听 | 返回空函数 |

### 代码结构差异

```typescript
// 交互模式入口
class InteractiveMode {
  private ui: TUI;
  private chatContainer: Container;
  private editor: EditorComponent;
  
  async run() {
    await this.init();
    while (true) {
      const userInput = await this.getUserInput();  // 阻塞等待
      await this.session.prompt(userInput);
    }
  }
}

// RPC 模式入口
export async function runRpcMode(runtimeHost: AgentSessionRuntime) {
  takeOverStdout();
  await rebindSession();
  attachJsonlLineReader(process.stdin, handleInputLine);
  
  // 无限循环（事件驱动）
  return new Promise(() => {});
}
```

---

## 编辑器插件/SDK 集成

### RpcClient 使用

`RpcClient` 类为编辑器插件提供类型安全的 API：

```typescript
import { RpcClient } from "@earendil-works/pi-coding-agent";

const client = new RpcClient({
  cwd: "/project/path",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  parentSession: "/path/to/parent/session", // 可选：指定父会话
});

await client.start();

// 订阅事件
client.onEvent((event) => {
  if (event.type === "message_end") {
    // 更新编辑器 UI
  }
});

// 发送提示
await client.prompt("解释这段代码");

// 等待完成
await client.waitForIdle();

// 或者收集所有事件
const events = await client.collectEvents();
```

### VsCode 插件集成示例

```typescript
import * as vscode from "vscode";
import { RpcClient } from "@earendil-works/pi-coding-agent";

export class PiAgentProvider {
  private client: RpcClient;
  private outputChannel: vscode.OutputChannel;
  
  constructor() {
    this.client = new RpcClient({
      cwd: vscode.workspace.rootPath!,
      model: vscode.workspace.getConfiguration("pi").get("model")
    });
    
    this.outputChannel = vscode.window.createOutputChannel("Pi Agent");
    
    this.client.onEvent((event) => {
      this.handleEvent(event);
    });
  }
  
  async start() {
    await this.client.start();
    vscode.window.showInformationMessage("Pi Agent 已启动");
  }
  
  async sendPrompt(prompt: string) {
    try {
      this.outputChannel.show();
      this.outputChannel.appendLine(`> ${prompt}`);
      
      const events = await this.promptAndWait(prompt);
      
      for (const event of events) {
        if (event.type === "message_update") {
          // 流式更新到输出面板
          this.outputChannel.append(event.message.content);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`错误: ${error.message}`);
    }
  }
  
  async promptAndWait(prompt: string) {
    const eventsPromise = this.client.collectEvents();
    await this.client.prompt(prompt);
    return eventsPromise;
  }
  
  private handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "agent_start":
        vscode.window.setStatusBarMessage("$(loading~spin) Pi 运行中...");
        break;
      case "agent_end":
        vscode.window.setStatusBarMessage("");
        break;
      case "tool_execution_start":
        this.outputChannel.appendLine(
          `[工具调用] ${event.toolName}(${JSON.stringify(event.args)})`
        );
        break;
    }
  }
}
```

### 请求-响应匹配

RpcClient 使用递增 ID 和超时机制：

```typescript
private async send(command: RpcCommandBody): Promise<RpcResponse> {
  const id = `req_${++this.requestId}`;
  const fullCommand = { ...command, id } as RpcCommand;
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`Timeout: ${this.stderr}`));
    }, 30000);
    
    this.pendingRequests.set(id, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    
    this.process!.stdin!.write(serializeJsonLine(fullCommand));
  });
}
```

---

## 关键设计总结

### 设计原则

| 原则 | 实现 |
|------|------|
| **简单性** | JSONL 而非 JSON-RPC 批量 |
| **流式性** | 实时事件流，非阻塞 |
| **类型安全** | 完整 TypeScript 类型 |
| **可组合** | 可嵌入任何应用程序 |
| **无状态** | 服务器无客户端状态 |

### 架构权衡

| 决策 | 优势 | 劣势 |
|------|------|------|
| JSONL 协议 | 简单、流式、Unicode 安全 | 非标准 JSON-RPC |
| 单连接模型 | 简单状态管理 | 无内置多客户端支持 |
| 子进程部署 | 隔离、稳定性 | 进程启动开销 |
| 事件流推送 | 实时更新 | 需要客户端缓冲 |

### 关键模式

1. **Fire-and-Forget**：通知类命令（如 `notify`）不等待响应
2. **Request-Response**：查询类命令使用 ID 匹配
3. **Event Streaming**：异步事件独立于命令流
4. **Dialog Promise**：扩展 UI 请求使用 Promise 挂起
5. **Preflight Pattern**：提示词预检查确保可接受性

### 性能考虑

- **JSONL 解析**：仅 LF 分隔，避免复杂 Unicode 处理
- **事件过滤**：客户端选择性订阅事件
- **缓冲策略**：批处理输出行减少系统调用
- **进程复用**：单个 Agent 进程处理多个命令
- **背压管理**：`waitForRawStdoutBackpressure()` 确保不会过度填充 stdout 缓冲区
- **stdout 刷新**：正常关闭时调用 `flushRawStdout()` 确保数据完整输出

### 安全考虑

- **stdin 验证**：所有输入需 JSON 解析验证
- **类型检查**：TypeScript 编译时类型安全
- **错误隔离**：命令错误不影响进程运行
- **资源限制**：超时机制防止挂起

---

## 参考资料

- **JSONL 规范**：http://jsonlines.org/
- **JSON-RPC 2.0**：https://www.jsonrpc.org/specification
- **AgentSession 文档**：`/docs/agent-session-analysis.md`
- **扩展系统文档**：`/docs/extension-system-analysis.md`
