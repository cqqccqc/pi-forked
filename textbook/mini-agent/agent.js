#!/usr/bin/env node
/**
 * mini-coding-agent — 深入 Pi Agent 课件的配套实战项目
 *
 * 通过亲手构建一个真实可用的 TUI Coding Agent，理解 Pi Agent 的核心原理。
 *
 * 用法:
 *   node agent.js                          # 交互模式
 *   node agent.js "帮我修复 utils.ts 的 bug" # 单次任务模式
 *
 * 前置条件: Node.js >= 18 (原生 fetch), 设置环境变量:
 *   export OPENAI_API_KEY=sk-...
 *   export OPENAI_BASE_URL=https://api.openai.com/v1  # 可选
 *   export OPENAI_MODEL=gpt-4o                          # 可选
 *
 * 特性:
 *   - 终端流式输出（逐 token 实时显示）
 *   - 5 个真实工具: read, write, bash, grep, ls
 *   - Agent Loop (while 循环 + 工具调用)
 *   - 交互式 TUI (readline)
 *   - 零外部依赖，纯 Node.js 标准库
 *
 * 对应课件章节:
 *   第3章 LLM 抽象层 → callLLM()
 *   第4章 Agent Loop   → main() 中的 while 循环
 *   第5章 工具系统      → tools 对象
 *   第9章 安全与可靠性  → 路径检查、超时、截断
 */

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";

// ============================================================
// 配置
// ============================================================
const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const CWD = process.cwd();
const MAX_TURNS = 25;

// ============================================================
// 工具系统
// ============================================================
const tools = {
  read_file: {
    name: "read_file",
    description: "读取文件内容。支持指定行范围（offset 起始行, limit 行数）",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要读取的文件路径，相对或绝对路径" },
        offset: { type: "number", description: "起始行号（1-based），可选" },
        limit: { type: "number", description: "最多读取行数，默认2000，可选" },
      },
      required: ["file_path"],
    },
    async execute(args) {
      const fp = path.resolve(CWD, args.file_path);
      if (!fp.startsWith(CWD)) return "Error: 不允许访问项目目录之外的文件";
      try {
        let content = fs.readFileSync(fp, "utf-8");
        let lines = content.split("\n");
        const total = lines.length;
        if (args.offset) lines = lines.slice(args.offset - 1);
        if (args.limit) lines = lines.slice(0, args.limit);
        else lines = lines.slice(0, 2000);
        const result = lines.join("\n");
        if (result.length > 50000) return result.slice(0, 50000) + `\n... (截断，共 ${total} 行)`;
        return result || "(空文件)";
      } catch (e) { return `Error: ${e.message}`; }
    },
  },

  write_file: {
    name: "write_file",
    description: "创建新文件或完全覆盖已有文件。需要提供完整文件内容",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "要写入的文件路径" },
        content: { type: "string", description: "文件的完整内容" },
      },
      required: ["file_path", "content"],
    },
    async execute(args) {
      const fp = path.resolve(CWD, args.file_path);
      if (!fp.startsWith(CWD)) return "Error: 不允许写入项目目录之外的文件";
      try {
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, args.content, "utf-8");
        return `✅ 已写入 ${args.file_path} (${args.content.length} 字符)`;
      } catch (e) { return `Error: ${e.message}`; }
    },
  },

  bash: {
    name: "bash",
    description: "在项目目录中执行 shell 命令。30秒超时，1MB 输出限制",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 shell 命令" },
      },
      required: ["command"],
    },
    async execute(args) {
      try {
        const out = execSync(args.command, {
          cwd: CWD, timeout: 30000, maxBuffer: 1024 * 1024,
          encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
        });
        return out || "(命令执行成功，无输出)";
      } catch (e) {
        return `Error (exit ${e.status}): ${e.stderr?.toString() || e.message}`;
      }
    },
  },

  grep: {
    name: "grep",
    description: "在项目文件中搜索匹配正则表达式的内容",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "正则表达式模式" },
        glob: { type: "string", description: "文件过滤 glob，如 *.ts，可选" },
      },
      required: ["pattern"],
    },
    async execute(args) {
      try {
        const regex = new RegExp(args.pattern, "g");
        const results = [];
        const files = walkDir(CWD, args.glob || "**/*");
        for (const f of files.slice(0, 500)) {
          try {
            const content = fs.readFileSync(f, "utf-8");
            const lines = content.split("\n");
            lines.forEach((line, i) => {
              if (regex.test(line)) results.push(`${f}:${i + 1}: ${line.trim().slice(0, 200)}`);
              regex.lastIndex = 0;
            });
          } catch { /* skip unreadable */ }
        }
        if (results.length > 100) {
          return results.slice(0, 100).join("\n") + `\n... (共 ${results.length} 条匹配，仅显示前100条)`;
        }
        return results.join("\n") || "未找到匹配";
      } catch (e) { return `Error: ${e.message}`; }
    },
  },

  ls: {
    name: "ls",
    description: "列出目录内容",
    parameters: {
      type: "object",
      properties: {
        dir_path: { type: "string", description: "目录路径，默认为当前目录" },
      },
    },
    async execute(args) {
      const dir = args.dir_path ? path.resolve(CWD, args.dir_path) : CWD;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}${e.isDirectory() ? "/" : ""}`).join("\n");
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
};

function walkDir(dir, glob) {
  const results = [];
  const ext = glob.replace("**/*", "");
  function walk(d) {
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith(".") && e.name !== "node_modules") walk(fp); }
        else if (!ext || e.name.endsWith(ext)) results.push(fp);
      }
    } catch { /* skip */ }
  }
  walk(dir);
  return results;
}

// ============================================================
// LLM 调用（流式）
// ============================================================
async function callLLM(messages, toolDefs) {
  if (!API_KEY) {
    console.error("\x1b[31m❌ 请设置 OPENAI_API_KEY 环境变量\x1b[0m");
    console.error("   export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  const body = { model: MODEL, messages, stream: true };
  if (toolDefs.length > 0) {
    body.tools = toolDefs.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

  // 流式消费 SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolCallAcc = {}; // index -> { name, arguments }
  let textContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        // 文本
        if (delta.content) {
          textContent += delta.content;
          process.stdout.write("\x1b[36m" + delta.content + "\x1b[0m"); // 青色输出
        }

        // 工具调用
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAcc[idx]) toolCallAcc[idx] = { id: tc.id || "", name: "", arguments: "" };
            if (tc.function?.name) toolCallAcc[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallAcc[idx].arguments += tc.function.arguments;
            if (tc.id) toolCallAcc[idx].id = tc.id;
          }
        }
      } catch { /* skip malformed */ }
    }
  }

  // 构建返回值
  const toolCalls = Object.values(toolCallAcc).filter(tc => tc.name);
  if (toolCalls.length > 0) {
    process.stdout.write("\n");
  }
  return { content: textContent, toolCalls, finishReason: toolCalls.length > 0 ? "tool_calls" : "stop" };
}

// ============================================================
// System Prompt
// ============================================================
const SYSTEM_PROMPT = `你是一个 Coding Agent，运行在用户的终端中，帮助完成编程任务。

## 核心能力
你可以使用工具来读取文件、写入文件、搜索代码、列出目录、执行命令。

## 工作方式
1. 先理解任务 → 用工具收集信息（读文件、搜代码、列目录）
2. 分析后做出修改 → 用 write_file 写入或创建文件
3. 验证 → 用 bash 运行测试或检查
4. 总结 → 告诉用户你做了什么

## 规则
- 使用中文回复
- 每次只做一个逻辑步骤，不要一次做太多
- 修改文件前先读取它
- 写文件前确保目录存在
- 完成后清晰总结你做了什么`;

// ============================================================
// Agent Loop
// ============================================================
async function run(prompt) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  const toolDefs = Object.values(tools).map(t => ({
    name: t.name, description: t.description, parameters: t.parameters,
  }));

  console.log("\x1b[1;35m🤖 mini-coding-agent 启动\x1b[0m");
  console.log("\x1b[90m   模型: %s | 最大轮次: %d\x1b[0m\n", MODEL, MAX_TURNS);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (turn > 0) console.log("\n\x1b[90m--- Turn %d ---\x1b[0m\n", turn + 1);

    // 调用 LLM
    const response = await callLLM(messages, toolDefs);

    if (response.finishReason === "stop") {
      // LLM 直接回复，任务完成
      console.log("\n\x1b[1;32m✅ 任务完成\x1b[0m");
      return;
    }

    // 有工具调用
    messages.push({ role: "assistant", content: response.content || null, tool_calls: response.toolCalls.map(tc => ({
      id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments },
    })) });

    for (const tc of response.toolCalls) {
      let args;
      try { args = JSON.parse(tc.arguments); } catch { args = {}; }
      console.log("\x1b[1;33m🔧 %s\x1b[0m %s", tc.name, JSON.stringify(args).slice(0, 100));

      const tool = tools[tc.name];
      const result = tool ? await tool.execute(args) : `Error: 未知工具 "${tc.name}"`;
      const truncated = result.length > 8000 ? result.slice(0, 8000) + `\n... (截断，共 ${result.length} 字符)` : result;
      console.log("\x1b[90m%s\x1b[0m", truncated.slice(0, 400));

      messages.push({ role: "tool", tool_call_id: tc.id, content: truncated });
    }
  }
  console.log("\n\x1b[1;33m⚠️ 达到最大轮次限制\x1b[0m");
}

// ============================================================
// 交互式 TUI
// ============================================================
async function interactiveMode() {
  console.log("\x1b[1;35m╔══════════════════════════════════╗\x1b[0m");
  console.log("\x1b[1;35m║   🛠  mini-coding-agent         ║\x1b[0m");
  console.log("\x1b[1;35m║   精简版 TUI Coding Agent        ║\x1b[0m");
  console.log("\x1b[1;35m╚══════════════════════════════════╝\x1b[0m");
  console.log("\x1b[90m输入你的编程任务，或输入 /exit 退出\x1b[0m\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\x1b[1;36m> \x1b[0m" });

  const ask = () => {
    rl.prompt();
    rl.once("line", async (line) => {
      const input = line.trim();
      if (!input) { ask(); return; }
      if (input === "/exit" || input === "/quit") { console.log("\x1b[90m再见!\x1b[0m"); rl.close(); process.exit(0); }
      await run(input);
      console.log("");
      ask();
    });
  };
  ask();
}

// ============================================================
// 入口
// ============================================================
const cliPrompt = process.argv.slice(2).join(" ");
if (cliPrompt) {
  await run(cliPrompt);
} else {
  await interactiveMode();
}
