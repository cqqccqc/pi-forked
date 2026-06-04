/**
 * 第4章：Agent Loop — Agent 的心脏
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 4,
  title: 'Agent Loop：驱动一切的 while 循环',
  desc: '深入理解 Agent 核心循环的设计——双层循环结构、状态管理和消息队列，掌握 agentLoop() 函数的执行流程。',

  objectives: [
    '理解 Agent Loop 的双层 while 循环结构——外层 follow-up 循环与内层工具调用循环',
    '掌握 agentLoop()（公开 API）和内部 runLoop() 的执行流程，能逐行阅读源码',
    '理解 Steering 和 Follow-up 消息队列的区别：all 模式 vs one-at-a-time 模式',
    '了解 Agent 类的有状态包装设计——无状态函数与有状态类的协作关系',
  ],

  render(container) {
    // === Section 1: 比喻引入 ===
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>4.1 Agent Loop 就像一个"不断干活直到没活干的工人"</h2>
      <p>想象一个有经验的建筑工人，他接到了一个任务："修复这栋房子的所有漏水管道"。</p>
      <p>他的工作方式是这样的：</p>
      <div class="step-list">
        <li>
          <h4>查看任务清单，确认要做什么</h4>
          <p>工人看一眼工单："修复漏水管道"。他拿出工具箱，开始思考第一步做什么。</p>
        </li>
        <li>
          <h4>决定第一步：检查水管走向</h4>
          <p>他决定先看看房子的水管图（调用 <code>read</code> 工具），找到所有管道的位置。</p>
        </li>
        <li>
          <h4>拿着水管图，找到漏水点</h4>
          <p>根据水管图，他用探测器逐个检查管道（调用 <code>bash</code> 执行检测命令）。</p>
        </li>
        <li>
          <h4>修复漏水，验证修复结果</h4>
          <p>找到漏水点后，他换上新的密封圈（调用 <code>edit</code> 修改代码），然后开水测试是否还漏水（调用 <code>bash</code> 运行测试）。</p>
        </li>
        <li>
          <h4>活干完了，还有新活吗？</h4>
          <p>所有漏水点修好了。但他不急着下班——先看看主管有没有在工单上新加了任务（检查 follow-up 队列）。如果有，继续干；没有，收工。</p>
        </li>
      </div>
      <p>这就是 <strong>Agent Loop</strong> 的核心逻辑——Agent 每完成一步都会停下来问自己："我需要调用工具吗？"如果需要，就调工具，把结果加回去，再问一次。直到不再需要任何工具，才看看有没有后续任务。</p>
    `;
    container.appendChild(s1);

    // === Section 2: 双层循环结构 ===
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>4.2 双层 while 循环结构</h2>
      <p>Agent Loop 的核心定义在 <code>packages/agent/src/agent-loop.ts</code> 的 <code>runLoop()</code> 函数中。它采用了双层循环结构：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — runLoop() 双层循环骨架</span></div>
        <pre><code class="language-typescript">async function runLoop(
  initialContext: AgentContext,
  newMessages: AgentMessage[],
  initialConfig: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
  streamFn?: StreamFn,
): Promise&lt;void&gt; {
  let currentContext = initialContext;
  let config = initialConfig;
  let firstTurn = true;
  let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

  // 外层循环：处理 follow-up 消息
  while (true) {
    let hasMoreToolCalls = true;

    // 内层循环：处理工具调用 + steering 消息
    while (hasMoreToolCalls || pendingMessages.length > 0) {
      // ... 调用 LLM、执行工具、检查结果
    }

    // Agent 即将结束，检查有没有 follow-up 消息
    const followUpMessages = (await config.getFollowUpMessages?.()) || [];
    if (followUpMessages.length > 0) {
      pendingMessages = followUpMessages;
      continue;  // 回到外层循环顶部，让内层循环处理
    }

    // 没有 follow-up，真正退出
    break;
  }

  await emit({ type: "agent_end", messages: newMessages });
}</code></pre>
      </div>

      <div class="info-card">
        <h4>双循环的本质</h4>
        <table class="content-table" style="margin-top:12px;">
          <tr><th></th><th>内层循环</th><th>外层循环</th></tr>
          <tr><td>触发条件</td><td>LLM 返回了 tool_call，或 pending 中有待注入的消息</td><td>内层循环退出后，follow-up 队列非空</td></tr>
          <tr><td>主要工作</td><td>调 LLM → 执行工具 → 注入结果 → 再调 LLM</td><td>取出 follow-up 消息，传给内层循环处理</td></tr>
          <tr><td>退出条件</td><td>LLM 不再返回工具调用，且 pending 为空</td><td>follow-up 队列为空</td></tr>
          <tr><td>类比</td><td>工人完成一个任务的每一步</td><td>工人完成一个任务后，检查有没有新任务</td></tr>
        </table>
      </div>

      <p>下面用流程图直观展示这个双层循环的工作过程。</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ Agent Loop 双层循环流程图</div>
      </div>
    `;
    container.appendChild(s2);
    // Render the agent loop diagram
    const diagramDiv = s2.querySelector('.diagram-container');
    Diagrams.drawAgentLoop(diagramDiv);

    // === Section 3: agentLoop 和 runLoop 源码 ===
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>4.3 agentLoop() — 循环的启动入口</h2>
      <p>Agent Loop 有两个入口函数：<code>agentLoop()</code> 用于带新消息启动，<code>agentLoopContinue()</code> 用于从当前上下文继续（如重试场景）。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — agentLoop() 入口</span></div>
        <pre><code class="language-typescript">export function agentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): EventStream&lt;AgentEvent, AgentMessage[]&gt; {
  const stream = createAgentStream();

  void runAgentLoop(
    prompts,
    context,
    config,
    async (event) => {
      stream.push(event);
    },
    signal,
    streamFn,
  ).then((messages) => {
    stream.end(messages);
  });

  return stream;
}</code></pre>
      </div>

      <p><code>agentLoop()</code> 创建了一个 <code>EventStream</code>，然后以"fire-and-forget"的方式启动 <code>runAgentLoop()</code>——不等待它完成，而是通过事件流通知调用方每一个生命周期事件。这是一个典型的<strong>异步事件驱动</strong>模式。</p>

      <h3>runAgentLoop() — 将 prompt 加入上下文并启动循环</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — runAgentLoop()</span></div>
        <pre><code class="language-typescript">export async function runAgentLoop(
  prompts: AgentMessage[],
  context: AgentContext,
  config: AgentLoopConfig,
  emit: AgentEventSink,
  signal?: AbortSignal,
  streamFn?: StreamFn,
): Promise&lt;AgentMessage[]&gt; {
  const newMessages: AgentMessage[] = [...prompts];
  const currentContext: AgentContext = {
    ...context,
    messages: [...context.messages, ...prompts],
  };

  await emit({ type: "agent_start" });
  await emit({ type: "turn_start" });
  for (const prompt of prompts) {
    await emit({ type: "message_start", message: prompt });
    await emit({ type: "message_end", message: prompt });
  }

  await runLoop(currentContext, newMessages, config, signal, emit, streamFn);
  return newMessages;
}</code></pre>
      </div>

      <p>这段代码做了几件事：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li>将新的 prompt 消息追加到上下文副本中（不修改原始 context）</li>
        <li>按顺序发出事件：<code>agent_start</code> → <code>turn_start</code> → 每条消息的 <code>message_start</code>/<code>message_end</code></li>
        <li>然后进入 <code>runLoop()</code> 主循环</li>
      </ul>
    `;
    container.appendChild(s3);

    // === Section 4: 内层循环详解 ===
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>4.4 内层循环详解：一次 Turn 的完整旅程</h2>
      <p>内层循环的每一次迭代称为一个 <strong>Turn</strong>。一个 Turn 包含调用 LLM 一次，以及（如果 LLM 决定调用工具）执行工具并将结果返回给 LLM 的过程。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — 内层循环核心</span></div>
        <pre><code class="language-typescript">// 内层循环：处理工具调用和 steering 消息
while (hasMoreToolCalls || pendingMessages.length > 0) {
  if (!firstTurn) {
    await emit({ type: "turn_start" });
  } else {
    firstTurn = false;
  }

  // 步骤1: 注入 pending 消息（steering 或上一轮的遗留）
  if (pendingMessages.length > 0) {
    for (const message of pendingMessages) {
      await emit({ type: "message_start", message });
      await emit({ type: "message_end", message });
      currentContext.messages.push(message);
      newMessages.push(message);
    }
    pendingMessages = [];
  }

  // 步骤2: 流式获取 LLM 响应
  const message = await streamAssistantResponse(
    currentContext, config, signal, emit, streamFn
  );
  newMessages.push(message);

  // 步骤3: 错误处理 — 如果 LLM 返回错误，立即终止
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    await emit({ type: "turn_end", message, toolResults: [] });
    await emit({ type: "agent_end", messages: newMessages });
    return;
  }

  // 步骤4: 提取工具调用并执行
  const toolCalls = message.content.filter((c) => c.type === "toolCall");

  const toolResults: ToolResultMessage[] = [];
  hasMoreToolCalls = false;
  if (toolCalls.length > 0) {
    const executedToolBatch = await executeToolCalls(
      currentContext, message, config, signal, emit
    );
    toolResults.push(...executedToolBatch.messages);
    hasMoreToolCalls = !executedToolBatch.terminate;

    for (const result of toolResults) {
      currentContext.messages.push(result);
      newMessages.push(result);
    }
  }

  await emit({ type: "turn_end", message, toolResults });

  // 步骤5: 准备下一轮（compaction、模型切换等）
  const nextTurnSnapshot = await config.prepareNextTurn?.({
    message, toolResults, context: currentContext, newMessages,
  });
  if (nextTurnSnapshot) {
    currentContext = nextTurnSnapshot.context ?? currentContext;
    config = { ...config, model: nextTurnSnapshot.model ?? config.model };
  }

  // 步骤6: 外部控制 — 是否在此停止
  if (await config.shouldStopAfterTurn?.({ message, toolResults, context: currentContext, newMessages })) {
    await emit({ type: "agent_end", messages: newMessages });
    return;
  }

  // 步骤7: 检查有没有新的 steering 消息
  pendingMessages = (await config.getSteeringMessages?.()) || [];
}</code></pre>
      </div>

      <p>一次 Turn 的 7 个步骤，每一步都有明确职责：</p>
      <table class="content-table">
        <tr><th>步骤</th><th>操作</th><th>目的</th></tr>
        <tr><td>1</td><td>注入 pending 消息</td><td>把用户在 Agent 工作中插入的新指令注入上下文，供 LLM 在下一轮响应时考虑</td></tr>
        <tr><td>2</td><td>调用 LLM 流式获取响应</td><td>通过 streamSimple() 调用 AI 模型，消费返回的 AssistantMessageEventStream</td></tr>
        <tr><td>3</td><td>错误/中止检测</td><td>如果 LLM 返回 error 或用户 abort，立即终止循环</td></tr>
        <tr><td>4</td><td>提取工具调用并执行</td><td>从 assistant message 中提取 toolCall，根据执行模式（并行/串行）执行</td></tr>
        <tr><td>5</td><td>准备下一 turn</td><td>触发 compaction（压缩）、模型切换等钩子</td></tr>
        <tr><td>6</td><td>外部停止检查</td><td>允许外部通过 shouldStopAfterTurn 钩子中断循环</td></tr>
        <tr><td>7</td><td>检查 steering 消息</td><td>查询是否有新的用户消息在等待，有则下一轮注入</td></tr>
      </table>
    `;
    container.appendChild(s4);

    // === Section 5: Agent 类 — 有状态包装 ===
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>4.5 Agent 类：无状态函数 + 有状态包装</h2>
      <p>Pi 的设计中有一个巧妙的分离：<strong>agentLoop() 是无状态的纯函数</strong>，而 <code>Agent</code> 类是对它的有状态包装，负责管理队列、生命周期和并发控制。</p>

      <h3>为什么要这样分离？</h3>
      <table class="content-table">
        <tr><th>设计</th><th>优点</th><th>缺点</th></tr>
        <tr><td>无状态 agentLoop 函数</td><td>逻辑清晰、易于测试、不依赖外部状态、可独立使用</td><td>需要调用方管理队列和并发</td></tr>
        <tr><td>有状态 Agent 类</td><td>管理队列、生命周期、并发控制、事件订阅</td><td>状态管理增加了复杂度</td></tr>
      </table>
      <p>这种分离让 core logic（循环逻辑）保持纯净，而状态管理的复杂性被封装在 Agent 类中。</p>

      <h3>Agent 类的结构</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent.ts — Agent 类结构</span></div>
        <pre><code class="language-typescript">class Agent {
  _state: MutableAgentState;        // 当前状态（消息、工具、模型、是否在流式传输中）
  listeners: Set&lt;EventListener&gt;;    // 事件订阅者
  steeringQueue;                    // 用户在工作时插入的消息队列
  followUpQueue;                    // agent 完成后执行的消息队列
  activeRun;                        // 当前运行中的 Promise + AbortController

  prompt(input)     → 启动新的 agent 循环
  continue()        → 从当前上下文继续（如 retry）
  steer(message)    → 排队 steering 消息
  followUp(message) → 排队 follow-up 消息
  abort()           → 取消当前运行
  subscribe(fn)     → 监听生命周期事件
}</code></pre>
      </div>

      <div class="info-card">
        <h4>互斥运行</h4>
        <p>同一时刻只能有一个 active run。如果 agent 正在运行中，新的 <code>prompt()</code> 调用会被排队或拒绝。这避免了并发状态冲突——你不会希望两个 agent loop 同时修改同一份消息历史。</p>
      </div>
    `;
    container.appendChild(s5);

    // === Section 6: Steering vs Follow-up ===
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>4.6 Steering vs Follow-up：两种消息队列</h2>
      <p>Agent 定义了两个消息队列，分别处理不同场景下的用户输入：</p>

      <table class="content-table">
        <tr><th></th><th>Steering 消息</th><th>Follow-up 消息</th></tr>
        <tr><td>触发时机</td><td>Agent 正在工作中（工具执行中或新一轮开始前）</td><td>Agent 完成当前任务后</td></tr>
        <tr><td>语义</td><td>"别停，我有个新指令插进来"</td><td>"你干完了？那接下来做这个"</td></tr>
        <tr><td>在循环中的位置</td><td>内层循环每轮结束前检查 <code>getSteeringMessages()</code></td><td>内层循环全部结束后，外层循环检查 <code>getFollowUpMessages()</code></td></tr>
        <tr><td>处理模式</td><td><code>"all"</code> — 一次全部取出并注入</td><td><code>"one-at-a-time"</code> — 每次只取一条</td></tr>
        <tr><td>类比</td><td>工人正在修水管，你说"顺便把水龙头也换一下"</td><td>工人修完了，你说"好了，现在去修二楼的管道"</td></tr>
      </table>

      <h3>为什么不合并成一个队列？</h3>
      <p>两种消息的<strong>处理时机和处理方式</strong>不同：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>Steering 消息</strong>需要在 Agent 还活跃时立即介入。如果 Agent 正在工具调用链中（比如读了 5 个文件后在改代码），steering 消息会在下一轮 LLM 调用前被注入，影响 LLM 的后续决策。</li>
        <li><strong>Follow-up 消息</strong>需要等 Agent 完全完成当前任务后再处理。如果把 follow-up 当成 steering 注入，LLM 可能会在当前任务还没完成时就分心处理后续任务，导致两个任务都做不好。</li>
      </ul>
    `;
    container.appendChild(s6);

    // === Section 7: 事件驱动 ===
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>4.7 事件驱动：所有状态变更通过事件通知</h2>
      <p>Agent Loop 中的所有关键节点都会通过 <code>emit()</code> 发出事件。上层代码（UI、session 管理器、扩展系统）通过订阅这些事件来做出响应，而不需要入侵循环逻辑本身。</p>

      <h3>Agent Loop 中的事件类型</h3>
      <table class="content-table">
        <tr><th>事件</th><th>触发时机</th><th>携带数据</th></tr>
        <tr><td><code>agent_start</code></td><td>Agent 循环开始</td><td>—</td></tr>
        <tr><td><code>agent_end</code></td><td>Agent 循环结束</td><td>本轮产生的所有新消息</td></tr>
        <tr><td><code>turn_start</code></td><td>每个 turn 开始</td><td>—</td></tr>
        <tr><td><code>turn_end</code></td><td>每个 turn 结束</td><td>assistant 消息 + 工具结果列表</td></tr>
        <tr><td><code>message_start</code></td><td>消息产生（user/asst/toolResult）</td><td>消息对象</td></tr>
        <tr><td><code>message_update</code></td><td>assistant 消息流式更新</td><td>增量事件 + 当前完整消息快照</td></tr>
        <tr><td><code>message_end</code></td><td>消息完成</td><td>最终消息对象</td></tr>
        <tr><td><code>tool_execution_start</code></td><td>工具开始执行</td><td>工具 ID、名称、参数</td></tr>
        <tr><td><code>tool_execution_update</code></td><td>工具执行过程中</td><td>部分结果</td></tr>
        <tr><td><code>tool_execution_end</code></td><td>工具执行完成</td><td>工具 ID、名称、结果、是否出错</td></tr>
      </table>

      <h3>事件流示例：一次简单的 read 工具调用</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">一次 read 工具调用的事件序列</span></div>
        <pre><code class="language-plaintext">agent_start
turn_start
  message_start (user: "帮我读一下 src/utils.ts")
  message_end   (user)
  message_start (assistant: 思考中...)
    message_update (thinking_delta)
    message_update (text_delta: "我")
    message_update (text_delta: "来")
    message_update (text_delta: "读取")
    message_update (toolcall_delta: {"filePath":"src/utils.ts"})
  message_end   (assistant: toolcall=read)
  tool_execution_start (read, {filePath: "src/utils.ts"})
    tool_execution_update (partial result)
  tool_execution_end   (read, result=...)
  message_start (toolResult)
  message_end   (toolResult)
turn_end
agent_end</code></pre>
      </div>

      <p>这个事件驱动架构让 UI 可以实时地：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li>显示 LLM 的流式文本输出（订阅 <code>message_update</code>）</li>
        <li>展示正在执行哪个工具及其参数（订阅 <code>tool_execution_start</code>）</li>
        <li>显示工具执行进度（订阅 <code>tool_execution_update</code>）</li>
        <li>展示工具执行结果（订阅 <code>tool_execution_end</code>）</li>
        <li>持久化消息到 session 文件（订阅 <code>message_end</code>）</li>
      </ul>

      <div class="info-card tip">
        <h4>为什么用事件驱动而不是回调？</h4>
        <p>回调模式会导致"回调地狱"——每个生命周期阶段都需要预先注册回调，嵌套难以管理。事件驱动让各方可以独立订阅自己关心的事件，"谁关心什么就订阅什么"，实现真正的<strong>关注点分离</strong>。</p>
      </div>
    `;
    container.appendChild(s7);

    // === Section 8: 深入 executeToolCalls 与 streamAssistantResponse ===
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>4.8 深入：executeToolCalls 的并行/串行决策与 streamAssistantResponse 的事件消费</h2>
      <p>内层循环的核心是两个函数：<code>streamAssistantResponse</code> 负责调用 LLM 并消费流式事件，<code>executeToolCalls</code> 负责执行工具调用。本节深入这两个函数的完整实现。</p>

      <h3>executeToolCalls：并行 vs 串行的决策逻辑</h3>
      <p>当 LLM 在一次响应中返回多个工具调用时，Agent 需要决定是顺序执行还是并行执行。这个决策由 <code>executeToolCalls</code> 完成：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — executeToolCalls() 入口</span></div>
        <pre><code class="language-typescript">async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise&lt;ExecutedToolCallBatch&gt; {
  const toolCalls = assistantMessage.content.filter((c) =&gt; c.type === "toolCall");

  // 检查是否有任何工具声明为 sequential
  const hasSequentialToolCall = toolCalls.some(
    (tc) =&gt; currentContext.tools?.find((t) =&gt; t.name === tc.name)?.executionMode === "sequential",
  );

  // 决策：全局配置优先，其次看工具声明
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}</code></pre>
      </div>

      <p>决策树很简单：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li>如果全局配置 <code>config.toolExecution === "sequential"</code>，走串行路径</li>
        <li>如果任何一个工具自身声明了 <code>executionMode: "sequential"</code>，也走串行路径（因为有依赖关系）</li>
        <li>否则走并行路径</li>
      </ul>

      <h3>并行执行的三阶段模式</h3>
      <p>并行执行采用<strong>准备→执行→收集</strong>三阶段模式，确保参数验证和事件发送的顺序正确：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — executeToolCallsParallel()</span></div>
        <pre><code class="language-typescript">async function executeToolCallsParallel(
  currentContext, assistantMessage, toolCalls, config, signal, emit
): Promise&lt;ExecutedToolCallBatch&gt; {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  // 阶段1: 顺序准备所有工具调用（参数验证、beforeToolCall 钩子）
  for (const toolCall of toolCalls) {
    await emit({ type: "tool_execution_start", toolCallId: toolCall.id, ... });

    const preparation = await prepareToolCall(
      currentContext, assistantMessage, toolCall, config, signal
    );

    // 如果准备阶段就失败了（如工具不存在、参数非法、钩子阻止），立即完成
    if (preparation.kind === "immediate") {
      const finalized = { toolCall, result: preparation.result, isError: preparation.isError };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      if (signal?.aborted) break;
      continue;
    }

    // 阶段2: 将实际执行包装为 thunk（延迟函数），稍后并发执行
    finalizedCalls.push(async () =&gt; {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext, assistantMessage, preparation, executed, config, signal
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
  }

  // 阶段3: Promise.all 并发执行所有 thunk，然后按原始顺序收集结果
  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) =&gt;
      typeof entry === "function" ? entry() : Promise.resolve(entry)
    ),
  );

  // 按原始顺序发送 toolResult 消息
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return { messages, terminate: shouldTerminateToolBatch(orderedFinalizedCalls) };
}</code></pre>
      </div>

      <table class="content-table">
        <tr><th>阶段</th><th>操作</th><th>为何必须顺序/并行</th></tr>
        <tr><td>阶段1: 准备</td><td>参数验证、beforeToolCall 钩子</td><td>必须顺序 — 参数验证可能抛出错误，钩子可能阻止执行</td></tr>
        <tr><td>阶段2: 执行</td><td>实际调用 tool.execute()</td><td>可以并行 — 各工具独立执行，不互相依赖</td></tr>
        <tr><td>阶段3: 收集</td><td>afterToolCall 钩子、发送结果消息</td><td>必须按原始顺序 — 保持消息在上下文中的位置与工具调用顺序一致</td></tr>
      </table>

      <h3>streamAssistantResponse：消费 EventStream</h3>
      <p><code>streamAssistantResponse</code> 是 Agent Loop 与 LLM provider 之间的桥梁。它负责将 <code>AgentMessage[]</code> 转换为 LLM 可理解的 <code>Message[]</code>，然后消费流式响应事件：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — streamAssistantResponse() 事件消费循环</span></div>
        <pre><code class="language-typescript">async function streamAssistantResponse(
  context: AgentContext, config: AgentLoopConfig,
  signal: AbortSignal | undefined, emit: AgentEventSink, streamFn?: StreamFn,
): Promise&lt;AssistantMessage&gt; {
  // 步骤A: 可选的消息转换（用于上下文压缩等）
  let messages = context.messages;
  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  }

  // 步骤B: AgentMessage[] → Message[]（剔除 UI 消息、转换自定义消息）
  const llmMessages = await config.convertToLlm(messages);

  // 步骤C: 构建 LLM Context
  const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: context.tools,
  };

  // 步骤D: 动态解析 API key（支持短期 OAuth token）
  const resolvedApiKey =
    (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined)
    || config.apiKey;

  // 步骤E: 调用 streamSimple（或注入的 streamFn）
  const response = await streamFunction(config.model, llmContext, {
    ...config, apiKey: resolvedApiKey, signal,
  });

  // 步骤F: 消费事件流，转换为 AgentEvent
  let partialMessage: AssistantMessage | null = null;
  let addedPartial = false;

  for await (const event of response) {
    switch (event.type) {
      case "start":
        // LLM 开始响应，创建 partial message 并加入上下文
        partialMessage = event.partial;
        context.messages.push(partialMessage);
        addedPartial = true;
        await emit({ type: "message_start", message: { ...partialMessage } });
        break;

      case "text_start": case "text_delta": case "text_end":
      case "thinking_start": case "thinking_delta": case "thinking_end":
      case "toolcall_start": case "toolcall_delta": case "toolcall_end":
        // 流式增量 — 更新上下文中的 partial message
        if (partialMessage) {
          partialMessage = event.partial;
          context.messages[context.messages.length - 1] = partialMessage;
          await emit({
            type: "message_update",
            assistantMessageEvent: event,
            message: { ...partialMessage },
          });
        }
        break;

      case "done": case "error": {
        // 流结束 — 获取最终消息替换 partial
        const finalMessage = await response.result();
        if (addedPartial) {
          context.messages[context.messages.length - 1] = finalMessage;
        } else {
          context.messages.push(finalMessage);
          await emit({ type: "message_start", message: { ...finalMessage } });
        }
        await emit({ type: "message_end", message: finalMessage });
        return finalMessage;
      }
    }
  }
  // ... fallback: 如果流未发送 done/error 事件就直接结束了
}</code></pre>
      </div>

      <p><code>streamAssistantResponse</code> 的关键设计：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);">
        <li><strong>partial message 在上下文中就地更新</strong>：不是每次增量都创建新对象，而是直接修改 <code>context.messages[last]</code>。这样 compact 操作不会丢失正在流式传输中的消息。</li>
        <li><strong>事件透传</strong>：<code>message_update</code> 事件携带原始的 <code>assistantMessageEvent</code>，让上层 UI 可以区分 thinking delta 和 text delta。</li>
        <li><strong>安全 fallback</strong>：如果流式循环自然结束（没有 done/error 事件），代码会在循环后调用 <code>response.result()</code> 获取最终消息。</li>
        <li><strong>API key 动态解析</strong>：<code>getApiKey()</code> 钩子允许在每个 turn 开始前动态获取 API key（如刷新 OAuth token），解决了长期运行的 agent 中 token 过期问题。</li>
      </ul>

      <div class="info-card tip">
        <h4>为什么 executeToolCalls 不直接在 agent-loop.ts 中内联？</h4>
        <p>将工具执行逻辑提取为独立函数有三大好处：(1) <code>runLoop</code> 保持简洁，聚焦于循环控制流；(2) 工具执行的串行/并行策略可独立测试；(3) 未来如果要支持新的执行模式（如优先级队列），只需修改 <code>executeToolCalls</code> 而不影响主循环。</p>
      </div>
    `;
    container.appendChild(s8);
  },

  quiz: [
    {
      question: 'Agent Loop 的双层循环中，内层循环的主要工作是什么？',
      options: [
        '检查 follow-up 队列，取出一条新消息',
        '调用 LLM → 执行工具 → 注入结果 → 再调 LLM，直到不需要工具调用',
        '持久化 session 数据到磁盘',
        '检测用户是否有新输入',
      ],
      answer: 1,
      explanation: '内层循环的核心工作是处理工具调用链：调用 LLM 获取响应，如果 LLM 决定调用工具，就执行工具并将结果返回给 LLM，循环直到 LLM 不再调用工具。',
    },
    {
      question: 'agentLoop() 函数为什么使用 fire-and-forget 模式启动 runAgentLoop()？',
      options: [
        '为了提高性能，忽略执行结果',
        '因为 Agent 运行过程中只需要事件通知，不需要等待最终结果',
        '为了让 Agent Loop 通过 EventStream 以事件驱动方式通知调用方，而不是阻塞等待',
        '为了支持多个 Agent 同时运行',
      ],
      answer: 2,
      explanation: 'agentLoop() 创建 EventStream 后立即返回，runAgentLoop() 通过 stream.push() 发送事件、stream.end() 返回最终结果。这是一个典型的异步事件驱动模式，让调用方可以边接收事件边处理。',
    },
    {
      question: 'Steering 消息和 Follow-up 消息的核心区别是什么？',
      options: [
        'Steering 消息是字符串，Follow-up 消息是对象',
        'Steering 消息在 Agent 工作中插入（内层循环），Follow-up 消息在 Agent 完成后处理（外层循环）',
        'Steering 消息只能有一条，Follow-up 消息可以有多条',
        'Steering 消息来自文件，Follow-up 消息来自用户输入',
      ],
      answer: 1,
      explanation: 'Steering 消息在 Agent 还活跃时通过内层循环注入（"别停，顺便做这个"），Follow-up 消息在 Agent 完成当前所有任务后由外层循环处理（"你干完了？那接下来做这个"）。',
    },
    {
      question: 'Agent Loop 中 toolcall_end 事件触发后，Agent 应该做什么？',
      options: [
        '发出 agent_end 事件，结束循环',
        '执行对应的工具，将结果加入上下文，然后继续循环让 LLM 决定下一步',
        '忽略工具调用，直接生成文本回复',
        '重新调用同一个 LLM，请求新的工具调用',
      ],
      answer: 1,
      explanation: '当 LLM 返回 toolcall_end 事件后，Agent 会执行对应的工具，将工具结果作为 toolResult 消息加入上下文，然后让内层循环继续——LLM 会根据工具结果决定下一步是继续调工具还是给出最终回复。',
    },
  ],

  coding: [
    {
      title: '模拟 Agent Loop 的内层循环',
      prompt: '阅读 packages/agent/src/agent-loop.ts 中的内层循环代码（runLoop 函数中的 while 循环），然后编写一个简化的 Agent Loop 模拟函数。要求：\n1. 实现一个 while 循环，每次迭代调用一次 LLM（用 mock 函数代替）\n2. 如果 LLM 返回 tool_call，调用对应的 mock 工具执行函数\n3. 将工具结果加入消息列表，继续循环\n4. 当 LLM 不再返回 tool_call 时退出循环',
      hint: '注意内层循环的两个退出条件：(1) LLM 不再返回工具调用 (hasMoreToolCalls === false)，(2) pending 消息为空。简化版只需要第一个条件。',
      answer: '// 简化的 Agent Loop 内层循环模拟\ninterface Message {\n  role: "assistant" | "toolResult";\n  content: { type: "text" | "toolCall"; name?: string; arguments?: Record<string, any>; text?: string }[];\n}\n\n// Mock LLM：第一次返回 read 工具调用，第二次返回 grep 工具调用，第三次给出最终回复\nlet callCount = 0;\nfunction mockLLM(): Message {\n  callCount++;\n  if (callCount === 1) {\n    return {\n      role: "assistant",\n      content: [{ type: "toolCall", name: "read", arguments: { filePath: "src/main.ts" } }],\n    };\n  }\n  if (callCount === 2) {\n    return {\n      role: "assistant",\n      content: [{ type: "toolCall", name: "grep", arguments: { pattern: "TODO" } }],\n    };\n  }\n  return {\n    role: "assistant",\n    content: [{ type: "text", text: "分析完成，没有发现问题" }],\n  };\n}\n\n// Mock 工具执行\nfunction executeTool(name: string, args: Record<string, any>): Message {\n  return {\n    role: "toolResult",\n    content: [{ type: "text", text: \`工具 \${name} 执行完成，参数: \${JSON.stringify(args)}\` }],\n  };\n}\n\n// 主循环\nasync function simplifiedAgentLoop(): Promise<Message[]> {\n  const messages: Message[] = [];\n  let hasMoreToolCalls = true;\n\n  while (hasMoreToolCalls) {\n    // 调用 LLM 获取响应\n    const assistantMessage = await mockLLM();\n    messages.push(assistantMessage);\n\n    // 提取工具调用\n    const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");\n\n    if (toolCalls.length === 0) {\n      // 没有工具调用，退出循环\n      hasMoreToolCalls = false;\n    } else {\n      // 执行所有工具调用\n      for (const tc of toolCalls) {\n        const result = executeTool(tc.name!, tc.arguments!);\n        messages.push(result);\n      }\n      // 继续循环，让 LLM 看到工具结果后决定下一步\n    }\n  }\n\n  return messages;\n}\n\n// 运行\nsimplifiedAgentLoop().then((msgs) => {\n  console.log(\`共产生 \${msgs.length} 条消息\`);\n  // 预期输出: 共产生 5 条消息\n  // (asst toolcall + toolResult + asst toolcall + toolResult + asst final)\n});',
      explanation: '这个简化版演示了内层循环的核心机制：每次迭代调用 LLM，如果 LLM 返回工具调用就执行工具并将结果加入上下文，继续循环直到 LLM 给出纯文本回复。真实代码在 runLoop() 中还额外处理了 steering 消息注入、错误/中止检测、prepareNextTurn 钩子等。',
    },
    {
      title: '追踪 executeToolCalls 的串行/并行决策',
      prompt: '阅读 packages/agent/src/agent-loop.ts 中 executeToolCalls、executeToolCallsSequential、executeToolCallsParallel 三个函数的源码（约 150 行），回答：\n1. 并行模式下，为什么阶段1（prepareToolCall）必须顺序执行？\n2. 并行模式中，最终消息的发送顺序为什么必须和原始工具调用顺序一致？\n3. FinalizedToolCallEntry 类型为什么是 FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>)？',
      hint: '关注 beforeToolCall 钩子的阻塞能力、Promise.all 的并发特性、以及 context.messages 的顺序语义。',
      answer: '1. 阶段1（prepareToolCall）必须顺序执行的原因：\n   - beforeToolCall 钩子可能返回 { block: true }，阻止后续工具执行。如果并行准备，一个工具的阻止决定无法影响其他正在准备中的工具。\n   - 参数验证（validateToolArguments）可能抛出异常，必须提前捕获并转为 immediate 结果。\n   - 工具可能不存在（tool not found），也需要直接返回错误结果。\n\n2. 消息发送顺序必须和原始工具调用顺序一致的原因：\n   - context.messages 是有序的消息历史，toolResult 消息应该和对应的 toolCall 在 LLM 眼中的顺序一致。\n   - LLM 在下一轮对话中看到的消息顺序会影响它的理解。如果结果顺序打乱，LLM 可能会混淆哪个结果对应哪个调用。\n\n3. FinalizedToolCallEntry 是联合类型的原因：\n   - 如果工具在准备阶段就失败了（kind === "immediate"），直接返回 FinalizedToolCallOutcome。\n   - 如果工具需要实际执行（kind === "prepared"），返回一个 thunk（延迟函数）。\n   - 这样设计允许 Promise.all 统一处理两种结果：对函数调用 fn()，对值用 Promise.resolve(value)。',
      explanation: '这个设计展示了函数式编程中 thunk 模式的实际应用——将"未来才会执行的计算"包装为函数，统一了同步结果和异步结果的接口。',
    },
    {
      title: '模拟 streamAssistantResponse 的事件消费',
      prompt: '阅读 packages/agent/src/agent-loop.ts 中 streamAssistantResponse 函数的事件消费循环（for await...of + switch case），然后实现一个简化版的事件消费者。要求：\n1. 使用 AsyncGenerator 模拟 LLM 返回的事件流\n2. 实现事件处理：start 开始消息，text_delta 累积文本，toolcall_delta 累积工具调用参数，done 结束\n3. 每次 text_delta 时打印累积的文本内容',
      hint: '注意 event.partial 的语义——每个事件携带的是当前的完整快照，不是增量。所以不需要手动累积文本。',
      answer: '// 模拟 LLM 流式返回的事件类型\ntype StreamEvent =\n  | { type: "start"; partial: { content: any[] } }\n  | { type: "text_delta"; partial: { content: any[] } }\n  | { type: "toolcall_start"; partial: { content: any[] } }\n  | { type: "toolcall_delta"; partial: { content: any[] } }\n  | { type: "toolcall_end"; partial: { content: any[] } }\n  | { type: "done" };\n\n// 模拟 LLM 流式响应\nasync function* mockEventStream(): AsyncGenerator<StreamEvent> {\n  yield { type: "start", partial: { content: [] } };\n  yield { type: "text_delta", partial: { content: [{ type: "text", text: "我来" }] } };\n  yield { type: "text_delta", partial: { content: [{ type: "text", text: "我来分析" }] } };\n  yield { type: "text_delta", partial: { content: [{ type: "text", text: "我来分析这个文件" }] } };\n  yield { type: "toolcall_start", partial: { content: [{ type: "toolCall", name: "read", arguments: {} }] } };\n  yield { type: "toolcall_delta", partial: { content: [{ type: "toolCall", name: "read", arguments: { filePath: "src" } }] } };\n  yield { type: "toolcall_delta", partial: { content: [{ type: "toolCall", name: "read", arguments: { filePath: "src/main.ts" } }] } };\n  yield { type: "toolcall_end", partial: { content: [{ type: "toolCall", name: "read", arguments: { filePath: "src/main.ts" } }] } };\n  yield { type: "done" };\n}\n\n// 简化的事件消费者\nasync function consumeStream(): Promise<{ text: string; toolCalls: any[] }> {\n  let currentText = "";\n  const toolCalls: any[] = [];\n\n  for await (const event of mockEventStream()) {\n    switch (event.type) {\n      case "start":\n        console.log("[Agent] LLM 开始响应");\n        break;\n\n      case "text_delta": {\n        // event.partial 是完整快照，所以直接取最新的 text 内容\n        const textBlocks = event.partial.content.filter((c: any) => c.type === "text");\n        currentText = textBlocks.map((c: any) => c.text).join("");\n        console.log(\`[Agent] 文本更新: "\${currentText}"\`);\n        break;\n      }\n\n      case "toolcall_start":\n        console.log("[Agent] 开始构造工具调用");\n        break;\n\n      case "toolcall_delta": {\n        const tc = event.partial.content.find((c: any) => c.type === "toolCall");\n        if (tc) {\n          console.log(\`[Agent] 工具调用更新: \${tc.name}(\${JSON.stringify(tc.arguments)})\`);\n        }\n        break;\n      }\n\n      case "toolcall_end": {\n        const tc = event.partial.content.find((c: any) => c.type === "toolCall");\n        if (tc) {\n          toolCalls.push(tc);\n          console.log(\`[Agent] 工具调用完成: \${tc.name}(\${JSON.stringify(tc.arguments)})\`);\n        }\n        break;\n      }\n\n      case "done":\n        console.log("[Agent] 流式响应结束");\n        break;\n    }\n  }\n\n  return { text: currentText, toolCalls };\n}\n\n// 运行\nconsumeStream().then((result) => {\n  console.log("\\\\n最终结果:", result);\n  // 预期输出:\n  // text: "我来分析这个文件"\n  // toolCalls: [{ type: "toolCall", name: "read", arguments: { filePath: "src/main.ts" } }]\n});',
      explanation: 'streamAssistantResponse 的核心设计是 event.partial 始终携带完整快照（而不是增量 patch），这使得消费者不需要手动累积状态。真实代码中还处理了 thinking delta（推理过程）、错误事件，以及 partial message 在 context.messages 中的就地更新。',
    },
  ],

  summary: [
    'Agent Loop 是一个双层 while 循环：内层处理工具调用链（调 LLM → 执行工具 → 再调 LLM），外层处理 follow-up 消息',
    'agentLoop() 是无状态的纯函数，通过 EventStream 以事件驱动方式通知调用方，不阻塞等待',
    'Agent 类是对 agentLoop() 的有状态包装，负责管理 steering/follow-up 队列、生命周期和并发控制',
    'Steering 消息在 Agent 工作中通过内层循环注入（all 模式），Follow-up 消息在 Agent 完成后由外层循环处理（one-at-a-time 模式）',
    '所有状态变更通过事件通知（agent_start/end、turn_start/end、message_start/update/end、tool_execution_start/update/end）',
    '内层循环每次迭代称为一个 Turn，包含 7 个步骤：注入 pending → 调 LLM → 错误检测 → 执行工具 → 准备下一 turn → 停止检查 → 检查 steering',
    'runLoop() 中的 prepareNextTurn 钩子支持 compaction（压缩上下文）和 model 切换，shouldStopAfterTurn 允许外部中断循环',
  ],
});
