# Pi Agent 多 LLM Provider 适配层分析

## 概述

Pi agent 的多 Provider 适配层位于 `packages/ai/` 包中，负责将多个 LLM Provider（Anthropic、OpenAI、Google、Mistral、Bedrock、OpenAI Codex 等）的异构 API 统一适配到标准的流式接口。当前支持 **9 种 API 类型、35 个 Provider 类别、900+ 个模型**。其核心设计目标是：

1. **统一流式接口**：所有 Provider 通过 `AssistantMessageEventStream` 返回标准化事件流
2. **延迟加载**：Provider 实现按需加载，减少启动时内存占用
3. **类型安全**：完整 TypeScript 类型系统，编译期检查 Provider 配置
4. **错误封装**：所有错误通过流事件传递，不抛出异常
5. **多传输协议**：支持 SSE 和 WebSocket 两种传输方式，部分 Provider（如 OpenAI Codex）支持自动降级

## 核心架构

### 1. 注册与查找机制

```
┌──────────────────────────────────────────────────────────────┐
│                    apiProviderRegistry                        │
│                    (Map<string, RegisteredApiProvider>)       │
└──────────────────────────────────────────────────────────────┘
                              │
        ┌─────────┬───────────┼───────────┬──────────┬──────────┐
        ▼         ▼           ▼           ▼          ▼          ▼
  anthropic-  openai-    google-      bedrock-   openai-    openai-
   messages  completions generative-ai converse-  responses  codex-
              (407模型)   (19模型)    stream     (81模型)  responses
                                       (90模型)             (6模型)
        │         │           │           │          │          │
   ┌────┴────┐ ┌──┴──┐  ┌────┴────┐ ┌───┴───┐ ┌───┴───┐ ┌───┴───┐
   │ stream  │ │stream│  │ stream  │ │stream │ │stream │ │stream │
   │streamSimple│Simple│ │streamSimple│Simple│ │Simple│ │Simple│
   └─────────┘ └─────┘  └─────────┘ └──────┘ └──────┘ └──────┘
```

**关键代码** (`api-registry.ts`)：

```typescript
// Provider 接口定义
interface ApiProvider<TApi extends Api = Api> {
  api: TApi;
  stream: StreamFunction<TApi, TOptions>;
  streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

// 注册机制（带 sourceId 支持按来源批量卸载）
export function registerApiProvider<TApi extends Api>(
  provider: ApiProvider<TApi>,
  sourceId?: string,
): void {
  apiProviderRegistry.set(provider.api, {
    provider: {
      api: provider.api,
      stream: wrapStream(provider.api, provider.stream),
      streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
    },
    sourceId,
  });
}

// 查找机制
export function getApiProvider(api: Api): ApiProviderInternal | undefined {
  return apiProviderRegistry.get(api)?.provider;
}
```

**设计要点**：
- 使用 `Map` 而非 Object 保证类型安全
- `wrapStream`/`wrapStreamSimple` 在运行时校验 API 类型匹配
- `sourceId` 支持插件系统按来源批量卸载 Provider

### 2. 延迟加载实现

```
                    调用 stream(model, context, options)
                              │
                              ▼
                ┌─────────────────────────┐
                │  createLazyStream       │
                │  (返回外层 Stream)      │
                └─────────────────────────┘
                          │
                          ▼ 立即返回 AssistantMessageEventStream
                ┌─────────────────────────┐
                │   Outer Stream (Promise) │
                │  - 已可推送 error 事件   │
                └─────────────────────────┘
                          │
                          ▼ 异步加载 Provider 模块
                ┌─────────────────────────┐
                │   import("./anthropic") │
                │   (动态 import)          │
                └─────────────────────────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        成功加载                     加载失败
              │                       │
              ▼                       ▼
    forwardStream()          push(error event)
    (转发到外层 Stream)       end(error message)
```

**关键代码** (`register-builtins.ts`)：

```typescript
// 延迟加载包装器
function createLazyStream<TApi extends Api>(
  loadModule: () => Promise<LazyProviderModule<TApi>>,
): StreamFunction<TApi, TOptions> {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream();

    loadModule()
      .then((module) => {
        const inner = module.stream(model, context, options);
        forwardStream(outer, inner);
      })
      .catch((error) => {
        const message = createLazyLoadErrorMessage(model, error);
        outer.push({ type: "error", reason: "error", error: message });
        outer.end(message);
      });

    return outer;  // 立即返回，不等待模块加载
  };
}

// Promise 缓存（避免重复加载）
let anthropicProviderModulePromise:
  | Promise<LazyProviderModule<"anthropic-messages", ...>>
  | undefined;

function loadAnthropicProviderModule() {
  anthropicProviderModulePromise ||= import("./anthropic.ts").then(...);
  return anthropicProviderModulePromise;
}
```

**错误处理策略**：
1. 模块加载失败时，不抛出异常
2. 创建带有 `stopReason: "error"` 的 `AssistantMessage`
3. 通过 `error` 事件传递错误信息
4. 确保消费者总是能获得可迭代的事件流

### 3. 统一流式接口设计

**入口函数** (`stream.ts`)：

```typescript
// 完整功能的流式接口
export function stream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.stream(model, context, options as StreamOptions);
}

// 简化版流式接口（带 reasoning 参数）
export function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.streamSimple(model, context, options);
}
```

**事件协议** (`types.ts`)：

```typescript
export type AssistantMessageEvent =
  // 开始事件（携带初始 AssistantMessage）
  | { type: "start"; partial: AssistantMessage }
  // 文本生成事件
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  // 思考事件
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  // 工具调用事件
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  // 终止事件
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

**设计契约** (`types.ts` 注释)：

```
StreamFunction Contract:
- 必须返回 AssistantMessageEventStream
- 调用后，请求/模型/运行时错误应编码到返回流中，不抛出异常
- 错误终止必须产生带有 stopReason "error" 或 "aborted" 的 AssistantMessage
  通过流协议发出
```

## EventStream 核心原语

### 生产者-消费者模型

```
                    Provider 实现
                        │
                        ▼
              ┌─────────────────┐
              │ stream.push()   │ ───> queue: T[]
              │ stream.end()    │ ───> done: bool
              └─────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │ waiting: (value │ ───> [resolve, resolve, ...]
              │         =>      │
              │   IteratorResult│
              │   )[]           │
              └─────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │ [Symbol.        │
              │  asyncIterator] │ ───> AsyncIterable<T>
              └─────────────────┘
                        │
                        ▼
                    消费者
                  for await (event)
```

**关键代码** (`event-stream.ts`)：

```typescript
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  constructor(isComplete, extractResult) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  // 生产者 API
  push(event: T): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(result?: R): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

  // 消费者 API
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>(
          (resolve) => this.waiting.push(resolve)
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  result(): Promise<R> {
    return this.finalResultPromise;
  }
}
```

**关键特性**：
1. **无背压机制**：`queue` 无界，生产者快于消费者时内存累积
2. **双端通信**：`push` 立即唤醒等待消费者，无消费者时入队
3. **结果 Promise**：`result()` 解析为最终 `AssistantMessage`，支持 `await complete()`
4. **完成检测**：通过 `isComplete` 回调判断终止事件（`done`/`error`）

## Provider 适配实现分析

### Anthropic Provider 适配

**关键适配点**：

1. **SSE 解析**：手写 SSE 解析器（不依赖 SDK）

```typescript
async function* iterateSseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: SseDecoderState = { event: null, data: [], raw: [] };
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let consumed = consumeLine(buffer);
      while (consumed) {
        buffer = consumed.rest;
        const event = decodeSseLine(consumed.line, state);
        if (event) yield event;
        consumed = consumeLine(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

2. **Thinking 支持**：区分自适应思考（Opus 4.6+）和预算思考

```typescript
if (supportsAdaptiveThinking(model.id)) {
  // 自适应思考：模型决定何时/多少思考
  params.thinking = { type: "adaptive", display };
  if (options.effort) {
    params.output_config = { effort: options.effort };
  }
} else {
  // 预算思考：老模型
  params.thinking = {
    type: "enabled",
    budget_tokens: options.thinkingBudgetTokens || 1024,
    display,
  };
}
```

**Redacted Thinking 处理**：安全过滤器审查的思考内容

```typescript
if (event.content_block.type === "redacted_thinking") {
  const block: Block = {
    type: "thinking",
    thinking: "[Reasoning redacted]",
    thinkingSignature: event.content_block.data,  // 加密签名用于多轮连续性
    redacted: true,  // 标记为已审查
    index: event.index,
  };
  output.content.push(block);
  stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
}
```

3. **OAuth 模式适配**：Claude Code 身份伪装

```typescript
if (isOAuthToken(apiKey)) {
  // 强制 Claude Code 系统提示
  params.system = [{
    type: "text",
    text: "You are Claude Code, Anthropic's official CLI for Claude.",
    ...(cacheControl ? { cache_control: cacheControl } : {}),
  }];

  // 工具名大小写转换（Read → READ）
  const toClaudeCodeName = (name: string) =>
    ccToolLookup.get(name.toLowerCase()) ?? name;
}
```

4. **缓存保留策略**：支持 `none`/`short`/`long` 三种缓存级别

```typescript
function getCacheControl(
  model: Model<"anthropic-messages">,
  cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: CacheControlEphemeral } {
  const retention = resolveCacheRetention(cacheRetention);
  if (retention === "none") {
    return { retention };
  }
  const ttl = retention === "long" && getAnthropicCompat(model).supportsLongCacheRetention
    ? "1h"  // 长缓存：1小时 TTL
    : undefined;
  return {
    retention,
    cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
  };
}
```

5. **会话亲和性头**：支持缓存路由到同一副本

```typescript
const sessionAffinityHeaders: Record<string, string | null> =
  sessionId && getAnthropicCompat(model).sendSessionAffinityHeaders
    ? { "x-session-affinity": sessionId }
    : {};
```

6. **工具调用增量解析**：处理 `input_json_delta`

```typescript
if (event.delta.type === "input_json_delta") {
  const index = blocks.findIndex((b) => b.index === event.index);
  const block = blocks[index];
  if (block && block.type === "toolCall") {
    block.partialJson += event.delta.partial_json;
    block.arguments = parseStreamingJson(block.partialJson);
    stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: event.delta.partial_json,
      partial: output,
    });
  }
}
```

7. **Compat 特性控制**：通过 `AnthropicMessagesCompat` 精细控制 Provider 行为

```typescript
function getAnthropicCompat(model): Required<...> {
  const isFireworks = model.provider === "fireworks";
  const isCloudflareAiGatewayAnthropic =
    model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic");
  return {
    supportsEagerToolInputStreaming: !isFireworks,  // Fireworks 不支持 per-tool eager streaming
    supportsLongCacheRetention: !isFireworks,       // Fireworks 不支持长缓存
    sendSessionAffinityHeaders: isFireworks || isCloudflareAiGatewayAnthropic,
    supportsCacheControlOnTools: !isFireworks,       // Fireworks 不支持 tool 上的 cache_control
    supportsTemperature: true,                       // Opus 4.7+ 被 model.compat 覆盖为 false
    allowEmptySignature: false,                      // 空签名重放需 model.compat 开启
  };
}
```

8. **空 thinking 签名重放**：当 `allowEmptySignature` 为 true，空签名以 `signature: ""` 重放

```typescript
if (getAnthropicCompat(model).allowEmptySignature && block.thinkingSignature === "") {
  // 直接重放空签名，而不是将 thinking 转换为 text
  replayBlock = { type: "thinking", thinking: "", thinkingSignature: "", ... };
}
```

9. **Temperature 抑制**：Claude Opus 4.7+ 拒绝非默认 temperature

```typescript
// 通过 AnthropicMessagesCompat.supportsTemperature 控制
// 当 false 时，从请求参数中省略 temperature 字段
if (getAnthropicCompat(model).supportsTemperature) {
  params.temperature = options.temperature;
}
// Claude Opus 4.7+ 的 model.compat.supportsTemperature = false
```

### OpenAI Completions Provider 适配

**关键适配点**：

1. **兼容性检测**：基于 URL 自动推断 Provider 行为

```typescript
function detectCompat(model: Model<"openai-completions">): ResolvedOpenAICompletionsCompat {
  const provider = model.provider;
  const baseUrl = model.baseUrl;

  const isZai = provider === "zai" || baseUrl.includes("api.z.ai");
  const isTogether = provider === "together" || baseUrl.includes("api.together.ai");
  const isMoonshot = provider === "moonshotai" || baseUrl.includes("api.moonshot.");
  // ...

  return {
    supportsStore: !isNonStandard,
    supportsDeveloperRole: !isNonStandard,
    supportsReasoningEffort: !isGrok && !isZai && !isMoonshot,
    maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    thinkingFormat: isDeepSeek ? "deepseek" : isZai ? "zai" : "openai",
    // ...
  };
}
```

2. **Thinking 参数格式多样性**：支持 8 种格式 (`"openai"`, `"openrouter"`, `"deepseek"`, `"together"`, `"zai"`, `"qwen"`, `"qwen-chat-template"`, `"string-thinking"`)

```typescript
// DeepSeek 格式
if (compat.thinkingFormat === "deepseek" && model.reasoning) {
  (params as any).thinking = { type: options?.reasoningEffort ? "enabled" : "disabled" };
  if (options?.reasoningEffort) {
    (params as any).reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;
  }
}

// OpenRouter 格式
else if (compat.thinkingFormat === "openrouter" && model.reasoning) {
  if (options?.reasoningEffort) {
    openRouterParams.reasoning = {
      effort: model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort,
    };
  }
}

// z.ai 格式
else if (compat.thinkingFormat === "zai" && model.reasoning) {
  (params as any).enable_thinking = !!options?.reasoningEffort;
}
```

3. **Prompt Cache 实现**：复用 Anthropic 风格标记

```typescript
function applyAnthropicCacheControl(
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  addCacheControlToSystemPrompt(messages, cacheControl);
  addCacheControlToLastTool(tools, cacheControl);
  addCacheControlToLastConversationMessage(messages, cacheControl);
}
```

4. **工具调用流式状态管理**：双索引追踪

```typescript
const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();

const ensureToolCallBlock = (toolCall: StreamingToolCallDelta) => {
  const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
  let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined;
  if (!block && toolCall.id) {
    block = toolCallBlocksById.get(toolCall.id);
  }
  // ...
};
```

### Amazon Bedrock Provider 适配

**关键适配点**：

1. **双认证模式**：支持 SigV4 签名和 Bearer Token

```typescript
// Bearer Token 模式（API Key 认证，需要 bedrock:CallWithBearerToken IAM 权限）
const bearerToken = options.bearerToken || process.env.AWS_BEARER_TOKEN_BEDROCK || undefined;
const useBearerToken = bearerToken !== undefined && process.env.AWS_BEDROCK_SKIP_AUTH !== "1";
if (useBearerToken) {
  config.token = { token: bearerToken };
  config.authSchemePreference = ["httpBearerAuth"];
}

// SigV4 模式（默认，使用 AWS 凭证链）
// 也支持 AWS_BEDROCK_SKIP_AUTH=1 跳过认证（用于代理场景）
const client = new BedrockRuntimeClient(config);
```

2. **自定义 HTTP 头注入**：通过 Smithy middleware 注入，确保被 SigV4 签名覆盖

```typescript
// 通过 build-step middleware 注入自定义头，保留的 AWS 头（x-amz-*、
// authorization, host）会被静默忽略以保护 SigV4 / bearer auth
if (options.headers && Object.keys(options.headers).length > 0) {
  addCustomHeadersMiddleware(client, options.headers);
}
```

3. **区域端点检测**：自动从 URL 提取区域

```typescript
function getStandardBedrockEndpointRegion(baseUrl: string): string | undefined {
  const { hostname } = new URL(baseUrl);
  const match = hostname.match(/^bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/);
  return match?.[1];  // 例如 "us-east-1", "eu-central-1"
}
```

4. **Thinking Display 控制**：区分 GovCloud 和标准区域

```typescript
// thinkingDisplay 选项控制 Claude thinking 返回方式
// "summarized": 返回总结的思考内容（默认）
// "omitted": 思考内容被 redacted，仅保留签名用于多轮连续性
// GovCloud 端点拒绝 display 字段，需省略
const display = isGovCloudBedrockTarget(model, options)
  ? undefined
  : (options.thinkingDisplay ?? "summarized");
```

5. **缓存点实现**：Claude 模型专用 `cachePoint`

```typescript
if (cacheRetention !== "none" && supportsPromptCaching(model)) {
  blocks.push({
    cachePoint: {
      type: CachePointType.DEFAULT,
      ...(cacheRetention === "long" ? { ttl: CacheTTL.ONE_HOUR } : {}),
    },
  });
}
```

6. **成本分配标签**：通过 `requestMetadata` 注入 AWS Cost Explorer 标签

```typescript
export interface BedrockOptions extends StreamOptions {
  /** Bearer token 认证，设置后绕过 SigV4 签名 */
  bearerToken?: string;
  /** 成本分配标签，出现在 AWS Cost Explorer 拆分成本数据中。
   *  Key: max 64 chars, 不能 aws: 前缀。Value: max 256 chars。最多 50 对。 */
  requestMetadata?: Record<string, string>;
  /** 控制 Claude thinking 返回方式 */
  thinkingDisplay?: BedrockThinkingDisplay;
  /** 交错思考（interleaved thinking），仅 Claude 4.x 模型支持 */
  interleavedThinking?: boolean;
}
```

7. **错误前缀映射**：SDK 异常转人类可读前缀

```typescript
const BEDROCK_ERROR_PREFIXES: Record<string, string> = {
  InternalServerException: "Internal server error",
  ModelStreamErrorException: "Model stream error",
  ValidationException: "Validation error",
  ThrottlingException: "Throttling error",
  ServiceUnavailableException: "Service unavailable",
};
```

### Google Generative AI Provider 适配

**关键适配点**：

1. **Part 类型判断**：通过 `thoughtSignature` 区分 text/thinking

```typescript
const isThinkingPart = (part: { thoughtSignature?: string }): boolean => {
  return !!part.thoughtSignature;
};

// 流式处理中动态切换 block 类型
if (part.text !== undefined) {
  const isThinking = isThinkingPart(part);
  if (!currentBlock || (isThinking && currentBlock.type !== "thinking")) {
    // 发送 *_end 事件，切换 block
  }
}
```

2. **模型系列判断**：正则匹配模型 ID

```typescript
function isGemini3ProModel(model: Model<"google-generative-ai">): boolean {
  return /gemini-3(?:\.\d+)?-pro/.test(model.id.toLowerCase());
}

function getDisabledThinkingConfig(model: Model<"google-generative-ai">): ThinkingConfig {
  if (isGemini3ProModel(model)) {
    return { thinkingLevel: "LOW" as any };  // 无法完全禁用
  }
  if (isGemini3FlashModel(model)) {
    return { thinkingLevel: "MINIMAL" as any };
  }
  return { thinkingBudget: 0 };  // Gemini 2.x 支持禁用
}
```

3. **预算分级**：按模型系列硬编码 token 预算

```typescript
function getGoogleBudget(model: Model, effort: ClampedThinkingLevel): number {
  if (model.id.includes("2.5-pro")) {
    const budgets = {
      minimal: 128,
      low: 2048,
      medium: 8192,
      high: 32768,
    };
    return budgets[effort];
  }
  // ... 其他模型系列
  return -1;  // 动态预算
}
```

## Provider Quirks 对比

| 特性 | Anthropic | OpenAI Completions | Google Generative AI | Amazon Bedrock | OpenAI Codex Responses |
|------|-----------|-------------------|---------------------|----------------|------------------------|
| **Thinking 格式** | `thinking: {type, budget_tokens, effort}` | `reasoning_effort` / `thinking: {type}` 等 8 种格式 | `thinkingConfig: {thinkingLevel, thinkingBudget}` | `additionalModelRequestFields` | `reasoning: {effort, summary}` |
| **Thinking 禁用** | `thinking: {type: "disabled"}` | 不传 `reasoning_effort` | `thinkingBudget: 0` (2.x) / `thinkingLevel: "LOW"` (3.x) | 省略 thinking 字段 | 不传 `reasoning` |
| **Redacted Thinking** | `redacted_thinking` 事件 | 不适用 | 不适用 | `reasoningContent` + 空签名 | 不适用 |
| **Tool Call ID** | Provider 生成 | Provider 生成 | 需自生成（常重复） | Provider 生成 | Provider 生成 |
| **Tool 流式** | `input_json_delta` | `tool_calls[].function.arguments` | `functionCall` 完整对象 | `toolUse.input` delta | Responses API 原生流式 |
| **Prompt Cache** | `cache_control` 标记 | `prompt_cache_key` + Anthropic 格式 | 不支持 | `cachePoint` 块 | `prompt_cache_key` |
| **Cache Retention** | `short`/`long`/`none` + TTL | 部分支持 + 24h | 不支持 | `CacheTTL.ONE_HOUR` (long) | `prompt_cache_retention: "24h"` |
| **会话亲和性** | `x-session-affinity` | `session_id` | 不支持 | 不支持 | `x-request-session-id` (WebSocket) |
| **认证方式** | API Key / OAuth (Bearer) | Bearer Token | API Key | SigV4 / Bearer Token | JWT (ChatGPT session token) |
| **Stop Reason** | `end_turn`, `max_tokens`, `tool_use` | `stop`, `length`, `tool_calls` | `STOP`, `MAX_TOKENS`, `STOP` + tool check | `END_TURN`, `MAX_TOKENS`, `TOOL_USE` | `completed`, `incomplete`, `failed`, `cancelled` |
| **SSE 解析** | 手写 | SDK 处理 | SDK 处理 | SDK 处理 | 自实现 SSE + WebSocket 帧解析 |
| **WebSocket 支持** | 不支持 | 部分 Provider 支持 | 不支持 | 不支持 | 是（优先，支持自动降级到 SSE） |
| **Usage 位置** | `message_start` + `message_delta` | `chunk.usage` | `usageMetadata` | `metadata.usage` | `response.usage` |
| **多轮签名** | `signature_delta` | 无 | `thoughtSignature` 追加 | `reasoningContent.reasoningText.signature` | `previous_response_id` |
| **Temperature 支持** | Opus 4.7+ 禁用 | 全部支持 | 全部支持 | 取决于模型 | 不支持（使用 reasoning 控制） |
| **空签名重放** | `allowEmptySignature` compat | 不适用 | 不适用 | 不适用 | 不适用 |

## 错误处理到流中的实现

```
Provider 实现
     │
     ▼
try {
  // API 调用
  for await (chunk) {
    stream.push({...});
  }
  stream.push({type: "done", ...});
  stream.end();
} catch (error) {
  // 清理内部状态
  for (const block of output.content) {
    delete (block as {index?: number}).index;
    delete (block as {partialJson?: string}).partialJson;
  }

  // 设置错误信息
  output.stopReason = options?.signal?.aborted ? "aborted" : "error";
  output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

  // 发送 error 事件
  stream.push({type: "error", reason: output.stopReason, error: output});
  stream.end();
}
```

**关键点**：
1. **清理内部状态**：删除 `index`、`partialJson` 等流式专用字段
2. **区分 abort/error**：根据 `signal?.aborted` 设置 `stopReason`
3. **错误序列化**：`Error.message` 或 `JSON.stringify`
4. **保证终结**：总是调用 `stream.end()`，确保消费者能结束迭代

## Model 类型系统

**能力声明** (`types.ts` + `models.generated.ts`)：

```typescript
interface Model<TApi extends Api> {
  id: string;                          // 模型 ID
  name: string;                        // 显示名称
  api: TApi;                           // 所属 API
  provider: Provider;                  // Provider 标识
  baseUrl: string;                     // API endpoint
  reasoning: boolean;                  // 是否支持思考
  thinkingLevelMap?: ThinkingLevelMap; // 思考级别映射
  input: ("text" | "image")[];         // 输入模态
  cost: {
    input: number;    // $/M tokens
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;               // 最大上下文
  maxTokens: number;                   // 最大输出
  headers?: Record<string, string>;    // 默认请求头
  compat?: TApi extends "openai-completions"
    ? OpenAICompletionsCompat
    : TApi extends "openai-responses"
      ? OpenAIResponsesCompat
      : TApi extends "anthropic-messages"
        ? AnthropicMessagesCompat
        : never;                      // 兼容性覆盖
}
```

**AssistantMessage 新增字段**：

```typescript
export interface AssistantMessage {
  // ... 原有字段
  responseModel?: string;  // 实际返回的模型（如 OpenRouter auto → anthropic/...）
  responseId?: string;     // Provider 特定的响应/消息 ID
  diagnostics?: AssistantMessageDiagnostic[];  // 失败/恢复的诊断信息
}
```

**Thinking Level 映射示例**：

```typescript
// Opus 4.7 支持 "xhigh" 级别
"claude-opus-4.7": {
  // ...
  thinkingLevelMap: {
    off: "low",     // 关闭思考时的默认值
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",  // 仅 Opus 4.7
  },
}
```

**AnthropicMessagesCompat 兼容性配置**（`types.ts`）：

```typescript
export interface AnthropicMessagesCompat {
  /** 是否接受 per-tool eager_input_streaming。false 时使用 legacy beta header。默认 true。 */
  supportsEagerToolInputStreaming?: boolean;
  /** 是否支持长缓存保留 (cache_control.ttl: "1h")。默认 true。 */
  supportsLongCacheRetention?: boolean;
  /** 是否发送 x-session-affinity 头。Fireworks 等需要此头做缓存路由。默认 false。 */
  sendSessionAffinityHeaders?: boolean;
  /** 是否支持在 tool 定义上标记 cache_control。Fireworks 不支持。默认 true。 */
  supportsCacheControlOnTools?: boolean;
  /** 模型是否接受 temperature 参数。Claude Opus 4.7+ 拒绝非默认 temperature。默认 true。 */
  supportsTemperature?: boolean;
  /** 是否强制自适应思考 (adaptive thinking) 格式。默认 false。 */
  forceAdaptiveThinking?: boolean;
  /** 是否允许空 thinking 签名重放。默认 false。 */
  allowEmptySignature?: boolean;
}
```

**OpenAIResponsesCompat 兼容性配置**（`types.ts`）：

```typescript
export interface OpenAIResponsesCompat {
  /** 是否发送 session_id 头用于缓存亲和性。默认 true。 */
  sendSessionIdHeader?: boolean;
  /** 是否支持 prompt_cache_retention: "24h"。默认 true。 */
  supportsLongCacheRetention?: boolean;
}
```

**OpenAICompletionsCompat 重要新增字段**：

```typescript
export interface OpenAICompletionsCompat {
  // ... 原有字段
  /** thinking 格式：支持 "openai" | "openrouter" | "deepseek" | "together" | "zai" | "qwen" | "qwen-chat-template" | "string-thinking"。默认 "openai"。 */
  thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "zai" | "qwen" | "qwen-chat-template" | "string-thinking";
  /** z.ai 是否支持 tool_stream: true。默认 false。 */
  zaiToolStream?: boolean;
  /** Prompt cache 控制格式。"anthropic" 使用 cache_control 标记。 */
  cacheControlFormat?: "anthropic";
  /** 是否发送会话亲和性头。默认 false。 */
  sendSessionAffinityHeaders?: boolean;
  /** 是否支持长缓存保留。默认 true。 */
  supportsLongCacheRetention?: boolean;
  /** 是否支持 strict mode 工具定义。默认 true。 */
  supportsStrictMode?: boolean;
}
```

## OpenAI Codex Responses Provider 适配

OpenAI Codex Responses 是面向 ChatGPT 用户的新 Provider，通过 JWT 认证访问 Codex API。其核心特点是 **双传输协议**（WebSocket + SSE）自动降级。

**关键适配点**：

1. **双传输协议自动降级**：优先 WebSocket，失败时降级为 SSE

```typescript
const transport = options?.transport || "auto";
if (transport !== "sse" && !websocketDisabledForSession) {
  try {
    await processWebSocketStream(...);  // 尝试 WebSocket
    // 成功则返回
  } catch (error) {
    if (aborted || isCodexNonTransportError(error)) throw error;
    // 记录诊断信息，降级到 SSE
    appendAssistantMessageDiagnostic(output,
      createAssistantMessageDiagnostic("provider_transport_failure", error, {...}));
  }
}
// 降级到 SSE
await processSSEStream(...);
```

2. **JWT 认证**：从 API Key 中提取 JWT token 和 accountId

```typescript
function extractAccountId(apiKey: string): string {
  // 解析 JWT payload 提取 account_id
}
```

3. **会话管理**：WebSocket 会话缓存和 SSE 降级追踪

```typescript
// 缓存成功的 WebSocket 连接，跨请求复用
// 跟踪降级事件，避免反复尝试 WebSocket
function isWebSocketSseFallbackActive(sessionId?: string): boolean { ... }
function recordWebSocketSseFallback(sessionId?: string): void { ... }
```

4. **Codex 专属选项**：

```typescript
export interface OpenAICodexResponsesOptions extends StreamOptions {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
  serviceTier?: "auto" | "default" | "flex" | "priority";
  textVerbosity?: "low" | "medium" | "high";
}
```

5. **WebSocket 消息处理**：自实现 WebSocket 帧解析和连接管理

```typescript
// WebSocket 连接超时（默认 15s）
const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;
// 消息过大关闭码
const WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;
// 支持 idle 超时检测
const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs);
```

**SSE 超时保护**：

```typescript
// SSE header 响应超时（默认 10s）
const DEFAULT_SSE_HEADER_TIMEOUT_MS = 10_000;
function createSSEHeaderTimeout() {
  // 创建独立 AbortController，超时时 abort SSE 请求
}
```

## OpenAI Responses / Azure OpenAI Responses Provider

这两个 Provider 共享核心流式处理逻辑 `processResponsesStream()`（位于 `openai-responses-shared.ts`），通过 `compat` 字段区分缓存行为：

- **OpenAI Responses** (`openai-responses` API)：支持 `prompt_cache_retention: "24h"`、`session_id` 缓存亲和性头
- **Azure OpenAI Responses** (`azure-openai-responses` API)：Azure 特有的端点格式和认证方式

两者的消息转换（`convertResponsesMessages`）和工具转换（`convertResponsesTools`）逻辑相同，共享 `openai-responses-shared.ts` 中的实现。

| 设计决策 | 实现方式 | 优点 | 缺点 |
|---------|---------|------|------|
| **统一流式接口** | `AssistantMessageEventStream` | 消费者无需关心 Provider 差异 | 需要适配层转换所有 Provider 格式 |
| **延迟加载 Provider** | `import()` + Promise 缓存 | 减少启动内存，按需加载 | 首次调用延迟，错误需编码到流 |
| **错误流式传递** | `error` 事件 + `stopReason` | 消费者统一处理，无异常泄漏 | 需要显式检查 `errorMessage` |
| **SSE 手写解析** (Anthropic) | 正则 + 状态机 | 不依赖 SDK 流实现，可精细控制 | 代码复杂，需维护边界情况 |
| **兼容性自动检测** | URL/Provider → Compat 表 | 无配置即可支持多数 Provider | 检测逻辑复杂，可能误判 |
| **Prompt Cache 复用** | Anthropic `cache_control` 标记 | 统一缓存策略，跨 Provider | 部分不支持 Provider 浪费字段 |
| **缓存保留策略** | `none`/`short`/`long` + TTL | 灵活控制缓存时长和成本 | Provider 支持程度不一 |
| **会话亲和性** | `x-session-affinity` / `session_id` | 提高缓存命中率 | 仅部分 Provider 支持 |
| **双认证模式** (Bedrock) | SigV4 / Bearer Token | 兼容企业和个人账户 | 配置逻辑复杂 |
| **双索引工具调用** (OpenAI) | `Map<index>` + `Map<id>` | 处理无序 delta，兼容异常流 | 内存占用翻倍 |
| **Thinking 多格式** | `compat.thinkingFormat` (8 种格式) | 支持 8 种 Provider 格式 | 配置分散，难以维护 |
| **Redacted Thinking** | `redacted` 标记 + 加密签名 | 安全过滤 + 多轮连续性 | 需处理空签名边界情况 |
| **WebSocket 传输** (Codex) | WS 优先 + SSE 自动降级 | 更低延迟，双向通信 | 实现复杂，连接管理需额外逻辑 |
| **Temperature 抑制** (Anthropic) | `supportsTemperature` compat | 兼容 Opus 4.7+ 新限制 | 需要 model 级别的 compat 声明 |
| **空签名重放** (Anthropic) | `allowEmptySignature` compat | 保持 thinking 结构而非降级为 text | 仅部分兼容 Provider 需要 |

## 数据流图

```
用户代码
  │
  ▼ streamSimple(model, context, options)
  │
  ▼ getApiProvider(model.api)
  │
  ▼ provider.streamSimple(model, context, options)
  │
  ▼ [延迟加载] import("./anthropic.ts") / import("./openai-codex-responses.ts")
  │
  ▼ streamProvider(model, context, options)
  │
  ▼ new AssistantMessageEventStream() (立即返回)
  │
  ├── [Anthropic / SSE 路径]
  │   │
  │   ▼ [异步] client.messages.create(..., {stream: true})
  │   │
  │   ▼ [异步] for await (sse of iterateSseMessages(response.body))
  │   │
  │   ▼ [异步] for await (event of iterateAnthropicEvents(sse))
  │   │
  │   ├─> message_start          ──> output.usage 初始化
  │   ├─> content_block_start    ──> stream.push(text_start)
  │   ├─> content_block_delta    ──> stream.push(text_delta)
  │   ├─> content_block_stop     ──> stream.push(text_end)
  │   ├─> message_delta          ──> output.usage 更新
  │   └─> message_stop           ──> stream.push(done)
  │
  └── [OpenAI Codex / WebSocket + SSE 降级路径]
      │
      ├─> [优先] WebSocket 连接
      │   ├─> 成功 → processWebSocketStream(...)
      │   │   ├─> response.created      ──> stream.push(start)
      │   │   ├─> response.output_text  ──> stream.push(text_delta)
      │   │   ├─> response.completed    ──> stream.push(done)
      │   │   ├─> response.failed       ──> stream.push(error)
      │   │   └─> response.cancelled    ──> stream.push(error)
      │   └─> 失败 → 记录诊断信息，降级到 SSE
      │
      └─> [降级] SSE 流
          ├─> response.output_text.delta  ──> stream.push(text_delta)
          ├─> response.completed          ──> stream.push(done)
          └─> response.failed             ──> stream.push(error)
  │
  ▼ stream.end()
  │
  ▼ for await (event of stream) (消费)
```

## 扩展性考虑

1. **新增 Provider**：
   - 实现 `StreamFunction<TApi, TOptions>`
   - 返回 `AssistantMessageEventStream`
   - 在 `register-builtins.ts` 注册

2. **新增 Provider 特有选项**：
   - 扩展 `StreamOptions` 交叉类型
   - 在 Provider 实现中解包

3. **新增事件类型**：
   - 扩展 `AssistantMessageEvent` 联合类型
   - 更新 `EventStream.isComplete` 判断逻辑

4. **兼容性覆盖**：
   - 设置 `model.compat` 覆盖自动检测
   - 优先级：显式配置 > URL 检测 > 默认值

## 新增 StreamOptions 选项

**缓存控制**：

```typescript
export type CacheRetention = "none" | "short" | "long";

export interface StreamOptions {
  // 提示缓存保留偏好，Provider 映射到其支持的值
  cacheRetention?: CacheRetention;  // 默认 "short"
  // 可选的会话标识符，支持基于会话的缓存
  sessionId?: string;
}
```

**HTTP 请求控制**：

```typescript
export interface StreamOptions {
  // HTTP 请求超时（毫秒）
  timeoutMs?: number;
  // 最大重试次数（支持客户端重试的 Provider/SDK）
  maxRetries?: number;
  // 最大重试延迟（毫秒），超过则立即失败
  maxRetryDelayMs?: number;
  // 自定义 HTTP 头
  headers?: Record<string, string>;
}
```

**传输协议控制**：

```typescript
export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";

export interface StreamOptions {
  // 偏好的传输方式。支持多传输的 Provider（如 OpenAI Codex）使用此选项
  transport?: Transport;
  // WebSocket 连接超时（毫秒），仅覆盖连接/打开握手阶段
  websocketConnectTimeoutMs?: number;
}
```

**回调钩子**：

```typescript
export interface StreamOptions {
  // 发送前检查/替换 provider payload
  onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
  // HTTP 响应接收后、消费 body 前调用
  onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
  // 可选的请求元数据。Provider 提取能理解的字段，忽略其余
  // 例如 Anthropic 使用 user_id 做滥用追踪和频率限制
  metadata?: Record<string, unknown>;
}
```
