# Pi Agent 扩展系统深度分析

## 一、扩展系统架构概览

Pi Agent 的扩展系统是一个基于事件驱动的插件架构，允许第三方代码在不修改核心代码的情况下注入 agent 的各个生命周期阶段。扩展系统位于 `packages/coding-agent/src/core/extensions/` 目录中。

```
扩展系统架构
├── ExtensionRunner (runner.ts)      ← 扩展运行时，负责事件分发和生命周期管理
├── ExtensionLoader (loader.ts)      ← 扩展加载器，负责发现和加载扩展模块
├── Extension Types (types.ts)       ← 扩展类型定义
└── Tool Wrapper (wrapper.ts)        ← 工具包装器，适配扩展工具到 agent 核心
```

### 核心设计理念

1. **事件驱动**：扩展通过订阅事件来参与 agent 生命周期，而不是直接修改核心代码
2. **弱耦合**：扩展与核心系统通过定义良好的接口（ExtensionAPI）通信
3. **热重载**：支持在运行时重新加载扩展而无需重启整个应用
4. **类型安全**：TypeScript 类型系统确保扩展开发时的类型检查

---

## 二、扩展加载机制

### 2.1 扩展发现

扩展可以通过以下方式被系统发现：

```
扩展发现路径
├── 项目本地扩展：${cwd}/.pi/extensions/
├── 全局扩展：~/.pi/extensions/
├── 配置路径：用户在 settings.json 中显式配置的路径
└── 内联扩展：通过代码直接创建的扩展
```

**扩展发现规则**（`discoverExtensionsInDir` 函数）：

1. **直接文件**：`*.ts` 或 `*.js` 文件被识别为扩展
2. **子目录带 index**：包含 `index.ts` 或 `index.js` 的子目录
3. **子目录带 package.json**：包含 `pi.extensions` 字段的 `package.json`

**注意**：`resolveExtensionEntries` 和 `readPiManifestFile` 函数已从 `loader.ts` 移至 `package-manager.ts`，以支持更统一的资源管理和扩展发现机制。

#### package.json 的 pi manifest

扩展包可以通过 `package.json` 的 `pi` 字段声明其资源：

```json
{
  "pi": {
    "extensions": ["./dist/main.js"],
    "skills": ["./skills/**/*.md"],
    "prompts": ["./prompts/**/*.md"],
    "themes": ["./themes/*.json"]
  }
}
```

支持的模式语法：
- 普通模式：包含匹配的文件
- `!pattern`：排除匹配的文件
- `+path`：强制包含特定文件（覆盖排除）
- `-path`：强制排除特定文件（覆盖包含）

```typescript
// 示例：扩展目录结构
extensions/
├── my-tool.ts              # 直接文件扩展
├── custom-commands/        # 子目录扩展
│   └── index.ts
└── complex-extension/      # 带 package.json 的复杂扩展
    └── package.json        # { "pi": { "extensions": ["./dist/main.js"] } }
```

### 2.2 扩展加载流程

```typescript
扩展加载流程
1. discoverAndLoadExtensions()
   ├─ 扫描扩展目录
   ├─ 解析扩展入口点
   └─ 收集所有扩展路径

2. loadExtensions()
   ├─ 创建共享 ExtensionRuntime
   ├─ 为每个扩展创建 ExtensionAPI
   └─ 调用扩展工厂函数

3. 扩展工厂函数 (ExtensionFactory)
   ├─ pi.registerTool()      # 注册自定义工具
   ├─ pi.registerCommand()   # 注册斜杠命令
   ├─ pi.on("event_name")    # 订阅事件
   └─ pi.registerShortcut()  # 注册快捷键
```

**关键代码片段**：

```typescript
// loader.ts 中的扩展创建
function createExtension(extensionPath: string, resolvedPath: string): Extension {
  const source =
    extensionPath.startsWith("<") && extensionPath.endsWith(">")
      ? extensionPath.slice(1, -1).split(":")[0] || "temporary"
      : "local";
  const baseDir = extensionPath.startsWith("<") ? undefined : path.dirname(resolvedPath);

  return {
    path: extensionPath,
    resolvedPath,
    sourceInfo: createSyntheticSourceInfo(extensionPath, { source, baseDir }),
    handlers: new Map(),        // 事件处理器
    tools: new Map(),           // 注册的工具
    messageRenderers: new Map(), // 自定义消息渲染器
    commands: new Map(),        // 注册的命令
    flags: new Map(),           // 注册的 CLI 标志
    shortcuts: new Map(),       // 注册的快捷键
  };
}
```

### 2.3 Jiti 动态导入

扩展加载使用 **jiti**（一个通用的 TypeScript/JavaScript 运行时）来动态加载扩展模块：

```typescript
const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  ...(isBunBinary
    ? { virtualModules: VIRTUAL_MODULES, tryNative: false }  // Bun 二进制模式
    : { alias: getAliases() }                                // Node.js 开发模式
  ),
});
```

- **Bun 二进制模式**：使用 `virtualModules` 提供预打包的依赖
- **Node.js 开发模式**：使用 `alias` 解析到 node_modules

#### 虚拟模块和别名配置

**虚拟模块**（Bun 二进制模式）包含以下包：

```typescript
const VIRTUAL_MODULES: Record<string, unknown> = {
  typebox: _bundledTypebox,
  "typebox/compile": _bundledTypeboxCompile,
  "typebox/value": _bundledTypeboxValue,
  "@sinclair/typebox": _bundledTypebox,
  "@sinclair/typebox/compile": _bundledTypeboxCompile,
  "@sinclair/typebox/value": _bundledTypeboxValue,
  "@earendil-works/pi-agent-core": _bundledPiAgentCore,
  "@earendil-works/pi-tui": _bundledPiTui,
  "@earendil-works/pi-ai": _bundledPiAi,
  "@earendil-works/pi-ai/oauth": _bundledPiAiOauth,
  "@earendil-works/pi-coding-agent": _bundledPiCodingAgent,
  // 向后兼容别名
  "@mariozechner/pi-agent-core": _bundledPiAgentCore,
  "@mariozechner/pi-tui": _bundledPiTui,
  "@mariozechner/pi-ai": _bundledPiAi,
  "@mariozechner/pi-ai/oauth": _bundledPiAiOauth,
  "@mariozechner/pi-coding-agent": _bundledPiCodingAgent,
};
```

---

## 三、PackageManager：资源管理核心

### 3.1 概述

`PackageManager`（位于 `package-manager.ts`）负责管理和解析所有类型的资源，包括扩展、技能、提示词和主题。它处理以下功能：

1. **包安装/卸载**：支持 npm 包和 git 仓库作为资源来源
2. **资源解析**：从多个来源解析和合并资源
3. **自动发现**：自动发现项目本地的资源
4. **模式过滤**：支持复杂的包含/排除模式
5. **更新检查**：检查并更新已安装的包

### 3.2 资源来源

```
资源来源层次（优先级从高到低）
├── 项目本地配置: .pi/settings.json
│   ├── packages (npm/git/local)
│   ├── extensions (本地路径)
│   ├── skills (本地路径)
│   ├── prompts (本地路径)
│   └── themes (本地路径)
├── 项目自动发现: .pi/{extensions,skills,prompts,themes}/
│   └── .agents/skills/ (祖目录)
├── 全局配置: ~/.pi/agent/settings.json
│   └── 同上
├── 全局自动发现: ~/.pi/agent/{extensions,skills,prompts,themes}/
│   └── ~/.agents/skills/
└── 临时包: 临时安装的包（会话级别）
```

### 3.3 资源优先级

```
资源优先级（数字越小优先级越高，同名冲突时优先级高的胜出）
0  project + settings entry (source: "local", scope: "project")
1  project + auto-discovered (source: "auto", scope: "project")
2  user + settings entry (source: "local", scope: "user")
3  user + auto-discovered (source: "auto", scope: "user")
4  package resource (origin: "package")
```

### 3.4 包类型解析

PackageManager 支持三种包类型：

```typescript
// NPM 包
"npm:package-name"          // 最新版本
"npm:package-name@1.2.3"    // 固定版本

// Git 仓库
"github:user/repo"          // 默认分支
"github:user/repo@v1.0.0"   // 特定标签
"gitlab:user/repo@main"     // 特定分支

// 本地路径
"./my-extension"            // 相对路径
"/absolute/path"            // 绝对路径
"~/path"                    // 用户目录
```

### 3.5 自动发现机制

#### 扩展自动发现

`collectAutoExtensionEntries` 函数实现了智能扩展发现（位于 `package-manager.ts`）：

```typescript
function collectAutoExtensionEntries(dir: string): string[] {
  // 1. 首先检查是否有 package.json 的 pi manifest
  const rootEntries = resolveExtensionEntries(dir);
  if (rootEntries) {
    return rootEntries;
  }

  // 2. 否则从目录内容发现
  // - 直接的 *.ts / *.js 文件
  // - 包含 index.ts / index.js 的子目录
  // - 包含 package.json 的子目录（读取 pi.extensions）
}
```

`resolveExtensionEntries` 函数也位于 `package-manager.ts`，负责解析扩展入口点：

```typescript
function resolveExtensionEntries(dir: string): string[] | null {
  // 检查 package.json 的 pi manifest
  const manifest = readPiManifestFile(packageJsonPath);
  if (manifest?.extensions?.length) {
    // 返回清单中声明的扩展路径
  }
  
  // 检查 index.ts 或 index.js
  // 返回找到的索引文件
}
```

#### 技能自动发现

支持两种技能发现模式：

```typescript
// "pi" 模式：查找 SKILL.md 文件
collectSkillEntries(dir, "pi")
// - SKILL.md 在根目录表示该目录是一个技能
// - 递归查找所有 SKILL.md

// "agents" 模式：兼容 .agents 目录结构
collectSkillEntries(dir, "agents")
// - 类似逻辑，但针对 .agents 目录优化
```

#### 祖目录技能发现

`collectAncestorAgentsSkillDirs` 函数会向遍历目录树，收集所有 `.agents/skills` 目录：

```
项目结构示例:
/repo/
  .agents/skills/           ← 被 CWD 发现
  subdir/
    .agents/skills/         ← 被 CWD 发现
  deep/
    subdir/
      .agents/skills/       ← 被 CWD 发现
  .git/                     ← 停止向上遍历
```

### 3.6 模式过滤系统

资源支持强大的模式过滤功能：

```typescript
// 支持的模式类型
"*.md"                      // glob 模式：匹配所有 .md 文件
"!test.md"                  // 排除模式：排除 test.md
"+specific.md"              // 强制包含：即使被排除规则匹配
"-unwanted.md"              // 强制排除：即使被包含规则匹配
"**/test/*.md"              // 递归 glob
```

模式应用顺序：
1. 应用普通包含模式
2. 应用排除模式（!）
3. 应用强制包含模式（+）
4. 应用强制排除模式（-）

### 3.7 .gitignore 集成

资源发现会读取并应用 `.gitignore`、`.ignore` 和 `.fdignore` 文件中的规则：

```typescript
function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
  for (const filename of IGNORE_FILE_NAMES) { // .gitignore, .ignore, .fdignore
    const ignorePath = join(dir, filename);
    if (existsSync(ignorePath)) {
      const patterns = readFileSync(ignorePath, "utf-8");
      ig.add(patterns);
    }
  }
}
```

### 3.8 环境变量处理

在 Linux 系统上，PackageManager 支持从 `/proc/self/environ` 读取环境变量：

```typescript
function getEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "linux" || Object.keys(process.env).length > 0) {
    return process.env;
  }
  try {
    const data = readFileSync("/proc/self/environ", "utf-8");
    // 解析 \0 分隔的环境变量
  } catch {
    return process.env;
  }
}
```

---

## 四、ExtensionRunner：事件分发核心

### 4.1 ExtensionRunner 架构

`ExtensionRunner` 是扩展系统的核心，负责：

1. **事件分发**：将 agent 事件路由到相应的扩展处理器
2. **生命周期管理**：管理扩展的激活和停用
3. **上下文提供**：为扩展提供执行上下文
4. **错误处理**：捕获和处理扩展中的错误

```typescript
class ExtensionRunner {
  private extensions: Extension[];              // 已加载的扩展列表
  private runtime: ExtensionRuntime;            // 共享运行时
  private uiContext: ExtensionUIContext;        // UI 上下文（可选）
  private mode: ExtensionMode = "print";        // 运行模式
  private cwd: string;                          // 当前工作目录
  private sessionManager: SessionManager;       // 会话管理器
  private modelRegistry: ModelRegistry;         // 模型注册表
  private errorListeners: Set<ExtensionErrorListener>; // 错误监听器
  private staleMessage: string | undefined;     // 过期标记

  // 扩展功能回调（懒绑定）
  private getModel: () => Model<any> | undefined;
  private isIdleFn: () => boolean;
  private getSignalFn: () => AbortSignal | undefined;
  private abortFn: () => void;
  private hasPendingMessagesFn: () => boolean;
  private getContextUsageFn: () => ContextUsage | undefined;
  private compactFn: (options?: CompactOptions) => void;
  private getSystemPromptFn: () => string;
  private newSessionHandler: NewSessionHandler;
  private forkHandler: ForkHandler;
  private navigateTreeHandler: NavigateTreeHandler;
  private switchSessionHandler: SwitchSessionHandler;
  private reloadHandler: ReloadHandler;
  private shutdownHandler: ShutdownHandler;

  constructor(
    extensions: Extension[],
    runtime: ExtensionRuntime,
    cwd: string,
    sessionManager: SessionManager,
    modelRegistry: ModelRegistry,
  ) { /* ... */ }
}
```

### 4.2 核心绑定机制

`bindCore` 方法将扩展系统与核心功能绑定：

```typescript
bindCore(
  actions: ExtensionActions,           // 动作方法（sendMessage, setModel 等）
  contextActions: ExtensionContextActions,  // 上下文访问方法
  providerActions?: {                  // Provider 注册方法
    registerProvider?: (name, config) => void;
    unregisterProvider?: (name) => void;
  },
): void
```

这个方法：
1. 将动作方法复制到共享运行时（所有扩展 API 都引用这个运行时）
2. 刷新待处理的 Provider 注册
3. 将 Provider 注册方法替换为直接调用

### 4.3 上下文创建

ExtensionRunner 为每次事件处理创建一个新的上下文：

```typescript
createContext(): ExtensionContext {
  const runner = this;
  const getModel = this.getModel;
  return {
    get ui() { runner.assertActive(); return runner.uiContext; },
    get mode() { runner.assertActive(); return runner.mode; },
    get hasUI() { runner.assertActive(); return runner.hasUI(); },
    get cwd() { runner.assertActive(); return runner.cwd; },
    get sessionManager() { runner.assertActive(); return runner.sessionManager; },
    get modelRegistry() { runner.assertActive(); return runner.modelRegistry; },
    get model() { runner.assertActive(); return getModel(); },
    get signal() { runner.assertActive(); return runner.getSignalFn(); },
    isIdle: () => { runner.assertActive(); return runner.isIdleFn(); },
    abort: () => { runner.assertActive(); runner.abortFn(); },
    hasPendingMessages: () => { runner.assertActive(); return runner.hasPendingMessagesFn(); },
    shutdown: () => { runner.assertActive(); runner.shutdownHandler(); },
    getContextUsage: () => { runner.assertActive(); return runner.getContextUsageFn(); },
    compact: (options) => { runner.assertActive(); runner.compactFn(options); },
    getSystemPrompt: () => { runner.assertActive(); return runner.getSystemPromptFn(); },
  };
}
```

**关键设计**：使用属性描述符（getter）而非对象展开，确保惰性求值、实时反映最新状态，且每次访问都经过 `assertActive()` 过期检查，避免在会话替换/重载后使用过时的上下文。

### 4.4 命令上下文（createCommandContext）

`createCommandContext` 在 `createContext` 的基础上增加了仅对用户主动命令安全的会话控制方法：

```typescript
createCommandContext(): ExtensionCommandContext {
  // 使用 Object.defineProperties 保持 createContext() 的 getter 惰性
  const context = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(this.createContext()),
  ) as ExtensionCommandContext;
  context.waitForIdle = () => { this.assertActive(); return this.waitForIdleFn(); };
  context.newSession = (options) => { this.assertActive(); return this.newSessionHandler(options); };
  context.fork = (entryId, options) => { this.assertActive(); return this.forkHandler(entryId, options); };
  context.navigateTree = (targetId, options) => { this.assertActive(); return this.navigateTreeHandler(targetId, options); };
  context.switchSession = (sessionPath, options) => { this.assertActive(); return this.switchSessionHandler(sessionPath, options); };
  context.reload = () => { this.assertActive(); return this.reloadHandler(); };
  return context;
}
```

与 `ExtensionContext` 相比，`ExtensionCommandContext` 额外提供：
- `waitForIdle()`: 等待 agent 结束流式输出
- `newSession()`: 创建新会话，支持 `withSession` 回调
- `fork()`: 从指定条目分支创建新会话文件
- `navigateTree()`: 在会话树中导航
- `switchSession()`: 切换到另一个会话文件
- `reload()`: 重载扩展、技能、提示词和主题

---

## 五、完整钩子列表

### 5.1 资源和会话事件

| 事件名 | 触发时机 | 可返回结果 | 用途 |
|--------|----------|------------|------|
| `resources_discover` | 启动/重载时发现额外资源 | `ResourcesDiscoverResult` | 扩展提供额外的 skills/prompts/themes 路径 |
| `session_start` | 会话启动/加载/重载时 | 无 | 初始化会话状态 |
| `session_before_switch` | 切换到另一个会话前 | `SessionBeforeSwitchResult` | 可阻止会话切换 |
| `session_before_fork` | 从某个条目分支前 | `SessionBeforeForkResult` | 可阻止分支或跳过会话恢复 |
| `session_before_compact` | 上下文压缩前 | `SessionBeforeCompactResult` | 可取消压缩或提供自定义压缩结果 |
| `session_compact` | 上下文压缩后 | 无 | 响应压缩完成 |
| `session_before_tree` | 在会话树中导航前 | `SessionBeforeTreeResult` | 可阻止导航或自定义分支摘要 |
| `session_tree` | 在会话树中导航后 | 无 | 响应导航完成 |
| `session_shutdown` | 会话关闭前（退出/重载/切换） | 无 | 清理资源 |

### 5.2 Agent 生命周期事件

| 事件名 | 触发时机 | 可返回结果 | 用途 |
|--------|----------|------------|------|
| `context` | 每次 LLM 调用前，转换上下文 | `ContextEventResult` | 修改发送给 LLM 的消息列表 |
| `before_provider_request` | LLM 请求发送前 | `BeforeProviderRequestEventResult` | 修改请求 payload |
| `after_provider_response` | LLM 响应返回后 | 无 | 记录响应头/状态码 |
| `before_agent_start` | Agent 开始前 | `BeforeAgentStartEventResult` | 修改 system prompt（链式传递至下一个扩展）或注入自定义消息 |
| `agent_start` | Agent 循环开始 | 无 | 初始化 agent 状态 |
| `agent_end` | Agent 循环结束 | 无 | 清理 agent 状态 |
| `turn_start` | 每个 turn 开始 | 无 | 记录 turn 开始 |
| `turn_end` | 每个 turn 结束 | 无 | 记录 turn 结束 |
| `message_start` | 消息开始 | 无 | 记录消息开始 |
| `message_update` | 消息更新（流式） | 无 | 处理流式更新 |
| `message_end` | 消息结束 | `MessageEndEventResult` | 修改最终消息 |
| `tool_execution_start` | 工具开始执行 | 无 | 记录工具开始 |
| `tool_execution_update` | 工具执行更新（流式） | 无 | 处理工具流式输出 |
| `tool_execution_end` | 工具执行结束 | 无 | 记录工具完成 |

### 5.3 工具事件

| 事件名 | 触发时机 | 可返回结果 | 用途 |
|--------|----------|------------|------|
| `tool_call` | 工具调用前，参数已验证 | `ToolCallEventResult` | 阻止工具执行或修改参数（就地修改 event.input） |
| `tool_result` | 工具执行后 | `ToolResultEventResult` | 修改工具结果内容、详情或错误状态 |

### 5.4 用户交互事件

| 事件名 | 触发时机 | 可返回结果 | 用途 |
|--------|----------|------------|------|
| `user_bash` | 用户通过 ! 或 !! 执行 bash 命令时 | `UserBashEventResult` | 提供自定义操作或完全处理执行 |
| `input` | 用户输入时 | `InputEventResult` | 转换输入内容（含 `streamingBehavior` 字段）或直接处理（handled） |

### 5.5 模型事件

| 事件名 | 触发时机 | 可返回结果 | 用途 |
|--------|----------|------------|------|
| `model_select` | 模型被选择时 | 无 | 响应模型切换 |
| `thinking_level_select` | 思考级别被选择时 | 无 | 响应思考级别切换 |

### 5.6 ExtensionMode 运行模式

`ExtensionContext` 中的 `mode` 字段指示当前运行模式：

| 值 | 含义 | UI 支持 |
|----|------|---------|
| `"tui"` | 交互式终端 UI 模式 | 完整 UI（对话框、widget、自定义组件等） |
| `"rpc"` | JSON-RPC 模式 | 对话框可用，无终端级 UI |
| `"json"` | JSON 模式 | 最小 UI 支持 |
| `"print"` | 非交互打印模式 | 无 UI（默认使用 `noOpUIContext`） |

非交互模式下，`ExtensionRunner` 使用 `noOpUIContext`（一个所有方法均为空操作的默认 UI 上下文），确保在无 TUI 环境中不会抛出异常。

### 5.7 session_shutdown 辅助函数

`emitSessionShutdownEvent` 是独立导出的辅助函数，用于在会话退出/重载/切换前通知扩展：

```typescript
export async function emitSessionShutdownEvent(
  extensionRunner: ExtensionRunner,
  event: SessionShutdownEvent,
): Promise<boolean> {
  if (extensionRunner.hasHandlers("session_shutdown")) {
    await extensionRunner.emit(event);
    return true;
  }
  return false;
}
```

该函数会先检查是否有扩展订阅了 `session_shutdown` 事件，仅在有订阅时才发送，避免不必要的开销。

---

## 六、扩展注册机制

### 6.1 工具注册

扩展通过 `registerTool` 注册自定义工具：

```typescript
pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "A custom tool for demonstration",
  promptSnippet: "Example usage snippet",
  promptGuidelines: ["Guideline 1", "Guideline 2"],
  parameters: Type.Object({
    param1: Type.String(),
    param2: Type.Number(),
  }),
  renderShell: "default", // 或 "self"（工具自行渲染边框）
  executionMode: "sequential", // 或 "parallel"
  prepareArguments: (raw) => {
    // 可选：在验证前准备参数
    return { param1: raw.param1, param2: Number(raw.param2) };
  },
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    // 工具执行逻辑
    return {
      content: [{ type: "text", text: "Result" }],
      details: { metadata: "value" },
    };
  },
  renderCall: (args, theme, context) => {
    // 自定义工具调用渲染
    return Text("Custom call rendering");
  },
  renderResult: (result, options, theme, context) => {
    // 自定义结果渲染
    return Text("Custom result rendering");
  },
});
```

**`defineTool` 辅助函数**：如果将工具定义赋值给变量或通过数组传递（如 `customTools`），使用 `defineTool` 包装以保留参数类型推断，避免 TypeScript 将泛型参数推断为 `unknown`：

```typescript
import { defineTool } from "@earendil-works/pi-coding-agent";
const myTool = defineTool({ /* ToolDefinition */ });
```

**类型守卫函数**：扩展系统提供了多个类型守卫用于安全地处理类型化的工具事件：

- `isToolCallEventType("bash", event)` / `isToolCallEventType("read", event)` 等：窄化 `ToolCallEvent` 类型
- `isBashToolResult(e)` / `isReadToolResult(e)` / `isEditToolResult(e)` 等：窄化 `ToolResultEvent` 类型

### 6.2 命令注册

扩展通过 `registerCommand` 注册斜杠命令：

```typescript
pi.registerCommand("my_command", {
  description: "A custom command",
  getArgumentCompletions: (prefix) => {
    // 提供参数自动完成
    return [
      { name: "option1", description: "First option" },
      { name: "option2", description: "Second option" },
    ];
  },
  handler: async (args, ctx) => {
    // 命令处理逻辑
    // ctx 是 ExtensionCommandContext，包含额外的会话控制方法
    await ctx.ui.notify("Command executed");
  },
});
```

### 6.3 快捷键注册

扩展通过 `registerShortcut` 注册键盘快捷键：

```typescript
pi.registerShortcut("ctrl+k", {
  description: "Custom keyboard shortcut",
  handler: async (ctx) => {
    // 快捷键处理逻辑
    ctx.ui.notify("Shortcut pressed");
  },
});
```

**快捷键冲突处理**：

1. **保留快捷键**：某些快捷键被系统保留（如 `app.interrupt`、`tui.input.submit`）
2. **冲突警告**：当扩展快捷键与内置或其他扩展快捷键冲突时，生成诊断信息
3. **优先级**：保留快捷键优先级最高，然后按注册顺序

### 6.4 Flag 注册

扩展通过 `registerFlag` 注册 CLI 标志：

```typescript
pi.registerFlag("my-flag", {
  description: "A custom flag",
  type: "boolean",
  default: false,
});

// 读取 flag 值
const flagValue = pi.getFlag("my-flag");
```

### 6.5 消息渲染器注册

扩展通过 `registerMessageRenderer` 注册自定义消息渲染器：

```typescript
pi.registerMessageRenderer("my_custom_type", (message, options, theme) => {
  // 返回 TUI 组件
  return Box({ border: "double" })([
    Text(JSON.stringify(message.content, null, 2)),
  ]);
});
```

### 6.6 Provider 注册

扩展通过 `registerProvider` 注册自定义 LLM Provider：

```typescript
pi.registerProvider("my-provider", {
  name: "My Custom Provider",
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "my-model",
      name: "My Model",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16384,
    },
  ],
  oauth: {
    name: "My Provider (SSO)",
    async login(callbacks) { /* ... */ },
    async refreshToken(credentials) { /* ... */ },
    getApiKey(credentials) { return credentials.access; },
  },
});
```

---

## 七、扩展与 Agent 的集成

### 7.1 集成点

扩展系统与 Agent 集成的关键点：

1. **AgentSession 构造函数**：初始化 ExtensionRunner
2. **_installAgentToolHooks**：安装工具调用钩子
3. **_emitExtensionEvent**：将 Agent 事件转换为扩展事件
4. **bindExtensions**：绑定扩展系统到会话

### 7.2 事件流转

```
Agent 事件流转
┌─────────────────────────────────────────────────────────────────┐
│ Agent Loop (packages/agent/src/agent-loop.ts)                   │
│  └─> 发出 AgentEvent                                           │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ AgentSession._handleAgentEvent (agent-session.ts)               │
│  └─> _emitExtensionEvent(event)                                │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ExtensionRunner.emit*(event)                                    │
│  └─> 遍历扩展，调用相应处理器                                   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展处理器 (Extension Handler)                                   │
│  └─> 执行扩展逻辑                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 工具执行流程

```
扩展工具执行流程
┌─────────────────────────────────────────────────────────────────┐
│ 1. Agent 循环检测到工具调用                                     │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. AgentSession._installAgentToolHooks 安装的钩子              │
│  └─> beforeToolCall: ExtensionRunner.emitToolCall()            │
│     └─> 扩展可以阻止或修改参数                                 │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. 工具执行                                                     │
│  └─> wrapper.ts 包装的工具被执行                                │
│     └─> 传入 ExtensionContext                                   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. AgentSession._installAgentToolHooks 安装的钩子              │
│  └─> afterToolCall: ExtensionRunner.emitToolResult()           │
│     └─> 扩展可以修改结果                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. 结果返回到 Agent 循环                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、扩展生命周期管理

### 8.1 生命周期阶段

```
扩展生命周期
├─ 加载阶段 (Loader)
│  ├─ 发现扩展
│  ├─ 创建 Extension 对象
│  └─ 调用扩展工厂函数
│
├─ 绑定阶段 (Runner)
│  ├─ bindCore() - 绑定核心动作
│  ├─ bindCommandContext() - 绑定命令上下文
│  └─ setUIContext() - 设置 UI 上下文
│
├─ 激活阶段
│  ├─ session_start 事件
│  └─ resources_discover 事件
│
├─ 运行阶段
│  ├─ 处理各种事件
│  ├─ 执行工具调用
│  └─ 响应用户命令
│
└─ 停用阶段
   ├─ session_shutdown 事件
   └─ 清理资源
```

### 8.2 上下文失效处理

扩展系统实现了**上下文失效机制**，防止在会话替换或重载后使用过时的上下文：

```typescript
invalidate(
  message = "This extension ctx is stale after session replacement or reload..."
): void {
  if (!this.staleMessage) {
    this.staleMessage = message;
    this.runtime.invalidate(message);
  }
}

private assertActive(): void {
  if (this.staleMessage) {
    throw new Error(this.staleMessage);
  }
}
```

**触发场景**：
- `ctx.newSession()` - 创建新会话后
- `ctx.fork()` - 分支后
- `ctx.switchSession()` - 切换会话后
- `ctx.reload()` - 重载扩展后

**正确用法**：

```typescript
// ❌ 错误：在 newSession 后使用旧的 ctx
const oldContext = ctx;
await ctx.newSession({ withSession: async (newCtx) => {
  // newCtx 是新的上下文
  oldContext.ui.notify("This will throw"); // 错误！
}});

// ✅ 正确：使用 withSession 提供的新上下文
await ctx.newSession({ withSession: async (newCtx) => {
  newCtx.ui.notify("This works"); // 正确！
}});
```

---

## 九、扩展 API (ExtensionAPI)

### 9.1 事件订阅 API

```typescript
// 订阅特定事件
pi.on("event_name", async (event, ctx) => {
  // 事件处理逻辑
});

// 可返回结果的订阅
pi.on("context", async (event, ctx) => {
  return { messages: modifiedMessages };
});
```

### 9.2 动作 API

```typescript
// 发送自定义消息
pi.sendMessage({
  customType: "my_type",
  content: { data: "value" },
  display: "Display text",
  details: { metadata: "value" },
});

// 发送用户消息
pi.sendUserMessage("Hello", { deliverAs: "followUp" });

// 追加自定义条目
pi.appendEntry("my_custom_type", { data: "value" });

// 设置会话名称
pi.setSessionName("My Session");

// 设置标签
pi.setLabel(entryId, "important");

// 执行 shell 命令
const result = await pi.exec("git", ["status"], { cwd: "/path" });

// 工具管理
const activeTools = pi.getActiveTools();
const allTools = pi.getAllTools();
pi.setActiveTools(["read", "bash", "my_tool"]);
pi.refreshTools(); // 刷新工具列表

// 命令管理
const commands = pi.getCommands();

// 模型管理
await pi.setModel(newModel);
const level = pi.getThinkingLevel();
pi.setThinkingLevel("high");

// 会话名称
const name = pi.getSessionName();

// 事件总线（扩展间通信）
pi.events.on("custom_event", (data) => { /* ... */ });
pi.events.emit("custom_event", { key: "value" });
```

### 9.3 Provider 管理 API

```typescript
// 注册 Provider
pi.registerProvider("my-provider", {
  name: "My Custom Provider",
  baseUrl: "https://api.example.com",
  apiKey: "$MY_API_KEY",           // 支持 $ENV_VAR / ${ENV_VAR} 内插
  api: "openai-completions",
  headers: { "X-Custom": "value" }, // 自定义请求头
  authHeader: true,                 // 自动添加 Authorization: Bearer
  models: [ /* ProviderModelConfig[] */ ],
});

// 只更新 baseUrl（不影响已有 models）
pi.registerProvider("anthropic", {
  baseUrl: "https://proxy.example.com",
});

// 取消注册 Provider（恢复内置 models）
pi.unregisterProvider("my-provider");
```

---

## 十、错误处理

### 10.1 错误监听

扩展系统提供了错误监听机制：

```typescript
runner.onError((error: ExtensionError) => {
  console.error(`Extension error from ${error.extensionPath}:`);
  console.error(`  Event: ${error.event}`);
  console.error(`  Error: ${error.error}`);
  if (error.stack) {
    console.error(`  Stack: ${error.stack}`);
  }
});
```

### 10.2 错误隔离

扩展系统实现了**错误隔离**：
- 单个扩展的错误不会影响其他扩展
- 错误会被捕获并通过 `emitError` 分发
- 事件处理继续进行，不会因一个扩展失败而中断

```typescript
try {
  const handlerResult = await handler(event, ctx);
  // 处理结果...
} catch (err) {
  this.emitError({
    extensionPath: ext.path,
    event: event.type,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
}
```

---

## 十一、扩展数据流

### 11.1 输入事件流

```
用户输入
  │
  ▼
emitInput (扩展可转换/拦截)
  │
  ├─ action: "handled" → 停止处理
  ├─ action: "transform" → 使用转换后的输入
  └─ action: "continue" → 使用原始输入
  │
  ▼
技能/模板扩展
  │
  ▼
emitBeforeAgentStart (扩展可修改 system prompt)
  │
  ▼
emitContext (扩展可修改上下文消息)
  │
  ▼
emitBeforeProviderRequest (扩展可修改 LLM 请求)
  │
  ▼
LLM 响应
```

### 11.2 工具调用流

```
LLM 发出工具调用
  │
  ▼
emitToolCall (扩展可阻止/修改)
  │
  ├─ block: true → 停止执行，返回错误
  └─ 继续执行
  │
  ▼
工具执行（扩展工具接收 ExtensionContext）
  │
  ▼
emitToolResult (扩展可修改结果)
  │
  ▼
结果返回给 LLM
```

---

## 十二、扩展开发最佳实践

### 12.1 扩展模板

```typescript
// my-extension.ts
import { Type } from "typebox";

export default function myExtension(pi) {
  // 注册工具
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Description for LLM",
    parameters: Type.Object({
      query: Type.String(),
    }),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      // 使用 ctx 访问会话状态
      const sessionName = ctx.sessionManager.getSessionName();

      // 使用 ctx.ui 与用户交互
      const confirmed = await ctx.ui.confirm("Confirm action?", "Details");

      if (!confirmed) {
        return { content: [{ type: "text", text: "Action cancelled" }] };
      }

      // 执行逻辑
      const result = await doSomething(params.query);

      return {
        content: [{ type: "text", text: `Result: ${result}` }],
        details: { metadata: "value" },
      };
    },
  });

  // 注册命令
  pi.registerCommand("my_command", {
    description: "My custom command",
    handler: async (args, ctx) => {
      // ctx 是 ExtensionCommandContext，有额外方法
      await ctx.waitForIdle();
      ctx.ui.notify("Command executed!");
    },
  });

  // 订阅事件
  pi.on("message_end", async (event, ctx) => {
    // 处理消息结束事件
  });
}
```

### 12.2 注意事项

1. **避免阻塞操作**：长时间运行的操作应该支持 AbortSignal
2. **错误处理**：始终使用 try-catch 包裹可能失败的代码
3. **资源清理**：使用 `session_shutdown` 事件清理资源
4. **上下文检查**：访问 `ctx` 属性会自动检查是否过时
5. **UI 可用性**：通过 `ctx.hasUI` 检查 UI 是否可用

### 12.3 调试技巧

```typescript
// 使用自定义消息进行调试
pi.appendEntry("debug", { message: "Debug info", value: someData });

// 使用通知进行调试
ctx.ui.notify("Debug point reached", "info");

// 使用 console.log（在开发模式下）
console.log("Debug:", someValue);
```

---

## 十三、关键设计总结

| 设计决策 | 原因 |
|---------|------|
| **事件驱动架构** | 解耦扩展与核心代码，支持灵活的生命周期注入 |
| **共享运行时** | 所有扩展共享同一个 ExtensionRuntime，减少内存开销 |
| **惰性上下文** | 使用 getter 而非对象展开，确保上下文值实时更新且可检查过时状态 |
| **错误隔离** | 单个扩展的错误不影响其他扩展和核心系统 |
| **工具包装** | 通过 wrapper.ts 适配扩展工具到 agent 核心，保持类型安全 |
| **热重载支持** | 通过 invalidate 机制防止使用过时上下文，支持运行时重载 |
| **分层事件分发** | 专用 emit 方法（如 emitToolCall）提供更强的类型安全 |
| **Provider 注册队列** | 在绑定前队列注册，绑定后立即生效，避免启动时序问题 |
| **Jiti 动态导入** | 支持 TypeScript 扩展在开发和生产环境中无缝工作 |
| **虚拟模块系统** | 在 Bun 二进制模式下提供预打包依赖，支持单文件分发 |
| **双层上下文** | `ExtensionContext`（事件处理）与 `ExtensionCommandContext`（命令处理）分离，后者额外提供 `waitForIdle`/`newSession`/`fork` 等仅在用户命令中安全的方法 |
| **无操作 UI 上下文** | 非交互模式下使用 `noOpUIContext` 作为默认 UI，确保 `ctx.ui.*` 方法在所有模式下都不抛出异常 |
| **before_agent_start 链式传递** | 多个扩展的 systemPrompt 修改会链式传递，每个扩展看到的结果是前面所有扩展修改的累积 |

---

## 十四、扩展系统流程图

### 14.1 完整扩展生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│ 扩展发现和加载                                                   │
│ 1. discoverAndLoadExtensions()                                  │
│ 2. 创建 ExtensionRuntime                                        │
│ 3. 为每个扩展创建 ExtensionAPI                                  │
│ 4. 调用扩展工厂函数                                              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展注册                                                         │
│ - pi.registerTool()                                            │
│ - pi.registerCommand()                                         │
│ - pi.registerShortcut()                                        │
│ - pi.registerFlag()                                            │
│ - pi.registerMessageRenderer()                                 │
│ - pi.on("event_name", handler)                                 │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展绑定 (bindExtensions)                                       │
│ 1. bindCore() - 绑定核心动作                                    │
│ 2. bindCommandContext() - 绑定命令上下文                        │
│ 3. setUIContext() - 设置 UI 上下文                              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展激活                                                         │
│ 1. emit("session_start")                                       │
│ 2. emitResourcesDiscover()                                     │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展运行期                                                       │
│ - 响应事件                                                      │
│ - 执行工具                                                      │
│ - 处理命令                                                      │
│ - 修改上下文/结果                                               │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 扩展停用                                                         │
│ 1. emit("session_shutdown")                                    │
│ 2. 清理资源                                                     │
│ 3. invalidate() - 标记上下文过时                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 14.2 事件分发流程

```
Agent 事件
    │
    ▼
┌───────────────────────────────────────────┐
│ AgentSession._emitExtensionEvent()        │
│  - 将 AgentEvent 转换为 ExtensionEvent    │
└───────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────┐
│ ExtensionRunner.emit*(event)             │
│  - 选择合适的 emit 方法                   │
│  - 专用方法: emitToolCall, emitMessageEnd │
│  - 通用方法: emit(event)                  │
└───────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────┐
│ 遍历扩展列表                              │
│  for (const ext of this.extensions)      │
└───────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────┐
│ 查找事件处理器                            │
│  handlers = ext.handlers.get(event.type)  │
└───────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────┐
│ 执行处理器                                │
│  for (const handler of handlers)         │
│    result = await handler(event, ctx)    │
└───────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────┐
│ 处理结果                                  │
│  - 可取消操作 (session_before_*)         │
│  - 可修改数据 (context, tool_result)      │
│  - 可替换消息 (message_end)               │
└───────────────────────────────────────────┘
    │
    ▼
继续下一个扩展或返回最终结果
```

---

## 十五、扩展系统与其他模块的交互

### 15.1 与 Agent 模块的交互

```
packages/agent (pi-agent-core)
├── Agent 类
│   └── beforeToolCall / afterToolCall 钩子
├── agentLoop 函数
│   └── transformContext / prepareNextTurn 配置
└── AgentEvent 类型
    └── 作为扩展事件的基础
```

### 15.2 与 AI 模块的交互

```
packages/ai (pi-ai)
├── streamSimple
│   └── 通过 beforeProviderRequest/afterProviderResponse 拦截
├── Model 类型
│   └── 通过 registerProvider 扩展
└── Context 类型
    └── 通过 context 事件修改
```

### 15.3 与 TUI 模块的交互

```
packages/tui (pi-tui)
├── 组件系统
│   └── 通过 ctx.ui 自定义渲染
├── 主题系统
│   └── 通过 ctx.ui.setTheme 扩展
└── 键盘处理
    └── 通过 registerShortcut 扩展
```

---

## 十六、总结

Pi Agent 的扩展系统是一个功能强大且设计优雅的插件架构：

1. **全面的事件覆盖**：29 个事件类型覆盖 agent 生命周期的各个阶段（session、agent、message、tool、model、input 等）
2. **灵活的注册机制**：支持工具、命令、快捷键、标志、渲染器、Provider 等多种扩展点，提供 `defineTool` 辅助函数保留类型推断
3. **类型安全**：TypeScript 类型系统确保扩展开发的类型检查，附带 `isToolCallEventType`、`isBashToolResult` 等类型守卫
4. **错误隔离**：单个扩展的错误不会影响整个系统
5. **热重载支持**：通过 `staleMessage` 机制和上下文惰性求值，支持运行时重新加载扩展
6. **Provider 扩展**：允许注册自定义的 LLM Provider，支持 OAuth 和自定义 streamSimple 处理器
7. **分层上下文**：区分 `ExtensionContext`（事件处理）和 `ExtensionCommandContext`（命令处理），后者额外提供 `waitForIdle`、`newSession`、`fork` 等会话控制方法
8. **多模式支持**：通过 `ExtensionMode`（tui/rpc/json/print）和无操作 UI 上下文（`noOpUIContext`）适配不同运行环境

扩展系统是 Pi Agent 可扩展性的核心，使得用户和开发者能够在不修改核心代码的情况下定制和增强 agent 的功能。
