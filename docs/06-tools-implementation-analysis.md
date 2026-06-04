# Pi Agent 核心工具实现分析

## 概述

Pi Agent 提供了七大核心工具，这些工具构成了 AI 编程助手的基础能力。本文档深入分析每个工具的实现细节、设计模式以及工具系统的整体架构。

## 工具架构设计

### ToolDefinition 与 AgentTool 的分离

工具系统采用了双层架构设计：

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolDefinition (UI 层)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ - name, label, description                             │ │
│  │ - parameters (TypeBox Schema)                          │ │
│  │ - renderCall(), renderResult()                         │ │
│  │ - execute() - 返回 content + details                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ wrapToolDefinition()
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AgentTool (运行时层)                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ - execute(toolCallId, params, signal, onUpdate)        │ │
│  │ - prepareArguments()                                   │ │
│  │ - executionMode ("sequential" | "parallel")            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**关键设计点：**
1. **ToolDefinition** 包含 UI 渲染逻辑（renderCall、renderResult）和 TypeBox JSON Schema
2. **AgentTool** 是运行时接口，专注于执行逻辑
3. `wrapToolDefinition()` 将 Definition 转换为 AgentTool，注入 ExtensionContext
4. 分离设计允许同一工具在不同模式下（interactive/rpc/CLI）有不同的渲染实现

### 工具工厂函数

每个工具提供两个工厂函数：
- `createXXXToolDefinition(cwd, options?)` → 返回 ToolDefinition（用于扩展系统）
- `createXXXTool(cwd, options?)` → 返回 AgentTool（用于核心运行时）

```typescript
// packages/coding-agent/src/core/tools/index.ts
export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
  switch (toolName) {
    case "read": return createReadToolDefinition(cwd, options?.read);
    case "bash": return createBashToolDefinition(cwd, options?.bash);
    // ...
  }
}
```

### 工具执行流程

```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Agent Loop   │───▶│ prepareTool   │───▶│ beforeTool   │
│              │    │   Call        │    │   Call Hook  │
└──────────────┘    └───────────────┘    └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │  Execute     │
                                         │  Tool        │
                                         └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ afterTool    │
                                         │ Call Hook    │
                                         └──────────────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ Emit Events  │
                                         │ & Messages   │
                                         └──────────────┘
```

**执行模式：**
- **sequential**: 工具按顺序执行，每个工具完成后才开始下一个
- **parallel**: 工具准备阶段顺序执行，执行阶段并发运行

```typescript
// packages/agent/src/agent-loop.ts
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
  return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

## 七大工具详解

### 1. Read 工具

**功能：** 读取文件内容，支持文本文件和图片（jpg, png, gif, webp）

**关键特性：**
- 行范围读取（offset/limit）
- 图片自动缩放（默认 2000x2000），发送为 image content block
- 截断保护（默认 2000 行或 50KB）
- 智能 macOS 路径解析（处理截图文件、NFD 规范化、智能引号）
- Compact 读取分类：对 SKILL.md、CLAUDE.md、AGENTS.md 和 docs/ 目录下的文件自动折叠显示（需展开查看内容）
- 非视觉模型兼容：当模型不支持图片输入时自动省略图片并添加提示
- 截断后提供可操作的 `offset=N` 续读提示

**实现要点：**

```typescript
// packages/coding-agent/src/core/tools/read.ts
export function createReadToolDefinition(cwd: string, options?: ReadToolOptions) {
  const autoResizeImages = options?.autoResizeImages ?? true;
  const ops = options?.operations ?? defaultReadOperations;
  return {
    name: "read",
    async execute(
      _toolCallId,
      { path, offset, limit }: { path: string; offset?: number; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?,
    ) {
      return new Promise((resolve, reject) => {
        // Abort 信号处理
        let aborted = false;
        const onAbort = () => { aborted = true; reject(new Error("Operation aborted")); };
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            // 1. 异步路径解析（支持 macOS 截图路径等变体）
            const absolutePath = await resolveReadPathAsync(path, cwd);
            if (aborted) return;

            // 2. 检查文件可读性
            await ops.access(absolutePath);
            if (aborted) return;

            // 3. 检测是否为图片
            const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
            let content: (TextContent | ImageContent)[];
            let details: ReadToolDetails | undefined;
            // 检查模型是否支持图片
            const nonVisionImageNote = getNonVisionImageNote(ctx?.model);

            if (mimeType) {
              // 3a. 读取图片（支持自动缩放）
              const buffer = await ops.readFile(absolutePath);
              if (autoResizeImages) {
                const resized = await resizeImage(buffer, mimeType);
                // 缩放后的图片 + 尺寸说明文本
                // ...
              }
              // 如果模型不支持 vision，添加提示
            } else {
              // 3b. 读取文本（支持行范围和截断）
              const buffer = await ops.readFile(absolutePath);
              const textContent = buffer.toString("utf-8");
              const allLines = textContent.split("\n");
              const startLine = offset ? Math.max(0, offset - 1) : 0;

              let selectedContent: string;
              if (limit !== undefined) {
                selectedContent = allLines.slice(startLine, startLine + limit).join("\n");
              } else {
                selectedContent = allLines.slice(startLine).join("\n");
              }

              const truncation = truncateHead(selectedContent);
              // 截断后添加可操作的 offset 提示
              if (truncation.truncated) {
                const nextOffset = startLine + truncation.outputLines + 1;
                outputText = `${truncation.content}\n\n[Showing lines ... Use offset=${nextOffset} to continue.]`;
              }
              details = { truncation };
            }
            // ...
          } catch (error) {
            // cleanup
          }
        })();
      });
    },
    renderCall(args, theme, context) {
      // Compact 分类：非展开状态下自动识别 SKILL.md、CLAUDE.md 等特殊文件
      const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
      // 折叠显示 "[skill] skill-name" 或 "read resource path"
    },
    renderResult(result, options, theme, context) {
      // 支持语法高亮，截断警告显示
    },
  };
}
```

**截断策略：**
```typescript
// packages/coding-agent/src/core/tools/truncate.ts
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

// truncateHead() - 从头部截断（文件读取）
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = splitLinesForCounting(content);
  const totalLines = lines.length;

  // 1. 检查首行是否超过字节限制
  const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
  if (firstLineBytes > maxBytes) {
    return { content: "", truncated: true, truncatedBy: "bytes", firstLineExceedsLimit: true, /* ... */ };
  }

  // 2. 收集符合条件的完整行
  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline

    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    outputLinesArr.push(line);
    outputBytesCount += lineBytes;
  }

  return { content: outputLinesArr.join("\n"), truncated: true, truncatedBy, /* ... */ };
}

// truncateTail() - 从尾部截断（bash 输出）
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  // 从后向前工作，保留最后 N 行/字节
  const outputLinesArr: string[] = [];
  let outputBytesCount = 0;
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
    // ... 类似 truncateHead 但反向工作

    // 边缘情况：如果单行超过 maxBytes，返回行的尾部（部分）
    if (outputLinesArr.length === 0) {
      const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
      outputLinesArr.unshift(truncatedLine);
      lastLinePartial = true;
    }
  }

  return { content: outputLinesArr.join("\n"), truncated: true, lastLinePartial, /* ... */ };
}
```

### 2. Bash 工具

**功能：** 执行 shell 命令，支持超时控制和输出截断

**关键特性：**
- 超时控制（timeout 参数）
- 流式输出（通过 onUpdate 回调，节流 100ms）
- 输出截断（默认最后 2000 行或 50KB）
- 临时文件保存完整输出
- 进程树清理（detached 模式）
- Spawn Hook 支持（动态修改命令/目录/环境变量）

**实现架构：**

```
┌─────────────────────────────────────────────────────────────┐
│                        Bash Tool                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ OutputAccumulator                                       │ │
│  │  - rolling tail (last N lines)                         │ │
│  │  - temp file (full output)                             │ │
│  │  - UTF-8 streaming decoder                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                              ▲                              │
│                              │ onData                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ BashOperations (spawn)                                 │ │
│  │  - child.stdout.on("data")                             │ │
│  │  - child.stderr.on("data")                             │ │
│  │  - timeout handling                                    │ │
│  │  - abort signal                                        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**核心实现：**

```typescript
// packages/coding-agent/src/core/tools/bash.ts
export function createBashToolDefinition(cwd: string, options?: BashToolOptions) {
  const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });

  return {
    name: "bash",
    async execute(_toolCallId, { command, timeout }, signal?, onUpdate?, _ctx?) {
      const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
      const spawnContext = resolveSpawnContext(command, cwd, spawnHook);

      // 节流更新（100ms 间隔）
      let updateDirty = false;
      const scheduleOutputUpdate = () => {
        updateDirty = true;
        const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
        if (delay <= 0) {
          emitOutputUpdate();
        } else {
          setTimeout(emitOutputUpdate, delay);
        }
      };

      const handleData = (data: Buffer) => {
        output.append(data);
        scheduleOutputUpdate();
      };

      // 执行命令
      const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
        onData: handleData,
        signal,
        timeout,
        env: spawnContext.env,
      });

      // 格式化输出
      const snapshot = output.snapshot({ persistIfTruncated: true });
      const { text, details } = formatOutput(snapshot);

      if (result.exitCode !== 0 && result.exitCode !== null) {
        throw new Error(`${text}\n\nCommand exited with code ${result.exitCode}`);
      }

      return { content: [{ type: "text", text }], details };
    }
  };
}
```

**本地 shell 执行实现：**

```typescript
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) => {
      return new Promise((resolve, reject) => {
        const { shell, args } = getShellConfig(options?.shellPath);
        const child = spawn(shell, [...args, command], {
          cwd,
          detached: process.platform !== "win32", // Unix 下启用 detached 模式
          env: env ?? getShellEnv(),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        if (child.pid) trackDetachedChildPid(child.pid);

        // 超时处理
        let timedOut = false;
        if (timeout !== undefined && timeout > 0) {
          setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }

        // 流式输出
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        // 中止信号处理
        const onAbort = () => {
          if (child.pid) killProcessTree(child.pid);
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        // 等待进程结束
        waitForChildProcess(child)
          .then((code) => {
            if (timedOut) {
              reject(new Error(`timeout:${timeout}`));
            } else if (signal?.aborted) {
              reject(new Error("aborted"));
            } else {
              resolve({ exitCode: code });
            }
          })
          .catch(reject);
      });
    },
  };
}
```

**OutputAccumulator 关键特性：**
- **滚动窗口：** 只保留最后 N 行（maxRollingBytes），防止内存无限增长
- **临时文件：** 当输出超过阈值时，自动创建临时文件保存完整输出
- **UTF-8 流式解码：** 正确处理多字节字符的边界问题

```typescript
// packages/coding-agent/src/core/tools/output-accumulator.ts
export class OutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxRollingBytes: number;
  private readonly decoder = new TextDecoder();

  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private totalLines = 0;

  append(data: Buffer): void {
    this.totalRawBytes += data.length;
    this.appendDecodedText(this.decoder.decode(data, { stream: true }));

    if (this.tempFileStream || this.shouldUseTempFile()) {
      this.ensureTempFile();
      this.tempFileStream?.write(data); // 写入临时文件
    } else if (data.length > 0) {
      this.rawChunks.push(data); // 暂存内存
    }
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): OutputSnapshot {
    const tailTruncation = truncateTail(this.getSnapshotText(), {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    });
    return {
      content: tailTruncation.content,
      truncation: { /* ... */ },
      fullOutputPath: this.tempFilePath,
    };
  }
}
```

### 3. Edit 工具

**功能：** 基于精确字符串替换的文件编辑

**关键特性：**
- Unified Patch 模式（所有 edits 都基于原始文件匹配）
- 支持多个不连续的编辑（单次调用）
- 模糊匹配（Unicode 规范化、尾随空白去除）
- 差异预览（renderCall 时异步计算）
- 并发写安全（通过 file-mutation-queue）
- 兼容模式：自动处理某些模型发送 JSON 字符串而非数组的 edits 参数

**参数预处理：**

```typescript
// packages/coding-agent/src/core/tools/edit.ts
function prepareEditArguments(input: unknown): EditToolInput {
  if (!input || typeof input !== "object") {
    return input as EditToolInput;
  }

  const args = input as Record<string, unknown>;

  // 某些模型（Opus 4.6, GLM-5.1）将 edits 作为 JSON 字符串发送
  if (typeof args.edits === "string") {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) args.edits = parsed;
    } catch {}
  }

  // 兼容旧的单编辑格式（oldText/newText）
  const legacy = args as LegacyEditToolInput;
  if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
    return args as EditToolInput;
  }

  const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
  edits.push({ oldText: legacy.oldText, newText: legacy.newText });
  const { oldText: _oldText, newText: _newText, ...rest } = legacy;
  return { ...rest, edits } as EditToolInput;
}
```

**编辑流程：**

```
┌─────────────────────────────────────────────────────────────┐
│                       Edit 工具执行流程                       │
└─────────────────────────────────────────────────────────────┘

1. 读取文件
   ├─ stripBom() - 去除 BOM
   ├─ detectLineEnding() - 检测行尾符
   └─ normalizeToLF() - 规范化为 LF

2. 匹配和替换
   ├─ fuzzyFindText() - 对每个 edit 进行模糊匹配
   ├─ 检查重叠和嵌套
   └─ 应用替换

3. 写入文件
   ├─ restoreLineEndings() - 恢复原行尾符
   ├─ withFileMutationQueue() - 并发安全
   └─ writeFile()

4. 生成元数据
   ├─ generateDiffString() - UI 显示的差异
   └─ generateUnifiedPatch() - 标准补丁格式
```

**核心算法 - 模糊匹配：**

```typescript
// packages/coding-agent/src/core/tools/edit-diff.ts
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
  // 1. 尝试精确匹配
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return {
      found: true,
      index: exactIndex,
      matchLength: oldText.length,
      usedFuzzyMatch: false,
      contentForReplacement: content,
    };
  }

  // 2. 规范化后进行模糊匹配
  const normalizedContent = normalizeForFuzzyMatch(content);
  const normalizedOldText = normalizeForFuzzyMatch(oldText);
  const fuzzyIndex = normalizedContent.indexOf(normalizedOldText);

  if (fuzzyIndex !== -1) {
    return {
      found: true,
      index: fuzzyIndex,
      matchLength: normalizedOldText.length,
      usedFuzzyMatch: true,
      contentForReplacement: fuzzyContent, // 使用规范化内容进行替换
    };
  }

  return { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false, contentForReplacement: content };
}

export function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd()) // 去除尾随空白
    .join("\n")
    .replace(/[‘’‚‛]/g, "'") // 智能引号 → ASCII
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-") // 各种 dash → -
    .replace(/[  -   　]/g, " "); // 特殊空格 → 空格
}
```

**重叠检测：**

```typescript
export function applyEditsToNormalizedContent(
  normalizedContent: string,
  edits: Edit[],
  path: string,
): AppliedEditsResult {
  // 1. 对 edits 做 LF 规范化预处理
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }));

  // 2. 校验 oldText 非空
  for (let i = 0; i < normalizedEdits.length; i++) {
    if (normalizedEdits[i].oldText.length === 0) {
      throw getEmptyOldTextError(path, i, normalizedEdits.length);
    }
  }

  // 3. 首次匹配：检测是否需要模糊匹配
  const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
  const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
    ? normalizeForFuzzyMatch(normalizedContent)
    : normalizedContent;

  // 4. 在最终内容上精确匹配所有 edits
  const matchedEdits: MatchedEdit[] = [];
  for (let i = 0; i < normalizedEdits.length; i++) {
    const edit = normalizedEdits[i];
    const matchResult = fuzzyFindText(baseContent, edit.oldText);

    if (!matchResult.found) {
      throw getNotFoundError(path, i, normalizedEdits.length);
    }

    // 检查唯一性
    const occurrences = countOccurrences(baseContent, edit.oldText);
    if (occurrences > 1) {
      throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
    }

    matchedEdits.push({
      editIndex: i,
      matchIndex: matchResult.index,
      matchLength: matchResult.matchLength,
      newText: edit.newText,
    });
  }

  // 5. 按位置排序后检查重叠
  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
  for (let i = 1; i < matchedEdits.length; i++) {
    const previous = matchedEdits[i - 1];
    const current = matchedEdits[i];
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(
        `edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. ` +
        `Merge them into one edit or target disjoint regions.`
      );
    }
  }

  // 6. 从后向前应用替换（字符串拼接，避免索引失效）
  let newContent = baseContent;
  for (let i = matchedEdits.length - 1; i >= 0; i--) {
    const edit = matchedEdits[i];
    newContent =
      newContent.substring(0, edit.matchIndex) +
      edit.newText +
      newContent.substring(edit.matchIndex + edit.matchLength);
  }

  // 7. 无变化检测
  if (baseContent === newContent) {
    throw getNoChangeError(path, normalizedEdits.length);
  }

  return { baseContent, newContent };
}
```

**并发写安全：**

```typescript
// packages/coding-agent/src/core/tools/file-mutation-queue.ts
const fileMutationQueues = new Map<string, Promise<void>>();

export async function withFileMutationQueue<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = getMutationQueueKey(filePath); // 解析为真实路径
  const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();

  let releaseNext!: () => void;
  const nextQueue = new Promise<void>((resolve) => { releaseNext = resolve; });
  const chainedQueue = currentQueue.then(() => nextQueue);
  fileMutationQueues.set(key, chainedQueue);

  await currentQueue; // 等待前面的操作完成
  try {
    return await fn(); // 执行当前操作
  } finally {
    releaseNext(); // 释放下一个操作
    if (fileMutationQueues.get(key) === chainedQueue) {
      fileMutationQueues.delete(key); // 清理
    }
  }
}
```

**路径解析工具：**

```typescript
// packages/coding-agent/src/core/tools/path-utils.ts
// 处理 macOS 特殊路径问题

function tryMacOSScreenshotPath(filePath: string): string {
  // macOS 截图文件名中的 AM/PM 使用窄不换行空格 (U+202F)
  return filePath.replace(/ (AM|PM)\./gi, ` $1.`);
}

function tryNFDVariant(filePath: string): string {
  // macOS 文件名使用 NFD（分解）形式存储
  return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
  // macOS 截图文件名使用智能引号 (U+2019)
  return filePath.replace(/'/g, "’");
}

// 智能路径解析，尝试多种变体（同步版本，仅基于文件名存在性）
export function resolveReadPath(filePath: string, cwd: string): string {
  // ... 尝试 AM/PM、NFD、智能引号、组合变体
}

// 异步版本（用于 read 工具 execute），在同步检查基础上还会用 access() 验证可读性
export async function resolveReadPathAsync(filePath: string, cwd: string): Promise<string> {
  // resolveReadPath 的所有变体 + access() 验证
}
```

### 4. Write 工具

**功能：** 创建新文件或完全覆盖现有文件

**关键特性：**
- 自动创建父目录（递归 mkdir）
- 语法高亮支持（增量更新缓存，前 50 行自动全量刷新）
- 并发写安全（file-mutation-queue）
- 流式渲染优化：通过 `WriteCallRenderComponent` 实现增量语法高亮，避免流式参数输入时重复全量高亮
- 与 Edit 工具的区别：Write 用于新文件或完全重写，Edit 用于精确修改

**实现要点：**

```typescript
// packages/coding-agent/src/core/tools/write.ts
export function createWriteToolDefinition(cwd: string, options?: WriteToolOptions) {
  const ops = options?.operations ?? defaultWriteOperations;

  return {
    name: "write",
    async execute(
      _toolCallId,
      { path, content }: { path: string; content: string },
      signal?: AbortSignal,
      _onUpdate?,
      _ctx?,
    ) {
      const absolutePath = resolveToCwd(path, cwd);
      const dir = dirname(absolutePath);
      return withFileMutationQueue(absolutePath, async () => {
        // 通过 throwIfAborted() 检查 signal，确保文件操作完成后再释放队列
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new Error("Operation aborted");
        };

        throwIfAborted();
        // 创建父目录
        await ops.mkdir(dir);
        throwIfAborted();

        // 写入文件内容
        await ops.writeFile(absolutePath, content);
        throwIfAborted();

        return {
          content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
          details: undefined,
        };
      });
    }
    // ... renderCall / renderResult
  };
}
```

**增量语法高亮（UI 优化）：**

```typescript
// packages/coding-agent/src/core/tools/write.ts
const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;

class WriteCallRenderComponent extends Text {
  cache?: WriteHighlightCache;
}

// 增量更新：只高亮新增部分，避免流式输入时每帧全量高亮
function updateWriteHighlightCacheIncremental(
  cache: WriteHighlightCache | undefined,
  rawPath: string | null,
  fileContent: string,
): WriteHighlightCache | undefined {
  const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
  if (!lang) return undefined;
  if (!cache) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (cache.lang !== lang || cache.rawPath !== rawPath) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (!fileContent.startsWith(cache.rawContent)) return rebuildWriteHighlightCacheFull(rawPath, fileContent);
  if (fileContent.length === cache.rawContent.length) return cache;

  // 增量更新：只对新内容做 normalize + 高亮
  const deltaRaw = fileContent.slice(cache.rawContent.length);
  const deltaDisplay = normalizeDisplayText(deltaRaw);
  const deltaNormalized = replaceTabs(deltaDisplay);
  cache.rawContent = fileContent;

  if (cache.normalizedLines.length === 0) {
    cache.normalizedLines.push("");
    cache.highlightedLines.push("");
  }

  const segments = deltaNormalized.split("\n");
  const lastIndex = cache.normalizedLines.length - 1;
  cache.normalizedLines[lastIndex] += segments[0];
  cache.highlightedLines[lastIndex] = highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);

  for (let i = 1; i < segments.length; i++) {
    cache.normalizedLines.push(segments[i]);
    cache.highlightedLines.push(highlightSingleLine(segments[i], cache.lang));
  }

  // 刷新前 50 行的高亮前缀（确保前缀始终准确）
  refreshWriteHighlightPrefix(cache);
  return cache;
}

// refreshWriteHighlightPrefix 对前 50 行做全量重新高亮，保证前缀行不受增量拼接影响
function refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
  const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
  if (prefixCount === 0) return;
  const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
  const prefixHighlighted = highlightCode(prefixSource, cache.lang);
  for (let i = 0; i < prefixCount; i++) {
    cache.highlightedLines[i] =
      prefixHighlighted[i] ?? highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
  }
}
```

### 5. Grep 工具

**功能：** 文件内容搜索（基于 ripgrep）

**关键特性：**
- 正则/字面量搜索
- glob 文件过滤
- 上下文行显示（context 参数，默认 0）
- 匹配数量限制（默认 100）
- 字节截断保护（默认 50KB）
- 长行截断（默认 500 字符，`GREP_MAX_LINE_LENGTH`）
- 可插拔 Operations：支持自定义 `isDirectory` 和 `readFile`（用于远程文件系统）
- 文件内容缓存（fileCache）：避免重复读取同一文件的上下文行

**实现架构：**

```
┌─────────────────────────────────────────────────────────────┐
│                        Grep 工具                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ripgrep (rg) --json --line-number                       │ │
│  │  流式输出 match 事件                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                              ▲                              │
│                              │                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 收集阶段                                                │ │
│  │  - 解析 JSON match 事件                                  │ │
│  │  - 限制匹配数量，超限时 kill ripgrep                    │ │
│  │  - 保存 (filePath, lineNumber, lineText)               │ │
│  └────────────────────────────────────────────────────────┘ │
│                              ▼                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 格式化阶段（rg 退出后）                                  │ │
│  │  - context=0: 直接使用 ripgrep 返回的行                  │ │
│  │  - context>0: 通过 fileCache 读取文件获取上下文         │ │
│  │  - truncateLine: 截断长行                                │ │
│  │  - formatPath: 相对化 / 文件名                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                              ▼                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 输出阶段                                                │ │
│  │  - truncateHead: 字节截断                                │ │
│  │  - 构建可操作警告（matchLimit, byteLimit, lineTrunc）   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**核心实现：**

```typescript
// packages/coding-agent/src/core/tools/grep.ts
export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
  readFile: (absolutePath: string) => Promise<string> | string;
}

export function createGrepToolDefinition(
  cwd: string,
  options?: GrepToolOptions,
): ToolDefinition<typeof grepSchema, GrepToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "grep",
    async execute(
      _toolCallId,
      { pattern, path: searchDir, glob, ignoreCase, literal, context, limit },
      signal?: AbortSignal,
      _onUpdate?,
      _ctx?,
    ) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

        (async () => {
          const rgPath = await ensureTool("rg", true);
          const searchPath = resolveToCwd(searchDir || ".", cwd);
          const ops = customOps ?? defaultGrepOperations;

          // 判断搜索目标是文件还是目录（决定路径格式化方式）
          let isDirectory: boolean;
          try {
            isDirectory = await ops.isDirectory(searchPath);
          } catch {
            settle(() => reject(new Error(`Path not found: ${searchPath}`)));
            return;
          }

          const contextValue = context && context > 0 ? context : 0;
          const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT); // 100

          // formatPath: 目录搜索显示相对路径，文件搜索显示文件名
          const formatPath = (filePath: string): string => {
            if (isDirectory) {
              const relative = path.relative(searchPath, filePath);
              if (relative && !relative.startsWith("..")) return relative.replace(/\\/g, "/");
            }
            return path.basename(filePath);
          };

          // fileCache: 缓存已读文件内容，避免重复读取
          const fileCache = new Map<string, string[]>();
          const getFileLines = async (filePath: string): Promise<string[]> => {
            let lines = fileCache.get(filePath);
            if (!lines) {
              try {
                const content = await ops.readFile(filePath);
                lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
              } catch { lines = []; }
              fileCache.set(filePath, lines);
            }
            return lines;
          };

          // formatBlock: 为每个匹配生成包含上下文行的输出块
          const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
            const lines = await getFileLines(filePath);
            const block: string[] = [];
            const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
            const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
            for (let current = start; current <= end; current++) {
              const lineText = lines[current - 1] ?? "";
              const { text: truncatedText, wasTruncated } = truncateLine(lineText.replace(/\r/g, ""));
              if (wasTruncated) linesTruncated = true;
              if (current === lineNumber) block.push(`${relativePath}:${current}: ${truncatedText}`);
              else block.push(`${relativePath}-${current}- ${truncatedText}`);
            }
            return block;
          };

          // 构建 ripgrep 参数
          const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];
          if (ignoreCase) args.push("--ignore-case");
          if (literal) args.push("--fixed-strings");
          if (glob) args.push("--glob", glob);
          args.push("--", pattern, searchPath);

          // 流式收集匹配，达到限制后 kill ripgrep
          const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
          let matchCount = 0;
          let matchLimitReached = false;
          let linesTruncated = false;
          let killedDueToLimit = false;
          const matches: Array<{ filePath: string; lineNumber: number; lineText?: string }> = [];

          rl.on("line", (line) => {
            if (matchCount >= effectiveLimit) return;
            const event = JSON.parse(line);
            if (event.type === "match") {
              matchCount++;
              matches.push({ filePath: event.data.path.text, lineNumber: event.data.line_number, lineText: event.data.lines.text });
              if (matchCount >= effectiveLimit) {
                matchLimitReached = true;
                killedDueToLimit = true;
                child.kill();
              }
            }
          });

          child.on("close", async (code) => {
            // rg 退出后格式化所有匹配
            if (!killedDueToLimit && code !== 0 && code !== 1) {
              settle(() => reject(new Error(stderr)));
              return;
            }

            for (const match of matches) {
              if (contextValue === 0 && match.lineText !== undefined) {
                // 无上下文：直接使用 ripgrep 返回的行（零开销）
                const { text: truncatedText, wasTruncated } = truncateLine(match.lineText);
                if (wasTruncated) linesTruncated = true;
                outputLines.push(`${formatPath(match.filePath)}:${match.lineNumber}: ${truncatedText}`);
              } else {
                // 有上下文：读取文件获取上下文行
                const block = await formatBlock(match.filePath, match.lineNumber);
                outputLines.push(...block);
              }
            }

            // 字节截断 + 构建警告
            const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
            // 匹配限制、字节限制、行截断三种警告
            if (matchLimitReached) details.matchLimitReached = effectiveLimit;
            if (truncation.truncated) details.truncation = truncation;
            if (linesTruncated) details.linesTruncated = true;
            settle(() => resolve({ content: [{ type: "text", text: output }], details }));
          });
        })();
      });
    },
  };
}
```

**上下文格式化：**

匹配行使用 `:` 分隔符，上下文行使用 `-` 分隔符，便于解析和区分。

```typescript
// 匹配行格式: relativePath:lineNumber: lineText
// 上下文行格式: relativePath-lineNumber- lineText
//
// 示例输出：
// src/core/tools/grep.ts:15: export interface GrepOperations {
// src/core/tools/grep.ts-14- /**
// src/core/tools/grep.ts-16-  * Check if path is a directory.
```

### 6. Find 工具

**功能：** 基于 glob 模式的文件查找（基于 fd 或自定义 glob 实现）

**关键特性：**
- glob 模式匹配（支持 `**/*.ts`、`src/**/*.spec.ts` 等语法）
- 结果数量和字节双重限制（默认 1000 结果或 50KB）
- 相对路径输出（Posix 风格，保留目录尾部 `/`）
- .gitignore 支持（`--no-require-git` 标志）
- 可插拔 Operations：支持自定义 `glob` 实现（用于远程文件系统）
- 包含路径分隔符的 pattern 自动添加 `--full-path` 和 `**/` 前缀

**实现要点：**

```typescript
// packages/coding-agent/src/core/tools/find.ts
export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}

export function createFindToolDefinition(
  cwd: string,
  options?: FindToolOptions,
): ToolDefinition<typeof findSchema, FindToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "find",
    async execute(
      _toolCallId,
      { pattern, path: searchDir, limit }: { pattern: string; path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      _ctx?,
    ) {
      return new Promise((resolve, reject) => {
        // settle 模式：确保只 resolve/reject 一次
        let settled = false;
        let stopChild: (() => void) | undefined;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          fn();
        };

        (async () => {
          const searchPath = resolveToCwd(searchDir || ".", cwd);
          const effectiveLimit = limit ?? DEFAULT_LIMIT; // 1000
          const ops = customOps ?? defaultFindOperations;

          // 自定义 glob 路径（如 SSH 远程文件系统）
          if (customOps?.glob) {
            const results = await ops.glob(pattern, searchPath, {
              ignore: ["**/node_modules/**", "**/.git/**"],
              limit: effectiveLimit,
            });
            // 相对化路径，保留尾部 /
            const relativized = results.map((p) => {
              if (p.startsWith(searchPath)) return toPosixPath(p.slice(searchPath.length + 1));
              return toPosixPath(path.relative(searchPath, p));
            });
            // 构建截断警告并输出
            // ...
            settle(() => resolve({ content: [...], details }));
            return;
          }

          // 默认 fd 路径
          const fdPath = await ensureTool("fd", true);
          const args: string[] = [
            "--glob", "--color=never", "--hidden",
            "--no-require-git", // 即使不在 git 仓库也应用 .gitignore
            "--max-results", String(effectiveLimit),
          ];

          // 包含路径分隔符的 pattern 自动切换到 --full-path 模式
          let effectivePattern = pattern;
          if (pattern.includes("/")) {
            args.push("--full-path");
            if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
              effectivePattern = `**/${pattern}`;
            }
          }
          args.push("--", effectivePattern, searchPath);

          const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
          stopChild = () => { if (!child.killed) child.kill(); };
          // ... 收集输出，相对化路径，保留尾部 /，添加截断警告
        })();
      });
    },
    renderCall(args, theme, context) {
      // 渲染 "find pattern in path (limit N)" 格式
    },
    renderResult(result, options, theme, context) {
      // 渲染结果列表，支持 expanded 展开和截断警告
    },
  };
}
```

### 7. Ls 工具

**功能：** 列出目录内容

**关键特性：**
- 字母排序（不区分大小写）
- 目录标记（`/` 后缀）
- 包含隐藏文件
- 数量和字节双重限制（默认 500 条目或 50KB）
- 可插拔 Operations（支持远程文件系统）

**实现要点：**

```typescript
// packages/coding-agent/src/core/tools/ls.ts
export function createLsToolDefinition(
  cwd: string,
  options?: LsToolOptions,
): ToolDefinition<typeof lsSchema, LsToolDetails | undefined> {
  const ops = options?.operations ?? defaultLsOperations;
  return {
    name: "ls",
    async execute(
      _toolCallId,
      { path, limit }: { path?: string; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      _ctx?,
    ) {
      return new Promise((resolve, reject) => {
        // Abort 信号处理
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }
        const onAbort = () => reject(new Error("Operation aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            const dirPath = resolveToCwd(path || ".", cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT; // 500

            // 路径存在性和类型检查
            if (!(await ops.exists(dirPath))) {
              reject(new Error(`Path not found: ${dirPath}`));
              return;
            }
            const stat = await ops.stat(dirPath);
            if (!stat.isDirectory()) {
              reject(new Error(`Not a directory: ${dirPath}`));
              return;
            }

            // 读取并排序目录条目
            let entries = await ops.readdir(dirPath);
            entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            // 格式化：添加目录标记 "/" 后缀
            const results: string[] = [];
            let entryLimitReached = false;
            for (const entry of entries) {
              if (results.length >= effectiveLimit) {
                entryLimitReached = true;
                break;
              }
              const fullPath = nodePath.join(dirPath, entry);
              let suffix = "";
              try {
                const entryStat = await ops.stat(fullPath);
                if (entryStat.isDirectory()) suffix = "/";
              } catch {
                continue; // 跳过无法 stat 的条目
              }
              results.push(entry + suffix);
            }

            signal?.removeEventListener("abort", onAbort);

            if (results.length === 0) {
              resolve({ content: [{ type: "text", text: "(empty directory)" }], details: undefined });
              return;
            }

            // 字节截断（无行数限制，条目数已由 limit 控制）
            const rawOutput = results.join("\n");
            const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
            let output = truncation.content;
            const details: LsToolDetails = {};
            const notices: string[] = [];
            if (entryLimitReached) {
              notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
              details.entryLimitReached = effectiveLimit;
            }
            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
              details.truncation = truncation;
            }
            if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

            resolve({
              content: [{ type: "text", text: output }],
              details: Object.keys(details).length > 0 ? details : undefined,
            });
          } catch (e: any) {
            signal?.removeEventListener("abort", onAbort);
            reject(e);
          }
        })();
      });
    },
    renderCall(args, theme, context) {
      // 渲染 "ls <path> (limit N)" 格式
      // ...
    },
    renderResult(result, options, theme, context) {
      // 渲染结果列表，支持 expanded 展开和截断警告
      // ...
    },
  };
}
```

## 工具执行策略

### Sequential vs Parallel

**Sequential 执行：**
```typescript
// packages/agent/src/agent-loop.ts
async function executeToolCallsSequential(
  currentContext,
  assistantMessage,
  toolCalls,
  config,
  signal,
  emit,
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallOutcome[] = [];

  for (const toolCall of toolCalls) {
    // 1. 准备工具调用
    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);

    // 2. 执行工具
    const executed = await executePreparedToolCall(preparation, signal, emit);

    // 3. 完成后处理（afterToolCall hook）
    const finalized = await finalizeExecutedToolCall(
      currentContext,
      assistantMessage,
      preparation,
      executed,
      config,
      signal,
    );

    // 4. 立即发送事件和消息
    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);

    finalizedCalls.push(finalized);

    if (signal?.aborted) break;
  }

  return {
    messages: finalizedCalls.map(createToolResultMessage),
    terminate: shouldTerminateToolBatch(finalizedCalls),
  };
}
```

**Parallel 执行：**
```typescript
async function executeToolCallsParallel(
  currentContext,
  assistantMessage,
  toolCalls,
  config,
  signal,
  emit,
): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  // 阶段 1：顺序准备（不能并行，因为需要验证参数）
  for (const toolCall of toolCalls) {
    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);

    if (preparation.kind === "immediate") {
      // 立即返回的错误结果
      const finalized = { toolCall, result: preparation.result, isError: preparation.isError };
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
    } else {
      // 包装为异步函数，稍后并行执行
      finalizedCalls.push(async () => {
        const executed = await executePreparedToolCall(preparation, signal, emit);
        const finalized = await finalizeExecutedToolCall(
          currentContext,
          assistantMessage,
          preparation,
          executed,
          config,
          signal,
        );
        await emitToolExecutionEnd(finalized, emit);
        return finalized;
      });
    }
  }

  // 阶段 2：并行执行
  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry)))
  );

  // 阶段 3：按原始顺序发送消息
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
  };
}
```

**执行模式触发条件：**
1. 全局配置 `config.toolExecution === "sequential"`
2. 任意工具声明 `executionMode: "sequential"`

### 流式更新机制

```typescript
// 工具执行时传入 onUpdate 回调
const result = await tool.execute(
  toolCallId,
  params,
  signal,
  (partialResult) => {
    // 发送 tool_execution_update 事件
    emit({
      type: "tool_execution_update",
      toolCallId,
      toolName: tool.name,
      args: toolCall.arguments,
      partialResult,
    });
  }
);

// Bash 工具的流式更新示例
const handleData = (data: Buffer) => {
  output.append(data);
  scheduleOutputUpdate(); // 节流更新
};

const scheduleOutputUpdate = () => {
  updateDirty = true;
  const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
  if (delay <= 0) {
    emitOutputUpdate();
  } else {
    setTimeout(emitOutputUpdate, delay);
  }
};
```

### 钩子集成

**beforeToolCall：**
```typescript
// 在 prepareToolCall 中调用
if (config.beforeToolCall) {
  const beforeResult = await config.beforeToolCall(
    {
      assistantMessage,
      toolCall,
      args: validatedArgs,
      context: currentContext,
    },
    signal,
  );

  if (beforeResult?.block) {
    return {
      kind: "immediate",
      result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
      isError: true,
    };
  }
}
```

**afterToolCall：**
```typescript
// 在 finalizeExecutedToolCall 中调用
if (config.afterToolCall) {
  const afterResult = await config.afterToolCall(
    {
      assistantMessage,
      toolCall: prepared.toolCall,
      args: prepared.args,
      result,
      isError,
      context: currentContext,
    },
    signal,
  );

  if (afterResult) {
    result = {
      content: afterResult.content ?? result.content,
      details: afterResult.details ?? result.details,
      terminate: afterResult.terminate ?? result.terminate,
    };
    isError = afterResult.isError ?? isError;
  }
}
```

## 错误处理

### 工具执行错误

```typescript
// 1. 参数验证错误
try {
  const validatedArgs = validateToolArguments(tool, preparedToolCall);
} catch (error) {
  return {
    kind: "immediate",
    result: createErrorToolResult(error.message),
    isError: true,
  };
}

// 2. 工具执行错误
try {
  const result = await tool.execute(toolCallId, params, signal, onUpdate);
  return { result, isError: false };
} catch (error) {
  return {
    result: createErrorToolResult(error.message),
    isError: true,
  };
}

// 3. Hook 错误
try {
  const afterResult = await config.afterToolCall(/* ... */);
} catch (error) {
  result = createErrorToolResult(error.message);
  isError = true;
}
```

### 中止处理

```typescript
// 1. 准备阶段中止
if (signal?.aborted) {
  return {
    kind: "immediate",
    result: createErrorToolResult("Operation aborted"),
    isError: true,
  };
}

// 2. 执行阶段中止（工具内部）
const onAbort = () => {
  aborted = true;
  reject(new Error("Operation aborted"));
};
signal?.addEventListener("abort", onAbort, { once: true });

// 3. Bash 工具的进程树中止
const onAbort = () => {
  if (child.pid) killProcessTree(child.pid);
};
signal?.addEventListener("abort", onAbort, { once: true });
```

## 可扩展性设计

### Operations 接口

每个工具都提供了可插拔的 Operations 接口，允许扩展到远程系统：

```typescript
// Read 工具示例
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null>;
}

// 默认本地实现
const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

// SSH 远程实现（示例）
const sshReadOperations: ReadOperations = {
  readFile: async (path) => {
    return await sshClient.exec(`cat ${path}`);
  },
  access: async (path) => {
    return await sshClient.exec(`test -r ${path}`);
  },
};
```

### 命令前缀和 Spawn Hook

Bash 工具支持命令前缀和 spawn hook，用于动态修改命令：

```typescript
export interface BashToolOptions {
  operations?: BashOperations;
  commandPrefix?: string; // 命令前缀
  spawnHook?: BashSpawnHook; // 完全的上下文修改钩子
}

// 示例：每次执行前激活虚拟环境
const options: BashToolOptions = {
  commandPrefix: "source .venv/bin/activate",
};

// 示例：动态修改命令、目录或环境变量
const spawnHook: BashSpawnHook = (context) => {
  return {
    ...context,
    command: `cd ${context.cwd} && ${context.command}`,
    env: { ...context.env, MY_VAR: "value" },
  };
};
```

## 关键设计总结

| 特性 | 实现方式 | 设计目标 |
|------|----------|----------|
| **双层架构** | ToolDefinition（UI）+ AgentTool（运行时） | 分离关注点，支持多种渲染模式 |
| **工具注册** | 工厂函数 + 名称映射 | 类型安全，易于扩展 |
| **执行策略** | Sequential vs Parallel | 平衡并发安全和性能 |
| **并发安全** | file-mutation-queue（文件级队列） | 防止写冲突，不同文件仍可并行 |
| **流式更新** | onUpdate 回调 + 节流 | 实时反馈，避免事件洪水 |
| **截断保护** | 行数/字节数双重限制 | 防止内存爆炸和 token 超限 |
| **错误处理** | 统一的 Error Tool Result | 清晰的错误传播链 |
| **钩子系统** | beforeToolCall / afterToolCall | 无侵入的扩展点 |
| **可插拔操作** | Operations 接口 | 支持远程执行（SSH、容器等） |
| **UI 优化** | 增量语法高亮 + 差异预览 | 流畅的交互体验 |

## 工具对比表

| 工具 | 主要用途 | 外部依赖 | 默认限制 | 并发安全 |
|------|----------|----------|----------|----------|
| **read** | 读取文件 | 无 | 2000 行 / 50KB | N/A |
| **bash** | 执行命令 | shell (sh/bash/zsh) | 最后 2000 行 / 50KB | 否（同一文件需队列） |
| **edit** | 精确编辑 | 无 | 无 | 是（file-mutation-queue） |
| **write** | 创建/覆盖 | 无 | 无 | 是（file-mutation-queue） |
| **grep** | 内容搜索 | ripgrep (rg) | 100 匹配 / 500 字符行截断 / 50KB 字节限制 | N/A |
| **find** | 文件查找 | fd | 1000 结果 / 50KB 字节限制 | N/A |
| **ls** | 列出目录 | 无 | 500 条目 / 50KB 字节限制 | N/A |

## 工具使用指南

### 何时使用哪个工具

```
┌─────────────────────────────────────────────────────────────┐
│                       工具选择决策树                         │
└─────────────────────────────────────────────────────────────┘

你需要操作文件吗？
│
├─ 否 → 使用 bash（执行命令）
│
└─ 是 → 你需要什么操作？
    │
    ├─ 查看内容
    │   ├─ 单个文件 → read
    │   ├─ 多个文件 → grep（搜索内容）+ read（查看文件）
    │   └─ 列出目录 → ls
    │
    ├─ 修改文件
    │   ├─ 新建文件或完全重写 → write
    │   ├─ 精确修改 → edit
    │   └─ 批量修改 → bash（使用 sed/find 等命令）
    │
    └─ 查找文件
        ├─ 按名称模式 → find
        └─ 按内容 → grep
```

### 最佳实践

1. **优先使用专用工具**：read > bash cat，edit > bash sed
2. **合并编辑**：对同一文件的多次修改应使用单次 edit 调用（多个 edits）
3. **利用截断信息**：检查 `details` 字段，使用 offset/limit 继续读取
4. **避免过度使用 bash**：bash 有超时和截断限制，不适合处理大文件
5. **使用上下文参数**：grep 的 context 参数可提供更清晰的匹配上下文

## 相关文件索引

- **工具定义：** `packages/coding-agent/src/core/tools/*.ts`
- **工具注册：** `packages/coding-agent/src/core/tools/index.ts`
- **渲染工具：** `packages/coding-agent/src/core/tools/render-utils.ts`（`shortenPath`, `linkPath`, `str`, `renderToolPath`, `getTextOutput` 等共享渲染函数）
- **编辑差异计算：** `packages/coding-agent/src/core/tools/edit-diff.ts`（`fuzzyFindText`, `applyEditsToNormalizedContent`, `generateDiffString`, `generateUnifiedPatch`）
- **截断工具：** `packages/coding-agent/src/core/tools/truncate.ts`（`truncateHead`, `truncateTail`, `truncateLine`）
- **路径解析：** `packages/coding-agent/src/core/tools/path-utils.ts`（`resolveReadPath`, `resolveReadPathAsync`, `resolveToCwd`）
- **文件变更队列：** `packages/coding-agent/src/core/tools/file-mutation-queue.ts`
- **类型定义：** `packages/agent/src/types.ts`
- **执行循环：** `packages/agent/src/agent-loop.ts`
- **扩展系统：** `packages/coding-agent/src/core/extensions/types.ts`
