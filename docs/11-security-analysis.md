# Pi Agent 安全性设计分析

## 概述

Pi Agent 采用了多层次的安全设计，从工具执行控制到敏感数据保护都有相应的机制。本文档深入分析其安全架构。

## 核心安全机制

### 1. 工具调用钩子系统

Pi Agent 通过 `beforeToolCall` 和 `afterToolCall` 钩子实现工具调用的前置和后置检查。

#### 1.1 beforeToolCall 钩子

在 `packages/agent/src/agent-loop.ts` 中的 `prepareToolCall` 函数执行工具调用前的检查：

```typescript
// agent-loop.ts:581-604
if (config.beforeToolCall) {
    const beforeResult = await config.beforeToolCall({
        assistantMessage,
        toolCall,
        args: validatedArgs,
        context: currentContext,
    }, signal);
    if (signal?.aborted) {
        return {
            kind: "immediate",
            result: createErrorToolResult("Operation aborted"),
            isError: true,
        };
    }
    if (beforeResult?.block) {
        return {
            kind: "immediate",
            result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
            isError: true,
        };
    }
}
```

**关键特性：**
- 支持阻塞工具执行（返回 `block: true`）
- 可提供阻塞原因
- 支持信号中断

#### 1.2 AgentSession 中的钩子实现

在 `packages/coding-agent/src/core/agent-session.ts` 中，钩子被连接到扩展系统：

```typescript
// agent-session.ts:396-415
this.agent.beforeToolCall = async ({ toolCall, args }) => {
    const runner = this._extensionRunner;
    if (!runner.hasHandlers("tool_call")) {
        return undefined;
    }

    try {
        return await runner.emitToolCall({
            type: "tool_call",
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            input: args as Record<string, unknown>,
        });
    } catch (err) {
        if (err instanceof Error) {
            throw err;
        }
        throw new Error(`Extension failed, blocking execution: ${String(err)}`);
    }
};
```

**安全要点：**
- 扩展系统错误会阻止工具执行
- 所有工具调用都必须通过钩子系统

### 2. 工具白名单机制

在 `packages/coding-agent/src/core/agent-session.ts` 中实现了工具白名单：

```typescript
// agent-session.ts:170-171
/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
allowedToolNames?: string[];
```

**实现机制：**

```typescript
// agent-session.ts:2256-2266
const allowedToolNames = this._allowedToolNames;
const isAllowedTool = (name: string): boolean => !allowedToolNames || allowedToolNames.has(name);

// 过滤工具定义
const allCustomTools = [
    ...registeredTools,
    ...this._customTools.map(/*...*/),
].filter((tool) => isAllowedTool(tool.definition.name));
```

### 3. 工具执行流程与安全控制

#### 3.1 工具执行流程图

```
┌─────────────────┐
│ LLM 调用工具    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 参数验证        │ ← validateToolArguments()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ beforeToolCall  │ ← 扩展可在此阻止执行
│ 钩子检查        │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌──────┐  ┌──────────┐
│通过  │  │被阻止     │
└──┬───┘  └────┬─────┘
   │           │
   ▼           ▼
┌─────────┐  返回错误
│执行工具  │
└────┬────┘
     │
     ▼
┌─────────────────┐
│ afterToolCall   │ ← 扩展可修改结果
│ 钩子处理        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│返回结果给 LLM   │
└─────────────────┘
```

#### 3.2 各工具的安全特性

##### Bash 工具

```typescript
// bash.ts 实现的安全特性：
// 1. 工作目录存在性检查
if (!existsSync(cwd)) {
    reject(new Error(`Working directory does not exist: ${cwd}`));
    return;
}

// 2. 进程隔离（非 Windows 下使用 detached 模式）
const child = spawn(shell, [...args, command], {
    cwd,
    detached: process.platform !== "win32",
    env: env ?? getShellEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,  // Windows 下隐藏窗口
});

// 3. 进程树跟踪（支持清理）
if (child.pid) trackDetachedChildPid(child.pid);

// 4. 超时控制
if (timeout !== undefined && timeout > 0) {
    timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) killProcessTree(child.pid);
    }, timeout * 1000);
}

// 5. 信号中断支持
if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
}

// 6. 输出截断（防止内存溢出）
const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
```

##### Write 工具

```typescript
// write.ts 的安全特性：
// 1. AbortSignal 检查
if (signal?.aborted) {
    reject(new Error("Operation aborted"));
    return;
}

// 2. 操作期间持续检查 aborted 状态
signal?.addEventListener("abort", onAbort, { once: true });
// ... 执行操作
if (aborted) return;

// 3. 使用文件变更队列（withFileMutationQueue）
return withFileMutationQueue(
    absolutePath,
    () => /* 执行写入操作 */
);
```

### 4. 认证与 API Key 管理

#### 4.1 认证存储架构

```typescript
// auth-storage.ts 提供的机制：
export class AuthStorage {
    private data: AuthStorageData = {};
    private runtimeOverrides: Map<string, string> = new Map();
    private fallbackResolver?: (provider: string) => string | undefined;
    
    // 文件权限控制
    private ensureFileExists(): void {
        if (!existsSync(this.authPath)) {
            writeFileSync(this.authPath, "{}", "utf-8");
            chmodSync(this.authPath, 0o600);  // 仅用户可读写
        }
    }
}
```

#### 4.2 认证查询优先级

```
1. 运行时覆盖（runtimeOverrides）
2. 环境变量
3. auth.json 存储的 API Key
4. auth.json 存储的 OAuth Token（自动刷新）
5. models.json 定义的 key/command
6. 自定义 fallback resolver
```

#### 4.3 OAuth Token 刷新安全

```typescript
// auth-storage.ts:403-426
// 使用文件锁防止并发刷新问题
async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
    let release: (() => Promise<void>) | undefined;
    let lockCompromised = false;
    let lockCompromisedError: Error | undefined;
    const throwIfCompromised = () => {
        if (lockCompromised) {
            throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
        }
    };
    
    release = await lockfile.lock(this.authPath, {
        retries: { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10000 },
        stale: 30000,
        onCompromised: (err) => {
            lockCompromised = true;
            lockCompromisedError = err;
        },
    });
    // ...
}
```

### 5. 扩展系统安全

#### 5.1 扩展工具包装

所有扩展注册的工具都会被包装，以集成到安全框架中：

```typescript
// tool-definition-wrapper.ts
export function wrapToolDefinition<TInput, TDetails>(
    definition: ToolDefinition<TInput, TDetails>,
    sourceInfo: SourceInfo,
): AgentTool<TInput> {
    return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        executionMode: definition.executionMode,
        prepareArguments: definition.prepareArguments,
        async execute(toolCallId, args, signal, onUpdate, ctx) {
            // 通过扩展运行器执行，继承安全钩子
            // ...
        },
    };
}
```

#### 5.2 扩展事件类型控制

```typescript
// extensions/types.ts 定义了严格的扩展事件类型
export type ExtensionEvent =
    | ToolCallEvent        // 工具调用拦截
    | ToolResultEvent      // 工具结果修改
    | UserBashEvent        // Bash 命令拦截
    | InputEvent           // 用户输入拦截
    | MessageEndEvent      // 消息结束处理
    | SessionBeforeCompact // 压缩前拦截
    | SessionBeforeTree    // 树导航前拦截
    // ... 等
```

### 6. 沙箱环境支持

#### 6.1 Bun 沙箱环境变量恢复

```typescript
// restore-sandbox-env.ts
/**
 * Bun compiled binaries have an empty `process.env` when running inside
 * sandbox environments (e.g. nono on Linux/macOS). On Linux we can recover
 * the environment from `/proc/self/environ`.
 */
export function restoreSandboxEnv(): void {
    if (!process.versions?.bun) return;
    
    if (Object.keys(process.env).length > 0) return;
    
    try {
        const data = readFileSync("/proc/self/environ", "utf-8");
        for (const entry of data.split("\0")) {
            const idx = entry.indexOf("=");
            if (idx > 0) {
                process.env[entry.slice(0, idx)] = entry.slice(idx + 1);
            }
        }
    } catch {
        // /proc/self/environ may not be readable; ignore.
    }
}
```

### 7. 关键设计总结

| 安全机制 | 实现位置 | 保护对象 |
|---------|---------|---------|
| beforeToolCall 钩子 | agent-loop.ts | 所有工具调用 |
| 工具白名单 | agent-session.ts | 工具暴露控制 |
| Bash 进程隔离 | bash.ts | 命令执行安全 |
| Bash 超时控制 | bash.ts | 资源占用限制 |
| 输出截断 | truncate.ts | 内存使用控制 |
| AbortSignal 支持 | 所有工具 | 操作中断能力 |
| 认证文件权限 | auth-storage.ts | API Key 存储安全 |
| 文件锁 | auth-storage.ts | 并发访问控制 |
| 扩展工具包装 | tool-definition-wrapper.ts | 扩展工具集成 |
| 变更队列 | file-mutation-queue.ts | 文件操作序列化 |

### 8. 安全边界与限制

#### 8.1 当前不提供的安全机制

1. **网络隔离**: 工具可以自由访问网络（通过 bash 工具）
2. **文件系统沙箱**: 工具可以访问用户有权限的所有文件
3. **资源配额**: 除了 Bash 超时，没有 CPU/内存配额限制
4. **权限模式枚举**: 代码中没有明确的 "auto"/"accept"/"deny" 等权限模式

#### 8.2 依赖外部机制的安全

1. **操作系统权限**: 依赖进程用户权限
2. **文件系统权限**: 依赖 OS 文件权限
3. **网络访问控制**: 依赖防火墙/网络配置

### 9. 扩展开发安全建议

基于当前架构，扩展开发者应：

1. **始终在 tool_call 事件中验证输入**
2. **使用 block 机制阻止危险操作**
3. **不要在扩展中绕过 AbortSignal 检查**
4. **谨慎处理用户提供的路径和命令**
5. **实现适当的资源清理**

### 10. 未来改进方向

1. **工具级权限控制**: 为不同工具设置不同的权限级别
2. **路径访问控制**: 限制工具可访问的文件路径
3. **网络访问控制**: 提供网络访问的白名单/黑名单
4. **资源配额系统**: 全面的 CPU/内存/时间配额
5. **审计日志**: 记录所有安全相关操作
