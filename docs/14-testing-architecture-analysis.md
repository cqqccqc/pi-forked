# Pi Agent 测试体系架构分析

## 概述

Pi Agent 采用了一套精心设计的测试体系，其核心目标是在**不依赖真实 API keys 和网络请求**的情况下，实现对完整 agent loop 的高保真测试。这套体系通过 Faux Provider（模拟 LLM）+ Test Harness（测试夹具）+ 事件断言的组合，实现了快速、确定性、CI 友好的测试。

```
┌─────────────────────────────────────────────────────────────────┐
│                         测试体系分层架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    test.sh (入口)                        │   │
│  │  • 剥离所有 API keys                                     │   │
│  │  • 设置 PI_NO_LOCAL_LLM                                  │   │
│  │  • 调用 npm test                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               vitest (测试运行器)                         │   │
│  │  • globals: true (全局 describe/it)                      │   │
│  │  • environment: "node"                                   │   │
│  │  • testTimeout: 30000ms                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Suite Test Harness (夹具)                    │   │
│  │  createHarness()                                         │   │
│  │  • 创建临时目录                                          │   │
│  │  • 注册 Faux Provider                                    │   │
│  │  • 初始化 AgentSession + 依赖服务                        │   │
│  │  • 订阅事件收集器                                         │   │
│  │  • 返回 cleanup 函数                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                Faux Provider (模拟 LLM)                  │   │
│  │  • 确定性响应队列                                         │   │
│  │  • 模拟 token 流式输出                                    │   │
│  │  • 模拟工具调用                                           │   │
│  │  • 估算 usage (input/output/cache tokens)                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  被测系统 (AgentSession)                  │   │
│  │  • 完整 agent loop                                       │   │
│  │  • 工具执行                                               │   │
│  │  • 事件发布                                               │   │
│  │  • 会话管理                                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   事件断言 (验证)                          │   │
│  │  • harness.eventsOfType("tool_execution_start")          │   │
│  │  • expect(getUserTexts(harness)).toEqual([...])          │   │
│  │  • expect(getAssistantTexts(harness)).toContain(...)     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 一、Faux Provider 实现

Faux Provider 是测试体系的核心，它通过注册为常规 provider 来模拟 LLM 行为。

### 1.1 注册机制

```typescript
// packages/ai/src/providers/faux.ts
export function registerFauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderRegistration {
    const api = options.api ?? randomId(DEFAULT_API);  // 每次注册生成唯一 api ID
    const provider = options.provider ?? DEFAULT_PROVIDER;
    const sourceId = randomId("faux-provider");         // 用于 unregister 清理

    // 响应队列存储
    let pendingResponses: FauxResponseStep[] = [];
    const state = { callCount: 0 };
    const promptCache = new Map<string, string>();      // 模拟 prompt cache

    const models = modelDefinitions.map((definition) => ({
        id: definition.id,
        name: definition.name ?? definition.id,
        api,
        provider,
        baseUrl: DEFAULT_BASE_URL,
        reasoning: definition.reasoning ?? false,
        input: definition.input ?? ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: definition.contextWindow ?? 128000,
        maxTokens: definition.maxTokens ?? 16384,
    }));

    // 流式响应函数
    const stream: StreamFunction<string, StreamOptions> = (requestModel, context, streamOptions) => {
        const outer = createAssistantMessageEventStream();
        const step = pendingResponses.shift();  // 消费预置响应
        state.callCount++;

        queueMicrotask(async () => {
            try {
                await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel);
                if (!step) {
                    // 队列为空时返回错误
                    let message = createErrorMessage(
                        new Error("No more faux responses queued"),
                        api, provider, requestModel.id
                    );
                    outer.push({ type: "error", reason: "error", error: message });
                    outer.end(message);
                    return;
                }

                // 支持动态响应工厂函数
                const resolved = typeof step === "function"
                    ? await step(context, streamOptions, state, requestModel)
                    : step;

                // 克隆消息并添加 usage 估算
                let message = cloneMessage(resolved, api, provider, requestModel.id);
                message = withUsageEstimate(message, context, streamOptions, promptCache);

                // 模拟流式输出
                await streamWithDeltas(outer, message, minTokenSize, maxTokenSize, tokensPerSecond, streamOptions?.signal);
            } catch (error) {
                const message = createErrorMessage(error, api, provider, requestModel.id);
                outer.push({ type: "error", reason: "error", error: message });
                outer.end(message);
            }
        });

        return outer;
    };

    // 注册到 api-registry
    registerApiProvider({ api, stream, streamSimple }, sourceId);

    return {
        api,
        models,
        getModel: (modelId?: string) => modelId ? models.find(m => m.id === modelId) : models[0],
        state,
        setResponses: (responses) => { pendingResponses = [...responses]; },
        appendResponses: (responses) => { pendingResponses.push(...responses); },
        getPendingResponseCount: () => pendingResponses.length,
        unregister: () => unregisterApiProviders(sourceId),  // 清理注册
    };
}
```

### 1.2 响应类型

Faux Provider 支持两种响应类型：

**静态响应** - 直接预置完整回复：
```typescript
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

harness.setResponses([
    fauxAssistantMessage("Hello!"),  // 纯文本回复
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),  // 工具调用
    fauxAssistantMessage(fauxThinking("Let me think..."), fauxText("Done")),  // 思考+文本
]);
```

**动态响应工厂** - 基于上下文生成回复：
```typescript
type FauxResponseFactory = (
    context: Context,      // 当前对话上下文
    options: StreamOptions | undefined,
    state: { callCount: number },  // 调用计数器
    model: Model<string>,
) => AssistantMessage | Promise<AssistantMessage>;

harness.setResponses([
    (context, options, state, model) => {
        // 可以根据 context.messages 动态生成回复
        const userMessages = context.messages.filter(m => m.role === "user");
        return fauxAssistantMessage(`You said: ${userMessages.length} messages`);
    }
]);
```

### 1.3 流式输出模拟

Faux Provider 会将文本拆分成小块，模拟真实 LLM 的流式输出：

```typescript
function splitStringByTokenSize(text: string, minTokenSize: number, maxTokenSize: number): string[] {
    const chunks: string[] = [];
    let index = 0;
    while (index < text.length) {
        const tokenSize = minTokenSize + Math.floor(Math.random() * (maxTokenSize - minTokenSize + 1));
        const charSize = Math.max(1, tokenSize * 4);  // 粗略估算 1 token ≈ 4 chars
        chunks.push(text.slice(index, index + charSize));
        index += charSize;
    }
    return chunks.length > 0 ? chunks : [""];
}

async function streamWithDeltas(
    stream: AssistantMessageEventStream,
    message: AssistantMessage,
    minTokenSize: number,
    maxTokenSize: number,
    tokensPerSecond: number | undefined,
    signal: AbortSignal | undefined,
): Promise<void> {
    const partial: AssistantMessage = { ...message, content: [] };

    stream.push({ type: "start", partial: { ...partial } });

    // 逐个 content block 流式输出
    for (let index = 0; index < message.content.length; index++) {
        const block = message.content[index];

        if (block.type === "text") {
            partial.content = [...partial.content, { type: "text", text: "" }];
            stream.push({ type: "text_start", contentIndex: index, partial: { ...partial } });

            for (const chunk of splitStringByTokenSize(block.text, minTokenSize, maxTokenSize)) {
                await scheduleChunk(chunk, tokensPerSecond);  // 模拟延迟
                (partial.content[index] as TextContent).text += chunk;
                stream.push({ type: "text_delta", contentIndex: index, delta: chunk, partial: { ...partial} });
            }
            stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: { ...partial } });
        }
        // ... toolCall, thinking 类似的流式逻辑
    }

    stream.push({ type: "done", reason: message.stopReason, message });
    stream.end(message);
}
```

### 1.4 Usage 估算

Faux Provider 会自动估算 token usage，用于测试成本计算和缓存逻辑：

```typescript
function withUsageEstimate(
    message: AssistantMessage,
    context: Context,
    options: StreamOptions | undefined,
    promptCache: Map<string, string>,
): AssistantMessage {
    const promptText = serializeContext(context);  // 序列化上下文为文本
    const promptTokens = estimateTokens(promptText);  // 粗略估算：chars / 4
    const outputTokens = estimateTokens(assistantContentToText(message.content));
    let input = promptTokens;
    let cacheRead = 0;
    let cacheWrite = 0;

    const sessionId = options?.sessionId;
    if (sessionId && options?.cacheRetention !== "none") {
        const previousPrompt = promptCache.get(sessionId);
        if (previousPrompt) {
            // 计算公共前缀长度 -> cacheRead tokens
            const cachedChars = commonPrefixLength(previousPrompt, promptText);
            cacheRead = estimateTokens(previousPrompt.slice(0, cachedChars));
            cacheWrite = estimateTokens(promptText.slice(cachedChars));
            input = Math.max(0, promptTokens - cacheRead);
        } else {
            cacheWrite = promptTokens;
        }
        promptCache.set(sessionId, promptText);
    }

    return {
        ...message,
        usage: {
            input,
            output: outputTokens,
            cacheRead,
            cacheWrite,
            totalTokens: input + outputTokens + cacheRead + cacheWrite,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
    };
}
```

## 二、Suite Test Harness

`test/suite/harness.ts` 提供了一套完整的测试夹具，用于创建隔离的 agent 测试环境。

### 2.1 Harness 接口

```typescript
export interface Harness {
    // 核心服务
    session: AgentSession;
    sessionManager: SessionManager;
    settingsManager: SettingsManager;
    authStorage: AuthStorage;

    // Faux Provider 控制
    faux: FauxProviderRegistration;
    models: [Model<string>, ...Model<string>[]];
    getModel(): Model<string>;
    getModel(modelId: string): Model<string> | undefined;

    // 响应队列控制
    setResponses: (responses: FauxResponseStep[]) => void;
    appendResponses: (responses: FauxResponseStep[]) => void;
    getPendingResponseCount: () => number;

    // 事件收集
    events: AgentSessionEvent[];
    eventsOfType<T extends AgentSessionEvent["type"]>(type: T): Extract<AgentSessionEvent, { type: T }>[];

    // 资源管理
    tempDir: string;
    cleanup: () => void;
}
```

### 2.2 Harness 创建流程

```typescript
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
    // 1. 创建临时目录 (带时间戳 + 随机后缀)
    const tempDir = join(tmpdir(), `pi-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    // 2. 注册 Faux Provider
    const fauxProvider: FauxProviderRegistration = registerFauxProvider({
        models: options.models,
    });
    fauxProvider.setResponses([]);  // 初始空队列
    const model = fauxProvider.getModel();

    // 3. 创建内存存储的核心服务
    const sessionManager = SessionManager.inMemory();  // 不写文件
    const settingsManager = SettingsManager.inMemory(options.settings);

    // 4. 配置认证 (in-memory fake key)
    const authStorage = AuthStorage.inMemory();
    if (options.withConfiguredAuth ?? true) {
        authStorage.setRuntimeApiKey(model.provider, "faux-key");
    }

    // 5. 注册模型到 ModelRegistry
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    if (options.withConfiguredAuth ?? true) {
        modelRegistry.registerProvider(model.provider, {
            baseUrl: model.baseUrl,
            apiKey: "faux-key",
            api: fauxProvider.api,
            models: fauxProvider.models.map(/*...*/),
        });
    }

    // 6. 创建 Agent
    const agent = new Agent({
        getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
        initialState: {
            model,
            systemPrompt: options.systemPrompt ?? "You are a test assistant.",
            tools: [],
        },
        convertToLlm,
        onPayload: async (payload) => { /* extension hook */ },
        onResponse: async (response) => { /* extension hook */ },
        transformContext: async (messages) => { /* extension hook */ },
    });

    // 7. 加载扩展 (可选)
    const extensionsResult = options.extensionFactories
        ? await createTestExtensionsResult(options.extensionFactories, tempDir)
        : undefined;

    // 8. 创建 ResourceLoader
    const resourceLoader = options.resourceLoader
        ?? createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined);

    // 9. 创建 AgentSession
    const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRegistry,
        resourceLoader,
        baseToolsOverride: toolMap,
        extensionRunnerRef,
    });

    // 10. 订阅事件收集器
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => {
        events.push(event);
    });

    // 11. 返回 Harness (含 cleanup)
    return {
        session, sessionManager, settingsManager, authStorage,
        faux: fauxProvider,
        models: fauxProvider.models,
        setResponses: fauxProvider.setResponses,
        appendResponses: fauxProvider.appendResponses,
        getPendingResponseCount: fauxProvider.getPendingResponseCount,
        events,
        eventsOfType<T extends AgentSessionEvent["type"]>(type: T) {
            return events.filter((event): event is Extract<AgentSessionEvent, { type: T }> =>
                event.type === type
            );
        },
        tempDir,
        cleanup() {
            session.dispose();
            fauxProvider.unregister();  // 从 api-registry 移除
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true });
            }
        },
    };
}
```

### 2.3 测试模式示例

**基本对话测试**：
```typescript
it("handles basic conversation", async () => {
    const harness = await createHarness();
    harness.setResponses([
        fauxAssistantMessage("Hello! How can I help?"),
        fauxAssistantMessage("Goodbye!"),
    ]);

    await harness.session.prompt("hello");
    await harness.session.prompt("bye");

    expect(getUserTexts(harness)).toEqual(["hello", "bye"]);
    expect(getAssistantTexts(harness)).toEqual(["Hello! How can I help?", "Goodbye!"]);
    harness.cleanup();
});
```

**工具调用测试**：
```typescript
it("executes tool and continues", async () => {
    const toolResults: string[] = [];
    const waitTool: AgentTool = {
        name: "wait",
        label: "Wait",
        description: "Wait for release",
        parameters: Type.Object({}),
        execute: async () => {
            toolResults.push("executed");
            return { content: [{ type: "text", text: "done" }], details: {} };
        },
    };

    const harness = await createHarness({ tools: [waitTool] });
    harness.setResponses([
        fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("Tool completed!"),
    ]);

    await harness.session.prompt("start");

    expect(toolResults).toEqual(["executed"]);
    expect(getAssistantTexts(harness)).toContain("Tool completed!");
    harness.cleanup();
});
```

**事件断言测试**：
```typescript
it("emits tool_execution_start and tool_execution_end events", async () => {
    const harness = await createHarness({ tools: [waitTool] });
    harness.setResponses([
        fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("Done"),
    ]);

    await harness.session.prompt("start");

    const toolStarts = harness.eventsOfType("tool_execution_start");
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0].toolName).toBe("wait");

    const toolEnds = harness.eventsOfType("tool_execution_end");
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0].toolName).toBe("wait");

    harness.cleanup();
});
```

## 三、测试隔离策略

每个测试都能获得完全隔离的 agent 环境，关键机制包括：

### 3.1 临时目录隔离

```typescript
function createTempDir(): string {
    // 时间戳 + 随机后缀确保唯一性
    const tempDir = join(tmpdir(), `pi-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    return tempDir;
}
```

### 3.2 API Provider 隔离

```typescript
// 每个 Faux Provider 注册时使用唯一 sourceId
const sourceId = randomId("faux-provider");
registerApiProvider({ api, stream, streamSimple }, sourceId);

// cleanup 时通过 sourceId 精确移除
unregister() {
    unregisterApiProviders(sourceId);  // 只移除自己的注册
}
```

### 3.3 内存存储

```typescript
// SessionManager.inMemory() 不写文件，完全内存操作
const sessionManager = SessionManager.inMemory();

// SettingsManager.inMemory() 避免读取用户配置
const settingsManager = SettingsManager.inMemory(options.settings);

// AuthStorage.inMemory() 不接触 ~/.pi/agent/auth.json
const authStorage = AuthStorage.inMemory();
```

### 3.4 测试清理模式

```typescript
describe("some feature", () => {
    const harnesses: Harness[] = [];  // 收集所有 harness

    afterEach(() => {
        // 每个测试后清理所有创建的 harness
        while (harnesses.length > 0) {
            harnesses.pop()?.cleanup();
        }
    });

    it("test case 1", async () => {
        const harness = await createHarness();
        harnesses.push(harness);
        // ... 测试逻辑
    });
});
```

## 四、Regression Test 组织

### 4.1 命名规范

```
test/suite/regressions/<issue-number>-<short-slug>.test.ts
```

示例：
- `2023-queued-slash-command-followup.test.ts` - Issue #2023
- `2835-tools-allowlist-filters-extension-tools.test.ts` - Issue #2835
- `3317-network-connection-lost-retry.test.ts` - Issue #3317

### 4.2 Regression Test 模板

```typescript
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, getUserTexts, type Harness } from "../harness.ts";

describe("issue #2023 queued slash-command follow-up", () => {
    const harnesses: Harness[] = [];

    afterEach(() => {
        while (harnesses.length > 0) {
            harnesses.pop()?.cleanup();
        }
    });

    it("treats extension-origin queued slash-command follow-ups as raw user text", async () => {
        // 1. 准备测试状态
        let extensionApi: ExtensionAPI | undefined;
        const commandRuns: string[] = [];

        // 2. 创建 harness
        const harness = await createHarness({
            extensionFactories: [
                (pi) => {
                    extensionApi = pi;
                    pi.registerCommand("testcmd", {
                        description: "Test command",
                        handler: async (args) => {
                            commandRuns.push(args);
                        },
                    });
                },
            ],
        });
        harnesses.push(harness);

        // 3. 预置 Faux 响应
        harness.setResponses([
            fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
            fauxAssistantMessage("first turn complete"),
            fauxAssistantMessage("queued follow-up handled by model"),
        ]);

        // 4. 执行测试场景
        const promptPromise = harness.session.prompt("start");
        await sawToolStart;
        extensionApi?.sendUserMessage("/testcmd queued", { deliverAs: "followUp" });
        releaseToolExecution?.();
        await promptPromise;

        // 5. 断言行为
        expect(commandRuns).toEqual([]);  // 命令不应被调度
        expect(getUserTexts(harness)).toEqual(["start", "/testcmd queued"]);
        expect(getAssistantTexts(harness)).toContain("queued follow-up handled by model");
    });
});
```

## 五、test.sh API Key 剥离机制

测试脚本的核心设计是确保测试不会意外调用真实 API：

### 5.1 完整环境清理

```bash
#!/usr/bin/env bash
set -e

AUTH_FILE="$HOME/.pi/agent/auth.json"
AUTH_BACKUP="$HOME/.pi/agent/auth.json.bak"

# 1. 备份并移除 auth.json
cleanup() {
    if [[ -f "$AUTH_BACKUP" ]]; then
        mv "$AUTH_BACKUP" "$AUTH_FILE"
        echo "Restored auth.json"
    fi
}
trap cleanup EXIT

if [[ -f "$AUTH_FILE" ]]; then
    mv "$AUTH_FILE" "$AUTH_BACKUP"
    echo "Moved auth.json to backup"
fi

# 2. 禁用本地 LLM 测试
export PI_NO_LOCAL_LLM=1

# 3. 剥离所有已知 API keys
unset ANTHROPIC_API_KEY
unset ANTHROPIC_OAUTH_TOKEN
unset OPENAI_API_KEY
unset AZURE_OPENAI_API_KEY
unset DEEPSEEK_API_KEY
unset GEMINI_API_KEY
unset GOOGLE_CLOUD_API_KEY
unset GROQ_API_KEY
# ... (覆盖 50+ 个环境变量)

echo "Running tests without API keys..."
npm test
```

### 5.2 测试内验证

在 `packages/ai/src/stream.ts` 的 `getEnvApiKey()` 中，只有在显式设置环境变量时才会读取 API keys：

```typescript
export function getEnvApiKey(provider: string): string | undefined {
    switch (provider) {
        case "anthropic":
            return process.env.ANTHROPIC_API_KEY
                ?? process.env.ANTHROPIC_OAUTH_TOKEN
                ?? process.env.ANTHROPIC_WEB_SEARCH_API_KEY;
        case "openai":
            return process.env.OPENAI_API_KEY;
        // ...
    }
}
```

当 test.sh unset 所有这些变量后，即使测试代码错误地尝试使用真实 provider，也会因缺少 API key 而失败，从而暴露问题。

## 六、Vitest 配置

### 6.1 coding-agent vitest.config.ts

```typescript
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 使用源码路径别名，确保测试运行的是最新代码
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

export default defineConfig({
    test: {
        globals: true,           // 启用全局 describe/it/expect
        environment: "node",     // Node 环境
        testTimeout: 30000,      // 30s 超时 (工具测试可能较慢)
        server: {
            deps: {
                external: [/@silvia-odwyer\/photon-node/],  // 原生依赖外部化
            },
        },
    },
    resolve: {
        alias: [
            { find: /^@earendil-works\/pi-ai$/, replacement: aiSrcIndex },
            { find: /^@earendil-works\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
            { find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
            // 兼容旧名称
            { find: /^@mariozechner\/pi-ai$/, replacement: aiSrcIndex },
            { find: /^@mariozechner\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
            { find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
        ],
    },
});
```

### 6.2 其他 packages 的配置

`tui`, `ai`, `agent` 也有各自的 vitest.config.ts，配置类似：

```typescript
export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        testTimeout: 30000,
    }
});
```

## 七、事件断言模式

### 7.1 事件类型体系

AgentSession 扩展了核心 AgentEvent，增加了会话特定事件：

```typescript
export type AgentSessionEvent =
    | Exclude<AgentEvent, { type: "agent_end" }>
    | { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
    | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
    | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
    | { type: "session_info_changed"; name: string | undefined }
    | { type: "thinking_level_changed"; level: ThinkingLevel }
    | { type: "compaction_end"; reason: ...; result: ...; aborted: boolean; willRetry: boolean; errorMessage?: string }
    | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
    | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };
```

### 7.2 类型安全的事件过滤

```typescript
// harness.ts 提供类型安全的事件过滤
eventsOfType<T extends AgentSessionEvent["type"]>(type: T): Extract<AgentSessionEvent, { type: T }>[] {
    return this.events.filter((event): event is Extract<AgentSessionEvent, { type: T }> =>
        event.type === type
    );
}

// 使用示例
const toolStarts = harness.eventsOfType("tool_execution_start");
expect(toolStarts[0].toolName).toBe("bash");  // TypeScript 知道这是 tool_execution_start 事件
```

### 7.3 复杂事件序列断言

```typescript
it("emits correct event sequence for tool call with retry", async () => {
    const harness = await createHarness({ tools: [flakyTool] });
    harness.setResponses([
        fauxAssistantMessage(fauxToolCall("flaky", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("Success after retry"),
    ]);

    await harness.session.prompt("test");

    // 验证事件顺序
    const eventTypes = harness.events.map(e => e.type);
    expect(eventTypes).toEqual([
        "turn_start",
        "message_start",
        "tool_execution_start",  // 第一次尝试
        "tool_execution_end",
        "auto_retry_start",      // 失败触发重试
        "tool_execution_start",  // 第二次尝试
        "tool_execution_end",
        "message_delta",
        "message_end",
        "turn_end",
    ]);
});
```

## 八、关键设计总结

| 维度 | 设计选择 | 理由 |
|------|----------|------|
| **LLM 模拟** | Faux Provider (注册式) | 与真实 provider 共享 API，测试高保真 |
| **响应控制** | 队列模式 | 支持多轮对话预置，确保可重复性 |
| **动态响应** | 工厂函数 | 支持基于上下文的复杂测试场景 |
| **流式模拟** | Token 分块输出 | 测试流式 UI 和增量更新逻辑 |
| **隔离策略** | 临时目录 + 内存存储 + sourceId 清理 | 完全隔离，无副作用 |
| **事件断言** | 类型安全的事件收集器 | 捕获内部状态，验证隐藏行为 |
| **API Key 保护** | test.sh 环境剥离 + auth.json 备份 | CI 安全，防止意外消耗 |
| **组织方式** | suite/ 通用 + regressions/ 问题回归 | 清晰的测试分类和维护性 |
| **超时设置** | 30s (vitest) | 平衡工具测试时间和失败检测 |
| **清理模式** | afterEach 收集清理 | 简单可靠，防止资源泄漏 |

这套测试体系的核心价值在于：**在零成本（无 API 消耗）、零网络依赖、高确定性**的前提下，实现了对复杂 agent loop 的高覆盖率测试。通过 Faux Provider 的高保真模拟 + 事件收集器的白盒断言，可以验证传统黑盒测试难以触及的内部行为（如工具调用序列、重试逻辑、队列管理等）。
