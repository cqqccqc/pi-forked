/**
 * 第9章：安全与可靠性：让 Agent 稳定运行
 *
 * 本章深入讲解 Coding Agent 的错误处理架构、重试机制和工具安全控制。
 * 章节模块格式:
 * - id, title, desc: 元信息
 * - objectives: 学习目标数组
 * - render(container): 渲染章节内容的函数
 * - quiz: 测验题数组 { question, options, answer(0-based), explanation }
 * - summary: 小结要点数组
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
	id: 9,
	title: '安全与可靠性：让 Agent 稳定运行',
	desc: '理解 Coding Agent 的三层错误处理架构、重试机制和工具安全控制，构建稳定可靠的 AI 编程助手。',

	objectives: [
		'理解三层错误处理架构（Provider / Agent Loop / AgentSession）',
		'掌握 StopReason 五种状态的含义和触发场景',
		'了解重试机制：指数退避策略和上下文溢出恢复',
		'理解工具安全控制：白名单、beforeToolCall / afterToolCall 钩子',
		'了解 bash 工具的多层安全防护措施',
	],

	render(container) {
		// === Section 1: 为什么需要错误处理 ===
		const s1 = document.createElement('div');
		s1.className = 'content-section';
		s1.innerHTML = `
			<h2>9.1 稳定运行的前提——为什么需要错误处理</h2>
			<p>Coding Agent 运行在一个高度不确定的环境中。它需要调用远程 AI 服务、读写本地文件、执行 shell 命令——每一步都可能出错：</p>
			<div class="step-list">
				<li>
					<h4>网络不可靠</h4>
					<p>API 服务可能超时、返回 500 错误、限流、连接中断——这些都是常态，不是例外</p>
				</li>
				<li>
					<h4>上下文有限</h4>
					<p>LLM 的上下文窗口有限（例如 200K tokens），当对话历史太长时，请求会被拒绝</p>
				</li>
				<li>
					<h4>工具可能失败</h4>
					<p>文件不存在、路径无权限、命令执行超时——工具调用不是总能成功</p>
				</li>
				<li>
					<h4>用户可能中断</h4>
					<p>用户随时按 Escape 取消操作，Agent 必须优雅地响应</p>
				</li>
			</div>
			<div class="info-card">
				<h4>设计哲学</h4>
				<p>Pi Agent 的错误处理哲学是：<strong>永远不要让异常导致 Agent 崩溃</strong>。所有错误都应该被捕获、编码为结构化的数据，在合适的层次上处理。</p>
			</div>
		`;
		container.appendChild(s1);

		// === Section 2: 三层错误处理架构 ===
		const s2 = document.createElement('div');
		s2.className = 'content-section';
		s2.innerHTML = `
			<h2>9.2 三层错误处理架构</h2>
			<p>Pi Agent 的错误处理分布在三个层次，各司其职。这种分层设计是保证系统稳定运行的核心：</p>

			<table class="content-table">
				<tr><th>层次</th><th>位置</th><th>职责</th><th>策略</th></tr>
				<tr>
					<td><strong>第3层：Provider</strong></td>
					<td><code>packages/ai/src/providers/*.ts</code></td>
					<td>协议级错误编码</td>
					<td>错误编码为流事件，<strong>不抛异常</strong></td>
				</tr>
				<tr>
					<td><strong>第2层：Agent Loop</strong></td>
					<td><code>packages/agent/src/agent-loop.ts</code></td>
					<td>运行时异常捕获</td>
					<td>捕获异常 → 合成为错误消息 → 走正常事件流</td>
				</tr>
				<tr>
					<td><strong>第1层：AgentSession</strong></td>
					<td><code>packages/coding-agent/src/core/agent-session.ts</code></td>
					<td>应用层重试与恢复</td>
					<td>指数退避重试 + 上下文溢出压缩恢复</td>
				</tr>
			</table>

			<p>数据流的方向是 <strong>第3层 → 第2层 → 第1层</strong>：Provider 把错误编码成流事件，Agent Loop 消费事件并做异常兜底，AgentSession 决定是否重试或恢复。</p>

			<div class="info-card tip">
				<h4>为什么要分层？</h4>
				<p>因为不同层次的错误需要不同的处理策略：网络超时适合重试，上下文溢出需要压缩，用户中止不应该重试。分层让每层专注于自己能处理的错误类型。</p>
			</div>
		`;
		container.appendChild(s2);

		// === Section 3: 第3层——Provider 的错误契约 ===
		const s3 = document.createElement('div');
		s3.className = 'content-section';
		s3.innerHTML = `
			<h2>9.3 第3层：Provider ——不抛异常的错误处理</h2>
			<p>LLM Provider 层有一个<strong>核心契约</strong>：</p>

			<div class="info-card">
				<h4>核心契约</h4>
				<p style="font-size:1.1rem;text-align:center;margin:12px 0;font-weight:700;">
					Provider 永远不 throw 或返回 rejected promise。<br>所有错误必须编码到返回的事件流中。
				</p>
			</div>

			<p>这意味着网络超时、API Key 无效、速率限制、服务端 500 错误——全部转化为流中的事件，而不是未捕获的异常。上层代码可以安全地用 <code>for await</code> 消费流：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">Provider 的错误编码流程</span></div>
				<pre><code class="language-plaintext">Provider SDK 抛出异常（如 500 Internal Server Error）
        │
        ▼
Provider 实现的 catch 块
        │
        ├── 创建 AssistantMessage {
        │     stopReason: "error",
        │     errorMessage: "500 Internal Server Error from Anthropic",
        │     usage: { input: 0, output: 0 },
        │     content: []
        │   }
        │
        ├── 流推入 { type: "error", reason: "error" }
        │
        └── 流结束 stream.end(message)</code></pre>
			</div>

			<p>这样做的好处是：无论发生什么错误，流消费者总是能收到一个完整的 <code>AssistantMessage</code>，不会因为未捕获异常而让整个 Agent 进程崩溃。</p>
		`;
		container.appendChild(s3);

		// === Section 4: StopReason 五种状态 ===
		const s4 = document.createElement('div');
		s4.className = 'content-section';
		s4.innerHTML = `
			<h2>9.4 StopReason：一次 LLM 调用如何结束</h2>
			<p>每次 LLM 调用的结果都带有一个 <code>stopReason</code> 字段，它精确描述了这次调用是如何结束的。理解这五种状态是理解错误处理流程的关键：</p>

			<table class="content-table">
				<tr><th>stopReason</th><th>含义</th><th>典型场景</th><th>是否正常</th></tr>
				<tr>
					<td><code>stop</code></td>
					<td>正常完成</td>
					<td>模型自然结束回复，不需要再调用工具</td>
					<td class="text-success">正常</td>
				</tr>
				<tr>
					<td><code>toolUse</code></td>
					<td>请求调用工具</td>
					<td>模型想读文件、执行命令、搜索代码等</td>
					<td class="text-success">正常</td>
				</tr>
				<tr>
					<td><code>length</code></td>
					<td>达到最大 token 数</td>
					<td>回复太长被截断，或输入填满上下文导致无空间生成输出</td>
					<td class="text-warning">需要注意</td>
				</tr>
				<tr>
					<td><code>error</code></td>
					<td>请求出错</td>
					<td>API 返回 500、网络超时、速率限制、上下文溢出等</td>
					<td class="text-danger">异常</td>
				</tr>
				<tr>
					<td><code>aborted</code></td>
					<td>用户或系统取消</td>
					<td>用户按 Escape、AbortSignal 触发</td>
					<td class="text-info">由用户触发</td>
				</tr>
			</table>

			<div class="info-card">
				<h4>为什么把错误编码为 stopReason 而非抛异常？</h4>
				<p>因为这样就建立了一个<strong>统一的终止语义</strong>。上层代码只需要检查 <code>stopReason</code>，不用关心错误来自哪个 Provider、是什么原因——无论是 OpenAI 的 429 还是 Anthropic 的 500，对上层来说都是 <code>error</code>。</p>
			</div>
		`;
		container.appendChild(s4);

		// === Section 5: 第2层——Agent Loop 的错误处理 ===
		const s5 = document.createElement('div');
		s5.className = 'content-section';
		s5.innerHTML = `
			<h2>9.5 第2层：Agent Loop ——运行时异常的兜底</h2>
			<p>Agent Loop 层有两个关键职责：消费 Provider 的事件流，以及在发生意外异常时兜底。</p>

			<h3>消费事件流</h3>
			<p>Agent Loop 用 <code>for await</code> 消费 Provider 返回的事件流，<code>done</code> 和 <code>error</code> 两种终止事件的处理逻辑完全一致——都从流中提取最终的消息，更新上下文，通知监听者：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts</span></div>
				<pre><code class="language-typescript">for await (const event of response) {
    switch (event.type) {
        case "done":
        case "error": {
            // 统一处理：无论成功还是失败，都拿到最终的 AssistantMessage
            const finalMessage = await response.result();
            // 更新上下文、通知监听者
            return finalMessage;
        }
    }
}</code></pre>
			</div>

			<h3>意外异常兜底</h3>
			<p>如果 Agent Loop 的 try-catch 捕获了未被 Provider 编码的异常（比如代码 bug、内存问题），<code>handleRunFailure</code> 方法会<strong>将异常合成为一条完整的错误消息</strong>，走正常的事件流发射出去：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/agent/src/agent.ts — handleRunFailure</span></div>
				<pre><code class="language-typescript">private async handleRunFailure(error, aborted) {
    const failureMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        stopReason: aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
    };
    // 模拟完整的事件序列，确保监听者收到通知
    await this.processEvents({ type: "message_start", message: failureMessage });
    await this.processEvents({ type: "message_end",   message: failureMessage });
    await this.processEvents({ type: "turn_end",      message: failureMessage });
    await this.processEvents({ type: "agent_end",     messages: [failureMessage] });
}</code></pre>
			</div>

			<p>这样即使发生了意料之外的异常，UI 也不会卡在加载状态——监听者总是能收到完整的 <code>message_start → message_end → turn_end → agent_end</code> 事件序列。</p>

			<h3>工具执行中的错误处理</h3>
			<p>工具执行也有独立的错误捕获，但策略不同——<strong>工具错误不中断循环，而是发回给 LLM</strong>：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">工具执行错误处理</span></div>
				<pre><code class="language-typescript">async function executePreparedToolCall(prepared, signal, emit) {
    try {
        const result = await prepared.tool.execute(/* ... */);
        return { result, isError: false };
    } catch (error) {
        // 工具抛出的异常被捕获，转化为错误结果，发回 LLM
        return {
            result: { content: [{ type: "text", text: error.message }] },
            isError: true,
        };
    }
}</code></pre>
			</div>

			<p>工具失败后，错误信息作为 <code>ToolResultMessage</code>（<code>isError: true</code>）发回给 LLM，让模型自己决定下一步——它可以重试、换一种策略、或者告诉用户它做不到。循环不会因工具失败而中断。</p>
		`;
		container.appendChild(s5);

		// === Section 6: 第1层——重试与压缩恢复 ===
		const s6 = document.createElement('div');
		s6.className = 'content-section';
		s6.innerHTML = `
			<h2>9.6 第1层：AgentSession ——自动重试与恢复</h2>
			<p>当 Agent Loop 返回一个 <code>stopReason: "error"</code> 的消息时，AgentSession 层决定如何应对。这里有两条路径：</p>

			<div class="step-list">
				<li>
					<h4>路径A：可恢复错误 → 指数退避重试</h4>
					<p>网络超时、服务端 500/502/503、速率限制（429）等——这些错误是临时的，重试大概率能解决</p>
				</li>
				<li>
					<h4>路径B：上下文溢出 → 压缩后重试</h4>
					<p>"prompt is too long"——重试同样的上下文只会再次溢出，必须先压缩对话历史</p>
				</li>
			</div>

			<h3>哪些错误可重试？</h3>
			<p>AgentSession 通过正则匹配 <code>errorMessage</code> 来判断错误是否可重试：</p>

			<table class="content-table">
				<tr><th>可重试（正则匹配）</th><th>不可重试</th></tr>
				<tr>
					<td>
						<ul style="list-style:disc;padding-left:20px;margin:0;color:var(--text-secondary);">
							<li>服务端过载：<code>overloaded</code>, <code>500</code>, <code>502</code>, <code>503</code>, <code>504</code></li>
							<li>速率限制：<code>rate limit</code>, <code>429</code>, <code>too many requests</code></li>
							<li>网络问题：<code>connection refused</code>, <code>fetch failed</code>, <code>socket hang up</code></li>
							<li>超时：<code>timeout</code>, <code>timed out</code></li>
							<li>连接中断：<code>websocket closed</code>, <code>other side closed</code></li>
						</ul>
					</td>
					<td>
						<ul style="list-style:disc;padding-left:20px;margin:0;color:var(--text-secondary);">
							<li>上下文溢出（走压缩路径）</li>
							<li>认证失败（API Key 无效）</li>
							<li>请求格式错误（400）</li>
							<li>配额/计费耗尽（重试也无济于事）</li>
						</ul>
					</td>
				</tr>
			</table>

			<h3>指数退避重试</h3>
			<p>重试不是立即重试，而是使用<strong>指数退避</strong>策略，给服务端恢复的时间：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">指数退避序列（maxRetries: 3, baseDelayMs: 2000ms）</span></div>
				<pre><code class="language-plaintext">第 1 次重试：等待 2000ms × 2⁰ = 2 秒
第 2 次重试：等待 2000ms × 2¹ = 4 秒
第 3 次重试：等待 2000ms × 2² = 8 秒

超过最大重试次数 → 向用户报告失败</code></pre>
			</div>

			<div class="info-card tip">
				<h4>一个关键设计</h4>
				<p>重试时，错误消息会从 Agent 的状态中移除（LLM 看不到错误，省 token），但<strong>保留在 session 文件中</strong>（用户可以查看历史记录来调试）。重试计数器在每次成功的 LLM 响应后<strong>立即重置</strong>——这意味着一次 prompt 中的多次工具调用不会累积重试次数。</p>
			</div>

			<h3>上下文溢出恢复：Compress-and-Retry</h3>
			<p>当错误消息匹配溢出模式（如 <code>"prompt is too long: 213462 tokens > 200000 maximum"</code>），重试没有意义——同样的上下文发回去只会再次溢出。此时走压缩路径：</p>

			<div class="step-list">
				<li>
					<h4>检测溢出</h4>
					<p>匹配 22 种溢出模式正则（覆盖 Anthropic、OpenAI、Google、xAI、Bedrock 等所有 provider），同时排除速率限制等误匹配</p>
				</li>
				<li>
					<h4>压缩对话</h4>
					<p>调用 LLM 将历史对话总结为摘要，替换原有消息，释放上下文空间</p>
				</li>
				<li>
					<h4>自动重试</h4>
					<p>压缩后自动用 agent.continue() 重新发送请求</p>
				</li>
			</div>

			<div class="info-card">
				<h4>溢出恢复只尝试一次</h4>
				<p>如果压缩后仍然溢出，不再重试。这样可以防止 压缩 → 溢出 → 压缩 → 溢出 的无限循环。用户会收到提示："Context overflow recovery failed. Try switching to a larger-context model."</p>
			</div>
		`;
		container.appendChild(s6);

		// === Section 7: 中止信号传播 ===
		const s7 = document.createElement('div');
		s7.className = 'content-section';
		s7.innerHTML = `
			<h2>9.7 中止（Abort）信号传播</h2>
			<p>用户按 Escape 键取消操作时，一个 AbortSignal 会从顶层传播到所有底层组件：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">AbortSignal 传播路径</span></div>
				<pre><code class="language-plaintext">用户按 Escape
        │
        ▼
Agent.abort() → abortController.abort()
        │
        ▼ signal 传播到：
        ├── agentLoop 的 signal 参数
        ├── streamAssistantResponse → 传给 streamSimple → 传给 Provider SDK
        ├── executeToolCalls → 传给 tool.execute()
        └── prepareToolCall 的 beforeToolCall 钩子</code></pre>
			</div>

			<p>中止后，Provider 在流中产生一个 <code>stopReason: "aborted"</code> 的消息。AgentSession 层面，对中止消息的处理策略是：<strong>不触发重试，不触发压缩</strong>——因为这是用户的主动选择。</p>

			<p>此外，Pi 还提供了 <code>combineAbortSignals</code> 工具函数（<code>packages/ai/src/utils/abort-signals.ts</code>），可以将多个 AbortSignal 合并为一个。例如在 OpenAI Codex Responses provider 中，需要同时响应"用户中止"和"内部超时"两个信号。</p>
		`;
		container.appendChild(s7);

		// === Section 8: 工具安全控制 ===
		const s8 = document.createElement('div');
		s8.className = 'content-section';
		s8.innerHTML = `
			<h2>9.8 工具安全控制</h2>
			<p>Coding Agent 能执行命令、写文件——这带来了强大的能力，也带来了安全风险。Pi 通过多层机制来控制工具的安全性。</p>

			<h3>工具白名单</h3>
			<p>AgentSession 支持通过 <code>allowedToolNames</code> 参数控制哪些工具对 LLM 可见：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/coding-agent/src/core/agent-session.ts</span></div>
				<pre><code class="language-typescript">/** Optional allowlist of tool names. When provided, only these tool names are exposed. */
allowedToolNames?: string[];

// 工具定义在注册时被过滤
const allTools = [...registeredTools, ...customTools]
    .filter(tool => isAllowedTool(tool.definition.name));</code></pre>
			</div>

			<p>例如，如果你只想让 Agent 读写文件，可以设置 <code>allowedToolNames: ['read', 'write']</code>，这样 Agent 甚至不知道 bash 工具的存在。</p>

			<h3>beforeToolCall / afterToolCall 钩子</h3>
			<p>每个工具调用前后都有钩子检查，这是最灵活的安全控制点：</p>

			<table class="content-table">
				<tr><th>钩子</th><th>时机</th><th>能力</th></tr>
				<tr>
					<td><code>beforeToolCall</code></td>
					<td>工具执行前，参数已验证</td>
					<td>可以阻止执行（<code>block: true</code>），返回替代结果</td>
				</tr>
				<tr>
					<td><code>afterToolCall</code></td>
					<td>工具执行后，结果已产生</td>
					<td>可以修改或替换返回给 LLM 的结果</td>
				</tr>
			</table>

			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/agent/src/agent-loop.ts — beforeToolCall</span></div>
				<pre><code class="language-typescript">if (config.beforeToolCall) {
    const beforeResult = await config.beforeToolCall({
        assistantMessage,
        toolCall,
        args: validatedArgs,
        context: currentContext,
    }, signal);

    if (signal?.aborted) {
        return { result: errorResult("Operation aborted"), isError: true };
    }
    if (beforeResult?.block) {
        return {
            result: errorResult(beforeResult.reason || "Tool execution was blocked"),
            isError: true,
        };
    }
}</code></pre>
			</div>

			<div class="info-card">
				<h4>扩展系统的安全作用</h4>
				<p>在 Pi Agent 中，beforeToolCall 钩子由扩展系统驱动。扩展可以监听 <code>tool_call</code> 事件来拦截和审查工具调用。如果扩展抛出异常，工具执行会被阻止——这是一种 fail-safe 策略。</p>
			</div>
		`;
		container.appendChild(s8);

		// === Section 9: bash 工具的安全措施 ===
		const s9 = document.createElement('div');
		s9.className = 'content-section';
		s9.innerHTML = `
			<h2>9.9 bash 工具的安全防护</h2>
			<p>bash 工具是最危险也最强大的工具——它能执行任意 shell 命令。Pi 为其设计了多层安全防护：</p>

			<table class="content-table">
				<tr><th>安全措施</th><th>说明</th><th>代码位置</th></tr>
				<tr>
					<td><strong>工作目录检查</strong></td>
					<td>执行前检查 <code>cwd</code> 是否存在，不存在则拒绝执行</td>
					<td><code>bash.ts:72-74</code></td>
				</tr>
				<tr>
					<td><strong>进程隔离</strong></td>
					<td>非 Windows 下使用 <code>detached: true</code> 模式创建子进程，隔离进程环境</td>
					<td><code>bash.ts:81</code></td>
				</tr>
				<tr>
					<td><strong>进程树追踪</strong></td>
					<td>追踪子进程 PID，支持清理整个进程树（防止孤儿进程）</td>
					<td><code>bash.ts:86</code></td>
				</tr>
				<tr>
					<td><strong>超时控制</strong></td>
					<td>可配置的 timeout，超时后 kill 整个进程树</td>
					<td><code>bash.ts:95-99</code></td>
				</tr>
				<tr>
					<td><strong>AbortSignal 支持</strong></td>
					<td>用户按 Escape 时 kill 进程树，立即停止执行</td>
					<td><code>bash.ts:105-108</code></td>
				</tr>
				<tr>
					<td><strong>输出截断</strong></td>
					<td>使用 <code>OutputAccumulator</code> 限制输出行数和字节数，防止内存溢出</td>
					<td><code>bash.ts:291</code></td>
				</tr>
			</table>

			<div class="info-card tip">
				<h4>安全边界与限制</h4>
				<p>Pi 的 bash 工具<strong>不提供</strong>网络隔离、文件系统沙箱、CPU/内存配额——它依赖操作系统的用户权限和文件权限来控制访问。这意味着 Agent 能做当前用户能做的一切事情。在生产环境中，建议搭配 Docker 容器或 sandbox 环境使用。</p>
			</div>
		`;
		container.appendChild(s9);

		// === Section 10: 整体流程总览 ===
		const s10 = document.createElement('div');
		s10.className = 'content-section';
		s10.innerHTML = `
			<h2>9.10 一次请求的完整容错流程</h2>
			<p>让我们把三层架构串联起来，看一个完整的错误处理流程：</p>

			<div class="code-block">
				<div class="code-label"><span class="file-path">完整错误处理流程</span></div>
				<pre><code class="language-plaintext">用户输入 → AgentSession.prompt()
        │
        ▼
Agent.prompt() → agentLoop()
        │
        ├─→ streamAssistantResponse()
        │     ├─→ Provider 返回正常: stopReason="stop" 或 "toolUse"
        │     ├─→ Provider 返回可重试错误: stopReason="error" + "500"
        │     ├─→ Provider 返回溢出: stopReason="error" + "prompt too long"
        │     ├─→ 用户中止: stopReason="aborted"
        │     └─→ 意外异常: handleRunFailure 合成错误消息
        │
        ├─→ executeToolCalls()
        │     ├─→ 工具正常: isError=false, 结果发回 LLM
        │     ├─→ 工具异常: isError=true, 错误发回 LLM 让模型决策
        │     ├─→ beforeToolCall 阻止: isError=true, reason="blocked"
        │     └─→ 中止: isError=true, "Operation aborted"
        │
        └─→ 事后处理 (_handlePostAgentRun)
              ├── 可重试错误? → 指数退避 → agent.continue()
              ├── 溢出错误?   → 压缩     → agent.continue()
              ├── 超过阈值?   → 压缩（不重试，用户自然继续）
              └── 正常结束    → 完成</code></pre>
			</div>

			<div class="info-card">
				<h4>设计总结</h4>
				<table class="content-table" style="margin-top:12px;">
					<tr><th>设计决策</th><th>原因</th></tr>
					<tr><td>Provider 不抛异常</td><td>流式场景下异常难以正确处理，编码为事件保证消费者总能完成消费</td></tr>
					<tr><td>统一的 stopReason 语义</td><td>上层无需关心 provider 差异，只需检查终止原因</td></tr>
					<tr><td>重试在 AgentSession 层</td><td>重试需要状态管理，agentLoop 是无状态的纯函数</td></tr>
					<tr><td>错误消息从 Agent 移除但保留在 session</td><td>LLM 看不到错误省 token，用户能在历史中看到便于调试</td></tr>
					<tr><td>工具错误发回 LLM 而非中断循环</td><td>让模型自己决定如何处理失败</td></tr>
					<tr><td>溢出恢复只尝试一次</td><td>防止无限的 压缩→溢出→压缩 循环</td></tr>
				</table>
			</div>
		`;
		container.appendChild(s10);

		// === Section 11: 深入：指数退避的数学与完整防护链 ===
		const s11 = document.createElement('div');
		s11.className = 'content-section';
		s11.innerHTML = `
			<h2>9.11 深入：指数退避重试与 bash 安全防护链</h2>
			<p>在 9.6 节中我们看到了重试机制和 bash 安全措施的概述。现在让我们深入源码，理解它们的完整实现。</p>

			<h3>9.11.1 指数退避的数学原理</h3>
			<p>指数退避（Exponential Backoff）是分布式系统中处理瞬时故障的经典策略。它的核心公式是：</p>
			<div class="info-card">
				<h4>指数退避公式</h4>
				<p style="font-size:1.1rem;text-align:center;margin:8px 0;">
					<strong>delay = baseDelay &times; 2<sup>attempt - 1</sup></strong>
				</p>
				<p>其中 baseDelay 是基础等待时间（Pi Agent 默认为 2000ms），attempt 从 1 开始计数。</p>
			</div>
			<table class="content-table">
				<tr><th>attempt</th><th>计算公式</th><th>等待时间（baseDelay=2000ms）</th><th>累计等待</th></tr>
				<tr><td>1</td><td>2000 &times; 2<sup>0</sup></td><td>2 秒</td><td>2 秒</td></tr>
				<tr><td>2</td><td>2000 &times; 2<sup>1</sup></td><td>4 秒</td><td>6 秒</td></tr>
				<tr><td>3</td><td>2000 &times; 2<sup>2</sup></td><td>8 秒</td><td>14 秒</td></tr>
				<tr><td>n</td><td>2000 &times; 2<sup>n-1</sup></td><td>2<sup>n</sup> &times; 1000ms</td><td>-</td></tr>
			</table>
			<p>为什么用指数而不是线性？因为指数增长给服务端更多恢复时间——如果大量客户端同时重试（如 thundering herd 问题），指数退避将请求分散到不同的时间点。</p>

			<h3>9.11.2 完整重试实现</h3>
			<p>AgentSession 中的 <code>_prepareRetry()</code> 方法是重试机制的完整实现：</p>
			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/coding-agent/src/core/agent-session.ts — _prepareRetry()</span></div>
				<pre><code class="language-typescript">private async _prepareRetry(message: AssistantMessage): Promise&lt;boolean&gt; {
  const settings = this.settingsManager.getRetrySettings();
  if (!settings.enabled) {
    return false;  // ① 重试功能被禁用
  }

  this._retryAttempt++;  // ② 递增重试计数器

  if (this._retryAttempt > settings.maxRetries) {
    // ③ 超过最大重试次数——回退计数器，停止重试
    this._retryAttempt--;
    return false;
  }

  // ④ 计算指数退避延迟
  const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

  this._emit({
    type: "auto_retry_start",
    attempt: this._retryAttempt,
    maxAttempts: settings.maxRetries,
    delayMs,
    errorMessage: message.errorMessage || "Unknown error",
  });

  // ⑤ 从 Agent 状态中移除错误消息（保留在 session 文件中）
  const messages = this.agent.state.messages;
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    this.agent.state.messages = messages.slice(0, -1);
  }

  // ⑥ 等待指数退避时间（支持中止）
  this._retryAbortController = new AbortController();
  try {
    await sleep(delayMs, this._retryAbortController.signal);
  } catch {
    // ⑦ 等待期间被中止——重置计数器，通知 UI
    const attempt = this._retryAttempt;
    this._retryAttempt = 0;
    this._emit({
      type: "auto_retry_end",
      success: false,
      attempt,
      finalError: "Retry cancelled",
    });
    return false;
  } finally {
    this._retryAbortController = undefined;
  }

  return true;  // ⑧ 准备就绪，调用者执行 agent.continue()
}</code></pre>
			</div>

			<h3>9.11.3 可重试错误的判定正则</h3>
			<p>判断一个错误是否可重试不是简单的 HTTP 状态码检查——不同的 LLM Provider 用不同的错误消息格式。Pi Agent 使用一个精心设计的正则表达式：</p>
			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/coding-agent/src/core/agent-session.ts — _isRetryableError()</span></div>
				<pre><code class="language-typescript">private _isRetryableError(message: AssistantMessage): boolean {
  if (message.stopReason !== "error" || !message.errorMessage) return false;

  // 上下文溢出不走重试（走压缩路径）
  const contextWindow = this.model?.contextWindow ?? 0;
  if (isContextOverflow(message, contextWindow)) return false;

  const err = message.errorMessage;
  // 排除不可重试的 Provider 限制错误（如配额耗尽、认证失败）
  if (this._isNonRetryableProviderLimitError(err)) return false;

  // 匹配所有可重试的错误模式
  return /overloaded|rate.?limit|too many requests|429|500|502|503|504|
          service.?unavailable|server.?error|internal.?error|
          network.?error|connection.?refused|connection.?lost|
          websocket.?closed|fetch failed|socket hang up|
          timed? out|timeout/i.test(err);
}</code></pre>
			</div>
			<p>这个正则的设计思路是分层判定：<strong>第一层</strong>（stopReason !== "error"）快速排除正常消息；<strong>第二层</strong>（isContextOverflow）将溢出错误导向压缩路径；<strong>第三层</strong>（_isNonRetryableProviderLimitError）排除认证和配额问题；<strong>第四层</strong>（正则）匹配网络和服务器瞬时故障。</p>

			<h3>9.11.4 成功重置机制</h3>
			<p>重试计数器的重置时机非常关键——它在每次成功的 LLM 响应后立即重置为零：</p>
			<div class="code-block">
				<div class="code-label"><span class="file-path">packages/coding-agent/src/core/agent-session.ts — 成功重置</span></div>
				<pre><code class="language-typescript">// 在收到成功的 assistant 消息后立即重置重试计数器
if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
  this._emit({
    type: "auto_retry_end",
    success: true,
    attempt: this._retryAttempt,
  });
  this._retryAttempt = 0;
}</code></pre>
			</div>
			<p>这意味着什么？假设用户发了一条 prompt，Agent 调用工具 3 次——如果在第 2 次工具调用后的 LLM 调用中遇到了可重试错误，重试计数器是 1（不是 3）。因为前两次 LLM 调用成功后计数器已被重置。这个设计避免了"一次 prompt 中的多次工具调用累积重试次数"的问题。</p>

			<h3>9.11.5 bash 工具安全防护的完整链路</h3>
			<p>在 9.9 节中我们列出了 bash 工具的 6 项安全措施。现在让我们看它们在代码中如何串联：</p>
			<div class="code-block">
				<div class="code-label"><span class="file-path">bash 工具安全防护的完整执行链路</span></div>
				<pre><code class="language-plaintext">executeBash(command, cwd, signal, timeout)
  │
  ├─ ① 工作目录检查
  │   if (!existsSync(cwd)) return "Error: working directory not found"
  │
  ├─ ② beforeToolCall 钩子检查（扩展系统）
  │   if (beforeResult?.block) return errorResult("blocked")
  │
  ├─ ③ 创建子进程（非 Windows 下 detached: true）
  │   child_process.spawn(shell, ["-c", command], {
  │     cwd, detached: true,  // 进程隔离
  │     stdio: ["ignore", "pipe", "pipe"],
  │   })
  │
  ├─ ④ 进程树追踪
  │   childPid = child.pid
  │   // treeKill 可清理整个进程树，防止孤儿进程
  │
  ├─ ⑤ 超时控制
  │   setTimeout(() => treeKill(childPid), timeout)
  │
  ├─ ⑥ AbortSignal 监听
  │   signal.addEventListener("abort", () => treeKill(childPid))
  │
  ├─ ⑦ OutputAccumulator 输出截断
  │   maxLines: 500, maxBytes: 100KB
  │   超过限制 → 截断 + 添加截断提示
  │
  └─ ⑧ 清理
      clearTimeout, signal.removeEventListener, 关闭 stdio</code></pre>
			</div>

			<div class="info-card">
				<h4>防护是分层且独立的</h4>
				<p>注意每个防护措施都是<strong>独立的一层</strong>——它们不互相依赖。工作目录检查失败不会阻止超时机制生效，超时触发不会影响 AbortSignal 的清理。这种分层防护的设计哲学和错误处理的三层架构一脉相承：每层专注自己的职责，层与层之间通过明确定义的接口交互。</p>
			</div>

			<h3>9.11.6 重试与防护的协同</h3>
			<p>重试机制和工具安全防护在实际运行中如何协同？考虑这个场景：</p>
			<div class="code-block">
				<div class="code-label">完整场景：指数退避 + bash 安全防护协同</div>
				<pre><code class="language-plaintext">1. LLM 决定调用 bash 执行 "npm install"
2. beforeToolCall → 扩展检查：命令不含危险模式 → 放行
3. bash 执行中... 网络超时（npm registry 无响应）
4. bash 超时控制触发 → treeKill → 工具返回 "Error: timeout"
5. 错误结果发回 LLM（isError: true）
6. LLM 分析：网络超时是临时问题 → 重新调用 bash "npm install"
7. 第二次执行成功 → llm.continue()
8. LLM 看到成功结果 → 继续后续任务</code></pre>
			</div>
			<p>这个场景展示了关键设计原则：<strong>工具层的错误（bash 超时）和 API 层的错误（LLM 调用失败）有不同的处理路径</strong>。工具错误交给 LLM 决策，API 错误走重试机制——两者互不干扰。</p>
		`;
					container.appendChild(s11);

			// === Section 12: 深入：Compaction恢复流程与扩展安全审计链 ===
			const s12 = document.createElement('div');
			s12.className = 'content-section';
			s12.innerHTML = `
				<h2>9.12 深入：Compaction 恢复流程与扩展安全审计链</h2>
				<p>在 9.6 节中我们看到了"溢出检测 → 压缩 → 重试"的概念流程。这一节深入 AgentSession 源码，看 <strong>_checkCompaction()</strong> 如何用双路径判定驱动压缩恢复，以及扩展系统如何审计每一次工具调用。</p>

				<h3>9.12.1 _checkCompaction() 的双路径判定</h3>
				<p><code>_checkCompaction()</code> 是每次 LLM 响应后自动调用的检查点。它包含<strong>六个防护性检查</strong>，分溢出（紧急，必须重试）和阈值（预防，不自动重试）两条路径：</p>

				<div class="code-block">
					<div class="code-label"><span class="file-path">agent-session.ts — _checkCompaction() 核心逻辑</span></div>
					<pre><code class="language-typescript">private async _checkCompaction(msg: AssistantMessage, skipAborted=true): Promise&lt;boolean&gt; {
  const settings = this.settingsManager.getCompactionSettings();
  if (!settings.enabled) return false;                  // ① 压缩被禁用
  if (skipAborted && msg.stopReason === "aborted")      // ② 用户取消跳过
    return false;

  // ③ 跳过不同模型的消息（切换到大上下文模型后不应压缩旧溢出错误）
  const sameModel = this.model &&
    msg.provider === this.model.provider && msg.model === this.model.id;
  if (!sameModel) return false;

  // ④ 跳过压缩边界之前的旧消息（防止刚压缩完又误判触发）
  const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
  if (compactionEntry && msg.timestamp <= new Date(compactionEntry.timestamp).getTime())
    return false;

  // === 路径A：溢出恢复（紧急） ===
  if (sameModel && isContextOverflow(msg, contextWindow)) {
    if (this._overflowRecoveryAttempted) {              // ⑤ 只尝试一次
      this._emit({ type: "compaction_end", reason: "overflow",
        willRetry: false, errorMessage: "恢复失败，建议切换大上下文模型" });
      return false;
    }
    this._overflowRecoveryAttempted = true;
    // ⑥ 从Agent状态移除错误消息（保留在session文件供用户查看）
    const msgs = this.agent.state.messages;
    if (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant")
      this.agent.state.messages = msgs.slice(0, -1);
    return await this._runAutoCompaction("overflow", true);
  }

  // === 路径B：阈值预防（非紧急） ===
  let contextTokens: number;
  if (msg.stopReason === "error") {
    const estimate = estimateContextTokens(this.agent.state.messages);
    if (estimate.lastUsageIndex === null) return false;
    contextTokens = estimate.tokens;
  } else {
    contextTokens = calculateContextTokens(msg.usage);
  }
  if (shouldCompact(contextTokens, contextWindow, settings))
    return await this._runAutoCompaction("threshold", false);
  return false;
}</code></pre>
				</div>

				<p>六个防护检查中，④ 是最容易被忽略但最关键的：如果没有它，刚压缩完的 session 中旧消息的 usage 数据会错误地再次触发压缩。</p>

				<h3>9.12.2 _runAutoCompaction() 的六步执行</h3>
				<div class="code-block">
					<div class="code-label"><span class="file-path">agent-session.ts — _runAutoCompaction() 核心流程</span></div>
					<pre><code class="language-typescript">private async _runAutoCompaction(
  reason: "overflow" | "threshold", willRetry: boolean
): Promise&lt;boolean&gt; {
  this._emit({ type: "compaction_start", reason });
  try {
    // Step 1: 提取session条目并准备compaction
    const pathEntries = this.sessionManager.getBranch();
    const preparation = prepareCompaction(pathEntries, settings);

    // Step 2: 扩展拦截（session_before_compact可取消或提供自定义摘要）
    if (this._extensionRunner.hasHandlers("session_before_compact")) {
      const result = await this._extensionRunner.emit({
        type: "session_before_compact", preparation, branchEntries: pathEntries,
      });
      if (result?.cancel) return false;
      if (result?.compaction) extensionCompaction = result.compaction;
    }

    // Step 3: 生成摘要（扩展提供 or LLM生成 via compact()）
    if (extensionCompaction) { summary = extensionCompaction.summary; }
    else { const r = await compact(preparation, this.model, ...); summary = r.summary; }

    // Step 4: 持久化 + 替换Agent状态（核心操作！）
    this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details);
    const ctx = this.sessionManager.buildSessionContext();
    this.agent.state.messages = ctx.messages;  // 替换整个消息数组

    // Step 5: 通知扩展（session_compact事件）
    await this._extensionRunner.emit({ type: "session_compact", compactionEntry, fromExtension });

    // Step 6: 决定是否retry
    this._emit({ type: "compaction_end", reason, result, willRetry });
    if (willRetry) return true;  // 溢出路径：外层调用agent.continue()
    return this.agent.hasQueuedMessages();
  } catch (error) {
    this._emit({ type: "compaction_end", reason, willRetry: false,
      errorMessage: reason === "overflow"
        ? \`Context overflow recovery failed: \${error.message}\`
        : \`Auto-compaction failed: \${error.message}\` });
    return false;
  }
}</code></pre>
				</div>
				<p>Step 4 中 <code>this.agent.state.messages = ctx.messages</code> 是核心操作——直接用压缩后的短消息列表替换内部状态。溢出路径下整个过程对用户<strong>完全透明</strong>。</p>

				<h3>9.12.3 扩展安全审计链</h3>
				<p>每次工具执行前后，扩展系统通过 beforeToolCall / afterToolCall 钩子进行审计。这些钩子在 AgentSession 初始化时注册到 Agent 实例：</p>
				<div class="code-block">
					<div class="code-label"><span class="file-path">agent-session.ts — _installAgentToolHooks()</span></div>
					<pre><code class="language-typescript">private _installAgentToolHooks(): void {
  this.agent.beforeToolCall = async ({ toolCall, args }) => {
    const runner = this._extensionRunner;
    if (!runner.hasHandlers("tool_call")) return undefined;
    try {
      return await runner.emitToolCall({
        type: "tool_call", toolName: toolCall.name,
        toolCallId: toolCall.id, input: args,
      });
      // 扩展返回 { block: true, reason } → 阻止执行
    } catch (err) {
      // fail-safe: 扩展异常也阻止执行（不确定时宁可阻止）
      throw new Error(\`Extension failed, blocking: \${String(err)}\`);
    }
  };

  this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
    const runner = this._extensionRunner;
    if (!runner.hasHandlers("tool_result")) return undefined;
    const hookResult = await runner.emitToolResult({
      type: "tool_result", toolName: toolCall.name,
      toolCallId: toolCall.id, input: args,
      content: result.content, details: result.details, isError,
    });
    if (!hookResult) return undefined;
    return { content: hookResult.content, details: hookResult.details,
             isError: hookResult.isError ?? isError };
  };
}</code></pre>
				</div>

				<div class="info-card">
					<h4>Fail-safe 安全哲学</h4>
					<p>beforeToolCall 中扩展<strong>抛出异常也会阻止工具执行</strong>——不确定时宁可阻止。afterToolCall 允许扩展<strong>修改返回给LLM的结果</strong>——审计扩展可以隐藏敏感内容或添加安全警告。</p>
				</div>

				<h3>9.12.4 三层防护协同全景</h3>
				<p>将错误处理（9.2-9.6）、指数退避重试（9.11）、compaction 恢复（9.12.1-2）、安全审计（9.12.3）串联起来，就是一次完整 Agent 运行中所有防护机制的协同全景：</p>

				<div class="code-block">
					<div class="code-label">一次 Agent 运行中的所有防护协同</div>
					<pre><code class="language-plaintext">用户输入 → AgentSession.prompt()
  │
  ├─ Provider: 错误编码为流事件（不抛异常）
  │
  └─ _handlePostAgentRun() — 每次LLM响应后触发
      │
      ├─ ① _isRetryableError? → _prepareRetry()
      │   ├─ 网络5xx/429等 → 指数退避等待（2/4/8秒）→ agent.continue()
      │   └─ 不可重试（认证失败/400）→ 向用户报告
      │
      ├─ ② _checkCompaction()
      │   ├─ 溢出 → _runAutoCompaction("overflow", retry=true)
      │   │   ├─ session_before_compact（扩展拦截/定制）
      │   │   ├─ compact() 调用LLM生成摘要
      │   │   ├─ appendCompaction + 替换Agent状态
      │   │   ├─ session_compact（通知扩展）
      │   │   └─ 返回true → agent.continue()（透明恢复）
      │   │
      │   └─ 阈值 → _runAutoCompaction("threshold", retry=false)
      │       └─ 同上流程，不自动重试
      │
      └─ ③ 每次工具执行
          ├─ beforeToolCall → 扩展tool_call事件（fail-safe阻止）
          └─ afterToolCall  → 扩展tool_result事件（可修改结果）</code></pre>
				</div>

				<div class="info-card">
					<h4>总结：为什么这套体系可靠</h4>
					<p>三件事让Agent极其健壮：<strong>1)</strong> Provider不抛异常，所有错误走统一事件流；<strong>2)</strong> 指数退避+压缩恢复覆盖绝大多数瞬时故障和溢出场景；<strong>3)</strong> 扩展安全审计链让第三方可以在不修改核心代码的情况下检查每一次工具调用。三者互补：错误处理保证不崩溃、重试和压缩保证能恢复、审计保证恢复后的行为仍然安全。</p>
				</div>
			`;
			container.appendChild(s12);
		},

		quiz: [
		{
			question: '在 Pi Agent 的三层错误处理架构中，"Provider 永抛异常"这一契约属于哪一层？',
			options: [
				'第1层：AgentSession',
				'第2层：Agent Loop',
				'第3层：Provider',
				'这不属于任何一层',
			],
			answer: 2,
			explanation: 'Provider（第3层）负责将错误编码为流事件，核心契约是"永远不抛异常"，保证流消费者总能安全消费。',
		},
		{
			question: '当 LLM 返回 stopReason: "aborted" 时，表示什么？',
			options: [
				'模型正常完成了回复',
				'用户或系统取消了操作（如按 Escape）',
				'API 返回了 500 错误',
				'上下文超出了模型窗口限制',
			],
			answer: 1,
			explanation: '"aborted" 表示用户或系统通过 AbortSignal 取消了操作。此时不触发重试，不触发压缩——因为这是用户的主动选择。',
		},
		{
			question: '为什么上下文溢出错误不直接重试，而是走"压缩后再重试"的路径？',
			options: [
				'因为重试太慢了',
				'因为重试同样的上下文会再次溢出，必须先压缩对话历史释放空间',
				'因为溢出错误不重要',
				'因为压缩比重试更省 API 费用',
			],
			answer: 1,
			explanation: '溢出错误的根本原因是上下文太长。重试同样的上下文没有任何改变，只会再次溢出。必须先用 LLM 总结压缩对话历史，再重试。',
		},
		{
			question: 'bash 工具在非 Windows 环境下使用 detached: true 模式创建子进程，这个设计的主要目的是什么？',
			options: [
				'让命令运行得更快',
				'进程隔离，防止子进程影响主进程的环境',
				'节省内存',
				'让命令在后台运行',
			],
			answer: 1,
			explanation: 'detached: true 创建独立的进程组，实现进程隔离。配合进程树追踪，可以在需要时清理整个子进程树，防止孤儿进程。',
		},
	],

	coding: [
		{
			title: '实现一个简单的指数退避函数',
			prompt: '编写一个通用的 retryWithBackoff 函数，接受一个异步操作和配置参数，在操作失败时自动进行指数退避重试。配置参数包括：maxRetries（最大重试次数，默认 3）、baseDelayMs（基础延迟，默认 2000ms）、retryableCheck（判断错误是否可重试的回调）。',
			hint: '使用 async/await + try-catch，延迟计算使用 baseDelayMs * 2 ** (attempt - 1)，用 setTimeout + Promise 实现等待。注意区分可重试和不可重试的错误。',
			answer: `async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    retryableCheck = () => true,
  } = options;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt > maxRetries;
      const isRetryable = retryableCheck(err);

      if (isLastAttempt || !isRetryable) {
        throw err;  // 不可重试或已达上限，向上抛出
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      console.log(\`Retry \${attempt}/\${maxRetries} in \${delayMs}ms: \${err.message}\`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// 使用示例
const result = await retryWithBackoff(
  () => fetch("https://api.example.com/data"),
  {
    maxRetries: 3,
    baseDelayMs: 1000,
    retryableCheck: (err) => {
      // 只重试网络错误和 5xx
      return err.message.includes("fetch failed") ||
             err.message.includes("500") ||
             err.message.includes("502") ||
             err.message.includes("503");
    },
  }
);`,
			explanation: '这个实现精确复现了 Pi Agent 的指数退避逻辑：attempt 从 1 开始，延迟 = baseDelayMs * 2^(attempt-1)。retryableCheck 回调允许调用者自定义哪些错误可重试——这是 Pi Agent 中 _isRetryableError() 的泛化版本。注意最后一次尝试失败后直接抛出，不再等待。',
		},
		{
			title: '实现一个带安全钩子的 bash 执行器',
			prompt: '实现一个 safeExec 函数，在执行 shell 命令前进行安全检查。需要：1) 检查命令是否包含黑名单模式（如 rm -rf、sudo rm、mkfs）；2) 如果匹配黑名单，抛出错误阻止执行；3) 执行前打印安全日志（命令内容、时间戳）；4) 命令执行后返回 stdout。使用 Node.js 的 child_process.execSync。',
			hint: '定义 DANGEROUS_PATTERNS 数组，用正则逐一检查。execSync 需要设置 timeout 和 maxBuffer。',
			answer: `import { execSync } from "node:child_process";

const DANGEROUS_PATTERNS = [
  /rm\\s+-rf\\s+\\//,       // rm -rf / (绝对路径)
  /rm\\s+-rf\\s+~/,         // rm -rf ~ (家目录)
  /sudo\\s+rm\\s+-rf/,      // sudo rm -rf
  /mkfs\\./,                 // 格式化文件系统
  /dd\\s+if=/,              // 磁盘写入
  />\\s*\\/dev\\/sd/,        // 重定向到磁盘设备
  /chmod\\s+777\\s+\\//,     // 危险的权限修改
  /:(){ :|:& };:/,          // fork bomb
];

function safeExec(command, options = {}) {
  const { cwd = process.cwd(), timeout = 30000 } = options;

  // ① 安全审计：检查黑名单
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      const msg = \`BLOCKED: dangerous command pattern matched: \${pattern}\`;
      console.log(\`[SECURITY] \${new Date().toISOString()} \${msg}\`);
      console.log(\`[SECURITY] Command: \${command}\`);
      throw new Error(msg);
    }
  }

  // ② 安全日志：记录允许执行的命令
  console.log(\`[SECURITY] \${new Date().toISOString()} EXEC: \${command}\`);
  console.log(\`[SECURITY] CWD: \${cwd}\`);

  // ③ 执行命令
  try {
    const stdout = execSync(command, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,   // 1MB
      encoding: "utf-8",
    });
    console.log(\`[SECURITY] \${new Date().toISOString()} SUCCESS (\${stdout.length} bytes)\`);
    return stdout;
  } catch (err) {
    console.log(\`[SECURITY] \${new Date().toISOString()} FAILED: \${err.message}\`);
    throw err;
  }
}

// 使用示例
try {
  const result = safeExec("ls -la", { cwd: "/tmp" });
  console.log(result);
} catch (err) {
  console.error("Command failed:", err.message);
}

// 这会被阻止
try {
  safeExec("rm -rf / --no-preserve-root");
} catch (err) {
  console.error("Blocked:", err.message);
  // BLOCKED: dangerous command pattern matched: /rm\\s+-rf\\s+\\//
}`,
			explanation: '这个实现复现了 Pi Agent bash 工具安全防护链的核心思想：执行前检查（对应 beforeToolCall 钩子）、安全日志（对应扩展的审计能力）、超时和输出限制（对应 bash 工具的超时和 OutputAccumulator）。注意黑名单是通过正则匹配实现的——这和 Pi Agent 的 _isRetryableError 使用正则匹配的模式一致。实际 Pi Agent 的安全机制更完善（进程树追踪、进程隔离等），但核心思想相同。',
		},
		{
			title: '实现一个 AbortSignal 合并函数（进阶）',
			prompt: '编写一个 combineAbortSignals 函数，接受多个 AbortSignal，返回一个新的 AbortSignal——当任意一个输入 signal 被 abort 时，输出的 signal 也会被 abort。这是 Pi Agent 中 combineAbortSignals 的精简版本。',
			hint: '使用 new AbortController() 创建输出 signal。对每个输入 signal 调用 addEventListener("abort", ...), 在回调中调用 outputController.abort()。返回 outputController.signal。',
			answer: `function combineAbortSignals(...signals) {
  // 过滤掉 undefined 的 signal
  const activeSignals = signals.filter(s => s != null);
  const controller = new AbortController();

  // 如果已有 signal 被 abort，立即 abort 输出
  if (activeSignals.some(s => s.aborted)) {
    controller.abort();
    return controller.signal;
  }

  // 监听每个 signal 的 abort 事件
  const onAbort = () => {
    controller.abort();
    // 清理：移除所有监听器，避免内存泄漏
    for (const s of activeSignals) {
      s.removeEventListener("abort", onAbort);
    }
  };

  for (const s of activeSignals) {
    s.addEventListener("abort", onAbort, { once: true });
  }

  return controller.signal;
}

// 使用示例
const userAbort = new AbortController();
const timeoutAbort = new AbortController();

// 2 秒后超时
setTimeout(() => timeoutAbort.abort(), 2000);

const combined = combineAbortSignals(userAbort.signal, timeoutAbort.signal);

// fetch 会在用户按 Escape 或 2 秒超时时被中止
try {
  const response = await fetch(url, { signal: combined });
} catch (err) {
  if (err.name === "AbortError") {
    console.log("Request was aborted (by user or timeout)");
  }
}`,
			explanation: 'AbortSignal 合并是 Pi Agent 中处理多个中止来源的关键技术。例如 OpenAI Codex Responses provider 需要同时响应"用户中止"和"内部超时"两个信号。这个实现的关键是：① 检查预 aborted 状态（如果有 signal 已经 abort，立即响应）；② 使用 { once: true } 避免重复触发；③ 在 abort 后清理监听器防止内存泄漏。',
		},
	],

	summary: [
		'Pi Agent 有三层错误处理架构：Provider（不抛异常，错误编码为流事件） → Agent Loop（意外异常兜底，合成错误消息） → AgentSession（指数退避重试 + 压缩恢复）',
		'StopReason 有五种值：stop（正常）、toolUse（请求工具）、length（截断）、error（出错）、aborted（取消），理解它们是理解错误处理流程的关键',
		'可恢复错误（网络问题、服务端错误、速率限制）自动使用指数退避重试，默认最多 3 次，baseDelay 2 秒',
		'上下文溢出不走重试，而是压缩对话历史后再重试，且只尝试一次防止无限循环',
		'工具安全通过白名单（allowedToolNames）和 beforeToolCall/afterToolCall 钩子实现，扩展可在此拦截危险操作',
		'bash 工具有多层安全防护：工作目录检查、进程隔离、进程树追踪、超时控制、AbortSignal、输出截断',
	],
});
