/**
 * 第2章：Coding Agent 的四层架构
 *
 * 格式与第1章保持一致:
 * - id, title, desc: 元信息
 * - objectives: 学习目标数组
 * - render(container): 渲染章节内容的函数
 * - quiz: 测验题数组 { question, options, answer(0-based), explanation }
 * - summary: 小结要点数组
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 2,
  title: 'Coding Agent 的四层架构',
  desc: '理解 Pi Agent 的分层设计思想，掌握各层的职责和依赖关系。',

  objectives: [
    '理解为什么要分层设计',
    '掌握四层架构：tui, ai (底层) → agent → coding-agent (上层)',
    '了解每层的核心职责',
    '理解包之间的依赖关系',
  ],

  render(container) {
    // === Section 1: 从盖房子说起 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>2.1 从盖房子说起</h2>
      <p>想象你要盖一栋房子。你不会把地基、水管、电线、墙壁和屋顶混在一起胡乱搭建，而是会分层施工：</p>
      <div class="step-list">
        <li>
          <h4>打地基</h4>
          <p>先打好坚实的地基，确保整栋房子不会倒塌</p>
        </li>
        <li>
          <h4>铺管线</h4>
          <p>在地基之上铺设水管和电线，它们依赖地基但不知道墙壁和屋顶的存在</p>
        </li>
        <li>
          <h4>砌墙</h4>
          <p>墙壁建在管线和地基之上，负责分隔空间和承重</p>
        </li>
        <li>
          <h4>盖屋顶</h4>
          <p>屋顶在最上层，保护整个房子，依赖下面所有层</p>
        </li>
      </div>
      <p>软件架构也是这样。<strong>分层设计</strong>是软件开发中最经典的设计思想之一。每一层有清晰的职责边界，下层为上层提供服务，上层依赖下层但下层不知道上层的存在。</p>

      <div class="info-card">
        <h4>分层设计的黄金法则</h4>
        <p style="font-size:1.1rem;text-align:center;margin:12px 0;font-weight:700;">
          上层依赖下层，下层不依赖上层
        </p>
        <p style="color:var(--text-secondary);text-align:center;">每一层只关心自己能提供什么能力，不关心谁在使用这些能力。</p>
      </div>
    `;
    container.appendChild(s1);

    // === Section 2: Pi 的四层架构 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>2.2 Pi 的四层架构</h2>
      <p>Pi Agent 采用严格的分层架构，从底到上依次是四个独立的 npm 包：</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ Pi Agent 四层架构全景图（上层依赖下层）</div>
      </div>
      <p>每一层都是独立的 npm 包（<code>@earendil-works</code> scope），有清晰的职责边界。我们来看看每一层具体做什么：</p>

      <table class="content-table">
        <tr><th>层级</th><th>包名</th><th>类比</th><th>核心职责</th></tr>
        <tr>
          <td><strong>第4层</strong></td>
          <td><code>coding-agent</code></td>
          <td>屋顶</td>
          <td>应用层：提供 CLI、TUI（终端界面）、RPC（编辑器集成）三种运行模式</td>
        </tr>
        <tr>
          <td><strong>第3层</strong></td>
          <td><code>agent</code></td>
          <td>墙壁</td>
          <td>Agent 运行时：核心循环（Agent Loop）、工具调用、状态管理、消息队列</td>
        </tr>
        <tr>
          <td><strong>第2层</strong></td>
          <td><code>ai</code></td>
          <td>管线</td>
          <td>LLM 抽象层：统一多 Provider（OpenAI、Anthropic、Google 等）的流式 API</td>
        </tr>
        <tr>
          <td><strong>第1层</strong></td>
          <td><code>tui</code></td>
          <td>地基</td>
          <td>终端 UI 库：差分渲染引擎、文本编辑器组件、键盘快捷键系统</td>
        </tr>
      </table>
    `;
    container.appendChild(s2);
    // Render the architecture diagram
    const diagramDiv = s2.querySelector('.diagram-container');
    Diagrams.drawArchitecture(diagramDiv);

    // === Section 3: 各层职责详解 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>2.3 各层职责详解</h2>

      <h3>第一层：tui（终端 UI）</h3>
      <p><code>pi-tui</code> 是 Pi 的"地基"。它是一个独立的终端 UI 渲染库，提供：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>差分渲染</strong>——只更新屏幕变化的部分，而不是整个重绘，保证流畅的终端体验</li>
        <li><strong>文本编辑器组件</strong>——支持语法高亮、光标导航、多行编辑</li>
        <li><strong>键盘快捷键系统</strong>——可配置的 keybindings，支持组合键</li>
      </ul>
      <p>注意：tui 层<strong>完全不知道</strong> AI、Agent、Coding Agent 的存在。它只是一个纯粹的 UI 库，可以被任何终端应用使用。</p>

      <h3>第二层：ai（LLM 抽象层）</h3>
      <p><code>pi-ai</code> 是 Pi 的"管线层"。它的任务是把不同 AI 厂商的 API 统一成一套接口：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>多 Provider 支持</strong>——Anthropic Claude、OpenAI、Google Gemini、Mistral、AWS Bedrock 等，一个接口全部搞定</li>
        <li><strong>统一流式协议</strong>——所有 Provider 都输出相同的事件格式（文本增量、思考增量、工具调用增量）</li>
        <li><strong>延迟加载</strong>——只在第一次使用某个 Provider 时才加载对应的 SDK，最小化启动时间和内存</li>
      </ul>
      <p>ai 层也不知道 agent 的存在。它只负责"给定消息，返回 AI 响应"这件事。</p>

      <h3>第三层：agent（Agent 运行时）</h3>
      <p><code>pi-agent-core</code> 是 Pi 的"墙壁层"，也是整个系统的核心骨架：</p>
      <ul style="list:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>Agent Loop</strong>——LLM 驱动的双层循环：内层处理工具调用链，外层处理后续消息</li>
        <li><strong>工具调用系统</strong>——定义和执行工具，支持并行和串行两种模式</li>
        <li><strong>状态管理</strong>——维护对话历史、工具执行结果、模型状态</li>
        <li><strong>消息队列</strong>——管理用户在 agent 工作期间插入的 steering 消息和任务完成后的 follow-up 消息</li>
      </ul>
      <p>agent 层依赖 ai 层（调用 LLM），但不知道终端 UI 的存在。</p>

      <h3>第四层：coding-agent（应用层）</h3>
      <p><code>coding-agent</code> 是 Pi 的"屋顶"，是最终用户直接使用的部分：</p>
      <ul style="list:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>交互模式（TUI）</strong>——终端里的完整交互体验，实时显示 AI 输出和工具进度</li>
        <li><strong>RPC 模式</strong>——通过 JSON-RPC 协议供 VS Code 等编辑器集成</li>
        <li><strong>CLI 模式</strong>——非交互式一次性执行，适合脚本和自动化</li>
        <li><strong>会话管理</strong>——持久化对话历史，支持分支、压缩、恢复</li>
        <li><strong>扩展系统</strong>——插件机制，允许第三方注入自定义行为</li>
        <li><strong>System Prompt 构建</strong>——动态组装系统提示词</li>
      </ul>
      <p>coding-agent 依赖下面所有层：通过 agent 驱动循环、通过 ai 调用模型、通过 tui 渲染界面。</p>
    `;
    container.appendChild(s3);

    // === Section 4: 为什么要分层 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>2.4 为什么要分层？</h2>
      <p>你可能觉得：把代码拆成四个包是不是太麻烦了？让我们看看分层带来的三个核心好处：</p>

      <div class="info-card">
        <h4>关注点分离（Separation of Concerns）</h4>
        <p>每一层只关注自己的领域。ai 层不需要知道 agent 的存在，tui 层不需要知道 AI 的存在。这让每一层的代码更简单、更容易理解。</p>
      </div>

      <div class="info-card tip">
        <h4>独立测试</h4>
        <p>因为层与层之间通过清晰的接口通信，你可以独立测试每一层。测试 ai 层时不需要启动 agent；测试 agent 时可以用 fake provider 替代真实 LLM（Pi 的测试就是这么做的，零 API 费用）。</p>
      </div>

      <div class="info-card warning">
        <h4>可替换</h4>
        <p>如果你想换一个 UI 方案（比如从终端 UI 换成 Web UI），只需要替换 tui 层，其他层完全不受影响。同理，如果你想支持一个新的 LLM Provider，只需要在 ai 层添加，上层代码无需修改。</p>
      </div>

      <div class="info-card">
        <h4>真实案例：三种运行模式共享同一核心</h4>
        <p>Pi 的交互模式（TUI）、RPC 模式（编辑器集成）、CLI 模式（脚本自动化）——这三种完全不同的运行模式，共用同一个 <code>AgentSession</code>（位于 coding-agent 层）。这正是分层设计的威力：核心逻辑写一次，多种界面复用。</p>
      </div>
    `;
    container.appendChild(s4);

    // === Section 5: 构建顺序 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>2.5 依赖关系与构建顺序</h2>
      <p>四个包的<strong>实际依赖关系</strong>（从各包的 package.json 提取）：</p>
      <table class="content-table">
        <tr><th>包</th><th>依赖的 pi-* 包</th><th>说明</th></tr>
        <tr><td><code>tui</code></td><td>无</td><td>纯 UI 库，完全独立</td></tr>
        <tr><td><code>ai</code></td><td>无</td><td>纯 LLM 库，完全独立</td></tr>
        <tr><td><code>agent</code></td><td><code>pi-ai</code></td><td>Agent 运行时需要调用 LLM</td></tr>
        <tr><td><code>coding-agent</code></td><td><code>pi-ai</code> + <code>pi-agent-core</code> + <code>pi-tui</code></td><td>应用层依赖所有下层</td></tr>
      </table>

      <div class="dg">
        <div class="dg-cap">▲ 真实的依赖关系图（箭头 = "依赖"）</div>
      </div>

      <p>注意：<strong>tui 和 ai 是完全独立的</strong>，互不依赖。只有在最上层的 coding-agent 才把它们组装在一起。这意味着：</p>
      <ul>
        <li>tui 和 ai <strong>可以并行构建</strong>（两者没有依赖关系）</li>
        <li>agent 必须在 ai 之后构建</li>
        <li>coding-agent 必须在所有三个包之后构建</li>
      </ul>

      <p>Pi 的构建脚本为了简单，采用<strong>串行顺序</strong>（tui → ai → agent → coding-agent），但这不是依赖关系强制的：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">package.json — 构建命令</span></div>
        <pre><code class="language-json">"build": "cd packages/tui && npm run build && cd ../ai && npm run build
       && cd ../agent && npm run build && cd ../coding-agent && npm run build"</code></pre>
      </div>
    `;
    container.appendChild(s5);

    // Render dependency diagram
    const depDiv = s5.querySelector('.dg');
    if (depDiv && typeof Diagrams !== 'undefined') {
      Diagrams.drawDependencyGraph(depDiv);
    }

    // === Section 6: 分层架构在代码中的体现 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>2.6 一个请求的四层之旅</h2>
      <p>让我们跟踪一个用户请求从输入到输出的完整路径，看看它如何穿越四层架构：</p>

      <table class="content-table">
        <tr><th>步骤</th><th>层级</th><th>发生了什么</th></tr>
        <tr>
          <td>1. 用户输入</td>
          <td>coding-agent</td>
          <td>用户在 TUI 中输入 "帮我修复 utils.ts 的 bug"</td>
        </tr>
        <tr>
          <td>2. 组装上下文</td>
          <td>coding-agent</td>
          <td>AgentSession 构建 system prompt，附加项目文件、规则等</td>
        </tr>
        <tr>
          <td>3. 启动循环</td>
          <td>agent</td>
          <td>调用 agent.prompt()，进入 Agent Loop</td>
        </tr>
        <tr>
          <td>4. 调用 LLM</td>
          <td>ai</td>
          <td>通过统一的流式接口调用配置的模型（如 Claude）</td>
        </tr>
        <tr>
          <td>5. LLM 响应</td>
          <td>ai → agent</td>
          <td>流式返回：LLM 决定先调用 read 工具读取 utils.ts</td>
        </tr>
        <tr>
          <td>6. 执行工具</td>
          <td>agent</td>
          <td>Agent 执行 read 工具，读取文件内容</td>
        </tr>
        <tr>
          <td>7. 继续循环</td>
          <td>agent → ai</td>
          <td>将工具结果注入上下文，再次调用 LLM</td>
        </tr>
        <tr>
          <td>8. 渲染输出</td>
          <td>tui</td>
          <td>LLM 的文本响应通过差分渲染实时显示在终端</td>
        </tr>
        <tr>
          <td>9. 持久化</td>
          <td>coding-agent</td>
          <td>将完整的对话历史写入 session 文件</td>
        </tr>
      </table>

      <p>你会发现，一个简单的请求经过了四层的协同工作。但作为开发者，你不需要同时关注所有层——当你修改 ai 层时，你只需要关注 Provider 的流式协议；当你修改 tui 层时，你只需要关注渲染逻辑。这就是分层架构的魅力。</p>
    `;
    container.appendChild(s6);

    // === Section 7: 深入 — 包的内部结构和依赖关系 ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>2.7 深入：包的内部结构和依赖关系</h2>
      <p>前面我们从宏观角度了解了四层架构。这一节我们钻进每个包的 <code>package.json</code>，用真实数据验证分层理论。</p>

      <h3>第一层：pi-tui — 零内部依赖的地基</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/package.json（真实数据，关键字段）</span></div>
        <pre><code class="language-json">{
  "name": "@earendil-works/pi-tui",
  "version": "0.78.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "get-east-asian-width": "1.6.0",
    "marked": "15.0.12"
  },
  "engines": { "node": ">=22.19.0" }
}</code></pre>
      </div>
      <p>关键发现：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>没有子路径导出</strong>——tui 只有一个 <code>main</code> 入口，所有 API 从顶层导入</li>
        <li><strong>仅 2 个外部依赖</strong>——<code>get-east-asian-width</code>（判断 CJK 字符宽度）和 <code>marked</code>（Markdown 渲染），不依赖任何 Pi 内部包</li>
        <li><strong>不依赖 ai/agent/coding-agent</strong>——验证了"下层不依赖上层"的分层原则</li>
      </ul>

      <h3>第二层：pi-ai — 10 个子路径导出</h3>
      <p><code>@earendil-works/pi-ai</code> 的 <code>exports</code> 字段暴露了 10 个子路径，每个子路径对应一个 Provider 或功能模块：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/package.json（真实数据，exports 字段）</span></div>
        <pre><code class="language-json">{
  "name": "@earendil-works/pi-ai",
  "version": "0.78.0",
  "bin": { "pi-ai": "./dist/cli.js" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./anthropic": { "types": "./dist/providers/anthropic.d.ts",
                     "import": "./dist/providers/anthropic.js" },
    "./google": { "types": "./dist/providers/google.d.ts",
                  "import": "./dist/providers/google.js" },
    "./google-vertex": { "types": "./dist/providers/google-vertex.d.ts",
                         "import": "./dist/providers/google-vertex.js" },
    "./mistral": { "types": "./dist/providers/mistral.d.ts",
                   "import": "./dist/providers/mistral.js" },
    "./openai-completions": { "types": "./dist/providers/openai-completions.d.ts",
                              "import": "./dist/providers/openai-completions.js" },
    "./openai-responses": { "types": "./dist/providers/openai-responses.d.ts",
                            "import": "./dist/providers/openai-responses.js" },
    "./openai-codex-responses": { "types": "./dist/providers/openai-codex-responses.d.ts",
                                  "import": "./dist/providers/openai-codex-responses.js" },
    "./azure-openai-responses": { "types": "./dist/providers/azure-openai-responses.d.ts",
                                  "import": "./dist/providers/azure-openai-responses.js" },
    "./oauth": { "types": "./dist/oauth.d.ts", "import": "./dist/oauth.js" },
    "./bedrock-provider": { "types": "./dist/bedrock-provider.d.ts",
                            "import": "./dist/bedrock-provider.js" }
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.91.1",
    "@aws-sdk/client-bedrock-runtime": "3.1048.0",
    "@google/genai": "1.52.0",
    "@mistralai/mistralai": "2.2.1",
    "openai": "6.26.0",
    "partial-json": "0.1.7",
    "typebox": "1.1.38"
  }
}</code></pre>
      </div>
      <p>设计要点：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>每个 Provider 一个子路径</strong>——如果你只用 Anthropic，可以 <code>import ... from "@earendil-works/pi-ai/anthropic"</code>，不加载 OpenAI 或 Google 的 SDK</li>
        <li><strong>自带 CLI</strong>——<code>"bin": { "pi-ai": "./dist/cli.js" }</code>，可独立运行模型发现等命令</li>
        <li><strong>types + import 双字段</strong>——每个子路径同时声明类型和实现，支持 TypeScript 类型推导</li>
        <li><strong>依赖全是外部 SDK</strong>——不依赖任何 Pi 内部包，保持完全独立</li>
      </ul>

      <h3>第三层：pi-agent-core — 第一个内部依赖出现</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/package.json（真实数据，关键字段）</span></div>
        <pre><code class="language-json">{
  "name": "@earendil-works/pi-agent-core",
  "version": "0.78.0",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./node": { "types": "./dist/node.d.ts", "import": "./dist/node.js" },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.78.0",
    "ignore": "7.0.5",
    "typebox": "1.1.38",
    "yaml": "2.9.0"
  }
}</code></pre>
      </div>
      <p>关键设计：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>依赖 pi-ai</strong>——agent 需要调用 LLM，所以依赖 ai 层。但 <strong>不依赖 tui</strong></li>
        <li><strong>./node 子路径</strong>——提供 Node.js 特定的传输层（<code>packages/agent/src/node.ts</code>），分离平台代码</li>
        <li><strong>./package.json 导出</strong>——允许上层读取 agent 包的元信息和版本号</li>
      </ul>

      <h3>第四层：pi-coding-agent — 完整的依赖聚合</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/package.json（节选关键字段）</span></div>
        <pre><code class="language-json">{
  "name": "@earendil-works/pi-coding-agent",
  "version": "0.78.0",
  "bin": { "pi": "dist/cli.js" },
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./hooks": { "types": "./dist/core/hooks/index.d.ts",
                 "import": "./dist/core/hooks/index.js" }
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "^0.78.0",
    "@earendil-works/pi-ai": "^0.78.0",
    "@earendil-works/pi-tui": "^0.78.0",
    "jiti": "2.7.0",              // ← 扩展系统 TypeScript 运行时（第8章）
    "glob": "13.0.6",
    "highlight.js": "10.7.3",
    "minimatch": "10.2.5",
    "yaml": "2.9.0"
  }
}</code></pre>
      </div>
      <p>架构信息：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:14px;">
        <li><strong>依赖全部三个内部包</strong>——tui（渲染界面）、ai（调用 LLM）、agent（驱动循环）</li>
        <li><strong>pi CLI 入口</strong>——<code>"bin": { "pi": "dist/cli.js" }</code>，用户执行 <code>pi</code> 命令的实际入口</li>
        <li><strong>./hooks 子路径</strong>——暴露 hooks 系统供插件使用</li>
        <li><strong>工具链依赖</strong>——<code>diff</code>（文件对比）、<code>glob</code>（文件搜索）、<code>minimatch</code>（路径匹配）、<code>highlight.js</code>（代码高亮）都是 coding-agent 特有的</li>
      </ul>

      <div class="info-card">
        <h4>关键发现：lockstep 版本管理</h4>
        <p>所有四个包的版本号都是 <code>0.78.0</code>，内部依赖使用 <code>^0.78.0</code>（caret 语义版本范围）。这意味着发布时四个包<strong>版本同步</strong>（lockstep versioning），安装 <code>pi-coding-agent@0.78.0</code> 时会自动拉取兼容版本的 agent、ai 和 tui，不会出现版本错配。</p>
      </div>

      <div class="info-card tip">
        <h4>依赖提升：coding-agent 直接依赖 pi-ai</h4>
        <p>注意 coding-agent 的 dependencies 中<strong>同时</strong>有 <code>pi-ai</code> 和 <code>pi-agent-core</code>（它自己也依赖 pi-ai）。这不是冗余——coding-agent 在某些场景下直接使用 ai 层的 API（如模型列表获取、模型发现），而不通过 agent 层中转。这是 monorepo 中<strong>依赖提升</strong>（dependency hoisting）的典型模式。</p>
      </div>
    `;
    container.appendChild(s7);

    // === Section 8: Pi 的工程化实践 ===
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>2.8 工程化实践：Pi 的技术栈与代码质量保障</h2>
      <p>理解了架构之后，我们来看看 Pi 在<strong>工程层面</strong>做了哪些设计——这些实践同样值得在你自己的项目中采用。</p>

      <h3>2.8.1 技术栈一览</h3>
      <table class="content-table">
        <tr><th>维度</th><th>选型</th><th>原因</th></tr>
        <tr><td>语言</td><td><strong>TypeScript (ESM)</strong></td><td>类型安全 + 现代 ES 模块</td></tr>
        <tr><td>运行时</td><td><strong>Node.js >= 22.19</strong></td><td>原生 fetch、ESM、AbortSignal</td></tr>
        <tr><td>包管理</td><td><strong>npm workspaces</strong> (monorepo)</td><td>原生 workspace，零额外工具链</td></tr>
        <tr><td>格式化/Lint</td><td><strong>Biome</strong> (tabs×3, 120列)</td><td>替代 ESLint+Prettier，Rust 实现极快</td></tr>
        <tr><td>类型检查</td><td><strong>tsgo</strong> (TypeScript 7 原生编译器)</td><td>替代 tsc，速度快 10 倍</td></tr>
        <tr><td>测试</td><td><strong>vitest</strong></td><td>Vite 原生，速度快，ESM 原生支持</td></tr>
        <tr><td>打包</td><td><strong>esbuild</strong> (仅 Bun 二进制)</td><td>命令行工具打包为单文件二进制</td></tr>
        <tr><td>版本管理</td><td><strong>lockstep</strong> (统一版本号)</td><td>4 个包共享同一版本，避免版本矩阵</td></tr>
      </table>

      <h3>2.8.2 Monorepo 脚手架</h3>
      <p>Pi 使用 npm 原生 <code>workspaces</code>（不是 Lerna/Turborepo），配置简洁：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">package.json — workspaces 配置</span></div>
        <pre><code class="language-json">"workspaces": [
  "packages/*",
  "packages/coding-agent/examples/extensions/with-deps",
  "packages/coding-agent/examples/extensions/custom-provider-anthropic",
  "packages/coding-agent/examples/extensions/custom-provider-gitlab-duo",
  "packages/coding-agent/examples/extensions/sandbox"
]</code></pre>
      </div>
      <p>根 package.json 不写任何应用代码，只定义构建脚本和 workspace 声明。每个子包在自己目录下独立构建，<strong>构建顺序由 dependencies 自动决定</strong>（npm 会按拓扑序执行）。</p>

      <h3>2.8.3 代码质量三重保障</h3>
      <p>Pi 的 <code>npm run check</code> 是一次完整的质量检查流水线（<strong>不包含测试</strong>）：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">package.json — check 命令</span></div>
        <pre><code class="language-json">"check": "biome check --write --error-on-warnings . &&
          npm run check:pinned-deps &&
          npm run check:ts-imports &&
          npm run check:shrinkwrap &&
          tsgo --noEmit &&
          npm run check:browser-smoke"</code></pre>
      </div>
      <table class="content-table">
        <tr><th>步骤</th><th>检查内容</th><th>工具</th></tr>
        <tr><td>1. Lint + Format</td><td>代码风格、潜在 bug、格式一致性</td><td><code>biome check --write</code></td></tr>
        <tr><td>2. 依赖版本</td><td>所有依赖必须精确版本（不允许 <code>^</code> 或 <code>~</code>）</td><td>自定义脚本 <code>check-pinned-deps</code></td></tr>
        <tr><td>3. 相对导入</td><td>禁止跨包的相对路径导入（必须用包名 import）</td><td>自定义脚本 <code>check-ts-imports</code></td></tr>
        <tr><td>4. Shrinkwrap</td><td>lockfile 与 package.json 一致，防止依赖漂移</td><td>自定义脚本 <code>check:shrinkwrap</code></td></tr>
        <tr><td>5. 类型检查</td><td>全量 TypeScript 类型检查（无生成，仅检查）</td><td><code>tsgo --noEmit</code></td></tr>
        <tr><td>6. 浏览器兼容</td><td>确保代码中没有 Node-only API（浏览器包需要）</td><td>自定义脚本 <code>check:browser-smoke</code></td></tr>
      </table>

      <div class="callout cl-info">
        <strong>🔑 关键设计：check 不跑测试</strong><br>
        测试是独立步骤（<code>./test.sh</code>）。check 只做静态分析——lint、格式、类型、依赖。这样 check 在 5 秒内完成，可以频繁运行（pre-commit hook）；测试可能需要 30 秒+，留给 CI。
      </div>

      <h3>2.8.4 TypeScript 高级技巧</h3>

      <h4>erasableSyntaxOnly</h4>
      <p>Pi 在 <code>tsconfig.base.json</code> 中设置了 <code>"erasableSyntaxOnly": true</code>。这意味着：</p>
      <ul>
        <li>❌ <strong>禁用</strong>：<code>enum</code>、<code>namespace</code>、<code>constructor parameter properties</code>、<code>import =</code></li>
        <li>✅ <strong>只允许</strong>：可以被直接"擦除"的类型语法（type、interface、泛型标注等）</li>
      </ul>
      <p>为什么？因为 TypeScript 7 的原生编译器（tsgo）可以直接剥离类型注解而不需要做任何代码变换。<code>enum</code> 和 <code>namespace</code> 会生成运行时代码，违反了这个原则。这个设置让编译速度极快，且输出代码和源码结构完全一致。</p>

      <h4>Declaration Merging</h4>
      <p>第6章已经介绍了 Declaration Merging 在消息类型扩展中的使用。这是 TypeScript 中少有的"不修改核心包就能扩展类型"的机制：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent 包定义空接口 → coding-agent 包注入具体类型</span></div>
        <pre><code class="language-typescript">// packages/agent/src/types.ts
export interface CustomAgentMessages {}  // 空占位
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

// packages/coding-agent/src/core/messages.ts
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}
// AgentMessage 自动变为: Message | BashExecutionMessage | CustomMessage | ...</code></pre>
      </div>

      <h4>泛型约束与类型推断</h4>
      <p>ai 层的 <code>streamSimple&lt;TApi extends Api&gt;</code> 是泛型约束的典范——通过 <code>TApi</code> 将模型类型和 Provider 类型关联起来，编译期就能发现"用错了 Provider"的错误：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">stream.ts — 泛型保证类型安全</span></div>
        <pre><code class="language-typescript">export function streamSimple&lt;TApi extends Api&gt;(
  model: Model&lt;TApi&gt;,           // model.api 必须匹配 TApi
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const provider = resolveApiProvider(model.api);
  // provider 的类型自动推断为 ApiProvider&lt;TApi&gt;
  return provider.streamSimple(model, context, options);
}</code></pre>
      </div>

      <h3>2.8.5 异步编程模式</h3>

      <h4>EventStream：AsyncIterable 模式</h4>
      <p>Pi 没有使用 Node.js Stream 或 RxJS，而是自己实现了一个轻量的 <code>EventStream&lt;T&gt;</code>，核心是 <strong>AsyncIterable + 生产者-消费者</strong>：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">event-stream.ts — 核心模式</span></div>
        <pre><code class="language-typescript">export class EventStream&lt;T, R = T&gt; implements AsyncIterable&lt;T&gt; {
  private queue: T[] = [];
  private waiting: ((v: IteratorResult&lt;T&gt;) => void)[] = [];

  push(event: T) { /* 生产者：推送事件，唤醒等待者 */ }
  end(result?: R) { /* 生产者：结束流，返回最终结果 */ }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length > 0) yield this.queue.shift()!;
      else if (this.done) return;
      else await new Promise(r => this.waiting.push(r)); // 阻塞等待
    }
  }

  result(): Promise&lt;R&gt; { /* 获取最终结果（如最终 AssistantMessage） */ }
}</code></pre>
      </div>
      <p>这个模式的关键优势：</p>
      <ul>
        <li><strong>零依赖</strong>：纯 Promise + 队列，不依赖任何流库</li>
        <li><strong>跨平台</strong>：Node 和浏览器都能用（不像 Node Readable Stream）</li>
        <li><strong>双通道</strong>：既可以 <code>for await</code> 消费事件流，也可以 <code>await stream.result()</code> 获取最终值</li>
      </ul>

      <h4>AbortSignal：贯穿全链路</h4>
      <p>AbortSignal 是 Pi 中<strong>出现频率最高的参数之一</strong>。它从 Agent Loop 入口一直传到 LLM 调用和工具执行：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent-loop.ts — AbortSignal 传递</span></div>
        <pre><code class="language-typescript">export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,          // ← 入口参数
  streamFn?: StreamFn,
): EventStream&lt;AgentEvent, AgentMessage[]&gt; { ... }

// 在工具执行中检查
if (signal?.aborted) {
  return { kind: "immediate", result: createErrorToolResult("Operation aborted"), isError: true };
}</code></pre>
      </div>
      <p>用户按 Ctrl+C → AbortController.abort() → signal.aborted = true → 所有正在执行的工具立刻返回错误 → Agent Loop 优雅退出。整个链路<strong>不抛异常</strong>。</p>

      <h3>2.8.6 依赖管理策略</h3>
      <table class="content-table">
        <tr><th>策略</th><th>配置</th><th>目的</th></tr>
        <tr><td>精确版本</td><td><code>.npmrc: save-exact=true</code></td><td>杜绝 semver 范围，所有依赖锁定精确版本</td></tr>
        <tr><td>最小发布年龄</td><td><code>.npmrc: min-release-age=2</code></td><td>只安装发布至少 2 天以上的包（避免恶意包）</td></tr>
        <tr><td>忽略安装脚本</td><td><code>npm install --ignore-scripts</code></td><td>防止依赖的 postinstall 脚本执行（安全性）</td></tr>
        <tr><td>Shrinkwrap 校验</td><td>自定义 check 脚本</td><td>确保 lockfile 与 package.json 完全同步</td></tr>
      </table>

      <h3>2.8.7 测试体系</h3>
      <p>Pi 的测试策略核心：<strong>不依赖真实 LLM API 就能完整测试 Agent</strong>。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">test.sh — 测试入口</span></div>
        <pre><code class="language-bash">#!/usr/bin/env bash
set -e
# 1. 移动 auth.json（移除所有 API key）
mv ~/.pi/agent/auth.json ~/.pi/agent/auth.json.bak
# 2. 运行测试（所有 LLM 调用都用 faux provider 模拟）
npm test
# 3. 恢复 auth.json
mv ~/.pi/agent/auth.json.bak ~/.pi/agent/auth.json</code></pre>
      </div>
      <table class="content-table">
        <tr><th>测试类型</th><th>工具</th><th>特点</th></tr>
        <tr><td>单元测试</td><td>vitest</td><td>测试纯函数（如 token 估算、模糊匹配）</td></tr>
        <tr><td>Suite 测试</td><td>vitest + Faux Provider</td><td>用模拟 LLM 测试完整 Agent Loop，零 API 费用</td></tr>
        <tr><td>回归测试</td><td><code>test/suite/regressions/</code></td><td>按 issue 编号组织，防止 bug 复现</td></tr>
      </table>
      <p>Faux Provider（<code>packages/ai/src/providers/faux.ts</code>）是测试体系的核心：它注册为一个真实的 Provider，但返回<strong>预设的响应序列</strong>——包括文本、工具调用、错误——完全可预测。</p>

      <h3>2.8.8 发布流程</h3>
      <p>4 个包 lockstep 发布（共享同一版本号）：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">terminal</span></div>
        <pre><code class="language-bash">npm run release:patch   # 修复/功能 → 版本 +0.0.1
npm run release:minor   # 破坏性变更 → 版本 +0.1.0</code></pre>
      </div>
      <p>release 脚本自动完成：bump 版本 → 更新 CHANGELOG → 运行 check → commit + tag → push（触发 CI 发布到 npm）。</p>

      <div class="callout cl-tip">
        <strong>💡 这些实践对你有何启发？</strong>
        <ul>
          <li>Monorepo + workspace 适合紧密耦合的多包项目</li>
          <li>Fast check（5秒）频繁运行 + Slow test（30秒）留给 CI</li>
          <li>Faux Provider 模式——任何调用外部 API 的系统都可以用 mock 替代测试</li>
          <li>EventStream 比 Node Stream / RxJS 更适合 agent 场景</li>
          <li>AbortSignal 贯穿全链路是优雅取消的关键</li>
        </ul>
      </div>
    `;
    container.appendChild(s8);
  },

  quiz: [
    {
      question: 'Pi Agent 的四层架构从底到上依次是什么？',
      options: [
        'ai → agent → tui → coding-agent',
        'tui 和 ai 是底层（互不依赖），agent 依赖 ai，coding-agent 依赖全部',
        'coding-agent → agent → ai → tui',
        'agent → ai → tui → coding-agent',
      ],
      answer: 1,
      explanation: '从底到上是 tui（终端 UI）→ ai（LLM 抽象）→ agent（运行时）→ coding-agent（应用层）。上层依赖下层。',
    },
    {
      question: '以下哪项不是分层设计带来的好处？',
      options: [
        '关注点分离，每层代码更简单',
        '可以独立测试每一层',
        '可以替换某一层而不影响其他层',
        '让代码运行速度更快',
      ],
      answer: 3,
      explanation: '分层设计主要带来关注点分离、独立测试和可替换性。它本身不会直接提升运行速度，反而因为增加了抽象层，可能引入微小的性能开销。',
    },
    {
      question: '如果你要给 Pi 添加一个新的 LLM Provider（如百度的文心一言），你应该修改哪一层？',
      options: [
        'tui 层',
        'ai 层',
        'agent 层',
        'coding-agent 层',
      ],
      answer: 1,
      explanation: '所有 LLM Provider 的对接都在 ai 层。添加新 Provider 只需要在 ai 层新增一个 Provider 实现并注册，上层代码完全不需要修改。',
    },
  ],

  coding: [
    {
      title: '依赖关系拓扑排序',
      prompt: '阅读 packages/*/package.json 中各包的 dependencies 字段。编写一个函数 getBuildOrder()，输入包依赖关系，用拓扑排序返回正确的构建顺序。\n\n要求：\n1. 输入为 Map<string, string[]>（包名 → 它依赖的包列表）\n2. 输出为 string[]，不依赖其他包的排在前面\n3. 如果存在循环依赖，抛出错误\n4. 核心算法：Kahn 算法（BFS 拓扑排序），参考 packages/agent/src/agent-loop.ts 了解 Pi 如何管理依赖关系',
      hint: 'Kahn 算法：统计每个节点的入度（有多少节点依赖它），将入度为 0 的节点入队，依次移除并更新入度。最终结果长度应等于节点总数，否则存在循环依赖。',
      answer: `// 拓扑排序 — Kahn 算法
// 文件参考: packages/*/package.json (dependencies 字段)
function getBuildOrder(graph: Map<string, string[]>): string[] {
  // 统计入度：每个包被多少其他包依赖
  const inDegree = new Map<string, number>();
  for (const [pkg] of graph) {
    inDegree.set(pkg, 0);
  }
  for (const [, deps] of graph) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }

  // Kahn 算法：入度为 0 的先构建
  const queue: string[] = [];
  const result: string[] = [];
  for (const [pkg, degree] of inDegree) {
    if (degree === 0) queue.push(pkg);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    // "移除"当前节点，更新被它依赖的节点的入度
    for (const [pkg, deps] of graph) {
      if (deps.includes(current)) {
        const newDegree = inDegree.get(pkg)! - 1;
        inDegree.set(pkg, newDegree);
        if (newDegree === 0) queue.push(pkg);
      }
    }
  }

  if (result.length !== graph.size) {
    throw new Error('检测到循环依赖！');
  }
  return result;
}

// 使用真实数据（从 package.json 提取）：
const graph = new Map([
  ['tui', []],
  ['ai', []],
  ['agent-core', ['ai']],
  ['coding-agent', ['agent-core', 'ai', 'tui']],
]);
console.log(getBuildOrder(graph));
// => ['tui', 'ai', 'agent-core', 'coding-agent']
// 这是基于实际依赖关系的拓扑序：tui 和 ai 可并行，agent 依赖 ai，coding-agent 依赖全部`,
      explanation: '拓扑排序的结果与项目要求的构建顺序完全一致。Kahn 算法的核心思想：每次选择没有前置依赖的包先构建，然后将它从其他包的依赖列表中移除。循环依赖检测也很重要——如果最终结果长度不等于图的节点数，说明有环。',
    },
    {
      title: '子路径导出解析器',
      prompt: '阅读 packages/ai/package.json 的真实 exports 字段（已在 2.7 节展示）。编写一个函数 parseSubpathExports()，输入 exports 对象，返回所有可用的子路径列表。\n\n要求：\n1. 输出子路径数组，如 [".", "./anthropic", "./google", ...]\n2. 排除 "."（主入口），只列子路径\n3. 从真实 exports 字段提取：每个子路径有 types 和 import 两个字段',
      hint: '使用 Object.keys(exports).filter(key => key !== ".") 获取子路径。注意 exports 的值可能是字符串或对象（含 types/import 字段）。',
      answer: `// 子路径导出解析器
// 文件参考: packages/ai/package.json (exports 字段)
interface ExportEntry {
  types?: string;
  import?: string;
  default?: string;
}

function parseSubpathExports(
  exports: Record<string, string | ExportEntry>
): { path: string; import: string; types: string }[] {
  return Object.entries(exports)
    .filter(([key]) => key !== '.')
    .map(([key, value]) => {
      const entry = typeof value === 'string'
        ? { import: value, types: value.replace('.js', '.d.ts') }
        : value;
      return {
        path: key,
        import: entry.import || '',
        types: entry.types || '',
      };
    });
}

// 使用真实数据：
const aiExports = {
  '.': { types: './dist/index.d.ts', import: './dist/index.js' },
  './anthropic': { types: './dist/providers/anthropic.d.ts', import: './dist/providers/anthropic.js' },
  './google': { types: './dist/providers/google.d.ts', import: './dist/providers/google.js' },
  './oauth': { types: './dist/oauth.d.ts', import: './dist/oauth.js' },
  './bedrock-provider': { types: './dist/bedrock-provider.d.ts', import: './dist/bedrock-provider.js' },
};

const subpaths = parseSubpathExports(aiExports);
// [
//   { path: './anthropic', import: './dist/providers/anthropic.js', ... },
//   { path: './google', import: './dist/providers/google.js', ... },
//   { path: './oauth', import: './dist/oauth.js', ... },
//   { path: './bedrock-provider', import: './dist/bedrock-provider.js', ... },
// ]`,
      explanation: '这个函数展示了如何解析 Node.js 的 exports 字段。真实项目中 pi-ai 有 10 个子路径导出，每个都提供 types + import 双字段，支持 TypeScript 类型推导和 ESM 导入。这是为什么你可以写 import ... from "@earendil-works/pi-ai/anthropic" 的原因。',
    },
    {
      title: '包版本一致性检查器',
      prompt: '四个 Pi 内部包的版本号必须一致（lockstep versioning）。编写一个函数 checkVersionConsistency()，输入四个包的 package.json 内容，验证：\n1. 所有包版本一致（都是 "0.78.0"）\n2. 内部依赖使用 caret 范围（如 "^0.78.0"）\n3. 没有包依赖更高版本的内部包\n\n要求返回 { valid: boolean, errors: string[] }',
      hint: '从 packages/*/package.json 读取 version 和 dependencies 字段。用 semver 语义：caret ^0.78.0 允许 >=0.78.0 <0.79.0。注意依赖名以 @earendil-works/ 开头的才是内部包。',
      answer: `// 包版本一致性检查器
// 文件参考: packages/*/package.json (version + dependencies 字段)
interface PkgInfo {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

interface CheckResult { valid: boolean; errors: string[] }

function checkVersionConsistency(packages: PkgInfo[]): CheckResult {
  const errors: string[] = [];

  // 1. 检查所有包版本一致
  const versions = new Set(packages.map(p => p.version));
  if (versions.size > 1) {
    errors.push(\`版本不一致: \${[...versions].join(', ')}\`);
  }

  // 2. 检查内部依赖使用 caret 范围
  for (const pkg of packages) {
    for (const [dep, range] of Object.entries(pkg.dependencies)) {
      if (!dep.startsWith('@earendil-works/')) continue;

      if (!range.startsWith('^')) {
        errors.push(
          \`\${pkg.name}: 内部依赖 \${dep} 使用 "\${range}"，应为 caret 范围\`
        );
      }
    }
  }

  // 3. 检查版本是否在包本身的版本范围内
  const majorMinor = packages[0]?.version.split('.').slice(0, 2).join('.');
  for (const pkg of packages) {
    for (const [dep, range] of Object.entries(pkg.dependencies)) {
      if (!dep.startsWith('@earendil-works/')) continue;
      // caret ^0.78.0 期望 dep 版本 >=0.78.0 <0.79.0
      if (!range.startsWith('^' + majorMinor)) {
        errors.push(
          \`\${pkg.name}: \${dep} 依赖 "\${range}" 与当前主版本 \${majorMinor} 不匹配\`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// 使用真实数据：
const packages = [
  { name: '@earendil-works/pi-tui', version: '0.78.0', dependencies: {} },
  { name: '@earendil-works/pi-ai', version: '0.78.0', dependencies: {} },
  { name: '@earendil-works/pi-agent-core', version: '0.78.0',
    dependencies: { '@earendil-works/pi-ai': '^0.78.0' } },
  { name: '@earendil-works/pi-coding-agent', version: '0.78.0',
    dependencies: { '@earendil-works/pi-ai': '^0.78.0',
      '@earendil-works/pi-agent-core': '^0.78.0',
      '@earendil-works/pi-tui': '^0.78.0' } },
];

console.log(checkVersionConsistency(packages));
// => { valid: true, errors: [] }`,
      explanation: '这个检查器验证了 Pi 的 lockstep versioning 策略：所有四个包版本同步为 0.78.0，内部依赖全部使用 ^0.78.0 caret 范围。如果有人在发版时忘记更新某个包的版本，这个检查器就会报错。注意 answer 中的模板字符串 \${...} 在实际运行中需要正确转义。',
    },
  ],

  summary: [
    'Pi Agent 采用四层架构：tui（终端 UI）→ ai（LLM 抽象）→ agent（运行时）→ coding-agent（应用层）',
    '上层依赖下层，下层不依赖上层；构建必须自底向上',
    'tui = 差分渲染引擎，ai = 统一多 Provider API，agent = Agent Loop + 工具执行，coding-agent = 三种运行模式 + 会话管理',
    '分层设计的三个核心好处：关注点分离、独立测试、可替换',
    '三种运行模式（TUI、RPC、CLI）共用同一个 AgentSession，体现了分层复用的威力',
  ],
});
