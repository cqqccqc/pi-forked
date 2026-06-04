# Pi Agent 配置系统深度分析

## 目录

- [概述](#概述)
- [目录结构](#目录结构)
- [配置分层架构](#配置分层架构)
- [配置项完整列表](#配置项完整列表)
- [配置合并策略](#配置合并策略)
- [运行时更新机制](#运行时更新机制)
- [配置校验与默认值](#配置校验与默认值)
- [关键设计总结](#关键设计总结)

---

## 概述

Pi Agent 采用基于 JSON 文件的配置系统，支持全局（`~/.pi/`）和项目级（`.pi/`）双层配置架构。配置系统由核心类 `SettingsManager` 管理，负责配置的加载、合并、持久化和运行时更新。

**核心设计特点：**
- **分层配置**：全局配置与项目配置独立管理，项目配置覆盖全局配置
- **深度合并**：嵌套对象采用深度合并策略，而非简单替换
- **变更追踪**：追踪会话期间修改的字段，避免覆盖外部编辑
- **存储抽象**：通过 `SettingsStorage` 接口支持文件和内存两种存储后端
- **配置迁移**：自动处理旧版本配置格式到新格式的迁移

---

## 目录结构

### 全局配置目录 (~/.pi/)

```
~/.pi/
├── agent/                          # Agent 核心配置目录
│   ├── settings.json               # 全局设置（用户可编辑）
│   ├── auth.json                   # 认证信息（API keys 等）
│   ├── models.json                 # 模型注册表
│   ├── extensions/                 # 全局扩展目录
│   ├── skills/                     # 全局技能目录
│   ├── prompts/                    # 全局提示模板目录
│   ├── themes/                     # 全局主题目录
│   ├── tools/                      # 自定义工具目录
│   ├── npm/                        # 全局 npm 包安装目录
│   ├── sessions/                   # 会话存储目录
│   ├── bin/                        # 管理的二进制文件（fd, rg）
│   ├── SYSTEM.md                   # 全局系统提示词
│   ├── APPEND_SYSTEM.md            # 追加系统提示词
│   └── pi-debug.log                # 调试日志文件
└── ...                             # 其他配置（如旧版兼容文件）
```

### 项目配置目录 (.pi/)

```
.pi/                                # 项目根目录下的配置
├── settings.json                   # 项目级设置（覆盖全局设置）
├── extensions/                     # 项目扩展目录
├── skills/                         # 项目技能目录
├── prompts/                        # 项目提示模板目录
├── themes/                         # 项目主题目录
├── npm/                            # 项目 npm 包安装目录
├── sessions/                       # 项目会话存储（可选）
├── SYSTEM.md                       # 项目系统提示词（覆盖全局）
└── APPEND_SYSTEM.md                # 项目追加系统提示词
```

### 环境变量控制

| 环境变量 | 作用 |
|---------|------|
| `PI_CODING_AGENT_DIR` | 覆盖 Agent 目录路径（默认 `~/.pi/agent`） |
| `PI_CODING_AGENT_SESSION_DIR` | 覆盖会话目录路径 |
| `PI_SKIP_VERSION_CHECK` | 跳过版本检查 |
| `PI_OFFLINE` | 离线模式，禁用所有启动时网络操作 |
| `PI_PACKAGE_DIR` | 覆盖包资源目录路径（用于 Nix/Guix 等） |
| `PI_CLEAR_ON_SHRINK` | 终端内容收缩时清除空行 |
| `PI_HARDWARE_CURSOR` | 显示硬件光标 |
| `PI_SHARE_VIEWER_URL` | 覆盖会话分享查看器 URL（默认 `https://pi.dev/session/`） |

**环境变量常量定义：**
```typescript
// config.ts
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;
```

这些常量根据应用名称动态生成，允许不同的应用名称使用不同的环境变量。

**分享 URL 配置：**
```typescript
// config.ts
const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

export function getShareViewerUrl(gistId: string): string {
    const baseUrl = process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
    return `${baseUrl}#${gistId}`;
}
```

---

## 配置分层架构

```
┌──────────────────────────────────────────────────────────────┐
│                      SettingsManager                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              deepMergeSettings(base, overrides)        │  │
│  │  ┌──────────────┐           ┌──────────────┐          │  │
│  │  │ globalSettings│  merge   │projectSettings│          │  │
│  │  │ (~/.pi/agent/ │   --->   │  (./.pi/)     │          │  │
│  │  │  settings.json│           │ settings.json │          │  │
│  │  └──────────────┘           └──────────────┘          │  │
│  │            │                        │                   │  │
│  │            └────────────┬───────────┘                   │  │
│  │                         ▼                               │  │
│  │                    mergedSettings                       │  │
│  │                    (运行时配置)                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    存储抽象层                            │  │
│  │  ┌─────────────────────┐   ┌─────────────────────┐    │  │
│  │  │ FileSettingsStorage  │   │InMemorySettingsStorage│   │  │
│  │  │  (文件系统存储)       │   │   (内存存储/测试)      │   │  │
│  │  └─────────────────────┘   └─────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 加载流程

```
启动
  │
  ▼
┌─────────────────────────┐
│ 检测环境变量             │
│ PI_CODING_AGENT_DIR 等  │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 加载全局配置             │
│ ~/.pi/agent/settings.json│
│ (如果不存在则使用空对象)   │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 执行配置迁移             │
│ migrateSettings()       │
│ (queueMode->steeringMode)│
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 加载项目配置             │
│ .pi/settings.json       │
│ (如果不存在则使用空对象)   │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 深度合并配置             │
│ deepMergeSettings()     │
│ 项目覆盖全局             │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│   运行时配置可用         │
└─────────────────────────┘
```

---

## 配置项完整列表

### 模型与思考配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `defaultProvider` | string | - | 默认提供商（如 `"anthropic"`, `"openai"`） |
| `defaultModel` | string | - | 默认模型 ID |
| `defaultThinkingLevel` | string | - | 思考级别：`"off"\|"minimal"\|"low"\|"medium"\|"high"\|"xhigh"` |
| `hideThinkingBlock` | boolean | `false` | 隐藏输出中的思考块 |
| `thinkingBudgets` | object | - | 各思考级别的自定义 token 预算 |
| `enabledModels` | string[] | - | 模型模式列表（用于 Ctrl+P 循环切换） |

**`thinkingBudgets` 示例：**
```json
{
  "thinkingBudgets": {
    "minimal": 1024,
    "low": 4096,
    "medium": 10240,
    "high": 32768
  }
}
```

### UI 与显示配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `theme` | string | `"dark"` | 主题名称（`"dark"`, `"light"`, 或自定义） |
| `quietStartup` | boolean | `false` | 隐藏启动头部信息 |
| `collapseChangelog` | boolean | `false` | 更新后显示精简版变更日志 |
| `enableInstallTelemetry` | boolean | `true` | 发送匿名安装/更新版本 ping |
| `doubleEscapeAction` | string | `"tree"` | 双击 Escape 键行为：`"tree"\|"fork"\|"none"` |
| `treeFilterMode` | string | `"default"` | `/tree` 默认过滤器模式：`"default"\|"no-tools"\|"user-only"\|"labeled-only"\|"all"` |
| `editorPaddingX` | number | `0` | 输入编辑器水平内边距（0-3） |
| `autocompleteMaxVisible` | number | `5` | 自动完成下拉菜单最大可见项数（3-20） |
| `showHardwareCursor` | boolean | `false` | 显示终端光标 |

### 压缩配置 (Compaction)

控制对话历史自动压缩行为。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `compaction.enabled` | boolean | `true` | 启用自动压缩 |
| `compaction.reserveTokens` | number | `16384` | 为 LLM 响应预留的 token 数 |
| `compaction.keepRecentTokens` | number | `20000` | 保留的最近 token 数（不进行摘要） |

### 分支摘要配置 (Branch Summary)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `branchSummary.reserveTokens` | number | `16384` | 分支摘要预留 token 数 |
| `branchSummary.skipPrompt` | boolean | `false` | 跳过 `/tree` 导航时的"总结分支？"提示 |

### 重试配置 (Retry)

控制自动重试行为。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `retry.enabled` | boolean | `true` | 启用 agent 级自动重试 |
| `retry.maxRetries` | number | `3` | 最大 agent 级重试次数 |
| `retry.baseDelayMs` | number | `2000` | 指数退避基础延迟（2s, 4s, 8s） |
| `retry.provider.timeoutMs` | number | SDK 默认 | 提供商/SDK 请求超时（毫秒） |
| `retry.provider.maxRetries` | number | SDK 默认 | 提供商/SDK 重试次数 |
| `retry.provider.maxRetryDelayMs` | number | `60000` | 服务器请求的最大延迟（60s） |

### 消息传递配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `steeringMode` | string | `"one-at-a-time"` | steering 消息发送模式：`"all"\|"one-at-a-time"` |
| `followUpMode` | string | `"one-at-a-time"` | follow-up 消息发送模式：`"all"\|"one-at-a-time"` |
| `transport` | string | `"auto"` | 首选传输协议：`"sse"\|"websocket"\|"auto"` |
| `httpIdleTimeoutMs` | number | SDK 默认 | HTTP header/body 空闲超时（毫秒），0 表示禁用 |
| `websocketConnectTimeoutMs` | number | SDK 默认 | WebSocket 连接/打开握手的超时（毫秒），0 表示禁用 |

### 终端与图像配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `terminal.showImages` | boolean | `true` | 在终端中显示图像（如果支持） |
| `terminal.imageWidthCells` | number | `60` | 内联图像的首选宽度（终端单元格） |
| `terminal.clearOnShrink` | boolean | `false` | 内容收缩时清除空行（可能导致闪烁） |
| `terminal.showTerminalProgress` | boolean | `false` | OSC 9;4 终端进度指示器 |
| `images.autoResize` | boolean | `true` | 自动调整图像大小至 2000x2000 最大 |
| `images.blockImages` | boolean | `false` | 阻止所有图像发送到 LLM |

### Shell 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `shellPath` | string | - | 自定义 shell 路径（如 Windows 上的 Cygwin） |
| `shellCommandPrefix` | string | - | 每个 bash 命令的前缀（如 `"shopt -s expand_aliases"`） |
| `npmCommand` | string[] | - | npm 包查找/安装操作的命令 argv |

### HTTP 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `httpIdleTimeoutMs` | number | SDK 默认 | HTTP header/body 空闲超时（毫秒），0 表示禁用 |

**超时值验证：**
```typescript
// 超时值必须是非负有限数
if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`Invalid httpIdleTimeoutMs setting: ${timeoutMs}`);
}
```

**`npmCommand` 示例：**
```json
{
  "npmCommand": ["mise", "exec", "node@20", "--", "npm"]
}
```

### 会话配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `sessionDir` | string | - | 会话文件存储目录，支持绝对/相对路径和 `~` |

### Markdown 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `markdown.codeBlockIndent` | string | `"  "` | 代码块缩进 |

### 警告配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `warnings.anthropicExtraUsage` | boolean | `true` | 当 Anthropic 订阅认证可能使用付费额外使用量时显示警告 |

### 资源配置

定义从何处加载扩展、技能、提示模板和主题。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `packages` | PackageSource[] | `[]` | 从 npm/git 包加载资源 |
| `extensions` | string[] | `[]` | 本地扩展文件路径或目录 |
| `skills` | string[] | `[]` | 本地技能文件路径或目录 |
| `prompts` | string[] | `[]` | 本地提示模板路径或目录 |
| `themes` | string[] | `[]` | 本地主题文件路径或目录 |
| `enableSkillCommands` | boolean | `true` | 将技能注册为 `/skill:name` 命令 |

**`PackageSource` 类型：**
```typescript
type PackageSource =
  | string                           // 字符串形式：加载包中的所有资源
  | {
      source: string;                // 包名
      extensions?: string[];         // 要加载的扩展过滤
      skills?: string[];             // 要加载的技能过滤
      prompts?: string[];            // 要加载的提示过滤
      themes?: string[];             // 要加载的主题过滤
    };
```

---

## 配置合并策略

### 深度合并算法

```typescript
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
    const result: Settings = { ...base };

    for (const key of Object.keys(overrides) as (keyof Settings)[]) {
        const overrideValue = overrides[key];
        const baseValue = base[key];

        if (overrideValue === undefined) {
            continue;
        }

        // 对于嵌套对象，递归合并
        if (
            typeof overrideValue === "object" &&
            overrideValue !== null &&
            !Array.isArray(overrideValue) &&
            typeof baseValue === "object" &&
            baseValue !== null &&
            !Array.isArray(baseValue)
        ) {
            (result as Record<string, unknown>)[key] = {
                ...baseValue,
                ...overrideValue
            };
        } else {
            // 对于基本类型和数组，覆盖值优先
            (result as Record<string, unknown>)[key] = overrideValue;
        }
    }

    return result;
}
```

### 合并示例

**全局配置 (~/.pi/agent/settings.json)：**
```json
{
  "theme": "dark",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3
  }
}
```

**项目配置 (.pi/settings.json)：**
```json
{
  "compaction": {
    "reserveTokens": 8192
  },
  "defaultModel": "claude-opus-4-5"
}
```

**合并结果：**
```json
{
  "theme": "dark",                    // 来自全局
  "compaction": {
    "enabled": true,                  // 来自全局
    "reserveTokens": 8192             // 项目覆盖全局
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3                   // 来自全局
  },
  "defaultModel": "claude-opus-4-5"    // 来自项目
}
```

### 关键规则

1. **嵌套对象深度合并**：`compaction`、`retry`、`terminal`、`images` 等嵌套对象进行深度合并
2. **数组直接覆盖**：`packages`、`extensions`、`skills` 等数组类型直接被覆盖
3. **项目优先**：项目配置值优先于全局配置值
4. **undefined 跳过**：值为 `undefined` 的配置项不参与合并

---

## 配置值解析层 (resolve-config-value)

`resolve-config-value.ts` 是配置系统中的值解析层，负责将配置中的"引用值"解析为实际值。主要被 `auth-storage.ts`（API key）和 `model-registry.ts`（模型配置）使用。

### 支持的三种值类型

| 类型 | 语法 | 说明 | 示例 |
|------|------|------|------|
| **字面值** | 普通字符串 | 直接当作配置值使用 | `"sk-ant-api-xxx"` |
| **环境变量** | `$NAME` 或 `${NAME}` | 从环境变量中读取 | `"$OPENAI_API_KEY"` |
| **Shell 命令** | `!command` | 执行 shell 命令，使用 stdout 输出 | `"!gcloud auth print-access-token"` |

### 模板解析

配置值可以混合字面量和环境变量，构成模板：

```
"prefix-${USER}-suffix"  →  解析为 "prefix-chenqi44-suffix"
```

- `$$` 转义为字面量 `$`
- `$!` 转义为字面量 `!`
- 如果模板中任意环境变量未设置，整体解析返回 `undefined`
- Shell 命令（以 `!` 开头）不参与模板解析，整体作为命令执行

### shell 命令执行

命令执行逻辑（`executeCommandUncached`）：

- **非 Windows 平台**：使用 `child_process.execSync` 执行，10 秒超时
- **Windows 平台**：先尝试用用户配置的 shell（`shellPath`）执行；若配置的 shell 不存在（ENOENT），则回退到默认 shell（`cmd.exe`）
- 命令输出经 `trim()` 处理，空输出视为 `undefined`
- 命令执行失败（非零退出码、超时等）返回 `undefined`

### 命令结果缓存

命令执行结果在进程生命周期内缓存（`Map<string, string | undefined>`），避免重复执行代价高昂的外部命令（如 `gcloud auth print-access-token`）。

```typescript
const commandResultCache = new Map<string, string | undefined>();

function executeCommand(commandConfig: string): string | undefined {
    if (commandResultCache.has(commandConfig)) return commandResultCache.get(commandConfig);
    const result = executeCommandUncached(commandConfig);
    commandResultCache.set(commandConfig, result);
    return result;
}
```

提供 `clearConfigValueCache()` 导出函数用于测试场景清除缓存。

### 主要导出函数

| 函数 | 说明 |
|------|------|
| `resolveConfigValue(config)` | 解析配置值为实际值（带缓存） |
| `resolveConfigValueUncached(config)` | 解析配置值（不带缓存，用于 header） |
| `resolveConfigValueOrThrow(config, description)` | 解析配置值，失败时抛出详细错误 |
| `isCommandConfigValue(config)` | 判断配置值是否为 shell 命令 |
| `isConfigValueConfigured(config)` | 判断配置值是否可解析（所有环境变量均已设置） |
| `isLegacyEnvVarNameConfigValue(config)` | 判断配置值是否为全大写下划线格式（旧式环境变量名） |
| `getConfigValueEnvVarName(config)` | 提取配置值中引用的单个环境变量名 |
| `getMissingConfigValueEnvVarNames(config)` | 获取配置值中未设置的环境变量名列表 |
| `resolveHeaders(headers)` | 批量解析 header 值（跳过解析失败的 header） |
| `resolveHeadersOrThrow(headers, desc)` | 批量解析 header 值（任意失败则抛错） |
| `clearConfigValueCache()` | 清除命令缓存（测试用） |

### 使用场景

```
auth.json 中的 API key 字段
    │
    ▼
resolveConfigValue("!gcloud auth print-access-token")
    │
    ▼
执行 shell 命令，缓存结果，返回 access token
```

```
models.json 中的 header 值
    │
    ▼
resolveHeaders({ "X-API-Key": "$MY_API_KEY" })
    │
    ▼
从 process.env 读取 MY_API_KEY，构建 header 对象
```

---

## 运行时更新机制

### 变更追踪系统

SettingsManager 实现了精细的变更追踪，避免外部编辑被意外覆盖。

```typescript
class SettingsManager {
    // 追踪全局字段修改
    private modifiedFields = new Set<keyof Settings>();
    private modifiedNestedFields = new Map<keyof Settings, Set<string>>();

    // 追踪项目字段修改
    private modifiedProjectFields = new Set<keyof Settings>();
    private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>();
}
```

### 保存流程

```
用户调用 setter (如 setTheme())
         │
         ▼
标记字段为已修改
         │
         ▼
┌─────────────────────────────────────┐
│ save() 或 saveProjectSettings()     │
│ 1. 创建内存快照                      │
│ 2. 仅写入修改的字段到文件            │
│ 3. 未修改字段保留文件原值            │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ withLock() 获取文件锁                │
│ 1. 读取当前文件内容                  │
│ 2. 合并内存修改与文件现有值          │
│ 3. 写入合并后的完整 JSON            │
└─────────────────────────────────────┘
         │
         ▼
    释放文件锁
```

### 外部编辑保护

**问题场景（已修复）：**
1. Pi 启动时加载 `packages: ["npm:some-pkg"]`
2. 用户外部编辑文件改为 `packages: []`
3. 用户通过 UI 修改无关设置（如 theme）
4. 旧实现会覆盖 `packages` 回启动值

**修复机制：**
- 追踪会话期间**显式修改**的字段
- 保存时仅写入修改的字段，保留文件中其他字段的当前值
- 嵌套字段支持精确追踪（如 `compaction.enabled`）

### 异步写入队列

```typescript
private writeQueue: Promise<void> = Promise.resolve();

private enqueueWrite(
    scope: SettingsScope,
    task: () => void
): void {
    this.writeQueue = this.writeQueue
        .then(() => {
            task();
            this.clearModifiedScope(scope);
        })
        .catch((error) => {
            this.recordError(scope, error);
        });
}
```

- 所有写入操作进入队列顺序执行
- 支持 `flush()` 等待所有写入完成
- 错误被记录但不中断队列

### 热重载

```typescript
async reload(): Promise<void> {
    await this.writeQueue;

    // 重新加载全局和项目配置
    const globalLoad = SettingsManager.tryLoadFromStorage(this.storage, "global");
    const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project");

    // 清除修改追踪
    this.modifiedFields.clear();
    this.modifiedNestedFields.clear();

    // 重新合并
    this.settings = deepMergeSettings(this.globalSettings, this.projectSettings);
}
```

---

## 配置校验与默认值

### 类型安全

所有配置项通过 TypeScript 接口定义类型：

```typescript
export interface Settings {
    lastChangelogVersion?: string;
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    // ... 更多配置项
}
```

### 默认值处理

配置系统采用"getter 带默认值"模式：

```typescript
getCompactionEnabled(): boolean {
    return this.settings.compaction?.enabled ?? true;
}

getImageWidthCells(): number {
    const width = this.settings.terminal?.imageWidthCells;
    if (typeof width !== "number" || !Number.isFinite(width)) {
        return 60;
    }
    return Math.max(1, Math.floor(width));
}
```

### 数值范围校验

```typescript
setEditorPaddingX(padding: number): void {
    this.globalSettings.editorPaddingX = Math.max(0, Math.min(3, Math.floor(padding)));
    this.markModified("editorPaddingX");
    this.save();
}

setAutocompleteMaxVisible(maxVisible: number): void {
    this.globalSettings.autocompleteMaxVisible = Math.max(3, Math.min(20, Math.floor(maxVisible)));
    this.markModified("autocompleteMaxVisible");
    this.save();
}
```

### 路径扩展

路径扩展现在使用统一的 `normalizePath()` 函数处理：

```typescript
// getSessionDir() 使用 normalizePath() 自动处理 ~ 展开
getSessionDir(): string | undefined {
    const sessionDir = this.settings.sessionDir;
    return sessionDir ? normalizePath(sessionDir) : sessionDir;
}
```

**`normalizePath()` 函数完整选项：**

```typescript
export interface PathInputOptions {
  /** 在规范化前修剪前导/尾随空格 */
  trim?: boolean;
  /** 展开前导 `~` 为主目录。默认 true。 */
  expandTilde?: boolean;
  /** 用于 `~` 展开的主目录。默认 os.homedir()。 */
  homeDir?: string;
  /** 去除前导 `@`，用于 CLI @file 路径。 */
  stripAtPrefix?: boolean;
  /** 将 unicode 空格变体规范化为常规空格。 */
  normalizeUnicodeSpaces?: boolean;
}
```

支持的功能：
- `~` 展开为用户主目录
- `~/path` 展开为用户主目录下的路径
- `file://` URL 转换为文件系统路径
- Unicode 空格字符规范化（`  -   　`）
- 可选的前导 `@` 去除（用于 CLI @file 路径）
- 自定义主目录支持

### 配置迁移

自动处理旧配置格式：

```typescript
private static migrateSettings(settings: Record<string, unknown>): Settings {
    // queueMode -> steeringMode
    if ("queueMode" in settings && !("steeringMode" in settings)) {
        settings.steeringMode = settings.queueMode;
        delete settings.queueMode;
    }

    // websockets boolean -> transport enum
    if (!("transport" in settings) && typeof settings.websockets === "boolean") {
        settings.transport = settings.websockets ? "websocket" : "sse";
        delete settings.websockets;
    }

    // skills object -> array format
    if ("skills" in settings && typeof settings.skills === "object" && !Array.isArray(settings.skills)) {
        // 迁移 enableSkillCommands 和 customDirectories...
    }

    // retry.maxDelayMs -> retry.provider.maxRetryDelayMs
    if ("retry" in settings && typeof settings.retry === "object") {
        const retrySettings = settings.retry as Record<string, unknown>;
        if (typeof retrySettings.maxDelayMs === "number") {
            retrySettings.provider = {
                ...(retrySettings.provider ?? {}),
                maxRetryDelayMs: retrySettings.maxDelayMs,
            };
        }
        delete retrySettings.maxDelayMs;
    }

    return settings as Settings;
}
```
    if ("skills" in settings && typeof settings.skills === "object" && !Array.isArray(settings.skills)) {
        // 迁移逻辑...
    }

    return settings as Settings;
}
```

---

## 关键设计总结

| 设计方面 | 实现方式 | 优势 |
|---------|---------|------|
| **分层配置** | 全局 + 项目双层架构 | 支持个性化项目配置，保留全局默认 |
| **深度合并** | 嵌套对象递归合并 | 细粒度覆盖，无需重复全部配置 |
| **变更追踪** | 字段级修改追踪 | 保护外部编辑，避免意外覆盖 |
| **存储抽象** | SettingsStorage 接口 | 支持文件/内存存储，便于测试 |
| **异步写入** | 队列化写入 + 文件锁 | 防止并发冲突，保证数据一致性 |
| **配置迁移** | 自动版本迁移 | 向后兼容，平滑升级 |
| **类型安全** | TypeScript + 运行时校验 | 编译时检查 + 运行时保护 |
| **热重载** | reload() 方法 | 支持运行时更新配置 |
| **错误处理** | drainErrors() 模式 | 非阻塞错误收集，不中断启动 |

### 配置系统数据流

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  文件系统      │     │ Settings     │     │   应用层      │
│  settings.json│────▶│ Manager      │────▶│  getter/setter│
└──────────────┘     └──────────────┘     └──────────────┘
                            ▲                       │
                            │                       │
                            └───────────────────────┘
                          reload() / save()

┌─────────────────────────────────────────────────────────────┐
│                    配置系统特性                              │
├─────────────────────────────────────────────────────────────┤
│ • 文件锁 (proper-lockfile) 防止并发写入                      │
│ • 变更追踪保护外部编辑                                       │
│ • 嵌套字段精确追踪 (如 compaction.enabled)                  │
│ • 异步写入队列不阻塞 UI                                      │
│ • 错误收集不中断启动                                         │
│ • InMemorySettingsStorage 用于单元测试                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 代码位置参考

| 组件 | 文件路径 |
|-----|---------|
| SettingsManager | `packages/coding-agent/src/core/settings-manager.ts` |
| 路径常量 | `packages/coding-agent/src/config.ts` |
| 路径工具函数 | `packages/coding-agent/src/utils/paths.ts` |
| 配置值解析 | `packages/coding-agent/src/core/resolve-config-value.ts` |
| 资源加载器 | `packages/coding-agent/src/core/resource-loader.ts` |
| 单元测试 | `packages/coding-agent/test/settings-manager.test.ts` |
| Bug 测试 | `packages/coding-agent/test/settings-manager-bug.test.ts` |
| 文档 | `packages/coding-agent/docs/settings.md` |

### 路径工具函数 (utils/paths.ts)

路径工具函数提供统一的路径处理能力：

| 函数 | 说明 |
|-----|------|
| `normalizePath(input, options)` | 规范化路径，支持 `~` 展开、Unicode 空格处理、`file://` URL 转换、自定义选项 |
| `resolvePath(input, baseDir, options)` | 解析相对路径为绝对路径，基于 baseDir |
| `canonicalizePath(path)` | 获取规范路径（解析符号链接），失败时返回原路径 |
| `isLocalPath(value)` | 判断是否为本地路径（非 `npm:`/`git:`/`http:` 等） |
| `getCwdRelativePath(filePath, cwd)` | 获取相对于 CWD 的路径（如果在 CWD 内） |
| `formatPathRelativeToCwdOrAbsolute(filePath, cwd)` | 格式化为相对路径或绝对路径（始终使用 `/` 分隔符） |
| `markPathIgnoredByCloudSync(path)` | 标记文件被云同步忽略（macOS/Linux: Dropbox/xattr） |

**PathInputOptions 选项：**

```typescript
export interface PathInputOptions {
  trim?: boolean;                      // 修剪前导/尾随空格
  expandTilde?: boolean;               // 展开 ~ 主目录（默认 true）
  homeDir?: string;                    // 自定义主目录
  stripAtPrefix?: boolean;             // 去除前导 @
  normalizeUnicodeSpaces?: boolean;    // 规范化 unicode 空格
}
```
