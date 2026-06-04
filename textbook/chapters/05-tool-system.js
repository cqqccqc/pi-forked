/**
 * 第5章：工具系统 — Agent 的手脚
 *
 * 深入理解 7 大核心工具的设计——双层架构、执行流水线和安全控制。
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 5,
  title: '工具系统：让 Agent 能读、能写、能执行',
  desc: '深入理解 7 大核心工具的设计——双层架构、执行流水线和安全控制。',

  objectives: [
    '理解 ToolDefinition 与 AgentTool 的分离设计',
    '掌握 7 大核心工具各自的功能与实现要点',
    '理解工具执行流水线（验证→钩子→执行→结果）',
    '了解工具如何注册和发现',
  ],

  render(container) {
    // === Section 1: 为什么需要工具 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>5.1 为什么 Agent 需要工具</h2>
      <p>LLM 本质上是一个"缸中之脑"——它能思考、能推理，但无法接触外部世界。它不能读文件、不能执行命令、不能搜索代码库。如果只是和 LLM 聊天，你得到的永远是纯文本回复。</p>
      <p><strong>工具（Tools）就是 Agent 的手脚。</strong>它们把 LLM 的"想法"转化为真实的文件系统操作。</p>

      <div class="info-card">
        <h4>核心洞察</h4>
        <p style="font-size:1.1rem;text-align:center;margin:12px 0;">
          Agent 的每一条有意义的行为，最终都落实为一个工具调用。没有工具，Agent 只是一个聊天机器人。
        </p>
      </div>

      <p>Pi Agent 提供了 <strong>7 大核心工具</strong>，覆盖了日常编程所需的全部文件系统操作：</p>
      <table class="content-table">
        <tr><th>工具名</th><th>功能</th><th>类型</th><th>外部依赖</th></tr>
        <tr><td><code>read</code></td><td>读取文件内容（文本/图片/PDF）</td><td>只读</td><td>无</td></tr>
        <tr><td><code>bash</code></td><td>执行 shell 命令</td><td>读写</td><td>shell</td></tr>
        <tr><td><code>edit</code></td><td>精确文本替换（old_string → new_string）</td><td>读写</td><td>无</td></tr>
        <tr><td><code>write</code></td><td>创建或覆盖文件</td><td>读写</td><td>无</td></tr>
        <tr><td><code>grep</code></td><td>正则搜索文件内容</td><td>只读</td><td>ripgrep</td></tr>
        <tr><td><code>find</code></td><td>按 glob 模式查找文件</td><td>只读</td><td>fd</td></tr>
        <tr><td><code>ls</code></td><td>列出目录内容</td><td>只读</td><td>无</td></tr>
      </table>

      <div class="info-card tip">
        <h4>类型安全</h4>
        <p>工具名称被定义为 TypeScript 联合类型 <code>ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"</code>，任何拼写错误都会在编译时被捕获。</p>
      </div>
    `;
    container.appendChild(s1);

    // === Section 2: 双层架构 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>5.2 双层架构：ToolDefinition 与 AgentTool</h2>
      <p>工具系统的设计核心是<strong>关注点分离</strong>。每个工具被拆分为两层：</p>

      <div class="diagram-container">
        <div class="diagram-caption">▲ 工具双层架构</div>
      </div>

      <h3>ToolDefinition（定义 + UI 渲染）</h3>
      <p><code>ToolDefinition</code> 定义了工具的"元信息"和 UI 表现：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><code>name</code> — 工具的唯一标识（如 "read"）</li>
        <li><code>label</code> — 终端显示名称</li>
        <li><code>description</code> — 发送给 LLM 的工具描述</li>
        <li><code>parameters</code> — TypeBox Schema，定义参数的 JSON Schema</li>
        <li><code>execute()</code> — 执行逻辑，返回 <code>{ content, details }</code></li>
        <li><code>renderCall()</code> — 渲染工具调用（TUI 中的调用展示）</li>
        <li><code>renderResult()</code> — 渲染工具结果（TUI 中的结果展示）</li>
      </ul>

      <h3>AgentTool（运行时执行）</h3>
      <p><code>AgentTool</code> 是 Agent 运行时看到的接口。它通过 <code>wrapToolDefinition()</code> 从 ToolDefinition 转换而来，额外提供：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><code>executionMode</code> — "sequential"（顺序执行）或 "parallel"（并行执行）</li>
        <li><code>prepareArguments()</code> — 参数预处理（用于 edit 等需要预处理参数的工具）</li>
      </ul>

      <div class="info-card tip">
        <h4>为什么分离？</h4>
        <p>同一工具在不同模式（interactive TUI / RPC / CLI）下需要不同的渲染实现。分离后，执行逻辑共用，渲染逻辑各自定制。扩展系统也只需要了解 <code>ToolDefinition</code> 接口。</p>
      </div>
    `;
    container.appendChild(s2);
    // Render the tool architecture diagram
    const archDiv = s2.querySelector('.diagram-container');
    Diagrams.drawToolArchitecture(archDiv);

    // === Section 3: 7 大核心工具详解 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>5.3 七大核心工具详解</h2>

      <h3>5.3.1 Read — 读取文件</h3>
      <p>Read 是最常用的工具，负责将文件内容送入 LLM 的上下文窗口。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>行范围读取</td><td><code>offset</code>（1-based 起始行）和 <code>limit</code>（最大行数）参数</td></tr>
        <tr><td>图片支持</td><td>自动检测 MIME 类型（jpg/png/gif/webp），发送为 image content block</td></tr>
        <tr><td>图片缩放</td><td>自动缩放至 2000x2000 以内，避免 token 超限</td></tr>
        <tr><td>截断保护</td><td>默认限制 2000 行或 50KB（以先触发者为准）</td></tr>
        <tr><td>续读提示</td><td>截断后提供 <code>offset=N</code> 的续读指引</td></tr>
        <tr><td>路径解析</td><td>处理 macOS 截图文件（AM/PM 特殊空格、NFD 规范化、智能引号）</td></tr>
        <tr><td>非视觉模型</td><td>当模型不支持图片输入时，自动省略图片并添加提示</td></tr>
        <tr><td>Compact 分类</td><td>对 SKILL.md、CLAUDE.md、AGENTS.md 和 docs/ 文件自动折叠显示</td></tr>
      </table>

      <h3>5.3.2 Bash — 执行命令</h3>
      <p>Bash 是功能最强大的工具，也是安全性最关键的工具。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>超时控制</td><td><code>timeout</code> 参数（秒），超时后发送 SIGKILL 终止进程树</td></tr>
        <tr><td>流式输出</td><td>通过 <code>onUpdate</code> 回调实时推送输出，节流 100ms</td></tr>
        <tr><td>截断保护</td><td>默认保留最后 2000 行或 50KB，完整输出写入临时文件</td></tr>
        <tr><td>进程树管理</td><td>detached 模式下追踪子进程 PID，中止时递归 kill 整个进程树</td></tr>
        <tr><td>Spawn Hook</td><td>支持 <code>spawnHook</code> 动态修改命令、工作目录和环境变量</td></tr>
        <tr><td>命令前缀</td><td><code>commandPrefix</code> 在每个命令前自动插入（如激活虚拟环境）</td></tr>
        <tr><td>OutputAccumulator</td><td>滚动窗口 + 临时文件，防止内存无限增长</td></tr>
      </table>

      <div class="code-block">
        <div class="code-label"><span class="file-path">bash.ts — 流式更新机制</span></div>
        <pre><code class="language-typescript">const BASH_UPDATE_THROTTLE_MS = 100;

const scheduleOutputUpdate = () => {
  updateDirty = true;
  const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
  if (delay <= 0) {
    emitOutputUpdate();      // 距离上次更新已超过 100ms，立刻发送
  } else {
    setTimeout(emitOutputUpdate, delay);  // 延迟到下次节流窗口
  }
};</code></pre>
      </div>

      <h3>5.3.3 Edit — 精确文本替换</h3>
      <p>Edit 是代码修改的核心工具，基于"原字符串 → 新字符串"的精确替换模式。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>多编辑支持</td><td>单次调用可包含多个 <code>edits</code>（<code>oldText → newText</code> 对）</td></tr>
        <tr><td>Unified Patch</td><td>所有 edit 都基于原始文件匹配，非增量应用</td></tr>
        <tr><td>模糊匹配</td><td>Unicode 规范化（NFKC）、去除尾随空白、智能引号转 ASCII</td></tr>
        <tr><td>重叠检测</td><td>检测多个 edit 的替换范围是否重叠，防止破坏性编辑</td></tr>
        <tr><td>唯一性检查</td><td>oldText 必须在文件中唯一（防止意外修改多处）</td></tr>
        <tr><td>行尾符保持</td><td>自动检测并保持原文件的 CRLF/LF 行尾格式</td></tr>
        <tr><td>并发安全</td><td>通过 <code>file-mutation-queue</code> 确保同一文件串行写入</td></tr>
        <tr><td>兼容模式</td><td>自动处理某些模型发送 JSON 字符串而非数组的 edits 参数</td></tr>
      </table>

      <h3>5.3.4 Write — 创建/覆盖文件</h3>
      <p>Write 用于创建新文件或完全覆盖已有文件。与 Edit 的区别：Write 是全量替换，Edit 是精确修改。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>自动创建目录</td><td>递归 <code>mkdir</code> 父目录</td></tr>
        <tr><td>语法高亮</td><td>基于文件扩展名识别语言，增量更新缓存（前 50 行全量刷新）</td></tr>
        <tr><td>并发安全</td><td>通过 <code>file-mutation-queue</code> 串行化同文件操作</td></tr>
        <tr><td>流式渲染</td><td><code>WriteCallRenderComponent</code> 支持流式参数输入的增量高亮</td></tr>
      </table>

      <h3>5.3.5 Grep — 内容搜索</h3>
      <p>Grep 基于 ripgrep 实现文件内容搜索。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>正则搜索</td><td>底层调用 ripgrep (<code>rg --json --line-number</code>)，流式解析 JSON 事件</td></tr>
        <tr><td>字面量搜索</td><td><code>literal</code> 参数切换 <code>--fixed-strings</code> 模式</td></tr>
        <tr><td>文件过滤</td><td><code>glob</code> 参数（如 <code>*.ts</code>）传递 <code>--glob</code> 给 ripgrep</td></tr>
        <tr><td>上下文显示</td><td><code>context</code> 参数控制匹配行前后显示的行数</td></tr>
        <tr><td>匹配限制</td><td>默认 100 匹配，超限后 kill ripgrep 节省资源</td></tr>
        <tr><td>缓存优化</td><td><code>fileCache</code> 避免重复读取同一文件的多行上下文</td></tr>
        <tr><td>可插拔</td><td><code>GrepOperations</code> 接口支持远程文件系统</td></tr>
        <tr><td>格式化约定</td><td>匹配行用 <code>:</code> 分隔，上下文行用 <code>-</code> 分隔</td></tr>
      </table>

      <h3>5.3.6 Find — 文件查找</h3>
      <p>Find 基于 fd 实现按 glob 模式查找文件。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>Glob 匹配</td><td>支持 <code>**/*.ts</code>、<code>src/**/*.spec.ts</code> 等语法</td></tr>
        <tr><td>智能前缀</td><td>包含 <code>/</code> 的 pattern 自动启用 <code>--full-path</code> 并添加 <code>**/</code> 前缀</td></tr>
        <tr><td>.gitignore</td><td><code>--no-require-git</code> 标志，即使不在 git 仓库也应用 .gitignore</td></tr>
        <tr><td>双重限制</td><td>默认 1000 结果或 50KB 字节限制</td></tr>
        <tr><td>可插拔</td><td><code>FindOperations.glob</code> 接口支持自定义文件系统（如 SSH）</td></tr>
        <tr><td>目录标记</td><td>保留路径中的目录尾部 <code>/</code></td></tr>
      </table>

      <h3>5.3.7 Ls — 列出目录</h3>
      <p>Ls 是最简单的工具，列出目录内容。</p>
      <table class="content-table">
        <tr><th>特性</th><th>实现</th></tr>
        <tr><td>字母排序</td><td>不区分大小写的 <code>localeCompare</code></td></tr>
        <tr><td>目录标记</td><td>目录名后添加 <code>/</code> 后缀</td></tr>
        <tr><td>包含隐藏文件</td><td>默认列出所有条目（含 <code>.</code> 开头）</td></tr>
        <tr><td>双重限制</td><td>默认 500 条目或 50KB</td></tr>
        <tr><td>可插拔</td><td><code>LsOperations</code> 接口支持远程文件系统</td></tr>
        <tr><td>空目录</td><td>返回 <code>(empty directory)</code></td></tr>
      </table>
    `;
    container.appendChild(s3);

    // === Section 4: 工具执行流水线 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>5.4 工具执行流水线</h2>
      <p>每个工具调用都经过一条严格的流水线：</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ 工具执行流水线</div>
      </div>
      <p>这条流水线确保了：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>参数验证</strong>：TypeBox Schema 在 <code>prepareArguments()</code> 阶段验证，非法参数提前拦截</li>
        <li><strong>钩子介入</strong>：扩展可以在执行前后检查和修改行为（<code>beforeToolCall</code> 可阻止执行，<code>afterToolCall</code> 可修改结果）</li>
        <li><strong>中止处理</strong>：<code>AbortSignal</code> 贯穿全程，用户取消时立刻停止</li>
        <li><strong>事件通知</strong>：每个阶段都有对应事件（<code>tool_execution_start</code> / <code>tool_execution_update</code> / <code>tool_execution_end</code>）</li>
      </ul>

      <h3>Sequential vs Parallel 执行</h3>
      <p>工具支持两种执行模式：</p>
      <table class="content-table">
        <tr><th>模式</th><th>流程</th><th>适用场景</th></tr>
        <tr><td>Sequential</td><td>准备→执行→Hook→结果→消息，逐个完成</td><td>有依赖关系的工具调用</td></tr>
        <tr><td>Parallel</td><td>阶段1：顺序准备所有工具；阶段2：并发执行；阶段3：按序发送消息</td><td>独立的只读操作（如同时读多个文件）</td></tr>
      </table>
      <p>当任一工具声明 <code>executionMode: "sequential"</code> 或全局配置为 sequential 时，退化为顺序执行。</p>
    `;
    container.appendChild(s4);
    // Render the tool flow diagram
    const toolFlowDiv = s4.querySelector('.diagram-container');
    Diagrams.drawToolFlow(toolFlowDiv);

    // === Section 5: 工具注册与工厂 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>5.5 工具的注册与发现</h2>
      <p>每个工具提供<strong>两个工厂函数</strong>和<strong>一个统一注册表</strong>：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/tools/index.ts — 工具注册表</span></div>
        <pre><code class="language-typescript">// 工厂函数模式：createXXXToolDefinition() → ToolDefinition
//              createXXXTool() → AgentTool

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
  switch (toolName) {
    case "read":  return createReadToolDefinition(cwd, options?.read);
    case "bash":  return createBashToolDefinition(cwd, options?.bash);
    case "edit":  return createEditToolDefinition(cwd, options?.edit);
    case "write": return createWriteToolDefinition(cwd, options?.write);
    case "grep":  return createGrepToolDefinition(cwd, options?.grep);
    case "find":  return createFindToolDefinition(cwd, options?.find);
    case "ls":    return createLsToolDefinition(cwd, options?.ls);
    default: throw new Error(\`Unknown tool name: \${toolName}\`);
  }
}

// 按权限分组
export function createCodingToolDefinitions(cwd, options?): ToolDef[] {
  return [read, bash, edit, write];  // 完整权限
}

export function createReadOnlyToolDefinitions(cwd, options?): ToolDef[] {
  return [read, grep, find, ls];     // 只读权限
}</code></pre>
      </div>

      <h3>可插拔的 Operations 接口</h3>
      <p>每个涉及 I/O 的工具都提供 <code>Operations</code> 接口，允许替换底层实现：</p>
      <table class="content-table">
        <tr><th>工具</th><th>Operations 接口关键方法</th></tr>
        <tr><td>read</td><td><code>readFile()</code>, <code>access()</code>, <code>detectImageMimeType()</code></td></tr>
        <tr><td>bash</td><td><code>exec()</code> — 替换整个命令执行后端</td></tr>
        <tr><td>write</td><td><code>writeFile()</code>, <code>mkdir()</code></td></tr>
        <tr><td>edit</td><td><code>readFile()</code>, <code>writeFile()</code></td></tr>
        <tr><td>grep</td><td><code>isDirectory()</code>, <code>readFile()</code></td></tr>
        <tr><td>find</td><td><code>exists()</code>, <code>glob()</code></td></tr>
        <tr><td>ls</td><td><code>exists()</code>, <code>stat()</code>, <code>readdir()</code></td></tr>
      </table>
      <p>这使得工具可以无缝切换到远程文件系统（SSH、Docker 容器等），而不需要修改任何工具内部逻辑。</p>

      <h3>并发写安全：file-mutation-queue</h3>
      <p>当多个工具调用同时写入同一文件时，<code>withFileMutationQueue()</code> 确保它们串行执行。不同文件的写操作仍然可以并行。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">file-mutation-queue.ts — 核心模式</span></div>
        <pre><code class="language-typescript">// 每个文件一个 Promise 链
const fileMutationQueues = new Map&lt;string, Promise&lt;void&gt;&gt;();

export async function withFileMutationQueue&lt;T&gt;(filePath: string, fn: () =&gt; Promise&lt;T&gt;): Promise&lt;T&gt; {
  const key = await getMutationQueueKey(filePath);  // 解析为真实路径
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();
  // 将新操作链接到当前队列之后
  let releaseNext!: () =&gt; void;
  const nextQueue = new Promise&lt;void&gt;(resolve =&gt; { releaseNext = resolve; });
  fileMutationQueues.set(key, currentQueue.then(() =&gt; nextQueue));
  await currentQueue;  // 等待前面的操作完成
  try { return await fn(); }
  finally { releaseNext(); }
}</code></pre>
      </div>
    `;
    container.appendChild(s5);

    // === Section 6: 工具设计原则总结 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>5.6 关键设计总结</h2>
      <table class="content-table">
        <tr><th>设计特性</th><th>实现方式</th><th>设计目标</th></tr>
        <tr><td>双层架构</td><td>ToolDefinition（UI）+ AgentTool（运行时）</td><td>分离关注点，支持多种渲染模式</td></tr>
        <tr><td>工具注册</td><td>工厂函数 + 名称映射</td><td>类型安全，易于扩展</td></tr>
        <tr><td>执行策略</td><td>Sequential vs Parallel</td><td>平衡并发安全和性能</td></tr>
        <tr><td>并发安全</td><td>file-mutation-queue（文件级队列）</td><td>防止写冲突，不同文件仍可并行</td></tr>
        <tr><td>流式更新</td><td>onUpdate 回调 + 节流</td><td>实时反馈，避免事件洪水</td></tr>
        <tr><td>截断保护</td><td>行数/字节数双重限制</td><td>防止内存爆炸和 token 超限</td></tr>
        <tr><td>钩子系统</td><td>beforeToolCall / afterToolCall</td><td>无侵入的扩展点</td></tr>
        <tr><td>可插拔操作</td><td>Operations 接口</td><td>支持远程执行（SSH、容器等）</td></tr>
      </table>
    `;
    container.appendChild(s6);

    // === Section 7: 深入 Edit 模糊匹配与 file-mutation-queue ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>5.7 深入：Edit 工具的模糊匹配算法与 file-mutation-queue 并发控制</h2>
      <p>Edit 工具是代码修改的核心，它的精确性依赖于两大基础设施：<strong>模糊匹配算法</strong>（处理 LLM 输出的 Unicode 不一致）和 <strong>file-mutation-queue</strong>（防止并发写冲突）。本节深入这两个模块的完整实现。</p>

      <h3>模糊匹配算法：normalizeForFuzzyMatch</h3>
      <p>LLM 有时会将代码中的 ASCII 引号转换为 Unicode 智能引号（"hello" vs "hello"），或在行尾添加空白。这会导致精确字符串匹配失败。模糊匹配通过一系列归一化步骤解决这个问题：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/tools/edit-diff.ts — normalizeForFuzzyMatch()</span></div>
        <pre><code class="language-typescript">/**
 * 对文本进行渐进式归一化，用于模糊匹配。
 * - 每行去除尾部空白
 * - 智能引号 → ASCII 引号
 * - Unicode 破折号/连字符 → ASCII 连字符
 * - 特殊 Unicode 空格 → 常规空格
 */
export function normalizeForFuzzyMatch(text: string): string {
  return (
    text
      .normalize("NFKC")
      // 第一步：每行去除尾部空白
      .split("\\n")
      .map((line) => line.trimEnd())
      .join("\\n")
      // 第二步：智能单引号 → '
      // U+2018 ‘, U+2019 ’, U+201A ‚, U+201B ‛
      .replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'")
      // 第三步：智能双引号 → "
      // U+201C ", U+201D ", U+201E ", U+201F "
      .replace(/[\\u201C\\u201D\\u201E\\u201F]/g, '"')
      // 第四步：各种破折号/连字符 → -
      // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
      // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
      .replace(/[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]/g, "-")
      // 第五步：特殊空格 → 常规空格
      // U+00A0 NBSP, U+2002-U+200A 各种空格, U+202F 窄 NBSP,
      // U+205F 中等数学空格, U+3000 表意空格
      .replace(/[\\u00A0\\u2002-\\u200A\\u202F\\u205F\\u3000]/g, " ")
  );
}</code></pre>
      </div>

      <h3>fuzzyFindText：先精确匹配，再模糊回退</h3>
      <p>模糊匹配采用<strong>精确优先，模糊回退</strong>策略。只有当精确匹配失败时才启用模糊匹配：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/tools/edit-diff.ts — fuzzyFindText()</span></div>
        <pre><code class="language-typescript">export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  // 策略1: 精确匹配（O(n) 的 indexOf）
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,        // 标记为精确匹配
      contentForReplacement: content, // 不修改原始内容
    };
  }

  // 策略2: 模糊匹配 — 在归一化空间中操作
  const fuzzyContent = normalizeForFuzzyMatch(content);
  const fuzzyOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

  if (fuzzyIndex === -1) {
    return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content };
  }

  // 找到模糊匹配 — 返回归一化后的内容用于替换
  // 注意：这意味着输出会丢失原始的 Unicode 变体，
  // 但由于我们只是修复小的格式差异，这是可接受的
  return {
    found: true,
    index: fuzzyIndex,
    matchLength: fuzzyOldText.length,
    usedFuzzyMatch: true,
    contentForReplacement: fuzzyContent, // 使用归一化内容
  };
}</code></pre>
      </div>

      <p>关键设计决策：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>精确匹配优先</strong>：大多数情况下 LLM 会提供精确匹配的文本，直接走 indexOf O(n) 路径，零开销。</li>
        <li><strong>NFKC 归一化</strong>：<code>normalize("NFKC")</code> 将兼容性字符（如全角拉丁字母 "Ａ" → "A"、连字 "ﬁ" → "fi"）转换为标准形式。</li>
        <li><strong>归一化空间替换</strong>：当使用模糊匹配时，整个文件内容会被归一化后再进行替换。这意味着文中的 Unicode 变体会丢失，但这是故意的——因为 LLM 使用 ASCII 版本作为 newText 也可能是故意的。</li>
      </ul>

      <h3>applyEditsToNormalizedContent：多编辑的完整流水线</h3>
      <p>当一次调用包含多个 edit 时，需要确保它们的替换区域不重叠，且所有匹配都基于<strong>同一个原始文件</strong>（不是增量匹配）：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/tools/edit-diff.ts — applyEditsToNormalizedContent()</span></div>
        <pre><code class="language-typescript">export function applyEditsToNormalizedContent(
  normalizedContent: string, edits: Edit[], path: string
): AppliedEditsResult {
  // 步骤1: 将 edit 本身的 oldText/newText 也做 LF 归一化
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  // 步骤2: 空文本检查
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length);
    }
  }

  // 步骤3: 所有匹配在同一个 base 内容上进行
  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;

  // 步骤4: 在 baseContent 上重新匹配（如果需要模糊匹配的话）
  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchResult = fuzzyFindText(baseContent, edit.oldText);
    if (!matchResult.found) throw getNotFoundError(path, i, normalizedEdits.length);

    // 唯一性检查：同一个 oldText 不能在文件中出现多次
    const occurrences = countOccurrences(baseContent, edit.oldText);
    if (occurrences > 1) throw getDuplicateError(path, i, normalizedEdits.length, occurrences);

    matchedEdits.push({ editIndex: i, matchIndex: matchResult.index, matchLength: matchResult.matchLength, newText: edit.newText });
  }

  // 步骤5: 按位置排序，检测重叠
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    const prev = matchedEdits[i - 1];
    const curr = matchedEdits[i];
    if (prev.matchIndex + prev.matchLength > curr.matchIndex) {
      throw new Error(
        \`edits[\${prev.editIndex}] and edits[\${curr.editIndex}] overlap in \${path}. Merge them or target disjoint regions.\`
      );
    }
  }

  // 步骤6: 从后往前应用替换（保持前面的偏移不变）
  let newContent = baseContent;
  for (let i = matchedEdits.length - 1; i >= 0; i--) {
    const edit = matchedEdits[i];
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength);
  }

  // 步骤7: 如果没有任何变更，报错
  if (baseContent === newContent) throw getNoChangeError(path, normalizedEdits.length);

  return { baseContent, newContent };
}</code></pre>
      </div>

      <p>为什么从后往前应用替换？假设有两个 edit：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li>Edit[0] 替换 offset 100-110 的内容</li>
        <li>Edit[1] 替换 offset 200-210 的内容</li>
        <li>如果从前往后应用，Edit[0] 的替换会改变文件长度，导致 Edit[1] 的 offset 失效</li>
        <li>从后往前应用则不存在这个问题——后面的替换不影响前面的偏移</li>
      </ul>

      <h3>file-mutation-queue：文件级并发控制</h3>
      <p>当多个工具调用同时写入同一个文件时，<code>withFileMutationQueue</code> 通过 Promise 链将同文件操作串行化：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/tools/file-mutation-queue.ts — 完整实现</span></div>
        <pre><code class="language-typescript">import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const fileMutationQueues = new Map&lt;string, Promise&lt;void&gt;&gt;();
let registrationQueue = Promise.resolve();

async function getMutationQueueKey(filePath: string): Promise&lt;string&gt; {
  const resolvedPath = resolve(filePath);
  try {
    return await realpath(resolvedPath);  // 解析符号链接，确保硬链接共享同一队列
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return resolvedPath;  // 新文件（尚不存在），使用 resolved path 作为 key
    }
    throw error;
  }
}

export async function withFileMutationQueue&lt;T&gt;(
  filePath: string, fn: () =&gt; Promise&lt;T&gt;
): Promise&lt;T&gt; {
  // 步骤1: 在 registrationQueue 后面排队获取队列 key
  //        确保 Map 的读写不会并发冲突
  const registration = registrationQueue.then(async () =&gt; {
    const key = await getMutationQueueKey(filePath);
    const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

    let releaseNext!: () =&gt; void;
    const nextQueue = new Promise&lt;void&gt;((resolveQueue) =&gt; {
      releaseNext = resolveQueue;
    });
    const chainedQueue = currentQueue.then(() =&gt; nextQueue);
    fileMutationQueues.set(key, chainedQueue);

    return { key, currentQueue, chainedQueue, releaseNext };
  });

  // 步骤2: 清理 registrationQueue（确保失败的注册不影响后续操作）
  registrationQueue = registration.then(
    () =&gt; undefined,
    () =&gt; undefined,  // 吞掉错误，保证链不断
  );

  // 步骤3: 等待前面的同文件操作完成，然后执行自己的操作
  const { key, currentQueue, chainedQueue, releaseNext } = await registration;
  await currentQueue;   // 等待前面的操作
  try {
    return await fn();  // 执行自己的操作
  } finally {
    releaseNext();      // 释放下一个等待者
    // 步骤4: 如果没有后续操作了，清理 Map
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key);
    }
  }
}</code></pre>
      </div>

      <p>有趣的数据结构：<code>Map&lt;string, Promise&lt;void&gt;&gt;</code> — 每个文件对应一个 Promise 链的尾部。新的写操作被链接到这个尾部之后，形成 FIFO 队列：</p>

      <div class="info-card">
        <h4>执行时序示例</h4>
        <p>假设三个操作同时写入 <code>/app/src/main.ts</code>：</p>
        <pre style="font-size:0.85rem;line-height:1.6;margin-top:8px;">
时刻 T0: Map = { "/app/src/main.ts" → Promise.resolve() }
时刻 T1: Op1 到来 → Map = { "/app/src/main.ts" → P1 }, Op1 等待 P_resolved
时刻 T2: Op2 到来 → Map = { "/app/src/main.ts" → P2 }, Op2 等待 P1
时刻 T3: Op3 到来 → Map = { "/app/src/main.ts" → P3 }, Op3 等待 P2
时刻 T4: P_resolved → Op1 开始执行
时刻 T5: Op1 完成, releaseNext() → P1 resolved → Op2 开始执行
时刻 T6: Op2 完成, releaseNext() → P2 resolved → Op3 开始执行
时刻 T7: Op3 完成, releaseNext() → P3 resolved, Map 清理
        </pre>
        <p style="margin-top:8px;"><strong>不同文件</strong>的操作互不影响——只有相同 <code>realpath</code> 的操作才会被串行化。</p>
      </div>

      <div class="info-card tip">
        <h4>registrationQueue 的作用</h4>
        <p>你可能会问：为什么需要一个额外的 <code>registrationQueue</code>？</p>
        <p>因为 <code>getMutationQueueKey()</code> 内部调用了 <code>realpath()</code>（异步 I/O），而 <code>fileMutationQueues</code> Map 的读写必须是原子的。如果两个操作同时进入 <code>withFileMutationQueue</code>，不通过 registrationQueue 串行化的话，可能会出现竞态条件——一个操作刚 get 了旧值，另一个操作就 set 了新值，导致 Promise 链丢失。</p>
        <p><code>registrationQueue</code> 本质上是一个<strong>对 Map 的互斥锁</strong>，确保读写 Map 的操作不会交叉。</p>
      </div>
    `;
    container.appendChild(s7);
  },

  quiz: [
    {
      question: 'Pi Agent 的工具有以下哪7个？',
      options: [
        'read, write, edit, copy, move, delete, search',
        'read, bash, edit, write, grep, find, ls',
        'read, shell, patch, create, search, locate, dir',
        'open, exec, diff, save, rg, fd, list',
      ],
      answer: 1,
      explanation: 'Pi Agent 的 7 大核心工具是 read、bash、edit、write、grep、find、ls。注意没有 copy/move/delete 等文件管理工具——这些通过 bash 工具执行对应命令来完成。',
    },
    {
      question: 'ToolDefinition 和 AgentTool 分离的主要原因是什么？',
      options: [
        '为了减少代码量',
        '为了让同一工具在不同模式（TUI/RPC/CLI）下有不同的渲染实现',
        '为了让工具执行更快',
        '为了让 LLM 更容易理解工具',
      ],
      answer: 1,
      explanation: 'ToolDefinition 包含 UI 渲染逻辑，AgentTool 是运行时接口。分离后，执行逻辑可以共用，而渲染逻辑根据模式（interactive TUI、RPC、CLI）各自定制。',
    },
    {
      question: '关于工具执行流水线的正确顺序是？',
      options: [
        '执行 → 验证 → 钩子 → 返回结果',
        '钩子 → 验证 → 执行 → 返回结果',
        '验证 → beforeToolCall钩子 → 执行 → afterToolCall钩子 → 返回结果',
        '验证 → 执行 → 钩子 → 返回结果',
      ],
      answer: 2,
      explanation: '工具执行的完整流水线：参数验证 → beforeToolCall 钩子（扩展可阻止执行）→ 执行工具 → afterToolCall 钩子（扩展可修改结果）→ 返回结果给 LLM。',
    },
    {
      question: '关于 write 和 edit 工具的区别，以下哪个说法是正确的？',
      options: [
        'write 用于修改文件的一部分，edit 用于覆盖整个文件',
        'write 用于创建新文件或完全覆盖，edit 用于精确的字符串替换',
        'write 和 edit 功能完全一样，只是名字不同',
        'write 只能用于文本文件，edit 可以用于任何文件',
      ],
      answer: 1,
      explanation: 'write 用于创建新文件或完全重写已有文件（全量替换），edit 用于精确的文本替换（old_string → new_string），支持单次调用中的多个不连续编辑。',
    },
  ],

  coding: [
    {
      title: '实现简化版 normalizeForFuzzyMatch',
      prompt: '阅读 packages/coding-agent/src/core/tools/edit-diff.ts 中的 normalizeForFuzzyMatch 函数，然后实现一个简化版。要求：\n1. 使用 String.prototype.normalize("NFKC") 做 Unicode 归一化\n2. 去除每行尾部的空白字符\n3. 将智能引号（‘’“”）转换为 ASCII 引号\n4. 写 3 个测试用例验证：普通文本、带尾部空白的文本、带智能引号的文本',
      hint: '使用 split("\\n").map(line => line.trimEnd()).join("\\n") 处理尾部空白，使用 .replace() 配合 Unicode 范围做字符替换。',
      answer: '// 简化版 normalizeForFuzzyMatch\nfunction normalizeForFuzzyMatch(text) {\n  return text\n    .normalize("NFKC")\n    .split("\\n")\n    .map((line) => line.trimEnd())\n    .join("\\n")\n    .replace(/[\\u2018\\u2019]/g, "\'")\n    .replace(/[\\u201C\\u201D]/g, \'"\')\n    .replace(/[\\u2013\\u2014]/g, "-");\n}\n\nfunction test() {\n  // 测试1: 普通文本\n  const t1 = "const x = 1;";\n  console.assert(normalizeForFuzzyMatch(t1) === "const x = 1;");\n  // 测试2: 尾部空白去除\n  const t2 = "const x = 1;   \\nconst y = 2;  ";\n  const r2 = normalizeForFuzzyMatch(t2);\n  console.assert(r2 === "const x = 1;\\nconst y = 2;");\n  // 测试3: 智能引号转换\n  const t3 = "console.log(\\u2018hello\\u2019)";\n  const r3 = normalizeForFuzzyMatch(t3);\n  console.assert(r3 === "console.log(\'hello\')");\n  console.log("All tests passed!");\n}\ntest();',
      explanation: '简化版省略了完整版中的一些边界情况处理（如 U+201A/201B 单引号变体、U+2015 水平线、U+2212 减号、各种特殊空格），但核心的三步归一化（NFKC → 去尾部空白 → 字符映射）已经完整实现。',
    },
    {
      title: '实现简化版文件写队列',
      prompt: '阅读 packages/coding-agent/src/core/tools/file-mutation-queue.ts 的完整实现，然后写一个简化版的 withFileMutationQueue。要求：\n1. 使用 Map<string, Promise<void>> 存储每个文件的 Promise 链\n2. 同文件操作必须串行执行（后面的等前面的完成）\n3. 不同文件操作可以并行\n4. 写一个测试：同时发起 3 个同文件写操作和 2 个不同文件写操作，验证串行/并行行为',
      hint: '用 Promise.resolve() 作为链的起点，每次新操作链接到链尾。用 Date.now() 记录时间戳来验证并行性。',
      answer: '// 简化版文件写队列\nconst queues = new Map<string, Promise<void>>();\n\nasync function withFileMutationQueue<T>(\n  filePath: string,\n  fn: () => Promise<T>,\n): Promise<T> {\n  // 获取当前文件的 Promise 链尾（如果是新文件，起点是 resolved promise）\n  const prev = queues.get(filePath) ?? Promise.resolve();\n\n  // 创建一个新的 Promise，作为下一个操作的等待点\n  let resolveNext!: () => void;\n  const next = new Promise<void>((r) => { resolveNext = r; });\n\n  // 将新链尾写入 Map\n  queues.set(filePath, prev.then(() => next));\n\n  // 等待前面的操作完成\n  await prev;\n\n  try {\n    // 执行自己的操作\n    return await fn();\n  } finally {\n    // 通知下一个等待者\n    resolveNext();\n    // 如果没有后续操作了，清理 Map\n    if (queues.get(filePath) === prev.then(() => next)) {\n      queues.delete(filePath);\n    }\n  }\n}\n\n// 测试\nasync function test() {\n  const log: string[] = [];\n  const start = Date.now();\n\n  function logMsg(msg: string) {\n    const elapsed = Date.now() - start;\n    log.push(\`[+\${String(elapsed).padStart(4, " ")}ms] \${msg}\`);\n  }\n\n  // 模拟写操作\n  async function writeFile(name: string, path: string, delayMs: number) {\n    logMsg(\`\${name} 开始写入 \${path}\`);\n    await new Promise((r) => setTimeout(r, delayMs));\n    logMsg(\`\${name} 完成写入 \${path}\`);\n  }\n\n  // 同时发起 5 个操作\n  await Promise.all([\n    // 3 个同文件操作（应串行执行）\n    withFileMutationQueue("/app/src/a.ts", () => writeFile("Op1", "/app/src/a.ts", 100)),\n    withFileMutationQueue("/app/src/a.ts", () => writeFile("Op2", "/app/src/a.ts", 100)),\n    withFileMutationQueue("/app/src/a.ts", () => writeFile("Op3", "/app/src/a.ts", 100)),\n    // 2 个不同文件操作（应并行执行）\n    withFileMutationQueue("/app/src/b.ts", () => writeFile("Op4", "/app/src/b.ts", 100)),\n    withFileMutationQueue("/app/src/c.ts", () => writeFile("Op5", "/app/src/c.ts", 100)),\n  ]);\n\n  console.log(log.join("\\n"));\n  // 预期输出示例（时间差约为 100ms 的倍数）：\n  // [+   5ms] Op1 开始写入 /app/src/a.ts\n  // [+   7ms] Op4 开始写入 /app/src/b.ts  <-- 不同文件，并行\n  // [+   8ms] Op5 开始写入 /app/src/c.ts  <-- 不同文件，并行\n  // [+ 106ms] Op1 完成写入 /app/src/a.ts\n  // [+ 107ms] Op2 开始写入 /app/src/a.ts  <-- 同文件，等 Op1 完成\n  // [+ 108ms] Op4 完成写入 /app/src/b.ts  <-- 与 a.ts 的操作并行\n  // [+ 109ms] Op5 完成写入 /app/src/c.ts\n  // [+ 210ms] Op2 完成写入 /app/src/a.ts\n  // [+ 211ms] Op3 开始写入 /app/src/a.ts  <-- 同文件，等 Op2 完成\n  // [+ 312ms] Op3 完成写入 /app/src/a.ts\n}\n\ntest();',
      explanation: '简化版省略了真实代码中的两个关键细节：(1) registrationQueue 对 Map 读写的互斥保护，(2) realpath 解析（用于处理符号链接）。在简化版中，我们假设 Map 的读写是原子的（在单线程 JavaScript 中确实是），且文件路径已经是最简形式。',
    },
    {
      title: '追踪 Edit 工具的完整执行路径',
      prompt: '阅读 packages/coding-agent/src/core/tools/edit.ts 的 execute 方法（约 50 行），以及 edit-diff.ts 中的 applyEditsToNormalizedContent 函数，追踪一次 edit 工具调用的完整执行路径。回答以下问题：\n1. execute 方法在执行前做了哪些检查？\n2. withFileMutationQueue 的回调函数内部，每一步的作用是什么？\n3. 如果文件包含 CRLF 行尾，整个过程如何保持行尾格式不变？\n4. 当 edits 参数是 JSON 字符串（而非数组）时，prepareEditArguments 如何处理？',
      hint: '注意 stripBom → normalizeToLF → applyEditsToNormalizedContent → restoreLineEndings 这一系列操作。',
      answer: '1. execute 方法在执行前做的检查：\n   - validateEditInput: 确保 edits 是数组且不为空\n   - resolveToCwd: 将路径解析为绝对路径\n   - withFileMutationQueue: 确保同文件操作串行化\n   - ops.access: 检查文件存在且可读写（R_OK | W_OK）\n\n2. withFileMutationQueue 回调内部的步骤：\n   - throwIfAborted: 检查是否已被用户取消\n   - ops.access: 检查文件可访问性\n   - ops.readFile: 读取文件内容（Buffer → UTF-8 字符串）\n   - stripBom: 去除 UTF-8 BOM（\\uFEFF），保存以便最后恢复\n   - detectLineEnding: 检测原始行尾格式（CRLF 或 LF）\n   - normalizeToLF: 统一转换为 LF，便于匹配\n   - applyEditsToNormalizedContent: 核心匹配 + 替换逻辑\n   - restoreLineEndings: 恢复原始行尾格式\n   - bom + finalContent: 如果原文件有 BOM，加回去\n   - ops.writeFile: 写入最终内容\n   - generateDiffString + generateUnifiedPatch: 生成 diff 用于展示\n\n3. CRLF 行尾保持的机制：\n   detectLineEnding 通过查找第一个 \\r\\n 和 \\n 的位置来判断行尾格式。如果 \\r\\n 出现在 \\n 之前，判定为 CRLF。在替换完成后，restoreLineEndings 将所有 \\n 替换回 \\r\\n。\n\n4. prepareEditArguments 处理 JSON 字符串：\n   某些模型（Opus 4.6、GLM-5.1）可能将 edits 参数作为 JSON 字符串发送，而非真正的数组。代码通过 typeof args.edits === "string" 检测，如果是字符串则尝试 JSON.parse 恢复为数组。同时兼容旧版的单对 oldText/newText 参数格式。',
      explanation: 'Edit 工具的整个执行路径展示了"读取→规范化→匹配替换→恢复格式→写回"的完整模式。这种设计确保了无论原始文件使用何种编码细节，LLM 都可以用最简单的 ASCII 文本来描述修改。',
    },
  ],

  summary: [
    'Agent 的 7 大核心工具：read（读）、bash（执行）、edit（改）、write（写）、grep（搜内容）、find（搜文件）、ls（列目录）',
    '双层架构：ToolDefinition 定义工具的元信息、参数 Schema 和 UI 渲染；AgentTool 封装运行时执行接口',
    '每个工具提供两个工厂函数：createXXXToolDefinition() 和 createXXXTool()，通过 createToolDefinition(toolName) 统一注册',
    '工具执行流水线：验证参数 → beforeToolCall 钩子 → 执行工具 → afterToolCall 钩子 → 返回结果给 LLM',
    '关键设计模式：文件级并发写队列（file-mutation-queue）、流式输出节流、行数/字节数双重截断保护、可插拔的 Operations 接口',
  ],
});
