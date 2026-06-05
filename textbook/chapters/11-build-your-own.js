window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 11,
  title: '动手构建：一个真实可运行的 TUI Coding Agent',
  desc: '用 300 行 Node.js 代码构建一个真正能跑的终端 Coding Agent — 支持流式输出、5个真实工具、交互式对话。',

  objectives: [
    '构建一个真实可运行的 TUI Coding Agent（node agent.js 直接启动）',
    '理解流式 SSE 解析：ReadableStream → 逐 token 终端输出',
    '实现 5 个真实工具：read_file、write_file、bash、grep、ls',
    '串联前9章知识：Agent Loop + 工具系统 + LLM 调用 + 安全防护',
  ],

  render(container) {
    // Section 1: 成果预览
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>11.1 成果预览：你能构建什么</h2>
      <p>本章结束时，你将拥有一个<strong>真实可运行的终端 Coding Agent</strong>：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">终端运行效果</span></div>
        <pre><code class="language-plaintext">$ export OPENAI_API_KEY=sk-...
$ node agent.js

╔══════════════════════════════════╗
║   🛠  mini-coding-agent         ║
║   精简版 TUI Coding Agent        ║
╚══════════════════════════════════╝
输入你的编程任务，或输入 /exit 退出

> 帮我创建一个 Express.js Hello World 服务器

🤖 mini-coding-agent 启动
   模型: gpt-4o | 最大轮次: 25

--- Turn 1 ---
我先看看当前目录有什么文件
🔧 ls {}
📄 package.json
📁 src/

--- Turn 2 ---
现在创建一个 server.js 文件
🔧 write_file {"file_path":"server.js","content":"const express..."}
✅ 已写入 server.js (234 字符)

--- Turn 3 ---
安装依赖并测试运行
🔧 bash {"command":"npm install express && node server.js &"}
依赖安装完成...
服务器运行在 http://localhost:3000

✅ 任务完成</code></pre>
      </div>

      <div class="info-card">
        <h4>🔥 这不是伪代码</h4>
        <p>代码在 <code>textbook/mini-agent/agent.js</code>，<strong>零外部依赖、纯 Node.js 标准库</strong>。设置 API Key 就能直接运行。</p>
      </div>
    `;
    container.appendChild(s1);

    // Section 2: 项目结构
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>11.2 项目结构：一个文件搞定一切</h2>
      <p>我们不拆多个文件——<strong>所有代码在一个 agent.js 中</strong>，方便理解和运行：</p>
      <div class="ft"><span class="dir">mini-agent/</span>
├── <span class="file">package.json</span>    <span class="cmt"># type: module</span>
└── <span class="file">agent.js</span>        <span class="cmt"># ~300 行，全部代码</span></div>
      <p>代码按功能分为 6 个区块，每个对应前几章的知识：</p>
      <table class="content-table">
        <tr><th>区块</th><th>行数</th><th>功能</th><th>对应章节</th></tr>
        <tr><td>工具系统</td><td>~120 行</td><td>read_file, write_file, bash, grep, ls</td><td>第5章</td></tr>
        <tr><td>LLM 调用</td><td>~60 行</td><td>流式 SSE 解析，逐 token 输出</td><td>第3章</td></tr>
        <tr><td>System Prompt</td><td>~20 行</td><td>定义 Agent 行为规则</td><td>第7章</td></tr>
        <tr><td>Agent Loop</td><td>~30 行</td><td>while 循环 + 工具调用</td><td>第4章</td></tr>
        <tr><td>交互式 TUI</td><td>~30 行</td><td>readline 终端交互（简化版），详见第10章 Pi 的完整 TUI 实现</td><td>第10章</td></tr>
        <tr><td>配置 + 入口</td><td>~15 行</td><td>环境变量 + CLI 参数</td><td>—</td></tr>
      </table>
    `;
    container.appendChild(s2);

    // Section 3: 工具系统
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>11.3 Step 1：实现 5 个真实工具</h2>
      <p>每个工具遵循统一接口：<code>{ name, description, parameters(JSON Schema), execute(args) }</code>。LLM 通过 JSON Schema 知道如何调用，Agent Loop 通过 execute() 执行。</p>

      <h3>read_file — 读取文件</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — read_file 工具</span></div>
        <pre><code class="language-javascript">read_file: {
  name: "read_file",
  description: "读取文件内容。支持指定行范围",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "文件路径" },
      offset:     { type: "number", description: "起始行号(1-based)" },
      limit:      { type: "number", description: "最多读取行数，默认2000" },
    },
    required: ["file_path"],
  },
  async execute(args) {
    const fp = path.resolve(CWD, args.file_path);
    if (!fp.startsWith(CWD)) return "Error: 不允许访问项目目录之外的文件";
    let content = fs.readFileSync(fp, "utf-8");
    let lines = content.split("\\n");
    if (args.offset) lines = lines.slice(args.offset - 1);
    if (args.limit) lines = lines.slice(0, args.limit);
    else lines = lines.slice(0, 2000);
    const result = lines.join("\\n");
    if (result.length > 50000) return result.slice(0, 50000) +
      \`\\n... (截断，共 \${lines.length} 行)\`;
    return result || "(空文件)";
  },
},</code></pre>
      </div>

      <h3>write_file — 写入文件</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — write_file 工具</span></div>
        <pre><code class="language-javascript">write_file: {
  name: "write_file",
  description: "创建新文件或完全覆盖已有文件",
  parameters: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "文件路径" },
      content:   { type: "string", description: "完整文件内容" },
    },
    required: ["file_path", "content"],
  },
  async execute(args) {
    const fp = path.resolve(CWD, args.file_path);
    if (!fp.startsWith(CWD)) return "Error: 不允许写入项目目录之外的文件";
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, args.content, "utf-8");
    return \`✅ 已写入 \${args.file_path} (\${args.content.length} 字符)\`;
  },
},</code></pre>
      </div>

      <h3>bash — 执行命令</h3>
      <p>使用 <code>execSync</code> 同步执行，30秒超时 + 1MB输出限制：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — bash 工具</span></div>
        <pre><code class="language-javascript">bash: {
  name: "bash",
  description: "在项目目录中执行 shell 命令",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "命令" },
    },
    required: ["command"],
  },
  async execute(args) {
    try {
      const out = execSync(args.command, {
        cwd: CWD, timeout: 30000, maxBuffer: 1024 * 1024,
        encoding: "utf-8",
      });
      return out || "(命令执行成功，无输出)";
    } catch (e) {
      return \`Error (exit \${e.status}): \${e.stderr || e.message}\`;
    }
  },
},</code></pre>
      </div>

      <h3>grep 和 ls</h3>
      <p>grep 用 <code>walkDir()</code> 递归遍历项目文件，用正则匹配每一行。ls 调用 <code>fs.readdirSync</code> 并区分目录/文件。完整代码见 agent.js。</p>

      <div class="callout cl-info">
        <strong>🔑 关键设计：统一的工具接口</strong><br>
        5 个工具使用完全相同的接口格式（name + description + parameters + execute）。这让 Agent Loop 可以通用地处理所有工具——不需要知道每个工具的具体实现，只需要通过名称查找并调用 execute()。
      </div>
    `;
    container.appendChild(s3);

    // Section 4: LLM 调用
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>11.4 Step 2：流式 LLM 调用（SSE 解析）</h2>
      <p>这是整个 Agent 中最"技术"的部分——解析 OpenAI 兼容的 SSE（Server-Sent Events）流，逐 token 输出到终端。</p>

      <h3>核心：ReadableStream → 逐行 SSE → 逐 token 输出</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — callLLM() 完整实现</span></div>
        <pre><code class="language-javascript">async function callLLM(messages, toolDefs) {
  const body = { model: MODEL, messages, stream: true };
  if (toolDefs.length > 0) {
    body.tools = toolDefs.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const res = await fetch(\`\${BASE_URL}/chat/completions\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": \`Bearer \${API_KEY}\` },
    body: JSON.stringify(body),
  });

  // === 流式消费 ===
  const reader = res.body.getReader();      // 拿到 ReadableStream reader
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallAcc = {};   // 按 index 累积工具调用片段
  let textContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 按行分割（SSE 一行一个事件）
    const lines = buffer.split("\\n");
    buffer = lines.pop() || "";  // 保留不完整的最后一行

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      const json = JSON.parse(data);
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      // 逐 token 输出文本（青色）
      if (delta.content) {
        textContent += delta.content;
        process.stdout.write("\\x1b[36m" + delta.content + "\\x1b[0m");
      }

      // 累积工具调用片段
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const acc = toolCallAcc[tc.index] ||
            (toolCallAcc[tc.index] = { id: "", name: "", arguments: "" });
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
    }
  }

  return {
    content: textContent,
    toolCalls: Object.values(toolCallAcc).filter(tc => tc.name),
    finishReason: Object.keys(toolCallAcc).length > 0 ? "tool_calls" : "stop",
  };
}</code></pre>
      </div>

      <div class="callout cl-tip">
        <strong>💡 关键细节</strong>
        <ul>
          <li><strong>buffer 处理</strong>：TCP 流可能在一个 chunk 的中间断开。保留最后不完整的行，等下一个 chunk 再拼接。</li>
          <li><strong>工具调用累积</strong>：LLM 可能分多个 delta 发送同一个工具调用的 name 和 arguments。用 toolCallAcc[tc.index] 按索引累积。</li>
          <li><strong>ANSI 转义码</strong>：<code>\\x1b[36m</code> 是青色，让 LLM 输出在终端中有颜色区分。</li>
        </ul>
      </div>
    `;
    container.appendChild(s4);

    // Section 5: Agent Loop
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>11.5 Step 3：Agent Loop — 把所有东西串起来</h2>
      <p>回顾第4章：Agent Loop 就是一个 while 循环——调 LLM → 检查是否有工具调用 → 执行工具 → 结果送回 LLM → 循环。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — run() 函数（Agent Loop）</span></div>
        <pre><code class="language-javascript">async function run(prompt) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  const toolDefs = Object.values(tools).map(t => ({
    name: t.name, description: t.description, parameters: t.parameters,
  }));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // ❶ 调用 LLM（流式输出到终端）
    const response = await callLLM(messages, toolDefs);

    // ❷ LLM 直接回复 → 任务完成
    if (response.finishReason === "stop") {
      console.log("\\n✅ 任务完成");
      return;
    }

    // ❸ 有工具调用 → 执行工具 → 结果加入消息历史
    messages.push({
      role: "assistant",
      content: response.content || null,
      tool_calls: response.toolCalls.map(tc => ({
        id: tc.id, type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of response.toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.arguments); } catch {}

      const tool = tools[tc.name];
      const result = tool ? await tool.execute(args)
        : \`Error: 未知工具 "\${tc.name}"\`;

      // 截断过长结果
      const truncated = result.length > 8000
        ? result.slice(0, 8000) + "..."
        : result;

      // 结果作为 tool 消息加入历史
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: truncated,
      });
    }
    // ❹ 回到循环顶部，让 LLM 看到工具结果后决定下一步
  }
}</code></pre>
      </div>

      <p>对比这个循环和第4章 Pi Agent 的 runLoop——<strong>一模一样</strong>。区别只是 Pi 多了错误处理、事件通知、steering 队列、并行工具执行。但骨架就是这个 30 行的 while 循环。</p>
    `;
    container.appendChild(s5);

    // Section 6: TUI
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>11.6 Step 4：交互式终端界面</h2>
      <p>用 Node.js 内置的 <code>readline</code> 实现一个简洁的交互式 TUI：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">agent.js — interactiveMode()</span></div>
        <pre><code class="language-javascript">async function interactiveMode() {
  // 打印欢迎界面
  console.log("╔══════════════════════════════════╗");
  console.log("║   🛠  mini-coding-agent         ║");
  console.log("║   精简版 TUI Coding Agent        ║");
  console.log("╚══════════════════════════════════╝");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  const ask = () => {
    rl.prompt();
    rl.once("line", async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input === "/exit") { rl.close(); process.exit(0); }
      await run(input);  // 调用 Agent Loop
      console.log("");
      ask();              // 继续等待下一条输入
    });
  };
  ask();
}</code></pre>
      </div>
      <p>整个 TUI 只有 ~25 行代码。readline 负责接收输入和显示提示符，run() 负责 Agent 逻辑。交互模式和单次任务模式共享同一个 run() 函数——这正是分层设计的好处。</p>
    `;
    container.appendChild(s6);

    // Section 7: 运行
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>11.7 运行你的 Agent</h2>
      <div class="steps">
        <li>
          <strong>设置 API Key</strong>
          <div class="code-block"><div class="code-label"><span class="file-path">终端</span></div>
          <pre><code class="language-bash">export OPENAI_API_KEY=sk-...
# 可选：使用其他兼容 API
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_MODEL=deepseek-chat</code></pre></div>
        </li>
        <li>
          <strong>交互模式运行</strong>
          <div class="code-block"><div class="code-label"><span class="file-path">终端</span></div>
          <pre><code class="language-bash">cd textbook/mini-agent
node agent.js</code></pre></div>
        </li>
        <li>
          <strong>单次任务模式</strong>
          <div class="code-block"><div class="code-label"><span class="file-path">终端</span></div>
          <pre><code class="language-bash">node agent.js "创建一个 Express 服务器"</code></pre></div>
        </li>
      </div>

      <div class="callout cl-warn">
        <strong>⚠️ 安全提醒</strong><br>
        这个 Agent 可以执行 shell 命令和写入文件。请在测试项目中使用，不要在重要项目目录中运行。
      </div>
    `;
    container.appendChild(s7);

    // Section 8: 与前9章对照
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>11.8 对照前9章：你的 mini-agent 和 Pi Agent 的对应关系</h2>
      <table class="content-table">
        <tr><th>mini-agent 中</th><th>Pi Agent 中</th><th>差异</th></tr>
        <tr><td><code>callLLM()</code> (60行)</td><td><code>packages/ai/</code> (~5000行)</td><td>Pi 支持 9 种 API、35 个 Provider、延迟加载</td></tr>
        <tr><td><code>while (turn < MAX)</code> (30行)</td><td><code>packages/agent/src/agent-loop.ts</code> (~400行)</td><td>Pi 有双层循环、事件流、steering/follow-up 队列</td></tr>
        <tr><td><code>tools</code> 对象 (120行)</td><td><code>packages/coding-agent/src/core/tools/</code> (~2000行)</td><td>Pi 有 7 个工具、双层架构、并发写队列、模糊匹配</td></tr>
        <tr><td><code>SYSTEM_PROMPT</code> 常量 (20行)</td><td><code>buildSystemPrompt()</code> (~500行)</td><td>Pi 动态构建，加载 CLAUDE.md、skills、扩展</td></tr>
        <tr><td>无持久化</td><td><code>session-manager.ts</code> (~800行)</td><td>Pi 有 JSONL 树形存储、上下文压缩、多分支</td></tr>
        <tr><td><code>if (!fp.startsWith(CWD))</code></td><td><code>beforeToolCall</code> 钩子 + 白名单</td><td>Pi 有完整的扩展安全审计链</td></tr>
      </table>
      <p>你现在拥有了 Coding Agent 的全部核心骨架。去看 Pi 的源码，你会发现——<strong>你全都能看懂</strong>。</p>
    `;
    container.appendChild(s8);

    // Section 9: 扩展方向
    const s9 = document.createElement('div');
    s9.className = 'content-section';
    s9.innerHTML = `
      <h2>11.9 课程总结</h2>
      <table class="content-table">
        <tr><th>章节</th><th>内容</th><th>在 Pi Agent 中的位置</th></tr>
        <tr><td>1-2</td><td>概念入门 + 架构全景</td><td>建立对 Coding Agent 的整体认知</td></tr>
        <tr><td>3</td><td>LLM 抽象层</td><td>packages/ai — 多 Provider 统一接口</td></tr>
        <tr><td>4</td><td>Agent Loop 核心</td><td>packages/agent — 双层 while 循环</td></tr>
        <tr><td>5</td><td>工具体系</td><td>packages/coding-agent/src/core/tools</td></tr>
        <tr><td>6</td><td>会话管理</td><td>JSONL 持久化 + 树形上下文</td></tr>
        <tr><td>7</td><td>System Prompt</td><td>动态构建 + 多源注入</td></tr>
        <tr><td>8</td><td>扩展系统</td><td>事件驱动插件体系</td></tr>
        <tr><td>9</td><td>安全与可靠性</td><td>三层错误处理 + 安全防护链</td></tr>
        <tr><td><strong>10</strong></td><td><strong>动手实践</strong></td><td><strong>mini-agent/agent.js — 300行，能跑！</strong></td></tr>
      </table>
    `;
    container.appendChild(s9);
  },

  challenges: [
    {
      title: '基础：让 Agent 跑起来',
      tasks: [
        '设置 OPENAI_API_KEY 环境变量',
        'cd textbook/mini-agent && node agent.js 启动交互模式',
        '输入 "列出当前目录的文件" 验证 Agent 能正常调用工具',
      ],
    },
    {
      title: '进阶：添加 edit_file 工具',
      tasks: [
        '参考 read_file 和 write_file，实现 edit_file 工具',
        'edit_file 接收 file_path、old_string、new_string 三个参数',
        '在文件中查找 old_string，替换为 new_string，返回替换结果',
        '注意：old_string 必须在文件中唯一存在',
      ],
    },
    {
      title: '进阶：添加流式工具输出',
      tasks: [
        '给 bash 工具添加流式输出：用 spawn 替换 execSync',
        '在子进程的 stdout.on("data") 中实时打印输出',
        '用 setTimeout 实现超时控制',
        '参考第9章的安全防护链',
      ],
    },
    {
      title: '高级：添加会话持久化',
      tasks: [
        '在每次对话结束后，将 messages 数组保存为 JSONL 文件到 ~/.mini-agent/sessions/',
        '实现 --resume 参数：加载最近的 session 文件继续对话',
        '参考第6章的 Session 管理设计',
      ],
    },
    {
      title: '大师：支持多 Provider',
      tasks: [
        '添加 Anthropic API 支持（/v1/messages 端点，不同的事件格式）',
        '参考第3章的 Provider 抽象层设计',
        '让 Agent 可以通过环境变量切换 OpenAI / Anthropic',
      ],
    },
  ],

  summary: [
    'mini-agent 是一个 300 行、零依赖、真实可用的 TUI Coding Agent（textbook/mini-agent/agent.js）',
    '包含 5 个真实工具：read_file, write_file, bash, grep, ls — 每个都有安全检查',
    '流式 SSE 解析：ReadableStream → 逐行分割 → delta 累积 → 逐 token 终端输出',
    'Agent Loop = while 循环：调 LLM → 解析响应 → 执行工具 → 结果送回 LLM → 循环',
    '对比 mini-agent 和 Pi Agent，你会发现核心骨架完全相同，差异只在工程化程度',
    '从这个 300 行的骨架开始，你可以逐步添加前9章学到的任何特性',
  ],
});
