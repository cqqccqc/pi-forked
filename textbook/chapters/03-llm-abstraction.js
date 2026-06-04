/**
 * 第3章：LLM 抽象层 — Agent 的大脑
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 3,
  title: 'LLM 抽象层：让 Agent 连接不同的 AI 大脑',
  desc: '理解 Pi 如何通过统一接口对接多个 LLM Provider（OpenAI、Anthropic、Google 等），使 Agent 可以无缝切换不同的 AI 模型。',

  objectives: [
    '理解为什么需要 Provider 抽象层——用"万能遥控器"比喻理解统一接口的必要性',
    '掌握统一流式接口的设计思想——streamSimple() 函数和 AssistantMessageEventStream',
    '了解延迟加载机制（Lazy Loading）如何优化启动性能和内存占用',
    '理解工具调用（Tool Calling）的流式事件协议',
  ],

  render(container) {
    // === Section 1: 为什么需要对接多个AI ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>3.1 为什么需要对接多个 AI？</h2>
      <p>想象你家里有电视、空调、音响、机顶盒……每个设备都有自己的遥控器。每次想换个台，你得在一堆遥控器里翻找正确的那个，还要记住每个遥控器的按钮布局。这很烦人，对吧？</p>
      <p><strong>万能遥控器</strong>解决了这个问题——它把不同品牌、不同设备的红外码全部集成在一起，你只需要按"开关"，它就知道该给哪个设备发什么信号。</p>
      <p>Pi 的 <code>packages/ai</code> 包就是 Coding Agent 的<strong>万能遥控器</strong>。市面上有 OpenAI、Anthropic、Google、Mistral、AWS Bedrock……每家 API 的请求格式、响应格式、认证方式都不一样。如果每对接一个 Provider 就要重写一遍 Agent Loop，那开发效率会极低，而且代码会充满 if-else。</p>

      <div class="info-card">
        <h4>万能遥控器 = Provider 抽象层</h4>
        <table class="content-table" style="margin-top:12px;">
          <tr><th>万能遥控器</th><th>Pi Provider 抽象层</th></tr>
          <tr><td>记住不同品牌的红外码</td><td>记住不同 Provider 的 API 格式</td></tr>
          <tr><td>你只按"开关"，遥控器翻译成具体信号</td><td>你只调 <code>streamSimple(model, context)</code>，Provider 翻译成具体 HTTP 请求</td></tr>
          <tr><td>添加新设备只需"学习"一次</td><td>添加新 Provider 只需实现一次 StreamFunction 接口</td></tr>
          <tr><td>不会因为换品牌就扔掉旧遥控器</td><td>Agent Loop 代码不因换模型而改动一行</td></tr>
        </table>
      </div>

      <p>目前 Pi 支持 <strong>9 种 API 类型、35 个 Provider 类别、900+ 个模型</strong>，而 Agent Loop 只需要处理一套统一的事件协议。这就是抽象层的力量。</p>

      <h3>9 种 API 类型</h3>
      <p>Pi 将所有 Provider 按其 API 格式归类为 9 种 API 类型，每种类型共享同一套适配逻辑：</p>
      <table class="content-table">
        <tr><th>API 类型</th><th>典型 Provider</th><th>API 风格</th></tr>
        <tr><td><code>anthropic-messages</code></td><td>Anthropic, Fireworks, Cloudflare AI Gateway</td><td>SSE 流式 + cache_control 标记</td></tr>
        <tr><td><code>openai-completions</code></td><td>OpenAI, DeepSeek, Groq, Together, z.ai, Moonshot 等</td><td>/v1/chat/completions 兼容</td></tr>
        <tr><td><code>openai-responses</code></td><td>OpenAI Responses API</td><td>新 Responses API 格式</td></tr>
        <tr><td><code>openai-codex-responses</code></td><td>OpenAI Codex (ChatGPT 用户)</td><td>WebSocket + SSE 双传输</td></tr>
        <tr><td><code>azure-openai-responses</code></td><td>Azure OpenAI</td><td>Azure 端点 + Responses 格式</td></tr>
        <tr><td><code>google-generative-ai</code></td><td>Google Gemini</td><td>Gemini API</td></tr>
        <tr><td><code>google-vertex</code></td><td>Google Vertex AI</td><td>Vertex AI 端点</td></tr>
        <tr><td><code>bedrock-converse-stream</code></td><td>AWS Bedrock Claude</td><td>AWS SDK + SigV4 认证</td></tr>
        <tr><td><code>mistral-conversations</code></td><td>Mistral</td><td>Mistral API</td></tr>
      </table>
    `;
    container.appendChild(s1);

    // === Section 2: 统一流式接口 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>3.2 统一流式接口：一条管道连接所有 AI</h2>
      <p>无论后台是 Claude、GPT 还是 Gemini，Agent Loop 始终调用同一个函数——<code>streamSimple()</code>。这个函数是 abstraction 层的"总入口"。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/stream.ts — 统一接口入口</span></div>
        <pre><code class="language-typescript">// 简化版流式接口 — 所有 Provider 的调用入口
export function streamSimple&lt;TApi extends Api&gt;(
  model: Model&lt;TApi&gt;,          // 要使用的模型（含 api 类型标记）
  context: Context,               // 对话上下文（system prompt + 消息 + 工具定义）
  options?: SimpleStreamOptions,  // 可选参数（temperature、reasoning 等）
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.streamSimple(model, context, options);
}

// 完整版流式接口 — 支持更多 Provider 特有选项
export function stream(
  model: Model&lt;Api&gt;,
  context: Context,
  options?: ProviderStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  return provider.stream(model, context, options as StreamOptions);
}</code></pre>
      </div>

      <p>这段代码极其简洁：根据 <code>model.api</code> 找到对应 Provider，然后调用它的 <code>streamSimple()</code>。你不需要知道它在跟 Claude 还是 Gemini 说话——返回的都是同一个 <code>AssistantMessageEventStream</code>。</p>

      <h3>数据流向</h3>
      <div class="step-list">
        <li>
          <h4>Agent Loop 调用 streamSimple(model, context, options)</h4>
          <p>传入模型标识、对话上下文（含 system prompt、消息历史、工具定义）和可选参数</p>
        </li>
        <li>
          <h4>resolveApiProvider(model.api) 查找 Provider</h4>
          <p>从 <code>apiProviderRegistry</code> Map 中根据 API 类型查找已注册的 Provider</p>
        </li>
        <li>
          <h4>provider.streamSimple() 执行具体逻辑</h4>
          <p>如果是首次调用，触发延迟加载（导入 Provider 模块和 SDK 依赖）</p>
        </li>
        <li>
          <h4>返回 AssistantMessageEventStream</h4>
          <p>立即返回一个可迭代的事件流。Provider 在后台异步处理（发 HTTP 请求、解析 SSE/WebSocket），通过 push() 推送事件</p>
        </li>
      </div>

      <div class="info-card tip">
        <h4>关键设计契约</h4>
        <p><strong>StreamFunction Contract</strong>（来自 <code>types.ts</code> 注释）：</p>
        <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
          <li>必须返回 <code>AssistantMessageEventStream</code></li>
          <li>调用后，请求/模型/运行时错误应编码到返回流中，<strong>不抛出异常</strong></li>
          <li>错误终止必须产生带有 <code>stopReason: "error"</code> 或 <code>"aborted"</code> 的 AssistantMessage，通过流协议发出</li>
        </ul>
      </div>
    `;
    container.appendChild(s2);

    // === Section 3: Provider 注册机制 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>3.3 Provider 注册机制：Map 注册表</h2>
      <p>所有 Provider 都注册在一个全局 <code>Map</code> 中。这个设计比 Object 更类型安全，而且能高效地按 API 类型查找。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/api-registry.ts — 注册与查找</span></div>
        <pre><code class="language-typescript">// Provider 接口定义
interface ApiProvider&lt;TApi extends Api = Api&gt; {
  api: TApi;
  stream: StreamFunction&lt;TApi, TOptions&gt;;
  streamSimple: StreamFunction&lt;TApi, SimpleStreamOptions&gt;;
}

// 全局注册表 — Map 而非 Object，提供完整的类型安全
const apiProviderRegistry = new Map&lt;Api, RegisteredApiProvider&gt;();

// 注册机制（带 sourceId 支持按来源批量卸载）
export function registerApiProvider&lt;TApi extends Api&gt;(
  provider: ApiProvider&lt;TApi&gt;,
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
}</code></pre>
      </div>

      <p>注册表在概念上像一个电话簿：</p>
      <table class="content-table">
        <tr><th>API 类型（Key）</th><th>注册的 Provider（Value）</th></tr>
        <tr><td><code>"anthropic-messages"</code></td><td>Anthropic Provider → 调用 Claude API</td></tr>
        <tr><td><code>"openai-completions"</code></td><td>OpenAI Completions Provider → 调用 OpenAI / DeepSeek / Groq 等</td></tr>
        <tr><td><code>"google-generative-ai"</code></td><td>Google Generative AI Provider → 调用 Gemini API</td></tr>
        <tr><td><code>"bedrock-converse-stream"</code></td><td>AWS Bedrock Provider → 通过 AWS SDK 调用</td></tr>
        <tr><td><code>"openai-codex-responses"</code></td><td>OpenAI Codex Provider → JWT 认证 + WebSocket/SSE</td></tr>
      </table>

      <p><code>wrapStream</code> 和 <code>wrapStreamSimple</code> 在运行时校验 API 类型是否匹配——如果 Provider 声称自己能处理 <code>"anthropic-messages"</code>，运行时就会检查它传入的 model 确实有这个 api 类型。</p>

      <div class="info-card">
        <h4>sourceId 的作用</h4>
        <p>每个 Provider 注册时可附带一个 <code>sourceId</code>，用于标识注册来源（如某个插件）。当插件被卸载时，可以按 <code>sourceId</code> 批量移除该插件注册的所有 Provider，避免残留。</p>
      </div>
    `;
    container.appendChild(s3);

    // === Section 4: 延迟加载 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>3.4 延迟加载：不用的 Provider 不加载</h2>
      <p>Pi 支持 9 种 API 类型，覆盖了 35 个 Provider。如果启动时把所有 Provider 的代码和 SDK 依赖全部加载进内存，启动会很慢，而且大部分用户只会用其中一个或两个。</p>

      <p><strong>延迟加载（Lazy Loading）</strong>解决了这个问题：每个 Provider 的代码只有在第一次被实际使用时，才会通过 <code>import()</code> 动态导入。</p>

      <h3>createLazyStream — 延迟加载的核心</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/providers/register-builtins.ts — 延迟加载包装器</span></div>
        <pre><code class="language-typescript">// 延迟加载包装器
function createLazyStream&lt;TApi extends Api&gt;(
  loadModule: () => Promise&lt;LazyProviderModule&lt;TApi&gt;&gt;,
): StreamFunction&lt;TApi, TOptions&gt; {
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

// Promise 缓存 — 避免重复加载同一个模块
let anthropicProviderModulePromise: Promise&lt;...&gt; | undefined;

function loadAnthropicProviderModule() {
  anthropicProviderModulePromise ||= import("./anthropic.ts").then(...);
  return anthropicProviderModulePromise;
}</code></pre>
      </div>

      <p>延迟加载的关键设计点：</p>
      <div class="step-list">
        <li>
          <h4>立即返回外层 EventStream</h4>
          <p><code>outer</code> 在函数入口就创建并返回，Consumer 可以立即开始 <code>for await</code> 迭代，不阻塞调用方</p>
        </li>
        <li>
          <h4>异步加载，成功后转发</h4>
          <p><code>loadModule()</code> 返回 Promise，成功后调用 <code>forwardStream(outer, inner)</code>，把内层 Provider 的事件流转发到外层</p>
        </li>
        <li>
          <h4>加载失败不崩溃，返回错误消息</h4>
          <p>如果 <code>import()</code> 失败（比如网络问题、找不到模块），catch 块创建一个 <code>stopReason: "error"</code> 的消息，通过流协议通知 Consumer，而不是抛异常崩溃</p>
        </li>
        <li>
          <h4>Promise 缓存避免重复加载</h4>
          <p><code>||=</code> 运算符确保 <code>import()</code> 只会执行一次——第二次调用直接复用缓存的 Promise</p>
        </li>
      </div>
    `;
    container.appendChild(s4);

    // === Section 5: 事件协议 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>3.5 流式事件协议：AI 和 Agent 的共同语言</h2>
      <p>所有 Provider 的输出都必须遵守统一的 <code>AssistantMessageEvent</code> 协议。这个协议定义了 LLM 响应的<strong>所有可能事件类型</strong>，让 Agent Loop 不需要知道 Provider 内部的实现细节。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/types.ts — 事件协议定义</span></div>
        <pre><code class="language-typescript">export type AssistantMessageEvent =
  // 开始事件（携带初始 AssistantMessage）
  | { type: "start"; partial: AssistantMessage }
  // 文本生成事件 — LLM 逐 token 输出文本
  | { type: "text_start";  contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta";  contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end";    contentIndex: number; content: string; partial: AssistantMessage }
  // 思考（Reasoning）事件 — 模型"内心独白"
  | { type: "thinking_start";  contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta";  contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end";    contentIndex: number; content: string; partial: AssistantMessage }
  // 工具调用事件 — LLM 决定调用某个工具
  | { type: "toolcall_start";  contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta";  contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end";    contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  // 终止事件
  | { type: "done";  reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };</code></pre>
      </div>

      <h3>事件流的典型时序</h3>
      <p>一次 LLM 调用产生的事件序列（假设模型既生成文本又调用了工具）：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">典型事件序列</span></div>
        <pre><code class="language-plaintext">start
  ├── thinking_start          ← 模型开始"思考"
  ├── thinking_delta          ← 思考内容逐 token 到达
  ├── thinking_delta
  ├── thinking_end            ← 思考结束
  ├── text_start              ← 模型开始输出文本
  ├── text_delta              ← "我"
  ├── text_delta              ← "需要"
  ├── text_delta              ← "读取文件"
  ├── text_end                ← 文本输出结束
  ├── toolcall_start          ← 模型决定调用工具（如 read）
  ├── toolcall_delta          ← 工具参数逐片段到达
  ├── toolcall_delta
  ├── toolcall_end            ← 工具调用参数完整
  └── done (reason: "toolUse") ← 本轮响应结束</code></pre>
      </div>

      <p>Agent Loop 的核心——<code>streamAssistantResponse()</code>——就是用一个 <code>for await (const event of response)</code> 循环来消费这些事件，实时推进 UI 展示和工具执行。</p>
    `;
    container.appendChild(s5);

    // === Section 6: EventStream 原语 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>3.6 EventStream：生产者-消费者的桥梁</h2>
      <p><code>EventStream</code> 是 <code>packages/ai</code> 中最重要的基础设施类。它实现了一个<strong>异步的生产者-消费者模型</strong>：Provider 作为生产者通过 <code>push()</code> 推送事件，Agent Loop 作为消费者通过 <code>for await</code> 消费事件。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/utils/event-stream.ts — 核心实现</span></div>
        <pre><code class="language-typescript">export class EventStream&lt;T, R = T&gt; implements AsyncIterable&lt;T&gt; {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult&lt;T&gt;) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise&lt;R&gt;;

  // 生产者 API
  push(event: T): void {
    if (this.done) return;
    // 检测是否为终止事件（如 done/error）
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }
    // 如果有等待的消费者，直接交付；否则入队
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(result?: R): void {
    this.done = true;
    // 唤醒所有等待中的消费者
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  // 消费者 API — 支持 for await (const event of stream)
  async *[Symbol.asyncIterator](): AsyncIterator&lt;T&gt; {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        // 无事件时等待，生产者 push() 会唤醒
        const result = await new Promise&lt;IteratorResult&lt;T&gt;&gt;(
          (resolve) => this.waiting.push(resolve)
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  // 获取最终结果（如最终的 AssistantMessage）
  result(): Promise&lt;R&gt; {
    return this.finalResultPromise;
  }
}</code></pre>
      </div>

      <p>设计要点：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>无背压</strong>：queue 无界，如果 Provider 推送快于消费者，事件会累积在内存中</li>
        <li><strong>双端通信</strong>：<code>push()</code> 如果有等待者则立即交付，否则入队等待</li>
        <li><strong>结果 Promise</strong>：<code>result()</code> 方法返回最终 <code>AssistantMessage</code>，可以在流式迭代结束后获取完整消息</li>
        <li><strong>完成检测</strong>：通过构造时传入的 <code>isComplete</code> 回调判断终止事件</li>
      </ul>

      <div class="info-card tip">
        <h4>为什么不直接用 ReadableStream？</h4>
        <p>浏览器 <code>ReadableStream</code> 和 Node.js <code>Readable</code> 都有各自的 API 和限制。自实现 <code>EventStream</code> 能在 Node 和浏览器环境统一工作，而且提供了 <code>result()</code> Promise 这种便捷的"最终结果"获取方式，这是标准流 API 缺少的。</p>
      </div>
    `;
    container.appendChild(s6);

    // === Section 7: Provider 差异有多大 ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>3.7 Provider 差异有多大？看看这些适配细节</h2>
      <p>统一接口的背后，是大量的适配工作。以下是不同 Provider 在同一能力上的差异对比：</p>

      <table class="content-table">
        <tr><th>特性</th><th>Anthropic</th><th>OpenAI</th><th>Google</th></tr>
        <tr><td>Thinking 格式</td><td><code>thinking: {type, budget_tokens}</code></td><td>8 种格式（openai/deepseek/openrouter/together/zai/qwen/qwen-chat-template/string-thinking）</td><td><code>thinkingConfig: {thinkingLevel, thinkingBudget}</code></td></tr>
        <tr><td>Tool Call 流式</td><td><code>input_json_delta</code> 增量事件</td><td><code>tool_calls[].function.arguments</code> 片段</td><td><code>functionCall</code> 完整对象</td></tr>
        <tr><td>Prompt Cache</td><td><code>cache_control</code> 标记</td><td>部分支持 + 24h retention</td><td>不支持</td></tr>
        <tr><td>认证方式</td><td>API Key / OAuth</td><td>Bearer Token</td><td>API Key</td></tr>
        <tr><td>Stop Reason</td><td><code>end_turn / max_tokens / tool_use</code></td><td><code>stop / length / tool_calls</code></td><td><code>STOP / MAX_TOKENS</code> + 手动检查工具</td></tr>
        <tr><td>传输方式</td><td>SSE</td><td>SSE（部分 Provider 支持 WebSocket）</td><td>SSE</td></tr>
      </table>

      <p>以 "让模型开启思考（Thinking）" 这一个简单的操作为例，不同 Provider 需要的参数完全不同：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">不同 Provider 对 "开启思考" 的不同参数格式</span></div>
        <pre><code class="language-typescript">// Anthropic: thinking 对象
params.thinking = { type: "enabled", budget_tokens: 1024 };

// OpenAI (标准): reasoning_effort 字段
params.reasoning_effort = "medium";

// DeepSeek (特殊格式): thinking + reasoning_effort 组合
params.thinking = { type: "enabled" };
params.reasoning_effort = "medium";

// z.ai (另一种格式): enable_thinking 布尔值
params.enable_thinking = true;

// Google Gemini 2.x: thinkingBudget 数字
params.thinkingConfig = { thinkingBudget: 2048 };

// Google Gemini 3.x: thinkingLevel 枚举（无法完全禁用）
params.thinkingConfig = { thinkingLevel: "HIGH" };</code></pre>
      </div>

      <p>这就是为什么需要 Provider 抽象层——把这些千差万别的参数格式，全部封装在各自的 Provider 实现中，对外暴露统一的 <code>reasoningEffort</code> 选项。</p>
    `;
    container.appendChild(s7);

    // === Section 8: 深入 — forwardStream 与延迟加载全链路 ===
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>3.8 深入：forwardStream 与延迟加载全链路</h2>
      <p>前面几节分别介绍了 EventStream、createLazyStream、事件协议。这一节我们把它们串联起来，追踪一次 LLM 调用从"发起"到"返回事件"的完整路径。</p>

      <h3>全链路时序图</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">一次 streamSimple() 调用的完整链路</span></div>
        <pre><code class="language-plaintext">Agent Loop                  register-builtins.ts              Provider Module
    |                              |                              |
    |-- streamSimple(model) ------>|                              |
    |                              |-- apiProviderRegistry.get() ->| (从 Map 查找)
    |                              |  返回的是 createLazySimpleStream 包装的函数
    |                              |                              |
    |   [立即返回 outer EventStream, Consumer 开始 await]         |
    |                              |                              |
    |                              |-- loadModule() ------------->|
    |                              |   (首次: import("./xxx.ts")) |
    |                              |   (后续: 复用 Promise 缓存)   |
    |                              |                              |-- new EventStream() (inner)
    |                              |                              |-- 发起 HTTP 请求
    |                              |                              |-- 解析 SSE/WS 事件
    |                              |                              |-- inner.push(event)
    |                              |<-- forwardStream(outer,inner)-|
    |                              |   (异步桥接内层→外层)          |
    |                              |                              |
    |<-- for await (event of outer) ----------------------------->|
    |    收到 start → text_delta → toolcall_end → done/error      |</code></pre>
      </div>

      <h3>forwardStream：两层 EventStream 的桥接器</h3>
      <p><code>forwardStream</code> 是连接"延迟加载包装器"和"真实 Provider"的关键函数。它位于 <code>packages/ai/src/providers/register-builtins.ts</code>：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/providers/register-builtins.ts — forwardStream 完整源码</span></div>
        <pre><code class="language-typescript">// 将 source 流中的所有事件转发到 target 流
// 这是 createLazyStream 的核心——连接外层（立即返回）和内层（延迟加载）
function forwardStream(
  target: AssistantMessageEventStream,
  source: AsyncIterable&lt;AssistantMessageEvent&gt;,
): void {
  // 注意：这个函数不返回 Promise！
  // 它启动一个"发射后不管"（fire-and-forget）的异步循环
  (async () => {
    for await (const event of source) {
      target.push(event);        // 逐个转发事件
    }
    target.end();                // source 结束后关闭 target
  })();
}

// createLazyStream 如何使用 forwardStream：
function createLazyStream&lt;TApi extends Api&gt;(
  loadModule: () => Promise&lt;LazyProviderModule&lt;TApi&gt;&gt;,
): StreamFunction&lt;TApi&gt; {
  return (model, context, options) => {
    const outer = new AssistantMessageEventStream();  // ① 立即创建外层流

    loadModule()                                       // ② 异步加载 Provider 模块
      .then((module) => {
        const inner = module.stream(model, context, options); // ③ 创建内层流
        forwardStream(outer, inner);                   // ④ 桥接！
      })
      .catch((error) => {                              // ⑤ 加载失败 → 错误事件
        const message = createLazyLoadErrorMessage(model, error);
        outer.push({ type: "error", reason: "error", error: message });
        outer.end(message);
      });

    return outer;  // ⑥ 立即返回——Consumer 不需要等加载完成
  };
}</code></pre>
      </div>

      <p><code>forwardStream</code> 有三个精妙的设计点：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>fire-and-forget</strong>——函数本身不返回 Promise，不阻塞调用方。内部的 async IIFE 在后台运行，事件逐个到达时自动推入 target</li>
        <li><strong>被动结束</strong>——当 source 流自然结束（<code>for await</code> 循环退出），自动调用 <code>target.end()</code>，通知消费者流已终止</li>
        <li><strong>两层 EventStream 各自独立</strong>——outer 在构造时就返回给 Consumer，inner 在 Provider 模块加载后才创建。两个流的生命周期完全解耦</li>
      </ul>

      <h3>完整注册链：从 registerBuiltInApiProviders 到 HTTP 请求</h3>
      <p>让我们追踪 Anthropic Provider 的完整注册和使用路径：</p>
      <div class="step-list">
        <li>
          <h4>模块加载时：registerBuiltInApiProviders()</h4>
          <p>文件底部 <code>registerBuiltInApiProviders()</code> 将 9 个 API Provider 注册到 <code>apiProviderRegistry</code> Map 中。每个 Provider 的 stream/streamSimple 字段实际上是一个 <code>createLazyStream(loadModule)</code> 返回的包装函数——此时 Provider 模块还没有被加载。</p>
        </li>
        <li>
          <h4>调用时：streamSimple(model, context)</h4>
          <p>Agent Loop 调用 <code>streamSimple()</code> → <code>resolveApiProvider(model.api)</code> → <code>apiProviderRegistry.get("anthropic-messages")</code> → 拿到包装函数</p>
        </li>
        <li>
          <h4>包装函数执行：创建外层流 + 触发加载</h4>
          <p>包装函数立即创建 <code>outer</code> EventStream 并返回。同时在后台调用 <code>loadAnthropicProviderModule()</code></p>
        </li>
        <li>
          <h4>首次加载：动态 import + Promise 缓存</h4>
          <p><code>loadAnthropicProviderModule()</code> 内部执行 <code>anthropicPromise ||= import("./anthropic.ts").then(...)</code>。<code>||=</code> 确保只 import 一次</p>
        </li>
        <li>
          <h4>模块加载成功：创建内层流 + forwardStream</h4>
          <p><code>import("./anthropic.ts")</code> 返回模块后，调用 <code>module.streamAnthropic(model, context, options)</code> 创建内层流（这个函数内部会发 HTTP 请求到 Anthropic API 并解析 SSE），然后 <code>forwardStream(outer, inner)</code> 桥接</p>
        </li>
        <li>
          <h4>Consumer 消费：for await 迭代</h4>
          <p>Agent Loop 的 <code>for await (const event of outer)</code> 从第 1 步返回后就在等待事件。一旦 forwardStream 开始转发，事件逐个到达</p>
        </li>
      </div>

      <h3>错误处理链</h3>
      <p>整个链路中有多个错误处理点，确保任何环节的失败都不会导致进程崩溃：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">错误处理全景</span></div>
        <pre><code class="language-typescript">// 第一层防护：createLazyStream 的 catch
// 捕获 import() 失败（模块不存在、网络问题等）
.catch((error) => {
  const message = createLazyLoadErrorMessage(model, error);
  // message.stopReason === "error"
  // message.errorMessage === error.message
  outer.push({ type: "error", reason: "error", error: message });
  outer.end(message);
});

// 第二层防护：StreamFunction Contract
// 每个 Provider 的 stream() 函数都必须遵守：
// "请求/模型/运行时错误应编码到返回流中，不抛出异常"
// Provider 内部用 try-catch 包裹 HTTP 请求和 SSE 解析

// 第三层防护：Agent Loop 消费 error 事件
// for await (const event of stream) {
//   if (event.type === "error") {
//     // 记录错误、通知用户、停止循环
//   }
// }</code></pre>
      </div>

      <div class="info-card">
        <h4>为什么不用 AbortController？</h4>
        <p>Pi 的 EventStream 没有内置取消机制。如果需要取消一个正在进行的 LLM 请求，调用方可以简单地 <code>break</code> 出 <code>for await</code> 循环。底层 HTTP 请求的取消由 Provider 内部使用的 HTTP 客户端（如 fetch 的 AbortController）处理。这种设计保持了 EventStream 接口的简洁性。</p>
      </div>
    `;
    container.appendChild(s8);
  },

  quiz: [
    {
      question: 'Pi 的 Provider 抽象层用以下哪个比喻最恰当？',
      options: [
        '一个翻译官，把一种语言翻译成另一种',
        '一个万能遥控器，统一控制不同品牌的设备',
        '一个文件管理器，组织和分类文件',
        '一个路由器，在不同网络之间转发数据包',
      ],
      answer: 1,
      explanation: 'Pi 的 Provider 抽象层像一个"万能遥控器"：它记住不同 Provider 的 API 格式，对外暴露统一接口，让 Agent Loop 无需关心背后是哪个 AI 模型。',
    },
    {
      question: '延迟加载（Lazy Loading）的核心优势是什么？',
      options: [
        '让 LLM 响应更快',
        '减少启动时的内存占用，按需加载 Provider SDK',
        '提高 API 调用的并发数',
        '自动压缩上下文',
      ],
      answer: 1,
      explanation: '延迟加载通过动态 import() 让 Provider 代码只在首次使用时加载，避免启动时加载 35 个 Provider 的 SDK 依赖，显著减少内存占用和启动时间。',
    },
    {
      question: '以下哪个不是 AssistantMessageEvent 协议中定义的事件类型？',
      options: [
        'text_delta',
        'toolcall_end',
        'model_switch',
        'thinking_start',
      ],
      answer: 2,
      explanation: 'AssistantMessageEvent 协议定义了 start、text_start/delta/end、thinking_start/delta/end、toolcall_start/delta/end、done、error 等事件类型。model_switch 不是流事件协议的一部分。',
    },
    {
      question: '当 Provider 加载失败（如 import() 失败）时，系统如何处理？',
      options: [
        '抛出异常，终止 Agent 进程',
        '静默跳过，换一个 Provider',
        '通过 EventStream 返回一个 stopReason: "error" 的消息，不崩溃',
        '重试 3 次，全部失败后再抛异常',
      ],
      answer: 2,
      explanation: '延迟加载失败时，catch 块创建一个带有 stopReason: "error" 的 AssistantMessage，通过流协议的 error 事件通知消费者。这是 StreamFunction Contract 的要求——错误必须编码到流中，不抛出异常。',
    },
  ],

  coding: [
    {
      title: '从头实现一个最小 EventStream',
      prompt: '阅读 packages/ai/src/utils/event-stream.ts 的完整源码（89行）。然后从头实现一个简化但功能完备的 EventStream 类，支持：\n\n1. push(event) — 生产者推送事件\n2. end(result?) — 生产者结束流\n3. for await 迭代 — 消费者异步消费事件\n4. result() — 获取最终结果 Promise\n\n要求实现：双队列机制（事件缓冲队列 + 等待消费者队列）、终止检测、最终结果 Promise。',
      hint: '核心数据结构：queue: T[]（未消费事件缓冲），waiting: ((value: IteratorResult<T>) => void)[]（等待的消费者回调）。push 时先检查 waiting 是否有等待者，有则直接交付；否则入队 queue。for await 时先检查 queue，有则 yield；否则创建 Promise 加入 waiting 等待唤醒。终止事件通过构造时注入的 isComplete 回调检测。',
      answer: `// 最小 EventStream 实现 — 参考 packages/ai/src/utils/event-stream.ts
class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<R>;
  private resolveFinalResult!: (result: R) => void;
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  constructor(
    isComplete: (event: T) => boolean,
    extractResult: (event: T) => R,
  ) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  // 生产者 API：非阻塞推送事件
  push(event: T): void {
    if (this.done) return;
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });  // 直接交付
    } else {
      this.queue.push(event);                  // 入队缓冲
    }
  }

  // 生产者 API：结束流，唤醒所有等待者
  end(result?: R): void {
    this.done = true;
    if (result !== undefined) this.resolveFinalResult(result);
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

  // 消费者 API：for await (const event of stream)
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>(
          (resolve) => this.waiting.push(resolve),
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }

  // 获取最终结果
  result(): Promise<R> { return this.finalResultPromise; }
}

// 验证：传递数字 1-10，以 >=10 为终止条件
const stream = new EventStream<number, number>(
  (n) => n >= 10,
  (n) => n,
);
(async () => {
  for (let i = 1; i <= 10; i++) {
    await new Promise(r => setTimeout(r, 10));
    stream.push(i);
  }
})();
(async () => {
  for await (const n of stream) console.log(n); // 1,2,...,10
  console.log('final:', await stream.result()); // 10
})();`,
      explanation: '这个实现展示了 EventStream 的三个核心机制：(1) 生产者-消费者彻底解耦——push 不阻塞，for await 不轮询；(2) 双队列互斥——同一时刻要么有等待的消费者（queue 为空），要么有缓冲的事件（waiting 为空）；(3) 终止检测由构造时注入回调处理，与业务逻辑完全分离。真实代码在 event-stream.ts，建议对比阅读 AssistantMessageEventStream 子类（第 69-83 行）。',
    },
    {
      title: '实现一个模拟 LLM Provider',
      prompt: '阅读 packages/ai/src/providers/anthropic.ts 或 openai-completions.ts 中任意一个 Provider 的 stream 函数实现。理解 Provider 的核心职责：接收 model + context，发起 HTTP 请求，解析 SSE/JSON 事件，推入 EventStream。\n\n然后用 EventStream 实现一个模拟 Provider——不发起真实网络请求，而是构造 fake 事件序列（start → text_delta × N → done），模拟一次完整的 LLM 流式响应。\n\n要求：如果 context 中有 tools 定义，需要在事件序列中插入 toolcall_start/delta/end 事件。',
      hint: 'StreamFunction 签名为 (model, context, options) => AsyncIterable<AssistantMessageEvent>。context.tools 是工具定义数组。每次 push 时需要构造包含 content 数组的 partial AssistantMessage 对象。事件类型参考 packages/ai/src/types.ts 中的 AssistantMessageEvent 联合类型。',
      answer: `// 模拟 LLM Provider — 演示 StreamFunction 契约
// 文件参考: packages/ai/src/providers/anthropic.ts (真实 HTTP + SSE 解析)
//           packages/ai/src/types.ts (AssistantMessageEvent 类型定义)
function createMockProvider() {
  return function streamMock(
    model: { id: string },
    context: { messages: { role: string; content: string }[]; tools?: any[] },
    options?: { temperature?: number },
  ): AsyncIterable<any> {
    const stream = new (require('./event-stream').AssistantMessageEventStream)();
    const hasTools = context.tools && context.tools.length > 0;

    (async () => {
      const base: any = {
        role: 'assistant', content: [], api: 'mock',
        provider: 'mock', model: model.id,
        stopReason: hasTools ? 'toolUse' : 'stop',
        usage: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      };

      // 1. start 事件
      stream.push({ type: 'start', partial: { ...base } });

      // 2. 模拟逐字符输出（token-by-token）
      const text = '根据代码分析，此函数复杂度为 O(n log n)。';
      let acc = '';
      for (const ch of text) {
        await new Promise(r => setTimeout(r, 20));
        acc += ch;
        stream.push({
          type: 'text_delta', contentIndex: 0, delta: ch,
          partial: { ...base, content: [{ type: 'text', text: acc }] },
        });
      }

      // 3. 如果有工具定义，模拟 tool call 的增量传输
      if (hasTools) {
        const args = '{"filePath":"/src/utils.ts"}';
        let argAcc = '';
        for (const ch of args) {
          await new Promise(r => setTimeout(r, 10));
          argAcc += ch;
          stream.push({
            type: 'toolcall_delta', contentIndex: 1, delta: ch,
            partial: { ...base, content: [
              { type: 'text', text: acc },
              { type: 'tool_use', id: 't1', name: context.tools![0].name, input: {} },
            ]},
          });
        }
      }

      // 4. done 事件 — 携带完整的 AssistantMessage
      const msg: any = { ...base,
        content: [{ type: 'text', text: acc }],
        usage: { input: 10, output: acc.length, cacheRead: 0, cacheWrite: 0 },
      };
      stream.push({ type: 'done', reason: hasTools ? 'toolUse' : 'stop', message: msg });
      stream.end(msg);
    })();

    return stream;
  };
}`,
      explanation: '这个模拟 Provider 展示了 StreamFunction 契约的核心：(1) 返回 AsyncIterable，Consumer 通过 for await 消费；(2) 事件严格按 start → ...delta... → done 的顺序；(3) 每个事件携带 partial AssistantMessage 快照，让 UI 可以增量渲染；(4) 错误不抛异常，通过 error 事件传递。真实 Provider（如 anthropic.ts）只是把字符串输出替换为 HTTP SSE 解析，其余结构完全一致。',
    },
    {
      title: '实现 createLazyStream 延迟加载模式',
      prompt: '阅读 packages/ai/src/providers/register-builtins.ts 中 createLazyStream 函数（第 162-181 行）和 forwardStream 函数（第 132-139 行）的源码。然后编写一个 createLazyProvider 包装函数，实现以下功能：\n\n1. 接收 loadModule 函数（返回 Promise<Provider>）\n2. 返回与原 Provider 签名相同的函数\n3. 首次调用时触发 loadModule()，后续调用复用 Promise 缓存\n4. 加载成功后通过类似 forwardStream 的机制将事件转发\n5. 加载失败时返回一个包含 error 事件的流\n\n要求：(a) Promise 缓存用 ||= 模式；(b) 立即返回外层流不阻塞调用方；(c) 错误不走 throw 而走流协议。',
      hint: '核心模式：const outer = new EventStream(); loadModule().then(real => forwardEvents(outer, real.stream(...))).catch(err => outer.push(errorEvent)); return outer;。Promise 缓存用 let p; p ||= loadModule(); 保证并发安全。forwardStream 源码位于 register-builtins.ts 第 132 行。',
      answer: `// createLazyStream 完整模式
// 文件参考: packages/ai/src/providers/register-builtins.ts
//   createLazyStream:   第 162-181 行
//   forwardStream:      第 132-139 行
//   Promise 缓存模式:   第 94-217 行（loadXxxProviderModule 函数们）

function createLazyProvider(
  loadModule: () => Promise<{ stream: (m: any, c: any, o?: any) => AsyncIterable<any> }>,
): (model: any, context: any, options?: any) => AsyncIterable<any> {
  // Promise 缓存在闭包中，确保只加载一次
  let modulePromise: ReturnType<typeof loadModule> | undefined;

  return (model, context, options) => {
    // ① 立即创建外层 EventStream
    const outer = new (require('./event-stream').AssistantMessageEventStream)();

    const getModule = () => {
      modulePromise ||= loadModule();  // ② ||= 确保并发安全
      return modulePromise;
    };

    getModule()
      .then((module) => {
        // ③ 加载成功：创建内层流 → 桥接到外层（forwardStream 等价实现）
        const inner = module.stream(model, context, options);
        (async () => {
          for await (const event of inner) {
            outer.push(event);
          }
          outer.end();
        })();
      })
      .catch((error) => {
        // ④ 加载失败：错误编码到流中，不抛异常
        const errMsg = {
          role: 'assistant', content: [],
          stopReason: 'error' as const,
          errorMessage: error instanceof Error ? error.message : String(error),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          timestamp: Date.now(),
        };
        outer.push({ type: 'error', reason: 'error', error: errMsg });
        outer.end(errMsg);
      });

    return outer;  // ⑤ 立即返回，不阻塞调用方
  };
}

// 验证：并发调用只触发一次加载
let loadCount = 0;
const lazyStream = createLazyProvider(async () => {
  loadCount++;
  await new Promise(r => setTimeout(r, 50));
  return { stream: async function* () { yield { type: 'done' }; } };
});

const [s1, s2, s3] = [
  lazyStream({ id: 't' }, { messages: [] }),
  lazyStream({ id: 't' }, { messages: [] }),
  lazyStream({ id: 't' }, { messages: [] }),
];
await Promise.all([
  (async () => { for await (const e of s1) {} })(),
  (async () => { for await (const e of s2) {} })(),
  (async () => { for await (const e of s3) {} })(),
]);
console.log('Load count:', loadCount); // => 1`,
      explanation: 'createLazyStream 是 Pi 延迟加载的核心，位于 register-builtins.ts。三个关键设计：(1) Promise 缓存在闭包中，||= 保证并发调用只触发一次 import()；(2) 外层流立即返回，Consumer 可以提前开始 for await 迭代；(3) forwardStream（fire-and-forget 模式）异步桥接两层 EventStream，错误通过流协议传递而非 throw。建议完整阅读 register-builtins.ts 第 132-204 行以理解全部细节。',
    },
  ],
  summary: [
    'Provider 抽象层是 Agent 的"万能遥控器"：用一套统一接口对接 9 种 API 类型、35 个 Provider、900+ 个模型',
    'streamSimple() 是所有 Provider 的统一调用入口，返回值始终是 AssistantMessageEventStream',
    'Provider 注册表是一个 Map<Api, Provider>，按 API 类型查找对应的适配实现',
    '延迟加载（createLazyStream）通过动态 import() 按需加载 Provider SDK，减少启动时间和内存占用',
    '所有 Provider 输出统一的 AssistantMessageEvent 协议：start → text/thinking/toolcall 事件 → done/error',
    'EventStream 是核心异步通信原语，实现了生产者-消费者解耦，支持 for await 迭代和 result() Promise',
    '不同 Provider 的参数格式差异巨大（如 Thinking 有 8 种格式），抽象层将其统一封装',
  ],
});
