window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 10,
  title: '终端 UI（TUI）渲染系统',
  desc: '深入 Pi 的终端 UI 层——差分渲染引擎、组件系统、键盘输入处理和交互模式的完整实现。',

  objectives: [
    '理解 TUI 差分渲染的原理——逐行比较，只重绘变化的部分',
    '掌握 Component 接口和 Container 组合模式',
    '了解 Editor 组件的实现——文本编辑、光标导航、撤销重做',
    '理解键盘输入处理——stdin 缓冲、按键解析、快捷键系统',
    '了解 InteractiveMode 如何将 TUI 与 Agent Loop 连接',
  ],

  render(container) {
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>10.1 终端 UI 为什么需要"自己造轮子"</h2>
      <p>大多数 CLI 工具用 <code>chalk</code> + <code>inquirer</code> 就够了。但 Coding Agent 的终端 UI 有特殊需求：</p>
      <ul>
        <li><strong>实时流式输出</strong>：LLM 的响应是逐 token 到达的，UI 需要在同一块区域持续更新文本</li>
        <li><strong>高刷新率</strong>：工具执行进度、spinner 动画、Markdown 渲染需要在 ~16ms 内完成一帧</li>
        <li><strong>减少闪烁</strong>：如果每次都清屏重绘，终端会疯狂闪烁——必须只更新变化的部分</li>
        <li><strong>跨平台键盘处理</strong>：macOS 的 Option 键、Linux 的 Alt 键、Windows 的特殊键码……</li>
        <li><strong>硬件光标定位</strong>：编辑器需要把终端光标放到正确的位置</li>
      </ul>
      <p>所以 Pi 自己实现了一个 <strong>pi-tui</strong> 库（<code>packages/tui/</code>），约 2000 行 TypeScript，提供差分渲染 + 组件系统 + 键盘处理。</p>
    `;
    container.appendChild(s1);

    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>10.2 核心接口：Component 和 Container</h2>

      <h3>Component 接口</h3>
      <p>所有 UI 元素的统一接口，只有 4 个方法：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/tui.ts — Component 接口</span></div>
        <pre><code class="language-typescript">export interface Component {
  /** 渲染为文本行数组。每行一个字符串，宽度由参数指定 */
  render(width: number): string[];

  /** 可选：处理键盘输入。有焦点时才会被调用 */
  handleInput?(data: string): void;

  /** 是否接收 key release 事件（Kitty 协议） */
  wantsKeyRelease?: boolean;

  /** 使缓存失效，强制重新渲染 */
  invalidate(): void;
}</code></pre>
      </div>
      <p>设计要点：</p>
      <ul>
        <li><strong>render 返回 string[]</strong>：不是 HTML、不是 Virtual DOM，就是纯文本行。终端只能显示字符，所以这是最直接的抽象</li>
        <li><strong>handleInput 是可选的</strong>：不需要交互的组件（如 Markdown 渲染器、spinner）不用实现它</li>
        <li><strong>invalidate 用于缓存失效</strong>：主题切换、窗口大小变化时调用，下次 render 会重新计算</li>
      </ul>

      <h3>Container：组件树</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/tui.ts — Container 类</span></div>
        <pre><code class="language-typescript">export class Container implements Component {
  private children: Component[] = [];

  addChild(child: Component): void { this.children.push(child); }

  render(width: number): string[] {
    const result: string[] = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      for (const line of childLines) result.push(line);
    }
    return result;
  }
}</code></pre>
      </div>
      <p>Container 本身就是 Component——典型的<strong>组合模式</strong>。TUI 类继承自 Container，是最顶层的容器。你把 Editor、Markdown 渲染器、工具进度条都 addChild 进去，TUI 调用 render 时递归渲染整棵树。</p>
    `;
    container.appendChild(s2);

    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>10.3 差分渲染：只更新变化的行</h2>
      <p>这是 pi-tui 最核心的优化。<code>TUI.doRender()</code> 在每次渲染时：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/tui.ts — doRender 核心逻辑</span></div>
        <pre><code class="language-typescript">private doRender(): void {
  const width = this.terminal.columns;
  const height = this.terminal.rows;

  // ① 渲染所有组件，得到新的文本行数组
  let newLines = this.render(width);

  // ② 与上一次渲染结果逐行比较
  let firstChanged = -1, lastChanged = -1;
  for (let i = 0; i < Math.max(newLines.length, this.previousLines.length); i++) {
    const oldLine = this.previousLines[i] || "";
    const newLine = newLines[i] || "";
    if (oldLine !== newLine) {
      if (firstChanged === -1) firstChanged = i;
      lastChanged = i;
    }
  }

  // ③ 只重绘变化范围 [firstChanged, lastChanged]
  if (firstChanged !== -1) {
    let buffer = "";
    // 移动光标到 firstChanged 行
    buffer += \`\\x1b[\${firstChanged + 1};1H\`;
    for (let i = firstChanged; i <= lastChanged; i++) {
      // 清除当前行并写入新内容
      buffer += \`\\x1b[2K\${newLines[i] || ""}\`;
      if (i < lastChanged) buffer += "\\r\\n";
    }
    this.terminal.write(buffer);
  }

  this.previousLines = newLines;
}</code></pre>
      </div>

      <p>关键细节：</p>
      <table class="content-table">
        <tr><th>场景</th><th>处理方式</th></tr>
        <tr><td>首次渲染</td><td>直接输出所有行，不比较（假设终端是干净的）</td></tr>
        <tr><td>终端宽度变化</td><td>全量重绘——换行位置变了，逐行 diff 无意义</td></tr>
        <tr><td>终端高度变化</td><td>全量重绘——可视区域变了</td></tr>
        <tr><td>内容缩减</td><td>触发 clearOnShrink——清除空行避免残留</td></tr>
        <tr><td>追加新行（最常见）</td><td>仅输出新增的行——这就是流式输出不闪烁的关键</td></tr>
      </table>

      <div class="callout cl-tip">
        <strong>💡 为什么不用 curses/ncurses？</strong><br>
        curses 是全屏重绘模型，每次 render 清屏再画，对 Coding Agent 的"持续追加内容"场景不友好——清屏会导致闪烁。差分渲染只改变化行，LLM 逐 token 输出时只有最后一行在变，其他行完全不刷。
      </div>
    `;
    container.appendChild(s3);

    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>10.4 输入处理：stdin 缓冲 → 按键解析 → 键盘快捷键</h2>
      <p>终端输入不是"按一个键就收到一个字符"那么简单。转义序列（如方向键的 <code>\\x1b[A</code>）可能被 TCP 拆成多个 chunk 到达。</p>

      <h3>StdinBuffer：输入缓冲</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/stdin-buffer.ts — 核心思路</span></div>
        <pre><code class="language-typescript">// 问题：终端的鼠标事件 \\x1b[<35;20;5m 可能分三次到达：
// Event 1: \\x1b      ← 不完整，等待
// Event 2: [<35      ← 还是不完整，等待
// Event 3: ;20;5m    ← 完整了，触发回调

// StdinBuffer 累积输入，直到检测到完整序列才 emit
class StdinBuffer extends EventEmitter {
  process(data: string): void {
    this.buffer += data;
    while (this.hasCompleteSequence()) {
      const seq = this.extractSequence();
      this.emit("sequence", seq);
    }
  }
}</code></pre>
      </div>

      <h3>keys.ts：按键解析</h3>
      <p>将原始字节序列解析为统一的 <code>KeyId</code>：</p>
      <div class="code-block">
        <div class="code-label">按键解析示例</div>
        <pre><code class="language-plaintext">"a"           → KeyId "a"
"\\x1b[A"      → KeyId "up"
"\\x1b[1;5A"   → KeyId "ctrl+up"
"\\x1b[27;5;32~" → KeyId "ctrl+space"</code></pre>
      </div>

      <h3>keybindings.ts：快捷键系统</h3>
      <p>通过 TypeScript 的 <strong>Declaration Merging</strong> 扩展快捷键：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/keybindings.ts</span></div>
        <pre><code class="language-typescript">// 核心包定义空接口——等待应用层填充
export interface Keybindings {}

// coding-agent 包注入具体快捷键
declare module "@earendil-works/pi-tui" {
  interface Keybindings {
    "submit":                { key: "enter",           description: "提交输入" },
    "newline":               { key: "shift+enter",     description: "换行" },
    "navigateHistoryPrev":   { key: "up",              description: "上一条历史" },
    "navigateHistoryNext":   { key: "down",            description: "下一条历史" },
    "interrupt":             { key: "ctrl+c",          description: "中断 Agent" },
    "toggleSidebar":         { key: "ctrl+b",          description: "切换侧边栏" },
    "exit":                  { key: "ctrl+d",          description: "退出" },
    // ... 30+ 个快捷键
  }
}</code></pre>
      </div>
      <p>这就是第6章介绍过的 Declaration Merging 模式——在 TUI 系统中再次出现。核心包不知道快捷键有哪些，应用层通过类型注入定义。</p>
    `;
    container.appendChild(s4);

    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>10.5 Editor 组件：终端里的文本编辑器</h2>
      <p>Editor 是 TUI 中最复杂的组件（~800 行），提供多行文本编辑能力：</p>

      <table class="content-table">
        <tr><th>功能</th><th>实现要点</th></tr>
        <tr><td>光标导航</td><td>支持按字符/单词/行移动，通过 <code>word-navigation.ts</code> 实现单词级跳转</td></tr>
        <tr><td>文本选择</td><td>Shift + 方向键选中文本，维护 selectionStart/selectionEnd</td></tr>
        <tr><td>撤销/重做</td><td>通过 <code>undo-stack.ts</code> 维护操作历史，Ctrl+Z / Ctrl+Shift+Z</td></tr>
        <tr><td>自动补全</td><td>Tab 触发，通过 <code>autocomplete.ts</code> 提供补全建议列表</td></tr>
        <tr><td>历史导航</td><td>上下方向键浏览历史输入（类似 shell 的 readline）</td></tr>
        <tr><td>语法高亮</td><td>通过正则和关键词匹配实现轻量级高亮（非 Language Server）</td></tr>
      </table>

      <h3>Editor 与 Agent 的连接</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">interactive-mode.ts — Editor 提交回调</span></div>
        <pre><code class="language-typescript">// InteractiveMode 设置 Editor 的提交回调
this.defaultEditor.onSubmit = async (text: string) => {
  text = text.trim();
  if (!text) return;

  // ① 先检查是否斜杠命令（第7章）
  if (text === "/settings") { this.showSettingsSelector(); return; }
  if (text === "/model") { await this.handleModelCommand(); return; }
  // ... 20 个内置命令

  // ② 再检查扩展命令
  if (text.startsWith("/")) {
    const result = await this.extensionRunner.emitCommand({ text });
    if (result?.handled) return;
  }

  // ③ 都不是——进入 Agent Loop
  await this.handleNewTask(text);
};</code></pre>
      </div>
      <p>用户在 Editor 中按 Enter → <code>onSubmit</code> 回调触发 → 检查命令 → 进入 Agent Loop。Agent 运行期间，Editor 仍然可以接收输入（用于 steering 消息——见第4章）。</p>
    `;
    container.appendChild(s5);

    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>10.6 Markdown 渲染器：终端里的富文本</h2>
      <p><code>components/markdown.ts</code> 将 Markdown 渲染为 ANSI 转义码修饰的文本行：</p>
      <ul>
        <li><strong>标题</strong>：<code>### 标题</code> → 加粗 + 颜色</li>
        <li><strong>代码块</strong>：<code>\`\`\`</code> → 缩进 + 灰色背景</li>
        <li><strong>列表</strong>：<code>- item</code> → 缩进 + 项目符号</li>
        <li><strong>内联代码</strong>：<code>\`code\`</code> → 高亮背景色</li>
        <li><strong>链接</strong>：<code>[text](url)</code> → 只显示 text，URL 忽略（终端无法点击）</li>
      </ul>
      <p>渲染是"一次性"的——Markdown 块一旦渲染完成就不再变化。它不处理增量更新（增量更新由 Agent Loop 的事件流驱动，每次消息更新时整个消息块重新渲染）。</p>
    `;
    container.appendChild(s6);

    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>10.7 渲染调度：防抖与节流</h2>
      <p>Agent 运行时，LLM 可能以 100 token/s 的速度产出文本。如果每个 token 都触发一次 TUI 渲染，终端会卡死。Pi 的调度策略：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/tui/src/tui.ts — requestRender 调度</span></div>
        <pre><code class="language-typescript">private static readonly MIN_RENDER_INTERVAL_MS = 16; // ~60fps

requestRender(force = false): void {
  if (force) {
    // 强制渲染：跳过防抖，立即在 nextTick 渲染
    process.nextTick(() => this.doRender());
    return;
  }
  if (this.renderRequested) return;  // 已经有渲染请求在排队
  this.renderRequested = true;
  process.nextTick(() => this.scheduleRender());
}

private scheduleRender(): void {
  const elapsed = performance.now() - this.lastRenderAt;
  const delay = Math.max(0, 16 - elapsed);  // 距上次渲染至少 16ms
  this.renderTimer = setTimeout(() => {
    this.doRender();
    if (this.renderRequested) this.scheduleRender(); // 还有请求，继续调度
  }, delay);
}</code></pre>
      </div>
      <p>关键设计：</p>
      <ul>
        <li><strong>合并渲染请求</strong>：<code>renderRequested</code> 标志位确保同一帧内多次调用只触发一次渲染</li>
        <li><strong>最小间隔 16ms</strong>：约 60fps，人眼感知流畅，CPU 不过载</li>
        <li><strong>force 模式</strong>：窗口大小变化、主题切换等场景需要立即全量重绘</li>
      </ul>
    `;
    container.appendChild(s7);

    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>10.8 完整的渲染循环</h2>
      <p>把上面的内容串起来，一次 LLM token 到达到终端显示的完整路径：</p>

      <div class="step-list">
        <li>
          <h4>LLM 流式输出一个 token</h4>
          <p>Agent Loop 通过 <code>for await</code> 消费 EventStream，收到 <code>text_delta</code> 事件</p>
        </li>
        <li>
          <h4>AgentSession 发出 message_update 事件</h4>
          <p>事件包含当前的完整 AssistantMessage 快照</p>
        </li>
        <li>
          <h4>TUI 收到事件，更新 Markdown 组件</h4>
          <p>Markdown 组件收到新的文本内容，更新内部状态</p>
        </li>
        <li>
          <h4>调用 requestRender()</h4>
          <p>如果距离上次渲染不到 16ms，等待；否则立即调度</p>
        </li>
        <li>
          <h4>doRender() 执行</h4>
          <p>递归 render 组件树 → 得到 newLines → 与 previousLines 逐行比较 → 找到变化范围</p>
        </li>
        <li>
          <h4>差分输出到终端</h4>
          <p>光标移到变化范围起始行 → 逐行清除并写入新内容 → 只有变化行产生 I/O</p>
        </li>
      </div>

      <p>这个管道的延迟通常在 <strong>1-3 帧（16-48ms）</strong>以内，用户完全感觉不到延迟。</p>
    `;
    container.appendChild(s8);

    const s9 = document.createElement('div');
    s9.className = 'content-section';
    s9.innerHTML = `
      <h2>10.9 TUI 与其他层的协作全景</h2>
      <table class="content-table">
        <tr><th>TUI 组件</th><th>连接的层</th><th>交互方式</th></tr>
        <tr><td><strong>Editor</strong></td><td>Slash Commands（第7章）</td><td>用户输入 "/xxx" → onSubmit → 检查命令 → 可能不进入 Agent Loop</td></tr>
        <tr><td><strong>Editor</strong></td><td>Agent Loop（第4章）</td><td>普通文本 → onSubmit → handleNewTask → agent.prompt()</td></tr>
        <tr><td><strong>Markdown 渲染器</strong></td><td>Agent Events（第4章）</td><td>订阅 message_update → 实时显示 LLM 输出</td></tr>
        <tr><td><strong>工具进度组件</strong></td><td>Tool System（第5章）</td><td>订阅 tool_execution_start/update/end → 显示工具执行状态</td></tr>
        <tr><td><strong>Loader/Spinner</strong></td><td>Agent Loop（第4章）</td><td>Agent 工作中显示动画，完成后隐藏</td></tr>
        <tr><td><strong>快捷键系统</strong></td><td>所有层</td><td>Ctrl+C → abort() 贯穿到 Agent Loop、LLM 调用、工具执行</td></tr>
      </table>

      <div class="callout cl-info">
        <strong>🔑 TUI 在整个 Pi 架构中的位置</strong><br>
        TUI 是最外层——它不修改任何业务逻辑，只负责"显示"和"输入"。Agent 不知道有终端 UI 存在（它只通过 EventStream 报告状态），TUI 不知道 Agent 内部怎么工作的（它只通过事件接收数据）。这种<strong>关注点分离</strong>让 TUI 可以被 RPC 模式、Web UI 等完全替换，而不影响核心逻辑。
      </div>
    `;
    container.appendChild(s9);
  },

  quiz: [
    {
      question: 'pi-tui 的差分渲染核心优化是什么？',
      options: [
        '使用 WebGL 加速渲染',
        '逐行比较新旧内容，只重绘变化的行',
        '把所有内容缓存到文件再读取',
        '使用多线程并行渲染',
      ],
      answer: 1,
      explanation: '差分渲染将新旧内容逐行比较，找到变化范围 [firstChanged, lastChanged]，只更新这些行。终端 ANSI 转义码支持按行定位和清除，不需要清屏。',
    },
    {
      question: 'Component 接口的 render 方法返回什么类型？',
      options: [
        'HTML 字符串',
        'Virtual DOM 树',
        'string[]（文本行数组）',
        'Canvas 绘制命令',
      ],
      answer: 2,
      explanation: 'render(width) 返回 string[]，每个元素是终端的一行文本。终端只能显示字符，这是最直接的抽象。',
    },
    {
      question: '为什么需要 StdinBuffer？',
      options: [
        '为了加快输入速度',
        '因为终端转义序列可能被 TCP 拆成多个 chunk 到达，需要累积后解析',
        '为了支持多语言输入',
        '为了过滤非法字符',
      ],
      answer: 1,
      explanation: '终端转义序列（如鼠标事件 \\x1b[<35;20;5m）可能分多个 TCP 包到达。StdinBuffer 累积输入直到检测到完整序列才触发回调。',
    },
  ],

  summary: [
    'pi-tui 是一个自研的终端 UI 库，提供 Component 组合模式、差分渲染引擎和键盘处理系统',
    '差分渲染的核心：逐行比较新旧内容 → 找到变化范围 → 只重绘变化行，实现流畅无闪烁的终端体验',
    'Component 接口只有 4 个方法（render/handleInput/wantsKeyRelease/invalidate），简洁且通用',
    'Container 是 Component 的组合容器，TUI 继承 Container 作为根节点',
    'StdinBuffer 解决转义序列的"拆包"问题，keys.ts 将字节解析为统一 KeyId',
    '快捷键系统通过 Declaration Merging 扩展——核心包定义空接口，应用层注入具体绑定',
    'TUI 不修改任何业务逻辑，只负责显示和输入——可以被 RPC 模式、Web UI 等完全替换',
  ],
});
