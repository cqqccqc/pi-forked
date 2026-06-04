/**
 * 第8章：扩展系统 — 打造可定制的 Agent
 *
 * 深入理解事件驱动的插件架构——扩展如何在不修改核心代码的情况下
 * 介入 Agent 的各个生命周期，添加自定义工具、命令和逻辑。
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 8,
  title: '扩展系统：打造可定制的 Agent',
  desc: '理解事件驱动的插件架构——扩展如何在不修改核心代码的情况下介入 Agent 的各个生命周期。',

  objectives: [
    '理解事件驱动的扩展架构设计理念',
    '掌握扩展的发现和加载流程（ExtensionLoader）',
    '了解 ExtensionRunner 的事件分发机制',
    '了解 PackageManager 的资源管理',
    '知道如何编写一个简单扩展——注册自定义工具',
  ],

  render(container) {
    // === Section 1: 为什么需要扩展系统 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>8.1 为什么需要扩展系统</h2>
      <p>一个 Coding Agent 的核心代码只能提供基础能力：读写文件、执行命令、搜索代码。但用户的需求千差万别——有人需要数据库查询工具，有人需要 JIRA 集成，有人需要自定义的代码审查流程。</p>

      <div class="info-card">
        <h4>🔌 扩展系统 = 不给核心改代码，就能加功能</h4>
        <p>扩展系统提供了一个标准化的"插槽"，让第三方（包括你自己）可以在不修改 Pi Agent 源代码的情况下，给 Agent 添加新的工具、命令、快捷键，甚至修改 Agent 的行为。</p>
      </div>

      <p>Pi Agent 的扩展系统设计遵循四个核心原则：</p>
      <table class="content-table">
        <tr><th>原则</th><th>含义</th><th>实现方式</th></tr>
        <tr><td>事件驱动</td><td>扩展通过订阅事件参与生命周期</td><td>20+ 个事件类型覆盖所有阶段</td></tr>
        <tr><td>弱耦合</td><td>扩展通过定义良好的接口与核心通信</td><td>ExtensionAPI 接口</td></tr>
        <tr><td>热重载</td><td>运行时重新加载扩展无需重启</td><td>invalidate 机制 + 上下文惰性求值</td></tr>
        <tr><td>错误隔离</td><td>单个扩展的错误不影响其他扩展和核心系统</td><td>try-catch 包裹每个 handler</td></tr>
      </table>
    `;
    container.appendChild(s1);

    // === Section 2: 扩展架构 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>8.2 扩展架构：两大核心组件</h2>
      <p>扩展系统由两个核心组件组成：<strong>ExtensionLoader</strong>（加载器）和 <strong>ExtensionRunner</strong>（运行时）。</p>

      <h3>ExtensionLoader —— 模块加载器</h3>
      <p>负责发现和加载扩展模块。它扫描指定目录，找到扩展入口点，通过 jiti 动态导入 TypeScript/JavaScript 模块。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/loader.ts</span></div>
        <pre><code class="language-typescript">// 扩展发现：扫描目录中的扩展文件
function discoverExtensionsInDir(dir: string): string[] {
  // 1. Direct files: *.ts 或 *.js → 直接加载
  // 2. Subdirectory with index: */index.ts 或 index.js → 加载
  // 3. Subdirectory with package.json: 'pi' manifest → 加载声明内容
}

// 扩展加载：发现 + 加载
export async function discoverAndLoadExtensions(
  configuredPaths: string[],
  cwd: string,
  agentDir: string,
): Promise&lt;LoadExtensionsResult&gt; {
  // 1. Project-local: cwd/.pi/extensions/
  // 2. Global: ~/.pi/extensions/
  // 3. Explicitly configured paths
  // 4. Inline extension factories
}</code></pre>
      </div>

      <h3>ExtensionRunner —— 事件分发器</h3>
      <p>负责将 Agent 事件分发给已加载的扩展，管理扩展的生命周期。它是扩展系统的"心脏"：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts</span></div>
        <pre><code class="language-typescript">export class ExtensionRunner {
  private extensions: Extension[];        // 已加载的扩展列表
  private runtime: ExtensionRuntime;      // 共享运行时（所有扩展共用）

  // 核心方法
  bindCore(actions, contextActions): void;  // 绑定核心动作
  createContext(): ExtensionContext;        // 创建事件处理上下文
  createCommandContext(): ExtensionCommandContext; // 创建命令处理上下文

  // 事件分发方法
  emit(event): Promise;               // 通用事件分发
  emitToolCall(event): Promise;        // 工具调用前分发
  emitToolResult(event): Promise;      // 工具结果分发
  emitContext(messages): Promise;      // 上下文修改分发
  emitBeforeAgentStart(...): Promise;  // Agent 启动前分发
}</code></pre>
      </div>

      <p>架构全景图：</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ 事件驱动的扩展架构</div>
      </div>
      <p>核心系统在上层发出事件，扩展在下层订阅感兴趣的事件并作出响应。所有扩展共享同一个 ExtensionRuntime，减少内存开销。</p>
    `;
    container.appendChild(s2);

    // Render the diagram
    const diagramDiv = s2.querySelector('.diagram-container');
    Diagrams.drawExtensionArch(diagramDiv);

    // === Section 3: 扩展的发现和加载 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>8.3 扩展的发现和加载</h2>

      <h3>8.3.1 扩展发现路径</h3>
      <p>Pi Agent 从以下四个层级发现扩展，优先级从高到低：</p>
      <div class="step-list">
        <li>
          <h4>项目本地扩展</h4>
          <p><code>.pi/extensions/</code> —— 仅对当前项目生效。团队可以将项目特定的扩展放在这里，通过 Git 共享</p>
        </li>
        <li>
          <h4>全局扩展</h4>
          <p><code>~/.pi/extensions/</code> —— 对所有项目生效。适合个人常用的通用扩展</p>
        </li>
        <li>
          <h4>配置路径</h4>
          <p>在 <code>.pi/settings.json</code> 中显式配置的扩展路径</p>
        </li>
        <li>
          <h4>内联扩展</h4>
          <p>通过代码直接传入的扩展工厂函数（<code>ExtensionFactory[]</code>）</p>
        </li>
      </div>

      <h3>8.3.2 扩展加载流程</h3>
      <p>每个扩展的加载都经过相同的流水线：</p>
      <div class="step-list">
        <li>
          <h4>1. 发现入口</h4>
          <p>扫描目录，找到扩展的入口文件（.ts / .js / index.ts / package.json pi manifest）</p>
        </li>
        <li>
          <h4>2. 创建 Extension 对象</h4>
          <p>创建一个空的 Extension 对象，包含 handlers、tools、commands 等空 Map</p>
        </li>
        <li>
          <h4>3. 创建 ExtensionAPI</h4>
          <p>为扩展创建一个 API 对象，注册方法（registerTool、on 等）写入 Extension 对象，动作方法（sendMessage 等）委托给共享运行时</p>
        </li>
        <li>
          <h4>4. 调用工厂函数</h4>
          <p>用 jiti 动态导入模块，调用 <code>export default function(pi)</code>，传入 ExtensionAPI</p>
        </li>
        <li>
          <h4>5. 绑定核心</h4>
          <p>ExtensionRunner.bindCore() 将所有动作方法写入共享运行时，刷新待处理的 Provider 注册</p>
        </li>
      </div>

      <p>核心代码展示了这个流程：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/loader.ts</span></div>
        <pre><code class="language-typescript">export async function loadExtensions(
  paths: string[], cwd: string, eventBus?: EventBus
): Promise&lt;LoadExtensionsResult&gt; {
  const runtime = createExtensionRuntime();

  for (const extPath of paths) {
    const factory = await loadExtensionModule(extPath);  // jiti 导入
    if (!factory) continue;

    const extension = createExtension(extPath, extPath);  // 创建空对象
    const api = createExtensionAPI(extension, runtime, cwd, eventBus);
    await factory(api);  // 调用 export default function(pi)
    extensions.push(extension);
  }

  return { extensions, errors, runtime };
}</code></pre>
      </div>
    `;
    container.appendChild(s3);

    // === Section 4: 扩展事件系统 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>8.4 事件驱动的生命周期</h2>
      <p>扩展通过订阅事件来参与 Agent 的各个生命周期阶段。Pi Agent 提供了覆盖完整生命周期的 20+ 个事件类型：</p>

      <h3>8.4.1 核心生命周期事件</h3>
      <table class="content-table">
        <tr><th>类别</th><th>事件</th><th>触发时机</th><th>扩展可以做什么</th></tr>
        <tr><td>会话</td><td><code>session_start</code></td><td>会话启动/重载</td><td>初始化状态</td></tr>
        <tr><td>会话</td><td><code>session_before_compact</code></td><td>上下文压缩前</td><td>取消压缩或提供自定义压缩</td></tr>
        <tr><td>会话</td><td><code>session_shutdown</code></td><td>退出/重载/切换前</td><td>清理资源</td></tr>
        <tr><td>Agent</td><td><code>before_agent_start</code></td><td>LLM 调用前</td><td>修改 System Prompt（链式传递）</td></tr>
        <tr><td>Agent</td><td><code>context</code></td><td>每次 LLM 调用前</td><td>修改消息列表</td></tr>
        <tr><td>Agent</td><td><code>before_provider_request</code></td><td>HTTP 请求前</td><td>修改请求 payload</td></tr>
        <tr><td>工具</td><td><code>tool_call</code></td><td>工具调用前</td><td>阻止执行或修改参数（就地修改 event.input）</td></tr>
        <tr><td>工具</td><td><code>tool_result</code></td><td>工具执行后</td><td>修改工具结果</td></tr>
        <tr><td>消息</td><td><code>message_end</code></td><td>消息结束</td><td>替换最终消息</td></tr>
        <tr><td>输入</td><td><code>input</code></td><td>用户输入</td><td>转换或拦截输入</td></tr>
      </table>

      <h3>8.4.2 事件流转过程</h3>
      <p>当一个事件发生时，它沿着固定的路径流转：</p>
      <div class="step-list">
        <li>
          <h4>1. Agent 核心发出事件</h4>
          <p>Agent Loop 或 AgentSession 在适当的时机发出事件对象</p>
        </li>
        <li>
          <h4>2. ExtensionRunner 接收事件</h4>
          <p>根据事件类型调用对应的专用 emit 方法（如 emitToolCall、emitBeforeAgentStart）或通用 emit 方法</p>
        </li>
        <li>
          <h4>3. 遍历所有扩展</h4>
          <p>按加载顺序遍历每个扩展，查找订阅了该事件类型的 handler</p>
        </li>
        <li>
          <h4>4. 执行 handler</h4>
          <p>依次调用每个 handler，传入事件对象和上下文。支持异步操作</p>
        </li>
        <li>
          <h4>5. 收集结果</h4>
          <p>不同事件有不同的结果处理方式：
            <code>tool_call</code> 的 block 可阻止执行；
            <code>tool_result</code> 可修改内容；
            <code>before_agent_start</code> 的 systemPrompt 会链式传递到下一个扩展</p>
        </li>
        <li>
          <h4>6. 错误隔离</h4>
          <p>每个 handler 执行都包裹在 try-catch 中，单个扩展出错不影响后续扩展和核心系统</p>
        </li>
      </div>

      <h3>8.4.3 链式传递：before_agent_start</h3>
      <p>多个扩展都可以修改 System Prompt。它们的修改是<strong>链式传递</strong>的——扩展 B 看到的 systemPrompt 包含了扩展 A 的修改：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts — emitBeforeAgentStart</span></div>
        <pre><code class="language-typescript">async emitBeforeAgentStart(prompt, images, systemPrompt, systemPromptOptions) {
  let currentSystemPrompt = systemPrompt;  // 初始值

  for (const ext of this.extensions) {
    for (const handler of ext.handlers.get("before_agent_start") ?? []) {
      const event = {
        type: "before_agent_start",
        prompt, images,
        systemPrompt: currentSystemPrompt,  // 传入当前累积值
        systemPromptOptions,
      };
      const result = await handler(event, ctx);
      if (result?.systemPrompt !== undefined) {
        currentSystemPrompt = result.systemPrompt;  // 更新累积值
      }
    }
  }
}</code></pre>
      </div>
    `;
    container.appendChild(s4);

    // === Section 5: 注册机制 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>8.5 扩展能注册什么</h2>
      <p>通过 <code>ExtensionAPI</code>（即工厂函数中的 <code>pi</code> 参数），扩展可以注册多种类型的资源：</p>

      <table class="content-table">
        <tr><th>注册方法</th><th>注册内容</th><th>用途</th></tr>
        <tr><td><code>registerTool()</code></td><td>LLM 可调用的工具</td><td>添加自定义工具，如数据库查询、API 调用</td></tr>
        <tr><td><code>registerCommand()</code></td><td>斜杠命令</td><td>添加 /my-command 形式的用户命令</td></tr>
        <tr><td><code>registerShortcut()</code></td><td>键盘快捷键</td><td>绑定快捷键到自定义操作</td></tr>
        <tr><td><code>registerFlag()</code></td><td>CLI 标志</td><td>添加 --my-flag 形式的命令行参数</td></tr>
        <tr><td><code>registerMessageRenderer()</code></td><td>自定义消息渲染器</td><td>自定义 TUI 中消息的显示方式</td></tr>
        <tr><td><code>registerProvider()</code></td><td>LLM Provider</td><td>注册自定义的 LLM 服务（含 OAuth 支持）</td></tr>
        <tr><td><code>on(event, handler)</code></td><td>事件处理器</td><td>订阅生命周期事件</td></tr>
      </table>

      <h3>ExtensionContext：扩展的运行时上下文</h3>
      <p>事件处理器收到的 <code>ctx</code> 对象提供了丰富的运行时信息和方法：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/types.ts</span></div>
        <pre><code class="language-typescript">export interface ExtensionContext {
  ui: ExtensionUIContext;            // UI 交互（对话框、通知等）
  mode: "tui" | "rpc" | "json" | "print";  // 运行模式
  hasUI: boolean;                    // 是否有 UI 能力
  cwd: string;                       // 当前工作目录
  sessionManager: ReadonlySessionManager;  // 会话管理（只读）
  model: Model&lt;any&gt; | undefined;     // 当前模型
  isIdle(): boolean;                 // Agent 是否空闲
  signal: AbortSignal | undefined;    // 中止信号
  abort(): void;                     // 中止当前操作
  shutdown(): void;                  // 优雅退出
  getContextUsage(): ContextUsage | undefined;  // 上下文使用情况
  compact(options?): void;           // 触发压缩
  getSystemPrompt(): string;         // 获取当前 System Prompt
}</code></pre>
      </div>

      <div class="info-card">
        <h4>💡 关键设计：惰性求值</h4>
        <p>ctx 对象的属性使用 <strong>getter（属性描述符）</strong> 而非对象展开。这意味着每次访问属性时都会实时获取最新值，并且经过 <code>assertActive()</code> 检查——确保在会话替换或重载后，不会意外使用过时的上下文。</p>
      </div>
    `;
    container.appendChild(s5);

    // === Section 6: jiti 动态导入 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>8.6 jiti：为什么不用 Node.js 原生 import</h2>
      <p>扩展模块需要在运行时动态加载。虽然 Node.js 支持动态 <code>import()</code>，但 Pi Agent 选择了 <a href="https://github.com/unjs/jiti" target="_blank">jiti</a>，原因如下：</p>

      <table class="content-table">
        <tr><th>需求</th><th>原生 import()</th><th>jiti</th></tr>
        <tr><td>TypeScript 原生支持</td><td>需要 tsx/ts-node 等额外工具</td><td>内置 TypeScript 编译，零配置</td></tr>
        <tr><td>Bun 二进制模式</td><td>Bun 的模块解析与 Node 不同</td><td>virtualModules 选项提供预打包依赖</td></tr>
        <tr><td>模块缓存控制</td><td>缓存策略有限</td><td>moduleCache: false 确保每次加载最新</td></tr>
        <tr><td>别名解析</td><td>需要 import maps 等</td><td>alias 选项直接映射包名到文件路径</td></tr>
      </table>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/loader.ts</span></div>
        <pre><code class="language-typescript">async function loadExtensionModule(extensionPath: string) {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,             // 禁用缓存，确保热重载
    // Bun 二进制模式: 使用 virtualModules（预打包依赖）
    // Node.js 开发模式: 使用 alias（解析到 node_modules）
    ...(isBunBinary
      ? { virtualModules: VIRTUAL_MODULES, tryNative: false }
      : { alias: getAliases() }
    ),
  });

  const module = await jiti.import(extensionPath, { default: true });
  return typeof module !== "function" ? undefined : module;
}</code></pre>
      </div>

      <p>在 Bun 二进制模式下，扩展可以使用的 npm 包（typebox、pi-agent-core、pi-tui、pi-ai 等）被预打包为虚拟模块，无需从文件系统或 npm registry 解析。这使得 Pi Agent 可以作为一个<strong>单文件二进制</strong>分发，同时仍然支持加载 TypeScript 扩展。</p>
    `;
    container.appendChild(s6);

    // === Section 7: PackageManager ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>8.7 PackageManager：将 npm 包变成扩展来源</h2>
      <p>除了本地文件，扩展还可以来自 npm 包或 Git 仓库。这由 <strong>PackageManager</strong>（<code>packages/coding-agent/src/core/package-manager.ts</code>）统一管理。</p>

      <h3>支持的包类型</h3>
      <div class="code-block">
        <div class="code-label">包类型的引用语法</div>
        <pre><code class="language-plaintext"># NPM 包
"npm:package-name"           # 最新版本
"npm:package-name@1.2.3"     # 固定版本

# Git 仓库
"github:user/repo"           # 默认分支
"github:user/repo@v1.0.0"    # 特定标签

# 本地路径
"./my-extension"             # 相对路径
"/absolute/path"             # 绝对路径</code></pre>
      </div>

      <h3>package.json 的 pi manifest</h3>
      <p>扩展包可以在 <code>package.json</code> 中通过 <code>pi</code> 字段声明自己提供的资源：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">package.json</span></div>
        <pre><code class="language-json">{
  "pi": {
    "extensions": ["./dist/main.js"],
    "skills": ["./skills/**/*.md"],
    "prompts": ["./prompts/**/*.md"],
    "themes": ["./themes/*.json"]
  }
}</code></pre>
      </div>

      <p>模式语法支持精细的资源控制：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:16px;">
        <li><strong>普通模式</strong>：<code>*.md</code> 包含所有匹配文件</li>
        <li><strong>排除模式</strong>：<code>!test.md</code> 排除匹配文件</li>
        <li><strong>强制包含</strong>：<code>+specific.md</code> 覆盖排除规则</li>
        <li><strong>强制排除</strong>：<code>-unwanted.md</code> 覆盖包含规则</li>
      </ul>
    `;
    container.appendChild(s7);

    // === Section 8: 动手示例 ===
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>8.8 动手写一个扩展</h2>
      <p>让我们来写一个简单的扩展——注册一个"时间查询"工具，让 Agent 能告诉用户当前时间：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">.pi/extensions/time-tool.ts</span></div>
        <pre><code class="language-typescript">import { Type } from "@sinclair/typebox";

export default function timeExtension(pi) {
  // 注册工具：告诉 LLM 这个工具的描述、参数和执行逻辑
  pi.registerTool({
    name: "get_current_time",
    label: "Get Current Time",
    description: "Get the current time in the specified timezone",
    promptSnippet: "Get current time in any timezone",
    parameters: Type.Object({
      timezone: Type.Optional(
        Type.String({ default: "UTC" })
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const timezone = params.timezone || "UTC";
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      return {
        content: [{
          type: "text",
          text: \`Current time in \${timezone}: \${timeStr}\`
        }],
        details: { timezone, iso: now.toISOString() },
      };
    },
  });

  // 订阅事件：在 Agent 启动时记录日志
  pi.on("agent_start", async (event, ctx) => {
    // 在开发模式下打印日志
    if (ctx.mode === "tui") {
      ctx.ui.notify("Time tool extension is active", "info");
    }
  });
}</code></pre>
      </div>

      <h3>关键要点</h3>
      <div class="step-list">
        <li>
          <h4>参数定义用 TypeBox</h4>
          <p>使用 <code>Type.Object({...})</code> 定义工具的 JSON Schema 参数。这会被发送给 LLM，LLM 根据 schema 生成正确的参数</p>
        </li>
        <li>
          <h4>execute 函数签名</h4>
          <p><code>execute(toolCallId, params, signal, onUpdate, ctx)</code> —— signal 用于响应中止，onUpdate 用于流式更新，ctx 提供运行时上下文</p>
        </li>
        <li>
          <h4>返回值格式</h4>
          <p>返回 <code>{ content: [{ type: "text", text: "..." }], details: {...} }</code>。content 会发给 LLM，details 用于 UI 展示</p>
        </li>
        <li>
          <h4>通过工厂函数导出</h4>
          <p>扩展必须 <code>export default</code> 一个函数（工厂函数）。这个函数接收 <code>pi</code>（ExtensionAPI）作为参数</p>
        </li>
      </div>

      <div class="info-card tip">
        <h4>🎯 放置扩展文件</h4>
        <p>将上面的 <code>time-tool.ts</code> 放到 <code>.pi/extensions/</code> 目录下，重启 Pi Agent（或执行 <code>/reload</code>），Agent 就能使用这个新工具了。无需修改任何核心代码。</p>
      </div>
    `;
    container.appendChild(s8);

    // === Section 9: 上下文失效机制 ===
    const s9 = document.createElement('div');
    s9.className = 'content-section';
    s9.innerHTML = `
      <h2>8.9 安全机制：上下文失效与错误隔离</h2>

      <h3>8.9.1 上下文失效（invalidate）</h3>
      <p>当用户在扩展命令中执行 <code>ctx.newSession()</code>、<code>ctx.fork()</code>、<code>ctx.switchSession()</code> 或 <code>ctx.reload()</code> 后，旧的 ctx 对象会变为"过时"状态。任何对旧 ctx 的访问都会抛出异常：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts</span></div>
        <pre><code class="language-typescript">invalidate(message?: string): void {
  if (!this.staleMessage) {
    this.staleMessage = message ??
      "This extension ctx is stale after session replacement or reload...";
    this.runtime.invalidate(message);
  }
}

private assertActive(): void {
  if (this.staleMessage) {
    throw new Error(this.staleMessage);
  }
}</code></pre>
      </div>

      <p>正确的做法是使用 <code>withSession</code> 回调中提供的新上下文：</p>
      <div class="code-block">
        <div class="code-label">正确 vs 错误用法</div>
        <pre><code class="language-typescript">// ❌ 错误：在 newSession 后使用旧的 ctx
await ctx.newSession({ withSession: async (newCtx) => {
  ctx.ui.notify("This will throw!");  // 错误！ctx 已过时
}});

// ✅ 正确：使用 withSession 提供的新上下文
await ctx.newSession({ withSession: async (newCtx) => {
  newCtx.ui.notify("This works!");  // 正确！
}});</code></pre>
      </div>

      <h3>8.9.2 错误隔离</h3>
      <p>扩展系统中的每个 handler 执行都包裹在独立的 try-catch 中。单个扩展的错误会被捕获并通过 <code>emitError</code> 分发给错误监听器，不会中断其他扩展或核心系统：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts — emit()</span></div>
        <pre><code class="language-typescript">for (const ext of this.extensions) {
  for (const handler of ext.handlers.get(event.type) ?? []) {
    try {
      const result = await handler(event, ctx);
      // 处理结果...
    } catch (err) {
      this.emitError({
        extensionPath: ext.path,
        event: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
      // 继续下一个扩展，不中断
    }
  }
}</code></pre>
      </div>
    `;
    container.appendChild(s9);

    // === Section 10: 深入：事件分发完整实现 ===
    const s10 = document.createElement('div');
    s10.className = 'content-section';
    s10.innerHTML = `
      <h2>8.10 深入：ExtensionRunner 的事件分发完整实现</h2>
      <p>在 8.2 节中我们看到了 ExtensionRunner 的概览，在 8.4 节中了解了事件流转的理论。现在让我们深入源码，看 <code>emit()</code> 和 <code>emitBeforeAgentStart()</code> 的完整实现细节。</p>

      <h3>8.10.1 通用事件分发：emit()</h3>
      <p><code>emit()</code> 是事件分发的核心方法。它的设计要解决三个问题：<strong>遍历所有扩展</strong>、<strong>错误隔离</strong>、<strong>结果收集</strong>。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts — emit()</span></div>
        <pre><code class="language-typescript">async emit&lt;TEvent extends RunnerEmitEvent&gt;(event: TEvent): Promise&lt;RunnerEmitResult&lt;TEvent&gt;&gt; {
  const ctx = this.createContext();           // ① 创建惰性求值的上下文
  let result: SessionBeforeEventResult | undefined;

  // ② 遍历所有扩展（外层循环）
  for (const ext of this.extensions) {
    const handlers = ext.handlers.get(event.type);
    if (!handlers || handlers.length === 0) continue;  // 跳过无 handler 的扩展

    // ③ 遍历扩展内所有 handler（内层循环）
    for (const handler of handlers) {
      try {
        // ④ 执行 handler，传入事件和上下文
        const handlerResult = await handler(event, ctx);

        // ⑤ 收集结果：仅 session_before_* 事件有返回值
        if (this.isSessionBeforeEvent(event) && handlerResult) {
          result = handlerResult as SessionBeforeEventResult;
          if (result.cancel) {
            // cancel = true → 立即返回，不再执行后续 handler
            return result as RunnerEmitResult&lt;TEvent&gt;;
          }
        }
      } catch (err) {
        // ⑥ 错误隔离：捕获异常，通知监听器，继续下一个 handler
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.emitError({
          extensionPath: ext.path,
          event: event.type,
          error: message,
          stack,
        });
        // ⚠️ 不 return，不 break——继续处理下一个 handler
      }
    }
  }

  return result as RunnerEmitResult&lt;TEvent&gt;;
}</code></pre>
      </div>

      <p>这个方法的精妙之处在于三个设计决策：</p>
      <table class="content-table">
        <tr><th>设计决策</th><th>代码体现</th><th>原因</th></tr>
        <tr>
          <td>双重循环结构</td>
          <td><code>for (ext of extensions)</code> → <code>for (handler of handlers)</code></td>
          <td>扩展之间独立，同一扩展的 handler 按注册顺序执行。外层遍历扩展保证先加载的扩展先处理</td>
        </tr>
        <tr>
          <td>错误不传播</td>
          <td>catch 块中只调用 <code>emitError()</code>，不 rethrow</td>
          <td>单个扩展的 bug 不能影响其他扩展或核心系统。错误通过 <code>onError</code> 监听器暴露给用户</td>
        </tr>
        <tr>
          <td>cancel 即短路</td>
          <td><code>if (result.cancel) return result</code></td>
          <td>session_before_switch/fork/compact/tree 事件允许扩展取消操作。一旦取消，后续扩展不再执行</td>
        </tr>
      </table>

      <div class="info-card">
        <h4>为什么 ctx 在循环外创建？</h4>
        <p>注意 <code>createContext()</code> 在循环之前只调用一次，所有扩展共享同一个 ctx 对象。ctx 的属性是 getter（惰性求值），所以即使 ctx 对象是同一个，每个 handler 访问 <code>ctx.ui</code>、<code>ctx.model</code> 时都能拿到最新值。这比每次循环都创建新 ctx 更高效。</p>
      </div>

      <h3>8.10.2 链式传递：emitBeforeAgentStart()</h3>
      <p>与通用 <code>emit()</code> 不同，<code>emitBeforeAgentStart()</code> 需要实现 <strong>systemPrompt 的链式传递</strong>——每个扩展修改 systemPrompt 后，下一个扩展看到的是修改后的值。这是扩展系统中最复杂的事件分发方法：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/extensions/runner.ts — emitBeforeAgentStart()</span></div>
        <pre><code class="language-typescript">async emitBeforeAgentStart(
  prompt: string,
  images: ImageContent[] | undefined,
  systemPrompt: string,
  systemPromptOptions: BuildSystemPromptOptions,
): Promise&lt;BeforeAgentStartCombinedResult | undefined&gt; {
  // ① 保存当前 systemPrompt——随着扩展处理而动态变化
  let currentSystemPrompt = systemPrompt;
  const ctx = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(this.createContext()),
  ) as ExtensionContext;

  // ② 重写 ctx.getSystemPrompt() 以返回"当前累积值"
  ctx.getSystemPrompt = () => {
    this.assertActive();
    return currentSystemPrompt;
  };

  const messages: NonNullable&lt;BeforeAgentStartEventResult["message"]&gt;[] = [];
  let systemPromptModified = false;

  // ③ 遍历所有扩展
  for (const ext of this.extensions) {
    const handlers = ext.handlers.get("before_agent_start");
    if (!handlers || handlers.length === 0) continue;

    for (const handler of handlers) {
      try {
        // ④ 每次构造 event 时，systemPrompt 取当前累积值
        const event: BeforeAgentStartEvent = {
          type: "before_agent_start",
          prompt,
          images,
          systemPrompt: currentSystemPrompt,   // ← 链式值
          systemPromptOptions,
        };
        const handlerResult = await handler(event, ctx);

        if (handlerResult) {
          const result = handlerResult as BeforeAgentStartEventResult;
          if (result.message) {
            messages.push(result.message);
          }
          // ⑤ 更新累积值——下一个扩展将看到这个新值
          if (result.systemPrompt !== undefined) {
            currentSystemPrompt = result.systemPrompt;
            systemPromptModified = true;
          }
        }
      } catch (err) {
        // ⑥ 错误隔离：同上
        this.emitError({
          extensionPath: ext.path,
          event: "before_agent_start",
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  }

  // ⑦ 返回组合结果
  if (messages.length > 0 || systemPromptModified) {
    return {
      messages: messages.length > 0 ? messages : undefined,
      systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
    };
  }
  return undefined;
}</code></pre>
      </div>

      <p>链式传递的直观图示：</p>
      <div class="code-block">
        <div class="code-label">三个扩展依次修改 systemPrompt 的过程</div>
        <pre><code class="language-plaintext">初始 systemPrompt: "You are a coding agent."

扩展A 收到 systemPrompt: "You are a coding agent."
扩展A 返回 systemPrompt: "You are a coding agent. Use TypeScript."

扩展B 收到 systemPrompt: "You are a coding agent. Use TypeScript."
扩展B 返回 systemPrompt: "You are a coding agent. Use TypeScript. Prefer async/await."

扩展C 收到 systemPrompt: "You are a coding agent. Use TypeScript. Prefer async/await."
扩展C 返回 systemPrompt: "... (同上，没修改)"

最终 systemPrompt: "You are a coding agent. Use TypeScript. Prefer async/await."</code></pre>
      </div>

      <div class="info-card">
        <h4>为什么 ctx.getSystemPrompt() 需要重写？</h4>
        <p>在 <code>emitBeforeAgentStart()</code> 中，ctx 对象通过 <code>Object.defineProperties</code> 复制了 <code>createContext()</code> 的所有属性描述符（保持 getter 惰性），然后单独重写了 <code>getSystemPrompt()</code> 方法——使其返回 <code>currentSystemPrompt</code>（动态变量）而不是核心系统的 systemPrompt。这样扩展在 handler 中调用 <code>ctx.getSystemPrompt()</code> 时，能拿到"当前经过前面扩展修改后"的版本。</p>
      </div>

      <h3>8.10.3 三种事件分发模式的对比</h3>
      <p>ExtensionRunner 的多个 emit 方法虽然表面不同，但内部遵循三种通用模式：</p>
      <table class="content-table">
        <tr><th>模式</th><th>方法</th><th>返回值策略</th><th>链式传递</th></tr>
        <tr>
          <td><strong>通知模式</strong></td>
          <td><code>emit()</code></td>
          <td>无返回值（除 session_before_* 的 cancel）</td>
          <td>否</td>
        </tr>
        <tr>
          <td><strong>变换模式</strong></td>
          <td><code>emitContext()</code>、<code>emitBeforeProviderRequest()</code>、<code>emitMessageEnd()</code>、<code>emitToolResult()</code></td>
          <td>返回变换后的数据</td>
          <td>是（每个 handler 的输出作为下一个 handler 的输入）</td>
        </tr>
        <tr>
          <td><strong>拦截模式</strong></td>
          <td><code>emitToolCall()</code>、<code>emitInput()</code></td>
          <td>block = true 短路返回</td>
          <td>部分是（input 支持 transform）</td>
        </tr>
      </table>

      <p>这三种模式覆盖了扩展系统的所有交互场景。理解了它们，你就完全掌握了 Pi Agent 扩展系统的事件分发机制。</p>
    `;
    container.appendChild(s10);
  },

  quiz: [
    {
      question: 'Pi Agent 的扩展系统采用什么架构模式？',
      options: [
        '中间件模式（Middleware）',
        '事件驱动模式（Event-Driven）',
        '观察者模式（Observer）',
        '责任链模式（Chain of Responsibility）',
      ],
      answer: 1,
      explanation: '扩展系统采用事件驱动架构：核心系统发出事件，扩展订阅感兴趣的事件并作出响应。扩展不直接修改核心代码，通过定义良好的事件接口与核心通信。',
    },
    {
      question: '扩展加载时使用 jiti 而不是 Node.js 原生 import() 的主要原因是什么？',
      options: [
        'jiti 速度更快',
        'jiti 内置 TypeScript 支持、在 Bun 二进制模式下提供虚拟模块、支持模块缓存控制',
        'jiti 是 Node.js 官方推荐的模块加载器',
        'jiti 不需要任何依赖',
      ],
      answer: 1,
      explanation: 'jiti 提供内置 TypeScript 编译、Bun 二进制模式下的 virtualModules 支持（预打包依赖）、以及 moduleCache: false 控制，这些是原生 import() 无法直接满足的需求。',
    },
    {
      question: '扩展在 before_agent_start 事件中修改了 systemPrompt，会发生什么？',
      options: [
        '只有第一个扩展的修改生效',
        '只有最后一个扩展的修改生效',
        '修改链式传递——后续扩展看到的是前面扩展修改后的累积结果',
        '直接报错，不允许修改 systemPrompt',
      ],
      answer: 2,
      explanation: '多个扩展的 systemPrompt 修改是链式传递的。每个扩展处理时看到的 systemPrompt 是前面所有扩展修改后的累积结果，实现逐层叠加的效果。',
    },
    {
      question: '扩展的 execute 函数签名中包含 signal 参数，它的作用是什么？',
      options: [
        '发送消息给前端',
        '响应中止请求——用户按 Ctrl+C 时可以取消正在执行的操作',
        '控制工具的执行模式（并行/串行）',
        '发送调试信号',
      ],
      answer: 1,
      explanation: 'signal 是 AbortSignal 实例。当用户中断 Agent（如按 Ctrl+C）时，signal 会被触发。工具应该检查 signal.aborted 或在异步操作中传递 signal，以支持优雅取消。',
    },
  ],

  coding: [
    {
      title: '编写一个注册自定义工具的扩展',
      prompt: '编写一个扩展，注册一个名为 "random_number" 的工具，让 LLM 能生成指定范围内的随机整数。工具需要定义参数 min（最小值，默认 1）和 max（最大值，默认 100），参数使用 TypeBox 的 Type.Object 和 Type.Number 定义。',
      hint: '参考 8.8 节的示例扩展结构。使用 pi.registerTool() 注册，export default 一个工厂函数，参数定义用 @sinclair/typebox 的 Type。',
      answer: `import { Type } from "@sinclair/typebox";

export default function randomExtension(pi) {
  pi.registerTool({
    name: "random_number",
    label: "Random Number Generator",
    description: "Generate a random integer between min and max (inclusive)",
    parameters: Type.Object({
      min: Type.Optional(Type.Number({ default: 1 })),
      max: Type.Optional(Type.Number({ default: 100 })),
    }),
    async execute(toolCallId, params, signal) {
      const min = Math.ceil(params.min ?? 1);
      const max = Math.floor(params.max ?? 100);
      const value = Math.floor(Math.random() * (max - min + 1)) + min;
      return {
        content: [{
          type: "text",
          text: \`Random number between \${min} and \${max}: \${value}\`,
        }],
        details: { min, max, value },
      };
    },
  });
}`,
      explanation: '和 8.8 节的 time-tool 扩展结构完全一致：export default 工厂函数 → pi.registerTool() → 定义 name/description/parameters → 实现 execute。TypeBox 的参数定义会被转换为 JSON Schema 发送给 LLM。execute 返回 { content, details } 格式。',
    },
    {
      title: '编写一个事件监听扩展',
      prompt: '编写一个扩展，监听 tool_call 事件，当 LLM 尝试调用 bash 工具执行包含 "rm -rf" 的命令时，阻止执行并返回安全警告。',
      hint: '使用 pi.on("tool_call", handler) 订阅事件。tool_call 事件的 event 对象包含 toolName 和 input 字段。handler 返回 { block: true, reason: "..." } 可以阻止执行。',
      answer: `export default function safetyExtension(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = event.input.command;
      // 检查危险命令模式
      if (/rm\\s+-rf|sudo\\s+rm|dd\\s+if=|mkfs\\./.test(cmd)) {
        return {
          block: true,
          reason: \`Safety: blocked potentially destructive command: \${cmd}\`,
        };
      }
    }
    // 返回 undefined 或不返回 → 允许执行
  });
}`,
      explanation: 'tool_call 事件的 handler 返回 { block: true } 可以阻止工具执行。这里通过正则匹配危险命令模式。注意 handler 不返回任何值（undefined）表示允许执行。实际 Pi Agent 中，block 为 true 时工具不会执行，而是返回一条错误消息给 LLM。',
    },
    {
      title: '编写一个上下文修改扩展（进阶）',
      prompt: '编写一个扩展，监听 before_agent_start 事件，在 systemPrompt 末尾追加一段自定义指令："Always respond in Chinese unless the user asks otherwise."',
      hint: '使用 pi.on("before_agent_start", handler)。handler 的 event 对象包含 systemPrompt 字段，返回 { systemPrompt: newValue } 可以修改它。注意需要追加而非替换。',
      answer: `export default function chineseResponseExtension(pi) {
  pi.on("before_agent_start", async (event, ctx) => {
    const appendText = "\\n\\nAlways respond in Chinese unless the user asks otherwise.";
    // 追加到现有 systemPrompt 后面，而非替换
    return {
      systemPrompt: event.systemPrompt + appendText,
    };
  });
}`,
      explanation: 'before_agent_start 事件支持链式传递——多个扩展可以依次追加内容。这里通过 event.systemPrompt 读取当前累积值，然后返回追加后的新值。注意如果直接写成 systemPrompt: "Always respond in Chinese..." 会替换掉整个 systemPrompt，破坏其他扩展的修改。正确做法是拼接：event.systemPrompt + 新增内容。',
    },
  ],

  summary: [
    '扩展系统采用事件驱动架构，通过 ExtensionLoader（模块加载）和 ExtensionRunner（事件分发）两大核心组件协同工作',
    '扩展从多个来源发现：项目本地 .pi/extensions/ → 全局 ~/.pi/extensions/ → 配置路径 → 内联工厂函数',
    '20+ 个事件类型覆盖完整生命周期：会话（session_*）、Agent（before_agent_start、context）、工具（tool_call、tool_result）、消息（message_end）、输入（input）等',
    '通过 pi.registerTool()、pi.registerCommand()、pi.registerProvider() 等方法注册各种资源；pi.on() 订阅事件',
    'jiti 提供内置 TypeScript 编译 + Bun 二进制模式虚拟模块 + 模块缓存控制，是扩展动态加载的关键基础设施',
    'PackageManager 支持 npm 包、Git 仓库、本地路径三类来源，通过 package.json 的 pi manifest 声明资源',
    '安全机制：上下文失效（invalidate）防止使用过时上下文；错误隔离确保单个扩展崩溃不影响核心系统',
    '编写扩展只需 export default 一个工厂函数，在其中用 pi API 注册工具、订阅事件——核心代码零修改',
  ],
});
