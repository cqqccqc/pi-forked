/**
 * 第6章：会话管理 — Agent 的记忆
 *
 * 理解 JSONL 树形存储、上下文构建和消息类型体系。
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 6,
  title: '会话管理：Agent 如何记住上下文',
  desc: '理解 JSONL 树形存储、上下文构建和消息类型体系。',

  objectives: [
    '理解 JSONL 文件格式和 append-only 追加写入策略',
    '掌握树形会话结构（id/parentId/leafId 构建多分支树）',
    '理解上下文构建（buildSessionContext）的路径遍历与压缩处理',
    '了解消息类型的三层架构与 Declaration Merging 扩展机制',
  ],

  render(container) {
    // === Section 1: 为什么需要会话管理 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>6.1 为什么需要会话管理</h2>
      <p>想象一下：你和 Agent 合作了 2 个小时，修改了 15 个文件，执行了 50 个命令。然后 Agent 重启了——如果它不记得之前做了什么，你得从头开始。</p>
      <p><strong>会话管理就是 Agent 的"记忆系统"。</strong>它负责：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>持久化</strong>：把对话历史保存到磁盘，重启后可以恢复</li>
        <li><strong>上下文构建</strong>：从持久化数据中重建 LLM 需要的消息列表</li>
        <li><strong>多分支</strong>：支持从历史任意节点分叉，探索不同方案</li>
        <li><strong>压缩</strong>：当对话太长时，自动总结旧内容以节省 token</li>
      </ul>

      <div class="info-card">
        <h4>核心洞察</h4>
        <p style="font-size:1.1rem;text-align:center;margin:12px 0;">
          会话不是线性聊天记录，而是一棵<strong>多分支树</strong>。每次"返回重试"就是一个新分支，旧分支不会丢失。
        </p>
      </div>
    `;
    container.appendChild(s1);

    // === Section 2: JSONL 存储格式 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>6.2 JSONL 存储格式</h2>
      <p>Session 文件存储在 <code>~/.pi/agent/sessions/&lt;encoded-cwd&gt;/</code> 目录下，采用 <strong>JSONL</strong>（每行一个 JSON 对象）格式：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">~/.pi/agent/sessions/.../2026-05-22T10-30-00-000Z_abc12345.jsonl</span></div>
        <pre><code class="language-json">{"type":"session","version":3,"id":"abc12345","timestamp":"2026-05-22T10:30:00.000Z","cwd":"/home/user/project"}
{"type":"message","id":"f8a1b2c3","parentId":null,"timestamp":"...","message":{"role":"user","content":[{"type":"text","text":"Read main.ts"}],"timestamp":1747898401000}}
{"type":"message","id":"e7d9c0b1","parentId":"f8a1b2c3","timestamp":"...","message":{"role":"assistant","content":[...],"stopReason":"toolUse"}}
{"type":"message","id":"a6c8d2e4","parentId":"e7d9c0b1","timestamp":"...","message":{"role":"toolResult","toolCallId":"tc_1","toolName":"read"}}
{"type":"message","id":"b5f7a3c6","parentId":"a6c8d2e4","timestamp":"...","message":{"role":"assistant","content":[...],"stopReason":"stop"}}</code></pre>
      </div>

      <h3>为什么选择 JSONL？</h3>
      <table class="content-table">
        <tr><th>特性</th><th>JSONL 的优势</th></tr>
        <tr><td>Append-only 写入</td><td>只在文件末尾追加，不修改已有数据，崩溃恢复简单</td></tr>
        <tr><td>行级独立</td><td>每行是完整 JSON，损坏一行不影响其他行</td></tr>
        <tr><td>流式读取</td><td>可逐行解析，不需要加载整个文件到内存</td></tr>
        <tr><td>人类可读</td><td>用文本编辑器就能查看和调试</td></tr>
        <tr><td>分支友好</td><td>tree 结构天然映射到 JSONL 的行追加模式</td></tr>
      </table>

      <h3>延迟持久化策略</h3>
      <p>Session 不是每条消息都立刻写磁盘。<code>_persist()</code> 方法有一套智能策略：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li>在收到第一个 <strong>assistant 消息</strong>之前，entry 暂存内存不写磁盘</li>
        <li>第一个 assistant 到达后，批量写入所有积攒的 entry，然后创建文件</li>
        <li>之后每条 entry 实时追加到文件</li>
      </ul>
      <p>这避免了用户输入了 prompt 但 agent 还没回复时产生"孤儿" session 文件。</p>
    `;
    container.appendChild(s2);

    // === Section 3: 树形会话结构 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>6.3 树形会话结构</h2>
      <p>Session 不是线性数组，而是一棵<strong>多分支树</strong>。每个 entry 通过 <code>id</code> 和 <code>parentId</code> 形成父子关系：</p>

      <div class="diagram-container">
        <div class="diagram-caption">▲ 会话树形结构</div>
      </div>

      <h3>核心字段</h3>
      <table class="content-table">
        <tr><th>字段</th><th>含义</th></tr>
        <tr><td><code>id</code></td><td>每个 entry 的唯一标识（8 位十六进制，碰撞检测）</td></tr>
        <tr><td><code>parentId</code></td><td>父节点 id（<code>null</code> 表示根节点）</td></tr>
        <tr><td><code>leafId</code></td><td>当前所在的叶节点（指针，决定上下文路径）</td></tr>
      </table>

      <h3>分支操作</h3>
      <p>分支通过移动 <code>leafId</code> 指针实现，O(1) 操作，不修改已有数据：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">session-manager.ts — branch() 方法</span></div>
        <pre><code class="language-typescript">/** 从历史节点分叉，只移动指针，不修改数据 */
branch(branchFromId: string): void {
  if (!this.byId.has(branchFromId)) {
    throw new Error(\`Entry \${branchFromId} not found\`);
  }
  this.leafId = branchFromId;  // 仅移动指针
}

/** 带摘要的分支：分叉前生成摘要，帮助 LLM 理解被放弃的路径 */
branchWithSummary(branchFromId: string | null, summary: string, details?, fromHook?): string {
  this.leafId = branchFromId;
  const entry: BranchSummaryEntry = {
    type: "branch_summary", summary,
    fromId: branchFromId ?? "root", /* ... */
  };
  this._appendEntry(entry);  // 在新分支开头插入摘要
  return entry.id;
}</code></pre>
      </div>

      <h3>Fork 操作</h3>
      <p>Fork（<code>createBranchedSession</code>）将树中的一条路径提取为独立的线性 session 文件。原始文件保持不变。另外 <code>SessionManager.forkFrom()</code> 支持跨项目 fork——将一个项目目录的 session fork 到当前项目，保留完整历史。</p>
    `;
    container.appendChild(s3);
    // Render the session tree diagram
    const treeDiv = s3.querySelector('.diagram-container');
    Diagrams.drawSessionTree(treeDiv);

    // === Section 4: Entry 类型体系 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>6.4 Entry 类型体系</h2>
      <p>Session 文件中可以包含多种类型的 entry，每种有不同的用途和 LLM 交互方式：</p>

      <table class="content-table">
        <tr><th>Entry 类型</th><th>用途</th><th>参与 LLM 上下文？</th></tr>
        <tr><td><code>message</code></td><td>标准消息（user/assistant/toolResult）</td><td>是（直接传递）</td></tr>
        <tr><td><code>compaction</code></td><td>上下文压缩边界（含 LLM 生成的摘要）</td><td>是（摘要转为 CompactionSummaryMessage）</td></tr>
        <tr><td><code>branch_summary</code></td><td>分支切换时的路径摘要</td><td>是（摘要转为 BranchSummaryMessage）</td></tr>
        <tr><td><code>custom_message</code></td><td>扩展注入的消息</td><td>是（转为 CustomMessage → user 消息）</td></tr>
        <tr><td><code>custom</code></td><td>扩展私有数据（跨 reload 保持状态）</td><td>否（被 buildSessionContext 忽略）</td></tr>
        <tr><td><code>label</code></td><td>用户书签/标签</td><td>否（纯 UI 数据）</td></tr>
        <tr><td><code>session_info</code></td><td>session 元信息（如显示名称）</td><td>否（纯元信息）</td></tr>
        <tr><td><code>thinking_level_change</code></td><td>思考等级变更记录</td><td>否（只更新变量）</td></tr>
        <tr><td><code>model_change</code></td><td>模型变更记录</td><td>否（只更新变量）</td></tr>
      </table>

      <div class="info-card tip">
        <h4>CustomEntry vs CustomMessageEntry 的关键区别</h4>
        <p><code>CustomEntry</code> 是扩展的"私有笔记本"——存储扩展内部状态，LLM 完全看不到。<br>
        <code>CustomMessageEntry</code> 是扩展的"传话筒"——注入内容到 LLM 对话中，在上下文构建时转为 user 消息。</p>
      </div>
    `;
    container.appendChild(s4);

    // === Section 5: 上下文构建 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>6.5 上下文构建：buildSessionContext</h2>
      <p><code>buildSessionContext()</code> 是会话管理最核心的函数。它将树形 session 还原为线性 <code>AgentMessage[]</code>，供 Agent 使用。</p>

      <h3>路径遍历</h3>
      <p>从 <code>leafId</code> 向根遍历，收集路径上的所有 entry，然后反转得到从根到叶子的有序列表：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">session-manager.ts — buildSessionContext() 路径遍历</span></div>
        <pre><code class="language-typescript">// 从 leafId 向根遍历
let current: SessionEntry | undefined = leaf;
while (current) {
  path.unshift(current);                           // 头部插入
  current = current.parentId ? byId.get(current.parentId) : undefined;
}
// path 现在是 [root, ..., leaf] 的有序数组</code></pre>
      </div>

      <h3>压缩边界处理</h3>
      <p>如果路径中存在 <code>CompactionEntry</code>，上下文构建需要特殊处理：</p>
      <ol style="color:var(--text-secondary);padding-left:20px;">
        <li><strong>先输出摘要</strong>：将 compaction.summary 包装为 CompactionSummaryMessage</li>
        <li><strong>再输出保留消息</strong>：从 <code>firstKeptEntryId</code> 开始到 compaction 之前的消息</li>
        <li><strong>最后输出新消息</strong>：compaction 之后的所有消息</li>
      </ol>
      <p>被压缩的部分（compaction 之前、firstKeptEntryId 之前）的消息不会出现在上下文中——它们被摘要替代了。</p>

      <h3>各类 Entry 的处理</h3>
      <table class="content-table">
        <tr><th>entry.type</th><th>buildSessionContext 中的行为</th></tr>
        <tr><td><code>message</code></td><td>直接 push entry.message</td></tr>
        <tr><td><code>custom_message</code></td><td>转为 CustomMessage，push</td></tr>
        <tr><td><code>branch_summary</code></td><td>有 entry.summary 时转为 BranchSummaryMessage，push（空摘要跳过）</td></tr>
        <tr><td><code>compaction</code></td><td>转为 CompactionSummaryMessage，作为边界（在 appendMessage 外部处理）</td></tr>
        <tr><td><code>thinking_level_change</code></td><td>忽略（只更新 thinkingLevel 变量）</td></tr>
        <tr><td><code>model_change</code></td><td>忽略（只更新 model 变量）</td></tr>
        <tr><td><code>custom</code></td><td>忽略（不参与上下文）</td></tr>
        <tr><td><code>label</code></td><td>忽略（纯 UI 数据）</td></tr>
        <tr><td><code>session_info</code></td><td>忽略（纯元信息）</td></tr>
      </table>
    `;
    container.appendChild(s5);

    // === Section 6: 消息三层架构 ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>6.6 消息的三层架构</h2>
      <p>Pi 的消息系统有三个抽象层次，每层有不同的职责：</p>

      <div class="info-card">
        <h4>三层架构</h4>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px;border:1px solid #e0e0e0;background:#f0e6ff;font-weight:bold;">AgentMessage</td><td style="padding:8px;border:1px solid #e0e0e0;">Agent 内部看到的完整消息类型</td></tr>
          <tr><td style="padding:8px;border:1px solid #e0e0e0;background:#e6f7e6;font-weight:bold;">Message</td><td style="padding:8px;border:1px solid #e0e0e0;">LLM 理解的标准消息（user/assistant/toolResult）</td></tr>
          <tr><td style="padding:8px;border:1px solid #e0e0e0;background:#e6f0ff;font-weight:bold;">SessionEntry</td><td style="padding:8px;border:1px solid #e0e0e0;">持久化层存储的条目</td></tr>
        </table>
      </div>

      <h3>convertToLlm：消息转换边界</h3>
      <p><code>convertToLlm()</code> 是 AgentMessage 和 LLM Message 之间的翻译层。所有自定义消息类型都在这里转换为 LLM 能理解的 <code>user</code> 角色消息：</p>

      <table class="content-table">
        <tr><th>AgentMessage 类型</th><th>转换后的 LLM Message</th></tr>
        <tr><td><code>user / assistant / toolResult</code></td><td>直接传递（标准消息）</td></tr>
        <tr><td><code>bashExecution</code></td><td>user 消息："Ran \`{command}\` ..."（excludeFromContext 时过滤）</td></tr>
        <tr><td><code>custom</code></td><td>user 消息：内容保持不变</td></tr>
        <tr><td><code>branchSummary</code></td><td>user 消息：summary 包裹在 XML 标签中</td></tr>
        <tr><td><code>compactionSummary</code></td><td>user 消息：summary 包裹在 XML 标签中</td></tr>
      </table>

      <div class="info-card tip">
        <h4>设计要点</h4>
        <p>所有自定义消息都转为 <strong>user</strong> 角色——在 LLM 视角下，这些都是"系统提供的信息"。Agent 内部可以自由使用任何消息类型，只在调用 LLM 前转换。</p>
      </div>
    `;
    container.appendChild(s6);

    // === Section 7: Declaration Merging ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>6.7 Declaration Merging：优雅的类型扩展</h2>
      <p>Pi 面临一个有趣的设计问题：<code>agent</code> 包（@earendil-works/pi-agent-core）定义了 <code>AgentMessage</code> 类型，但它不应该知道 <code>coding-agent</code> 包特有的消息类型（如 BashExecutionMessage）。</p>
      <p>解决方案是 TypeScript 的 <strong>Declaration Merging</strong>：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">agent 包 — 定义扩展点</span></div>
        <pre><code class="language-typescript">// packages/agent/src/types.ts
// 空的占位接口，等待应用层通过 declaration merging 填充
interface CustomAgentMessages {
  // 空 —— 等待应用层填充
}

type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]</code></pre>
      </div>

      <div class="code-block">
        <div class="code-label"><span class="file-path">coding-agent 包 — 填充具体类型</span></div>
        <pre><code class="language-typescript">// packages/coding-agent/src/core/messages.ts
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}

// 合并后的 AgentMessage 自动变为：
// Message | BashExecutionMessage | CustomMessage | BranchSummaryMessage | CompactionSummaryMessage</code></pre>
      </div>

      <p>这样 <code>agent</code> 核心包保持零依赖，不需要知道任何上层消息类型；而 <code>coding-agent</code> 通过 TS 的类型系统"注入"自定义类型。核心包只暴露扩展点，不耦合具体实现。</p>
    `;
    container.appendChild(s7);

    // === Section 8: 压缩机制 ===
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>6.8 压缩（Compaction）机制</h2>
      <p>当对话历史越来越长，会超过 LLM 的上下文窗口。压缩机制自动将旧消息总结为摘要，释放 token 空间：</p>

      <h3>触发条件</h3>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>溢出触发</strong>：LLM 返回 context overflow 错误 → 立即压缩并重试（仅一次）</li>
        <li><strong>阈值触发</strong>：<code>contextTokens > contextWindow - reserveTokens</code> → 预压缩（不重试）</li>
        <li>默认 <code>reserveTokens = 16384</code>（为回复预留约 16k token）</li>
        <li>默认 <code>keepRecentTokens = 20000</code>（保留最近约 20k token 的消息）</li>
      </ul>

      <h3>压缩流程</h3>
      <ol style="color:var(--text-secondary);padding-left:20px;">
        <li><strong>估算 token</strong>：优先使用 LLM 返回的 usage.totalTokens（精确值）；后续消息用 chars/4 估算</li>
        <li><strong>寻找切割点</strong>：从最新消息向前累积 token，达到 keepRecentTokens 时停止；永远不在 toolResult 处切割</li>
        <li><strong>处理切割 Turn</strong>：如果切割点落在 assistant 消息（非 user），找到 turn 起始的 user 消息，turn 前缀单独总结</li>
        <li><strong>调用 LLM 生成摘要</strong>：如果有 previousSummary → 使用增量更新 prompt；否则使用初始总结 prompt</li>
        <li><strong>追加文件操作</strong>：摘要末尾附加读/写/改过的文件列表</li>
        <li><strong>持久化 CompactionEntry</strong>，然后用新的消息列表替换 agent.state.messages</li>
      </ol>

      <div class="info-card">
        <h4>摘要的结构化格式</h4>
        <p>LLM 被要求按以下格式生成摘要，确保结构化且可增量更新：</p>
        <pre style="font-size:0.85rem;color:var(--text-secondary);">## Goal
[用户要完成什么？]

## Progress
### Done: [已完成的任务]
### In Progress: [进行中的工作]
### Blocked: [阻塞项]

## Key Decisions: [关键决策]
## Next Steps: [下一步]
## Critical Context: [关键上下文]</pre>
      </div>
    `;
    container.appendChild(s8);

    // === Section 9: 关键设计总结 ===
    const s9 = document.createElement('div');
    s9.className = 'content-section';
    s9.innerHTML = `
      <h2>6.9 关键设计总结</h2>
      <table class="content-table">
        <tr><th>设计决策</th><th>原因</th></tr>
        <tr><td>JSONL 树形存储</td><td>Append-only 写入高效；分支通过 parentId 天然支持；崩溃恢复只需读取完整行</td></tr>
        <tr><td>延迟持久化</td><td>避免用户只输入 prompt 但 agent 还没回复时产生"孤儿" session 文件</td></tr>
        <tr><td>四类自定义消息</td><td>每种有不同的 LLM 交互方式——bash 转为 user、custom 转为 user、summary 包裹 XML、exclude 完全过滤</td></tr>
        <tr><td>convertToLlm 在 LLM 调用边界执行</td><td>Agent 内部可以自由使用任何消息类型，只在需要时转换</td></tr>
        <tr><td>Declaration Merging</td><td>核心包不知道上层消息类型，保持零依赖；上层通过 TS 类型系统注入</td></tr>
        <tr><td>leafId 指针</td><td>移动指针即可分支/切换，O(1) 操作；不需要复制或修改任何已有数据</td></tr>
        <tr><td>压缩增量更新</td><td>多次压缩时不从头总结，基于上次摘要更新，减少 token 消耗和语义丢失</td></tr>
      </table>
    `;
    container.appendChild(s9);

    // === Section 10: 深入：Compaction 的完整实现 ===
    const s10 = document.createElement('div');
    s10.className = 'content-section';
    s10.innerHTML = `
      <h2>6.10 深入：Compaction 的完整实现</h2>
      <p>前面 6.8 节从概念上描述了压缩流程，这一节我们深入源码，看 <strong>compact()</strong> 函数的完整实现。</p>

      <h3>完整流程概览</h3>
      <p>compaction 模块（<code>packages/coding-agent/src/core/compaction/compaction.ts</code>）包含四个核心阶段，每个阶段都是纯函数：</p>
      <div class="step-list">
        <li><h4>阶段 1: Token 估算（estimateContextTokens + estimateTokens）</h4>
        <p>优先使用 LLM 返回的 usage.totalTokens 精确值；无法获取时用 chars/4 启发式估算</p></li>
        <li><h4>阶段 2: 切割点查找（findCutPoint）</h4>
        <p>从最新消息向前反向遍历，累积 token 到 keepRecentTokens 时停止；永远不在 toolResult 处切割</p></li>
        <li><h4>阶段 3: 准备（prepareCompaction）</h4>
        <p>调用前两个阶段，提取要总结的消息列表、turn prefix、文件操作记录</p></li>
        <li><h4>阶段 4: LLM 摘要生成 + 合并（compact）</h4>
        <p>调用 LLM 生成结构化摘要，追加文件操作列表，最后返回 CompactionResult</p></li>
      </div>

      <h3>阶段 1: Token 估算 — estimateTokens()</h3>
      <p><code>estimateTokens()</code> 对不同类型的消息采用不同的估算策略。核心规则：对每个 content block 的文本或参数长度求和，除以 4 得到 token 估算值。这是<strong>保守估算</strong>（通常高估），保证不会超出 LLM 上下文窗口。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">compaction.ts — estimateTokens()</span></div>
        <pre><code class="language-typescript">export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      // 文本内容 + 图片估算（每张图计 4800 字符）
      chars = estimateTextAndImageContentChars(
        (message as { content: string | Array<{ type: string; text?: string }> }).content
      );
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = message as AssistantMessage;
      for (const block of assistant.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "toolCall")
          chars += block.name.length + JSON.stringify(block.arguments).length;
      }
      return Math.ceil(chars / 4);
    }
    case "toolResult":
    case "bashExecution":
    case "branchSummary":
    case "compactionSummary":
      // 各自按内容长度估算
      return Math.ceil(chars / 4);
  }
  return 0;
}</code></pre>
      </div>

      <p><code>estimateContextTokens()</code> 是更高层的估算函数。它找到最后一条有 usage 数据的 assistant 消息作为"锚点"，用其精确 token 数作为基准，再加上之后新消息的估算值。这样混合使用精确值和估算值，在准确性和性能之间取得平衡：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">compaction.ts — estimateContextTokens()</span></div>
        <pre><code class="language-typescript">export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);
  if (!usageInfo) {
    // 没有 usage 数据：所有消息用 estimateTokens 估算
    let estimated = 0;
    for (const msg of messages) estimated += estimateTokens(msg);
    return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
  }
  // 有 usage 数据：usage.totalTokens（精确值）+ 新消息的估算值
  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++)
    trailingTokens += estimateTokens(messages[i]);
  return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
}</code></pre>
      </div>

      <h3>阶段 2: 切割点查找算法 — findCutPoint()</h3>
      <p><code>findCutPoint()</code> 是 compaction 的核心算法。它从最新消息向前反向遍历，逐步累积 token 数量，当累积量达到 keepRecentTokens 时停止，在最近的合法切割点切开。</p>
      <p>关键约束：<strong>永远不在 toolResult 处切割</strong>（toolResult 必须跟随其 toolCall），只允许在 user、assistant、bashExecution、branch_summary、custom_message 处切割。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">compaction.ts — findCutPoint() 核心逻辑</span></div>
        <pre><code class="language-typescript">export function findCutPoint(
  entries: SessionEntry[], startIndex: number,
  endIndex: number, keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0)
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };

  // 从最新消息向前反向遍历，累积 token
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];  // 默认从第一个合法切割点开始
  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    accumulatedTokens += estimateTokens(entry.message);
    if (accumulatedTokens >= keepRecentTokens) {
      // 找到 >= i 的最近的合法切割点
      for (let c = 0; c < cutPoints.length; c++) {
        if (cutPoints[c] >= i) { cutIndex = cutPoints[c]; break; }
      }
      break;
    }
  }

  // 判断是否是 split turn：切割点不在 user 消息上意味着把一轮对话切成了两半
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}</code></pre>
      </div>

      <h3>阶段 3 & 4: compact() 主函数</h3>
      <p><code>compact()</code> 是最终的编排函数，接收 <code>prepareCompaction()</code> 预处理好的数据，调用 LLM 生成摘要。当切割点导致 turn 分裂时（isSplitTurn），会<strong>并行生成两份摘要</strong>（历史摘要 + turn prefix 摘要），最后合并为一。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">compaction.ts — compact() 核心流程</span></div>
        <pre><code class="language-typescript">export async function compact(
  preparation: CompactionPreparation, model: Model&lt;any&gt;,
  apiKey?: string, headers?: Record&lt;string, string&gt;,
  customInstructions?: string, signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel, streamFn?: StreamFn,
): Promise&lt;CompactionResult&gt; {
  const { firstKeptEntryId, messagesToSummarize, turnPrefixMessages,
          isSplitTurn, tokensBefore, previousSummary, fileOps, settings } = preparation;

  let summary: string;
  if (isSplitTurn && turnPrefixMessages.length > 0) {
    // Split turn：并行生成历史摘要 + turn prefix 摘要
    const [historyResult, turnPrefixResult] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(messagesToSummarize, model, settings.reserveTokens,
            apiKey, headers, signal, customInstructions, previousSummary,
            thinkingLevel, streamFn)
        : Promise.resolve("No prior history."),
      generateTurnPrefixSummary(turnPrefixMessages, model, settings.reserveTokens,
        apiKey, headers, signal, thinkingLevel, streamFn),
    ]);
    summary = \`\${historyResult}\\n\\n---\\n\\n**Turn Context (split turn):**\\n\\n\${turnPrefixResult}\`;
  } else {
    // 正常情况：仅生成历史摘要（如有 previousSummary 则增量更新）
    summary = await generateSummary(messagesToSummarize, model, settings.reserveTokens,
      apiKey, headers, signal, customInstructions, previousSummary, thinkingLevel, streamFn);
  }

  // 追加文件操作列表到摘要末尾（读/写/改的文件清单）
  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);

  return { summary, firstKeptEntryId, tokensBefore,
           details: { readFiles, modifiedFiles } as CompactionDetails };
}</code></pre>
      </div>

      <h3>摘要 Prompt 设计：增量更新 vs 初始总结</h3>
      <p><code>generateSummary()</code> 根据是否有 previousSummary 选择不同的 prompt：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:16px;">
        <li><strong>SUMMARIZATION_PROMPT（初始总结）</strong>：要求 LLM 按结构化格式生成摘要——Goal、Progress（Done / In Progress / Blocked）、Key Decisions、Next Steps、Critical Context</li>
        <li><strong>UPDATE_SUMMARIZATION_PROMPT（增量更新）</strong>：已有 previousSummary 时使用，要求 LLM <strong>保留已有信息</strong>，只更新进度（如将 In Progress 移到 Done）和下一步</li>
      </ul>
      <p>所有对话在发送给 LLM 前会先通过 <code>serializeConversation()</code> 序列化为纯文本并包裹在 <code>&lt;conversation&gt;</code> 标签中，同时使用 <code>SUMMARIZATION_SYSTEM_PROMPT</code> 作为 system prompt，确保 LLM 理解这是总结任务而非继续对话。</p>

      <div class="info-card">
        <h4>Compaction 的设计哲学</h4>
        <p>整个 compaction 模块遵循三个核心原则：</p>
        <ol style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-top:8px;">
          <li><strong>纯函数</strong>：所有逻辑不依赖 session I/O，便于测试和复用</li>
          <li><strong>保守估算</strong>：chars/4 高估 token，宁可多压缩也不能溢出</li>
          <li><strong>增量更新</strong>：基于上次摘要更新而非从头总结，减少 token 消耗和语义丢失</li>
        </ol>
      </div>
    `;
    container.appendChild(s10);
  },

  quiz: [
    {
      question: 'Pi Agent 的 session 存储在什么格式的文件中？',
      options: [
        'SQLite 数据库',
        'BSON 二进制文件',
        'JSONL（每行一个 JSON 对象）',
        'YAML 配置文件',
      ],
      answer: 2,
      explanation: 'Session 采用 JSONL 格式存储，每行一个完整的 JSON 对象。这种格式支持 append-only 写入、流式读取、行级容错和人类可读。',
    },
    {
      question: '下面关于 Session 树形结构的描述，哪个是正确的？',
      options: [
        'Session 是一个线性数组，消息按时间顺序排列',
        'Session 是一棵多分支树，每个 entry 有 id 和 parentId，分支通过移动 leafId 指针实现',
        'Session 是一个环形缓冲区，旧消息自动覆盖',
        'Session 使用 B+树索引来加速查找',
      ],
      answer: 1,
      explanation: 'Session 是多分支树结构。每个 entry 通过 id/parentId 形成父子关系，leafId 指针决定当前上下文路径。分支只需移动指针，不修改已有数据。',
    },
    {
      question: '关于 CustomEntry 和 CustomMessageEntry，哪个说法正确？',
      options: [
        '两者功能完全相同，只是名字不同',
        'CustomEntry 参与 LLM 上下文，CustomMessageEntry 不参与',
        'CustomEntry 是扩展私有数据（不参与 LLM 上下文），CustomMessageEntry 注入内容到 LLM 对话中',
        '两者都不参与 LLM 上下文，仅用于 UI 显示',
      ],
      answer: 2,
      explanation: 'CustomEntry 用于扩展存储内部状态（跨 reload 保持），LLM 完全看不到。CustomMessageEntry 用于扩展注入内容到 LLM 对话，在上下文构建时转为 user 消息。',
    },
    {
      question: 'Declaration Merging 在 Pi 中的作用是什么？',
      options: [
        '合并重复的代码以减少包体积',
        '让 agent 核心包在不引入上层依赖的情况下，通过 TypeScript 类型系统扩展 AgentMessage 类型',
        '合并多个 session 文件为一个',
        '合并多个 LLM 的响应以提高准确性',
      ],
      answer: 1,
      explanation: 'agent 核心包定义空的 CustomAgentMessages 接口，coding-agent 包通过 declare module 填充具体类型（BashExecutionMessage 等）。核心包保持零依赖，不耦合具体消息类型。',
    },
  ],

  coding: [
    {
      title: '实现 Token 估算器',
      prompt: '编写一个 estimateTokens 函数，接收消息对象（含 role 和 content），用 chars/4 方式估算 token 数量。支持 user（文本或数组 content）、assistant（多 block）、toolResult 三种角色。',
      hint: '对 user 消息：如果 content 是字符串直接用其长度；如果是数组，遍历取 text 字段求和。对 assistant 消息：遍历 content 数组，取各 block 的 text 或 thinking 字段。最后 Math.ceil(chars / 4)。',
      answer: `function estimateTokens(message) {
  let chars = 0;
  switch (message.role) {
    case 'user': {
      if (typeof message.content === 'string') {
        chars = message.content.length;
      } else {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) chars += block.text.length;
        }
      }
      break;
    }
    case 'assistant': {
      for (const block of message.content) {
        if (block.type === 'text') chars += block.text.length;
        else if (block.type === 'thinking') chars += block.thinking.length;
        else if (block.type === 'toolCall')
          chars += block.name.length + JSON.stringify(block.arguments).length;
      }
      break;
    }
    case 'toolResult': {
      if (typeof message.content === 'string') chars = message.content.length;
      else {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) chars += block.text.length;
        }
      }
      break;
    }
  }
  return Math.ceil(chars / 4);
}`,
      explanation: '这是 compaction.ts 中 estimateTokens() 的简化实现。核心思想是 chars/4——这是一个保守（高估）的启发式，确保 token 估算不会偏低导致 context overflow。真实实现还处理 bashExecution、branchSummary、compactionSummary 等自定义消息类型。',
    },
    {
      title: '实现 JSONL Session 文件解析器',
      prompt: '编写一个 parseSessionFile 函数，读取 JSONL 格式的 session 文件，解析每一行为 JSON 对象，并根据 id/parentId 构建成树形结构（Map<id, entry>），同时追踪 leafId。假设文件内容是一个多行字符串。',
      hint: '逐行解析 JSON，以 id 为 key 存入 Map。leafId 可以是最后一条消息的 id。返回 { entries: Map, leafId }。',
      answer: `function parseSessionFile(jsonlContent) {
  const lines = jsonlContent.trim().split('\\n');
  const byId = new Map();
  let leafId = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    byId.set(entry.id, entry);
    leafId = entry.id;  // 最后一条作为叶子
  }

  return { byId, leafId };
}

// 使用示例：从 leafId 向根遍历，构建上下文路径
function buildPath(byId, leafId) {
  const path = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;  // [root, ..., leaf]
}`,
      explanation: '这是 SessionManager 加载 session 文件的核心逻辑。JSONL 每行独立解析，容错性好。tree 结构通过 id/parentId 隐式定义，leafId 指针决定当前活跃路径。遍历路径只需从 leafId 向根回溯，O(path_depth) 时间复杂度。',
    },
    {
      title: '实现压缩切割点查找',
      prompt: '编写一个 findCompactionCutPoint 函数，接收消息数组（每条含 role 和 tokens 字段）和 keepTokens 参数。从数组末尾向前反向遍历，累积 token，当累积量超过 keepTokens 时，找到最近的 user 或 assistant 消息索引作为切割点。规则：不能在 toolResult 处切割。',
      hint: '反向遍历（i 从 length-1 到 0），累加 tokens。当累加量 >= keepTokens 时，从当前 i 向后找第一个 role 为 "user" 或 "assistant" 的消息索引。',
      answer: `function findCompactionCutPoint(messages, keepTokens) {
  let accumulated = 0;
  let cutIndex = 0;

  // 从最新消息向前反向遍历
  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += messages[i].tokens;

    if (accumulated >= keepTokens) {
      // 找到 >= i 的最近的合法切割点（不能是 toolResult）
      for (let j = i; j < messages.length; j++) {
        if (messages[j].role === 'user' || messages[j].role === 'assistant') {
          cutIndex = j;
          break;
        }
      }
      break;
    }
  }

  // 切割点之前的消息将被压缩，之后的消息保留
  return {
    cutIndex,
    messagesToSummarize: messages.slice(0, cutIndex),
    messagesToKeep: messages.slice(cutIndex),
    tokensBefore: messages.reduce((sum, m) => sum + m.tokens, 0),
  };
}

// 示例
const messages = [
  { role: 'user', tokens: 500 },
  { role: 'assistant', tokens: 1200 },
  { role: 'toolResult', tokens: 300 },
  { role: 'assistant', tokens: 800 },
  { role: 'user', tokens: 400 },
  { role: 'assistant', tokens: 600 },
];
const result = findCompactionCutPoint(messages, 1500);
// cutIndex = 2 (toolResult 的索引 2 不能切，所以切在索引 3 的 assistant)
// messagesToSummarize: [0,1,2], messagesToKeep: [3,4,5]`,
      explanation: '这是 findCutPoint() 的简化实现。核心逻辑是反向遍历找到 token 预算边界，再向前找合法切割点。真实实现更复杂：需要处理 validCutPoints 预计算、split turn 检测（切割点不在 user 消息上时需找到 turn 起始消息）、以及非 message 类型的条目跳过等。',
    },
  ],

  summary: [
    'Session 采用 JSONL 格式 append-only 存储，延迟持久化避免孤儿文件',
    '会话是树形结构：id/parentId 构建多分支树，leafId 指针决定上下文路径，分支 O(1) 操作',
    '9 种 Entry 类型：message、compaction、branch_summary、custom_message、custom、label、session_info、thinking_level_change、model_change',
    'buildSessionContext() 从 leafId 向根遍历，处理 compaction 边界，将各类 entry 转为 AgentMessage[]',
    '消息三层架构：AgentMessage（内部）→ Message（LLM）→ SessionEntry（持久化），convertToLlm() 负责转换',
    'Declaration Merging 让核心包在不依赖上层的情况下扩展消息类型——核心包暴露接口，上层通过 TS 类型系统注入',
  ],
});
