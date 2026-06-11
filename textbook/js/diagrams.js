/**
 * Diagrams Engine — 交互式图表渲染
 *
 * 每个 draw 函数接收 container DOM 元素，将完整的 SVG 字符串设置到 innerHTML。
 * 关键：SVG 内容通过 HTML div 的 innerHTML 设置（而非 SVG 元素的 innerHTML），
 * 确保浏览器能在正确的命名空间中解析 SVG 元素。
 */
const Diagrams = {
  /** 安全获取可用宽度 */
  _w(container, max) {
    const cw = container.clientWidth;
    return cw > 48 ? Math.min(cw - 48, max) : max;
  },

  /** 绘制四层架构图 */
  drawArchitecture(container) {
    const w = this._w(container, 700);
    let svg = S.open(w, 340);
    const layers = [
      { y: 30,  label: 'coding-agent',    sub: '应用层：CLI / TUI / RPC 三种模式',    color: '#6c5ce7' },
      { y: 105, label: 'agent (pi-agent-core)', sub: 'Agent 运行时：循环、工具执行、状态管理', color: '#00b894' },
      { y: 180, label: 'ai (pi-ai)',       sub: 'LLM 抽象层：统一多 Provider 流式 API',  color: '#0984e3' },
      { y: 255, label: 'tui (pi-tui)',     sub: '终端 UI：差分渲染、编辑器组件',          color: '#e17055' },
    ];
    layers.forEach((l, i) => {
      svg += R(20, l.y, w - 40, 55, l.color);
      svg += T(40, l.y + 22, l.label, 14, l.color, 'bold');
      svg += T(40, l.y + 42, l.sub, 11, '#888');
      if (i < layers.length - 1) {
        svg += A(w / 2, l.y + 57, w / 2, layers[i + 1].y - 2, l.color);
      }
    });
    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制 Agent Loop 流程图 */
  drawAgentLoop(container) {
    const w = this._w(container, 640);
    const cx = Math.floor(w / 2); // center x = 320
    let svg = S.open(w, 400);

    // ===== 主流程：居中从上到下 =====
    // 1. 用户输入
    svg += R(cx - 65, 20, 130, 34, '#6c5ce7');
    svg += T(cx, 41, '用户输入', 12, '#6c5ce7', 'bold', 'middle');
    svg += A(cx, 54, cx, 82, '#aaa');

    // 2. 调用 LLM
    svg += R(cx - 65, 84, 130, 34, '#0984e3');
    svg += T(cx, 105, '调用 LLM', 12, '#0984e3', 'bold', 'middle');
    svg += A(cx, 118, cx, 146, '#aaa');

    // 3. 解析响应
    svg += R(cx - 65, 148, 130, 34, '#0984e3', 0.12);
    svg += T(cx, 169, '解析响应', 12, '#0984e3', 'bold', 'middle');
    svg += A(cx, 182, cx, 208, '#aaa');

    // 4. 决策菱形
    svg += D(cx, 230, 140, 46, '#6c5ce7');
    svg += T(cx, 226, '有工具调用?', 10, '#6c5ce7', 'bold', 'middle');
    svg += T(cx, 242, '(stopReason?)', 8, '#888', 'normal', 'middle');

    // 5. 任务完成（决策下方，否分支直下）
    svg += R(cx - 65, 330, 130, 34, '#00b894');
    svg += T(cx, 351, '✅ 任务完成', 12, '#00b894', 'bold', 'middle');
    // 决策 → 否 → 任务完成
    svg += A(cx, 276, cx, 328, '#00b894');
    svg += T(cx + 18, 305, '否(stop)', 8, '#00b894', 'normal', 'start');

    // ===== 工具执行路径：右侧，然后从上方绕回 =====
    const rx = cx + 140; // right column x
    // 6. 执行工具
    svg += R(rx - 60, 146, 120, 34, '#e17055');
    svg += T(rx, 167, '执行工具', 12, '#e17055', 'bold', 'middle');
    // 决策 → 是 → 执行工具
    svg += A(cx + 70, 230, rx, 178, '#e17055');
    svg += T(cx + 90, 198, '是(toolUse)', 8, '#e17055', 'normal', 'start');

    // 7. 结果注入
    svg += R(rx - 60, 210, 120, 50, '#fdcb6e', 0.12);
    svg += T(rx, 230, '工具结果', 11, '#fdcb6e', 'bold', 'middle');
    svg += T(rx, 248, '注入上下文', 9, '#888', 'normal', 'middle');
    svg += A(rx, 180, rx, 208, '#aaa');

    // 8. 循环箭头：从结果注入右侧绕到调用LLM上方
    svg += A(rx, 235, rx, 300, '#aaa', true);
    svg += A(rx, 300, cx, 300, '#aaa', true);
    svg += A(cx, 300, cx, 82, '#aaa', true);
    svg += T(cx + 72, 292, '循环（结果送回 LLM）', 8, '#888', 'normal', 'start');

    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制工具执行流程 */
  drawToolFlow(container) {
    const w = this._w(container, 700);
    let svg = S.open(w, 260);
    svg += T(w / 2, 36, '工具执行流水线', 15, '#333', 'bold', 'middle');
    const steps = [
      'LLM 请求调用工具', '验证参数', 'beforeToolCall 钩子', '执行工具', 'afterToolCall 钩子', '返回结果给 LLM',
    ];
    const colors = ['#0984e3', '#fdcb6e', '#e17055', '#00b894', '#e17055', '#6c5ce7'];
    const stepW = Math.floor((w - 60) / steps.length);
    steps.forEach((label, i) => {
      const x = 20 + i * stepW;
      svg += R(x, 90, stepW - 10, 46, colors[i]);
      svg += T(x + (stepW - 10) / 2, 106, label, 9, colors[i], 'bold', 'middle');
      if (i < steps.length - 1) {
        svg += A(x + stepW - 4, 113, x + stepW + 6, 113, '#aaa');
      }
    });
    svg += T(w / 2, 170, '每个工具调用都经过：验证 → 前置钩子 → 执行 → 后置钩子 → 返回结果', 11, '#888', 'normal', 'middle');
    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制 Session 树结构 */
  drawSessionTree(container) {
    const w = this._w(container, 650);
    let svg = S.open(w, 250);
    svg += T(w / 2, 16, '会话 = 一棵多分支树', 13, '#333', 'bold', 'middle');
    // 节点
    const nodes = [
      { x: 300, y: 40,  label: 'null (root)',               color: '#aaa' },
      { x: 300, y: 85,  label: 'user: "Read main.ts"',      color: '#6c5ce7' },
      { x: 300, y: 130, label: 'assistant: tool_use',       color: '#0984e3' },
      { x: 300, y: 175, label: 'toolResult: read',           color: '#00b894' },
      { x: 180, y: 225, label: 'assistant: 回复A',           color: '#0984e3' },
      { x: 420, y: 225, label: 'assistant: 回复B (分支)',    color: '#e17055' },
    ];
    // 连线
    const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5]];
    edges.forEach(([a, b]) => {
      svg += L(nodes[a].x, nodes[a].y + 8, nodes[b].x, nodes[b].y - 8, '#aaa');
    });
    nodes.forEach((n, i) => {
      const r = i === 0 ? 5 : 7;
      svg += C(n.x, n.y, r, n.color);
      svg += T(n.x + 12, n.y + 4, n.label, 10, n.color, i === 0 ? 'normal' : 'bold');
    });
    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制 System Prompt 构建流程 */
  drawSystemPromptFlow(container) {
    const w = this._w(container, 700);
    let svg = S.open(w, 270);
    const cx = w / 2;
    // Builder box
    svg += R(cx - 110, 60, 220, 40, '#6c5ce7', 0.18);
    svg += T(cx, 84, 'buildSystemPrompt()', 14, '#6c5ce7', 'bold', 'middle');
    // Sources
    const sources = [
      { x: 20,  label: 'CLAUDE.md\nAGENTS.md',      color: '#6c5ce7' },
      { x: 150, label: 'Skills\n(.pi/skills)',       color: '#00b894' },
      { x: 280, label: 'Extensions\n(工具定义)',      color: '#0984e3' },
      { x: 420, label: '动态信息\n(日期/CWD)',        color: '#e17055' },
      { x: 560, label: '自定义\nSYSTEM.md',          color: '#fdcb6e' },
    ];
    sources.forEach(s => {
      svg += R(s.x, 150, 110, 44, s.color, 0.1);
      svg += T(s.x + 55, 172, s.label, 10, s.color, 'bold', 'middle');
      svg += A(s.x + 55, 148, cx, 100, '#aaa');
    });
    // Output
    svg += R(cx - 140, 215, 280, 36, '#333', 0.07);
    svg += T(cx, 237, '→ 最终的 System Prompt 文本', 12, '#333', 'bold', 'middle');
    svg += A(cx, 100, cx, 213, '#aaa');
    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制工具双层架构：ToolDefinition ↔ AgentTool */
  drawToolArchitecture(container) {
    const w = this._w(container, 680);
    const h = 240;
    let svg = S.open(w, h);
    svg += T(w / 2, 18, '工具双层架构', 14, '#333', 'bold', 'middle');

    // 左侧：LLM 视角标注箭头
    svg += T(34, 68, '给 LLM 看', 9, '#6c5ce7', 'bold', 'start');
    svg += L(85, 62, 105, 62, '#6c5ce7');
    svg += A(105, 62, 125, 62, '#6c5ce7');

    // 上层：ToolDefinition
    const tdW = w - 180;
    const tdX = 130;
    svg += R(tdX, 42, tdW, 52, '#6c5ce7', 0.12);
    svg += T(w / 2, 64, 'ToolDefinition', 13, '#6c5ce7', 'bold', 'middle');
    svg += T(w / 2, 84, '定义工具的 "元信息"：name · label · description · parameters(TypeBox)', 9, '#888', 'normal', 'middle');

    // 中间转换区
    svg += R(tdX + 40, 110, tdW - 80, 26, '#f0f0f0', 0.5);
    svg += T(w / 2, 127, 'wrapToolDefinition()  —  转换成运行时接口', 10, '#666', 'bold', 'middle');
    // 箭头：ToolDefinition ↓
    svg += A(w / 2, 96, w / 2, 108, '#aaa');
    // 箭头：↓ AgentTool
    svg += A(w / 2, 138, w / 2, 150, '#aaa');

    // 底侧标注
    svg += T(34, 182, '给 Agent\n运行时调用', 9, '#00b894', 'bold', 'start');
    svg += L(85, 177, 105, 177, '#00b894');
    svg += A(105, 177, 125, 177, '#00b894');

    // 下层：AgentTool
    svg += R(tdX, 154, tdW, 52, '#00b894', 0.12);
    svg += T(w / 2, 176, 'AgentTool', 13, '#00b894', 'bold', 'middle');
    svg += T(w / 2, 196, '运行时接口：executionMode · prepareArguments() · execute()', 9, '#888', 'normal', 'middle');

    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制扩展系统架构 */
  drawExtensionArch(container) {
    const w = this._w(container, 680);
    let svg = S.open(w, 220);
    svg += T(w / 2, 24, '事件驱动的扩展架构', 14, '#333', 'bold', 'middle');
    // Core box
    svg += R(50, 50, w - 100, 52, '#6c5ce7', 0.1);
    svg += T(w / 2, 78, 'Agent Core (核心系统)', 13, '#6c5ce7', 'bold', 'middle');
    // Events
    const events = [
      { x: 90,  label: 'before_tool_call',  color: '#e17055' },
      { x: 210, label: 'after_tool_call',   color: '#00b894' },
      { x: 340, label: 'session_start',     color: '#0984e3' },
      { x: 470, label: 'before_compaction', color: '#fdcb6e' },
    ];
    events.forEach(e => {
      svg += R(e.x, 114, 100, 26, e.color, 0.18);
      svg += T(e.x + 50, 131, e.label, 8, e.color, 'bold', 'middle');
    });
    // Extensions box
    svg += R(60, 155, w - 120, 34, '#333', 0.06);
    svg += T(w / 2, 176, 'Extensions (插件) — 订阅事件、注册工具、修改行为', 11, '#666', 'normal', 'middle');
    svg += A(w / 2, 140, w / 2, 153, '#aaa');
    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制第10章精简版 Agent 的模块数据流 */
  drawMiniAgentArchitecture(container) {
    const w = this._w(container, 600);
    let svg = S.open(w, 260);

    // 左侧：用户输入
    svg += R(20, 100, 100, 36, '#aaa', 0.1);
    svg += T(70, 122, '用户输入任务', 11, '#666', 'bold', 'middle');
    svg += A(122, 118, 170, 118, '#aaa');

    // 中间：agent.js（调度中心）
    svg += R(170, 50, 200, 140, '#6c5ce7', 0.15);
    svg += T(270, 76, 'agent.js', 15, '#6c5ce7', 'bold', 'middle');
    svg += T(270, 96, 'Agent Loop', 12, '#6c5ce7', 'bold', 'middle');
    svg += T(270, 116, 'while 循环调度', 10, '#888', 'normal', 'middle');
    svg += T(270, 136, '• 发消息给 LLM', 9, '#888', 'normal', 'middle');
    svg += T(270, 154, '• 解析 tool_calls', 9, '#888', 'normal', 'middle');
    svg += T(270, 172, '• 执行工具 → 循环', 9, '#888', 'normal', 'middle');

    // 右侧上：llm.js
    svg += R(430, 20, 120, 44, '#0984e3', 0.12);
    svg += T(490, 36, 'llm.js', 13, '#0984e3', 'bold', 'middle');
    svg += T(490, 54, 'chat() 调用 LLM', 9, '#888', 'normal', 'middle');
    svg += A(370, 42, 428, 42, '#0984e3');

    // 右侧下：tools.js
    svg += R(430, 130, 120, 44, '#00b894', 0.12);
    svg += T(490, 146, 'tools.js', 13, '#00b894', 'bold', 'middle');
    svg += T(490, 164, 'read · bash', 9, '#888', 'normal', 'middle');
    svg += A(370, 152, 428, 152, '#00b894');

    // 标注箭头
    svg += T(395, 36, '请求', 9, '#0984e3', 'normal', 'middle');
    svg += T(395, 146, '执行', 9, '#00b894', 'normal', 'middle');

    // 底部：最终回复
    svg += R(170, 210, 200, 36, '#333', 0.06);
    svg += T(270, 232, '→ 最终回复给用户', 12, '#333', 'bold', 'middle');
    svg += A(270, 190, 270, 208, '#aaa');

    svg += S.close;
    container.innerHTML = svg;
  },

  /** 绘制包的依赖关系图 */
  drawDependencyGraph(container) {
    const w = this._w(container, 620);
    let svg = S.open(w, 160);

    // Bottom layer: tui and ai (side by side, independent)
    svg += R(40, 100, 120, 34, '#e17055');
    svg += T(100, 121, 'tui', 13, '#e17055', 'bold', 'middle');

    svg += R(220, 100, 120, 34, '#0984e3');
    svg += T(280, 121, 'ai', 13, '#0984e3', 'bold', 'middle');

    // Middle layer: agent
    svg += R(130, 40, 140, 34, '#00b894');
    svg += T(200, 61, 'agent', 13, '#00b894', 'bold', 'middle');

    // Top layer: coding-agent
    svg += R(w / 2 - 100, -10, 200, 34, '#6c5ce7');
    svg += T(w / 2, 11, 'coding-agent', 13, '#6c5ce7', 'bold', 'middle');

    // Arrows: agent → ai
    svg += A(190, 74, 260, 98, '#00b894');
    // Arrows: coding-agent → agent, ai, tui
    svg += A(w / 2 - 30, 24, 170, 38, '#6c5ce7');
    svg += A(w / 2, 24, 270, 38, '#6c5ce7');
    svg += A(w / 2 + 30, 24, 130, 38, '#6c5ce7');

    // Labels
    svg += T(310, 95, '依赖', 8, '#00b894', 'normal', 'start');
    svg += T(w / 2 + 50, 50, '依赖全部', 8, '#6c5ce7', 'normal', 'start');
    svg += T(50, 50, '零依赖\n(独立包)', 8, '#888', 'normal', 'middle');
    svg += T(310, 50, '零依赖\n(独立包)', 8, '#888', 'normal', 'middle');

    svg += S.close;
    container.innerHTML += svg;
  },

  /** 绘制消息完整处理流程 */
  drawMessageFlow(container) {
    const w = this._w(container, 660);
    let svg = S.open(w, 540);

    const cx = Math.floor(w / 2);
    const rx = cx + 160;

    // 1. 用户输入
    svg += R(cx - 65, 10, 130, 30, '#6c5ce7');
    svg += T(cx, 29, '用户按键 Enter', 11, '#6c5ce7', 'bold', 'middle');
    svg += A(cx, 40, cx, 56, '#aaa');

    // 2. onSubmit 回调
    svg += R(cx - 75, 58, 150, 30, '#e17055', 0.12);
    svg += T(cx, 77, 'Editor.onSubmit', 10, '#e17055', 'bold', 'middle');
    svg += A(cx, 88, cx, 104, '#aaa');

    // 3. 斜杠命令检查
    svg += D(cx, 124, 140, 40, '#f59e0b');
    svg += T(cx, 120, '/ 开头?', 9, '#f59e0b', 'bold', 'middle');
    svg += T(cx, 136, '(斜杠命令?)', 8, '#888', 'normal', 'middle');

    // Yes branch right → 内置命令
    svg += A(cx + 70, 124, rx - 65, 124, '#f59e0b');
    svg += R(rx - 130, 108, 130, 30, '#f59e0b', 0.1);
    svg += T(rx - 65, 127, '内置命令执行', 9, '#f59e0b', 'bold', 'middle');
    svg += T(rx - 65, 148, '(不进入Agent Loop)', 8, '#888', 'normal', 'middle');

    // No branch down → AgentSession.prompt
    svg += A(cx, 144, cx, 170, '#aaa');
    svg += T(cx + 50, 160, '否', 8, '#aaa', 'normal', 'start');

    // 4. AgentSession.prompt
    svg += R(cx - 85, 172, 170, 56, '#0984e3', 0.12);
    svg += T(cx, 192, 'AgentSession.prompt()', 11, '#0984e3', 'bold', 'middle');
    svg += T(cx, 210, 'Skill展开 · Input事件 · 上下文构建', 8, '#888', 'normal', 'middle');
    svg += A(cx, 228, cx, 244, '#aaa');

    // 5. System Prompt + Context
    svg += R(cx - 85, 246, 170, 30, '#00b894', 0.1);
    svg += T(cx, 265, 'buildSystemPrompt() + buildContext()', 9, '#00b894', 'bold', 'middle');
    svg += A(cx, 276, cx, 292, '#aaa');

    // 6. Agent Loop
    svg += R(cx - 65, 294, 130, 48, '#6c5ce7', 0.15);
    svg += T(cx, 312, 'Agent Loop', 12, '#6c5ce7', 'bold', 'middle');
    svg += T(cx, 330, 'runLoop() while循环', 9, '#888', 'normal', 'middle');
    svg += A(cx, 342, cx, 358, '#aaa');

    // 7. LLM调用
    svg += R(cx - 75, 360, 150, 30, '#0984e3', 0.12);
    svg += T(cx, 379, 'streamSimple() → HTTP SSE', 9, '#0984e3', 'bold', 'middle');
    svg += A(cx, 390, cx, 406, '#aaa');

    // 8. 决策：有工具调用?
    svg += D(cx, 424, 140, 40, '#6c5ce7');
    svg += T(cx, 420, '有工具调用?', 9, '#6c5ce7', 'bold', 'middle');
    svg += T(cx, 436, '(toolUse?)', 8, '#888', 'normal', 'middle');

    // Yes → 工具执行
    svg += A(cx + 70, 424, rx - 65, 424, '#e17055');
    svg += R(rx - 130, 408, 130, 30, '#e17055', 0.1);
    svg += T(rx - 65, 427, 'executeToolCalls()', 9, '#e17055', 'bold', 'middle');
    svg += T(rx - 65, 448, '验证·钩子·执行·结果', 8, '#888', 'normal', 'middle');

    // 循环回 LLM
    svg += A(rx - 65, 438, rx - 65, 460, '#aaa', true);
    svg += A(rx - 65, 462, cx, 462, '#aaa', true);
    svg += A(cx, 462, cx, 390, '#aaa', true);
    svg += T(cx + 10, 430, '循环', 7, '#888', 'normal', 'start');

    // No → 事件推送TUI
    svg += A(cx, 444, cx, 470, '#aaa');
    svg += T(cx + 15, 460, '否', 8, '#aaa', 'normal', 'start');

    // 9. TUI渲染
    svg += R(cx - 75, 472, 150, 42, '#00b894', 0.1);
    svg += T(cx, 488, '事件 → TUI.handleEvent()', 10, '#00b894', 'bold', 'middle');
    svg += T(cx, 504, 'message_update · 差分渲染', 8, '#888', 'normal', 'middle');

    svg += S.close;
    container.innerHTML += svg;
  },

  /** 绘制三断点 KV Cache 模型 */
  drawCacheModel(container) {
    const w = this._w(container, 660);
    let svg = S.open(w, 90);
    const cx = w * 0.65;

    // 绿色：Cache 命中区域
    svg += R(0, 10, cx, 32, '#16a34a', 0.2, '#16a34a');
    svg += T(cx / 2, 30, 'System Prompt + 工具定义（Cache 命中）', 11, '#16a34a', 'bold', 'middle');

    // 灰色：需重新计算
    svg += R(cx + 2, 10, w - cx - 2, 32, '#888', 0.12, '#888');
    svg += T(cx + (w - cx) / 2, 30, '对话消息（需要计算）', 11, '#888', 'bold', 'middle');

    // 断点标记线
    svg += L(cx, 2, cx, 58, '#16a34a');
    svg += T(cx, 74, '← 缓存断点 →', 9, '#16a34a', 'bold', 'middle');

    // 底部标注
    svg += T(40, 82, '断点1: system prompt', 8, '#16a34a', 'normal', 'start');
    svg += T(cx - 60, 82, '断点2: 工具定义', 8, '#16a34a', 'normal', 'start');
    svg += T(cx + 10, 82, '断点3: 最后对话消息', 8, '#888', 'normal', 'start');

    svg += S.close;
    container.innerHTML += svg;
  },
};

// ===================================================================
// 内部辅助常量与函数
// ===================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 起止模板 */
const S = {
  open(w, h) {
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;height:auto;display:block;">`;
  },
  get close() { return '</svg>'; },
};

/** 圆角矩形 */
function R(x, y, w, h, color, opacity) {
  const o = opacity == null ? 0.12 : opacity;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${color}" fill-opacity="${o}" stroke="${color}" stroke-opacity="0.4" stroke-width="1.5"/>`;
}

/** 菱形 */
function D(cx, cy, w, h, color) {
  const hw = w / 2, hh = h / 2;
  return `<polygon points="${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy} ${cx},${cy - hh}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.4" stroke-width="1.5"/>`;
}

/** 圆形 */
function C(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.85"/>`;
}

/** 文本 */
function T(x, y, text, size, color, weight, anchor) {
  const lines = text.split('\n');
  const a = anchor || 'start';
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * (size + 4)}" font-size="${size}" fill="${color}" font-weight="${weight || 'normal'}" text-anchor="${a}" font-family="system-ui, sans-serif">${l}</text>`
  ).join('');
}

/** 连线（无箭头） */
function L(x1, y1, x2, y2, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" opacity="0.5"/>`;
}

/** 箭头线 */
function A(x1, y1, x2, y2, color, dashed) {
  const id = 'ar' + Math.random().toString(36).slice(2, 8);
  const d = dashed ? ' stroke-dasharray="5,4"' : '';
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}" opacity="0.55"/></marker></defs><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" opacity="0.55" marker-end="url(#${id})"${d}/>`;
}
