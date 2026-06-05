/**
 * 第1章：什么是 Coding Agent
 *
 * 这是章节模块的参考模板。每个章节模块格式:
 * - id, title, desc: 元信息
 * - objectives: 学习目标数组
 * - render(container): 渲染章节内容的函数
 * - quiz: 测验题数组 { question, options, answer(0-based), explanation }
 * - summary: 小结要点数组
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 1,
  title: '什么是 Coding Agent',
  desc: '了解 AI 编程助手的概念、工作原理和核心能力，建立对 Coding Agent 的整体认知。',

  objectives: [
    '理解 Coding Agent 是什么，能做什么',
    '了解 Coding Agent 和普通聊天 AI 的区别',
    '掌握 Agent 的核心工作流程：感知→思考→行动',
    '认识 Pi Agent 项目的基本情况',
  ],

  render(container) {
    // === Section 1: 从一个例子开始 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>1.1 从一个例子开始</h2>
      <p>假设你正在写代码，需要对一个文件做一些修改。你可能会这样告诉 AI：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">💬 你对 AI 说</span></div>
        <pre><code class="language-plaintext">帮我把 src/utils.ts 里的 formatDate 函数改成支持多时区</code></pre>
      </div>
      <p>然后 AI 会怎么处理这个请求呢？它不是简单地"聊天回复"，而是像一个真正的程序员一样：</p>
      <div class="step-list">
        <li>
          <h4>🔍 读取文件</h4>
          <p>AI 会先用 <code>read</code> 工具读取 src/utils.ts，理解 formatDate 的当前实现</p>
        </li>
        <li>
          <h4>🔎 搜索相关代码</h4>
          <p>用 <code>grep</code> 搜索项目中所有调用 formatDate 的地方，确保修改不会破坏其他代码</p>
        </li>
        <li>
          <h4>✏️ 编辑文件</h4>
          <p>用 <code>edit</code> 工具精确替换 formatDate 的实现，添加时区参数支持</p>
        </li>
        <li>
          <h4>✅ 验证修改</h4>
          <p>可选地运行 <code>bash</code> 执行测试，确保修改正确</p>
        </li>
      </div>
      <p>这就是 <strong>Coding Agent</strong>——它不是一个只会聊天的 AI，而是一个<strong>能读、能写、能搜索、能执行命令</strong>的编程助手。</p>
    `;
    container.appendChild(s1);

    // === Section 2: Coding Agent 的定义 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>1.2 Coding Agent 是什么</h2>
      <p>简单来说，<strong>Coding Agent 是一个能用工具的 AI 程序</strong>。它和普通 AI 聊天的关键区别在于：</p>
      <table class="content-table">
        <tr><th>对比维度</th><th>普通 AI 聊天</th><th>Coding Agent</th></tr>
        <tr><td>能力边界</td><td>只能"说"——输出文本</td><td>能"做"——读文件、写代码、执行命令</td></tr>
        <tr><td>交互方式</td><td>一问一答</td><td>多轮自主行动（读→改→验证→循环）</td></tr>
        <tr><td>上下文</td><td>仅对话内容</td><td>对话 + 文件系统 + 目录结构 + 自定义规则</td></tr>
        <tr><td>工作模式</td><td>被动回答</td><td>主动探索和修改</td></tr>
      </table>

      <div class="info-card">
        <h4>💡 核心公式</h4>
        <p style="font-size:1.2rem;text-align:center;margin:12px 0;font-weight:700;">
          Coding Agent = LLM（大脑）+ 工具（手脚）+ 循环（自主决策）
        </p>
      </div>
    `;
    container.appendChild(s2);

    // === Section 3: Agent 的工作原理 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>1.3 Agent 是如何工作的</h2>
      <p>所有 Coding Agent（包括 Pi、Claude Code、Cursor 等）都遵循一个核心模式——<strong>Agent Loop（代理循环）</strong>：</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ Agent Loop 核心流程</div>
      </div>
      <p>这个循环可以简化为三步：</p>
      <div class="step-list">
        <li>
          <h4>感知（Perceive）</h4>
          <p>把用户的请求、当前上下文（文件内容、项目结构、对话历史等）打包成一条消息，发给 LLM</p>
        </li>
        <li>
          <h4>思考（Think）</h4>
          <p>LLM 分析请求，决定下一步该做什么——是直接回复用户，还是调用某个工具</p>
        </li>
        <li>
          <h4>行动（Act）</h4>
          <p>如果 LLM 决定调用工具（比如读取文件），Agent 就执行这个工具，把结果返回给 LLM，然后回到第1步继续循环</p>
        </li>
      </div>
      <p>这个循环会一直持续，直到 LLM 认为任务完成、不再需要调用工具为止。</p>
    `;
    container.appendChild(s3);
    // Render the agent loop diagram
    const diagramDiv = s3.querySelector('.diagram-container');
    Diagrams.drawAgentLoop(diagramDiv);

    // === Section 4: 为什么需要 Coding Agent ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>1.4 为什么需要 Coding Agent</h2>
      <p>你可能会问：已经有了 Copilot 自动补全，为什么还需要 Coding Agent？</p>
      <div class="info-card tip">
        <h4>🎯 Coding Agent 解决的是"多步骤编程任务"</h4>
        <p>代码补全只能帮你写下一行代码。Coding Agent 可以帮你：</p>
        <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
          <li>理解整个项目的结构，找到需要修改的地方</li>
          <li>跨多个文件进行一致性的修改</li>
          <li>写代码 → 运行测试 → 根据结果修复 → 再测试，形成完整的开发闭环</li>
          <li>执行 shell 命令、管理依赖、配置环境</li>
        </ul>
      </div>
    `;
    container.appendChild(s4);

    // === Section 5: 课程概述 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>1.5 本课程将带你做什么</h2>
      <p>我们将以 <strong>Pi Agent</strong>（一个开源的 Coding Agent）为例，从零开始，逐层深入：</p>
      <table class="content-table">
        <tr><th>阶段</th><th>章节</th><th>你会学到</th></tr>
        <tr><td>🔰 入门</td><td>第1-2章</td><td>概念理解 + 项目架构全景</td></tr>
        <tr><td>🧠 大脑</td><td>第3章</td><td>如何对接多个 AI 模型（OpenAI、Anthropic 等）</td></tr>
        <tr><td>❤️ 心脏</td><td>第4章</td><td>Agent Loop 核心循环的设计与实现</td></tr>
        <tr><td>🤲 手脚</td><td>第5章</td><td>7 大核心工具：读、写、搜、编、执行</td></tr>
        <tr><td>🧩 记忆</td><td>第6章</td><td>会话持久化和上下文管理</td></tr>
        <tr><td>📋 规则</td><td>第7章</td><td>System Prompt 如何给 Agent 设定行为规范</td></tr>
        <tr><td>🔌 扩展</td><td>第8章</td><td>插件系统：如何给 Agent 添加新能力</td></tr>
        <tr><td>🛡️ 保障</td><td>第9章</td><td>错误处理、安全机制、重试策略</td></tr>
        <tr><td>🖥️ TUI</td><td>第10章</td><td>终端 UI：差分渲染、组件系统、键盘处理</td></tr>
        <tr><td>🏗️ 实践</td><td>第11章</td><td>动手构建一个精简版 Coding Agent</td></tr>
      </table>
      <p style="margin-top:20px;">不需要一次看完所有章节。每一章都是独立的，你可以根据自己的兴趣跳着看。</p>
      <p>准备好了吗？让我们开始吧！ 🚀</p>
    `;
    container.appendChild(s5);

    // === Section 6: 深入：Pi 的启动流程 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>1.6 深入：Pi Agent 的一行命令背后发生了什么</h2>
      <p>当你执行 <code>pi "帮我修复这个 bug"</code> 时，Pi 内部实际发生了什么？让我们追踪完整链路：</p>

      <h3>入口：main.ts</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/main.ts — 启动入口</span></div>
        <pre><code class="language-typescript">// 简化后的启动流程
async function main() {
  // 1. 解析命令行参数
  const args = parseArgs(process.argv.slice(2));

  // 2. 确定运行模式：interactive / rpc / print(CLI)
  const mode = resolveMode(args);

  // 3. 加载配置（全局 ~/.pi/ + 项目 .pi/）
  const settings = await loadSettings(args.cwd);

  // 4. 加载扩展（.pi/extensions/ + 全局扩展）
  const extensions = await discoverAndLoadExtensions(settings);

  // 5. 创建 AgentSession（核心会话对象）
  const session = await AgentSession.create({
    cwd: args.cwd,
    settings,
    extensions,
    model: resolveModel(settings.model),
  });

  // 6. 根据模式启动
  if (mode === 'interactive') {
    await startInteractiveMode(session);   // TUI
  } else if (mode === 'rpc') {
    await startRpcMode(session);           // JSON-RPC
  } else {
    await runPrintMode(session, args.prompt); // CLI
  }
}</code></pre>
      </div>
      <p>这个启动流程串联了后续所有章节的知识点——配置系统（第2章工程化实践 + settings 文档）、扩展系统（第8章）、会话管理（第6章）、三种运行模式（interactive / rpc / print）。</p>

      <h3>核心类型：AgentSession</h3>
      <p><code>AgentSession</code> 是 coding-agent 包的核心类，位于 <code>packages/coding-agent/src/core/agent-session.ts</code>。它把 agent 运行时、工具系统、会话管理、扩展系统全部串联在一起：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/agent-session.ts</span></div>
        <pre><code class="language-typescript">// AgentSession 的核心公开字段（概念示意，实际有更多私有字段）
export class AgentSession {
  readonly agent: Agent;                 // Agent 实例（核心循环）
  readonly sessionManager: SessionManager;  // 会话持久化管理
  readonly settingsManager: SettingsManager; // 配置管理
  // 内部还持有: ExtensionRunner, ModelRegistry, 扩展系统等
  // 但这些是 private 字段，通过方法暴露功能

  async prompt(input: string): Promise&lt;void&gt; {
    // 1. 构建 System Prompt（第7章）
    // 2. 构建消息上下文（第6章）
    // 3. 调用 agent.prompt() 启动循环（第4章）
    // 4. 处理响应和事件
  }
}</code></pre>
      </div>
      <p>AgentSession 是连接各个子系统的枢纽——后续章节讲到的扩展系统、模型管理、会话持久化都经由它协调。</p>
    `;
    container.appendChild(s6);
  },

  quiz: [
    {
      question: 'Coding Agent 和普通 AI 聊天的核心区别是什么？',
      options: [
        'Coding Agent 回答更快',
        'Coding Agent 能使用工具（读文件、写代码、执行命令等）',
        'Coding Agent 只支持英文',
        'Coding Agent 不需要网络连接',
      ],
      answer: 1,
      explanation: 'Coding Agent 的核心特性是它能调用工具来操作文件和执行命令，而普通聊天 AI 只能输出文本。',
    },
    {
      question: 'Agent Loop 的三个核心步骤是什么？',
      options: [
        '编译 → 运行 → 调试',
        '感知 → 思考 → 行动',
        '读取 → 保存 → 退出',
        '下载 → 安装 → 配置',
      ],
      answer: 1,
      explanation: 'Agent Loop 遵循 感知(Perceive)→思考(Think)→行动(Act) 的循环，直到任务完成。',
    },
    {
      question: '以下哪个不是 Coding Agent 的典型能力？',
      options: [
        '读取项目文件',
        '搜索代码中的特定模式',
        '直接在浏览器中预览网页',
        '执行 shell 命令',
      ],
      answer: 2,
      explanation: '虽然有些 Agent 可以预览网页，但这不是 Coding Agent 的核心能力。核心能力是读写文件、搜索代码和执行命令。',
    },
  ],

  coding: [
    {
      title: '跟踪 Pi 的启动流程',
      prompt: '阅读 packages/coding-agent/src/main.ts 文件，找到 main() 函数。画出 Pi 从命令行启动到进入 Agent Loop 的完整流程图，标注每一步调用了哪个模块。\n\n提示：关注 parseArgs → loadSettings → AgentSession.create → startInteractiveMode/startRpcMode/runPrintMode 的调用链。',
      hint: 'main.ts 中约有 500 行代码。从文件底部找到 main() 函数的定义（约在第 400 行附近），然后向上追踪每个被调用的函数。',
      answer: `// Pi 启动流程（简化）
// 1. main.ts: main()
// 2. 解析 CLI 参数 → args (config.ts: parseCliArgs)
// 3. 确定运行模式 → mode (interactive | rpc | print)
// 4. 加载项目配置 → settings (.pi/settings.json + ~/.pi/agent/settings.json)
// 5. 加载扩展 → extensions (.pi/extensions/ + ~/.pi/agent/extensions/)
// 6. 发现模型 → models (models.generated.ts + settings 中的自定义模型)
// 7. 创建 AgentSession → session (agent-session.ts)
//    内部创建: Agent, SessionManager, SettingsManager, ExtensionRunner, BashExecutor
// 8. 根据 mode 分支:
//    - interactive → startInteractiveMode(session) → TUI
//    - rpc → startRpcMode(session) → JSON-RPC over stdin/stdout
//    - print → runPrintMode(session, prompt) → 一次性 CLI`,
      explanation: '理解启动流程能帮你建立对 Pi 整体架构的认知。AgentSession 是核心——它创建了后续所有章节讲到的组件。',
    },
    {
      title: '实现一个最小 Agent Loop 的伪代码',
      prompt: '不看书上的代码，根据本节学到的"感知→思考→行动"三步循环，写出一个最小 Agent Loop 的伪代码（不超过 20 行）。\n\n要求：\n1. 包含 while 循环\n2. 区分 LLM 直接回复和 LLM 请求调用工具两种情况\n3. 有循环退出条件',
      hint: '参考 1.3 节的循环描述。核心判断逻辑：LLM 的 stopReason 是什么？如果是 "toolUse" 就执行工具再循环，如果是 "stop" 就退出。',
      answer: `async function agentLoop(messages, tools) {
  while (true) {
    // 1. 感知：把当前消息历史发给 LLM
    const response = await callLLM(messages, tools);

    // 2. 把 LLM 回复加入历史
    messages.push(response);

    // 3. 思考+行动：检查 LLM 是要回复还是要调工具
    if (response.stopReason === 'toolUse') {
      // LLM 请求调用工具 — 执行工具，结果加入历史，继续循环
      for (const tc of response.toolCalls) {
        const result = await executeTool(tc.name, tc.args);
        messages.push({ role: 'toolResult', content: result });
      }
      continue;  // 回到循环开头，让 LLM 看到工具结果
    }

    // 4. LLM 直接回复 — 任务完成
    return response.content;
  }
}`,
      explanation: '这就是 Agent Loop 的本质——和后面第4章要深入学习的内容完全一致，只是第4章的版本多了错误处理、事件通知、steering 队列等工程化细节。',
    },
  ],

  summary: [
    'Coding Agent 是能用工具的 AI 程序，不只是聊天，还能读写文件、搜索代码、执行命令',
    '核心公式：Coding Agent = LLM（大脑）+ 工具（手脚）+ 循环（自主决策）',
    'Agent Loop 是 Coding Agent 的心脏：感知→思考→行动 的循环直到任务完成',
    '本课程以开源的 Pi Agent 为例，从浅入深讲解如何构建一个完整的 Coding Agent',
  ],
});
