# System Prompt 动态构建机制分析

## 概述

pi agent 的 system prompt 采用了模块化、分层构建的设计，支持多源上下文注入、工具动态发现、技能热加载等特性。整个构建流程通过 `buildSystemPrompt()` 函数实现，位于 `packages/coding-agent/src/core/system-prompt.ts`。

## 核心数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                         System Prompt 构建流程                        │
└─────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │ ResourceLoader │
                              └───────┬──────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│  ContextFiles │           │    Skills     │           │   Extensions  │
│               │           │               │           │               │
│ - AGENTS.md   │           │ - ~/.pi/skills│           │ - ToolDefs    │
│ - CLAUDE.md   │           │ - .pi/skills  │           │ - Prompts     │
│ (祖先目录遍历) │           │               │           │ - Overrides   │
└───────┬───────┘           └───────┬───────┘           └───────┬───────┘
        │                           │                             │
        └───────────────────────────┼─────────────────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │ BuildSystemPrompt │
                          │   Options        │
                          └─────────┬─────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│  基础 Prompt   │           │  工具 Snippets │           │  动态信息     │
│               │           │               │           │               │
│ - 默认指令     │           │ - promptSnippet│           │ - 当前日期    │
│ - 或自定义     │           │ - guidelines  │           │ - 工作目录    │
│   SYSTEM.md   │           │ (从ToolDef)   │           │               │
└───────┬───────┘           └───────┬───────┘           └───────┬───────┘
        │                           │                           │
        └───────────────────────────┼─────────────────────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │  最终 System      │
                          │  Prompt          │
                          └──────────────────┘
```

## 核心组件分析

### 1. ResourceLoader 资源加载器

**位置**: `packages/coding-agent/src/core/resource-loader.ts`

ResourceLoader 是资源发现的中央协调器，负责从多个来源加载各类资源：

```typescript
export interface ResourceLoader {
  getExtensions(): LoadExtensionsResult;
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  extendResources(paths: ResourceExtensionPaths): void;
  reload(): Promise<void>;
}
```

**资源发现路径优先级**：
1. **项目本地**: `<cwd>/.pi/{skills,prompts,themes,extensions}/`
2. **用户全局**: `~/.pi/{skills,prompts,themes,extensions}/`
3. **包依赖**: 通过 `package.json` 的 `pi` 字段声明
4. **CLI 参数**: 命令行显式指定的路径
5. **扩展注入**: 扩展运行时动态提供的资源

### 2. Context Files 上下文文件加载

**发现机制** (`loadProjectContextFiles`):

```typescript
// 从当前目录向上遍历至根目录
let currentDir = resolvedCwd;
const root = resolve("/");

while (true) {
  // 尝试加载上下文文件
  const contextFile = loadContextFileFromDir(currentDir);
  if (contextFile && !seenPaths.has(contextFile.path)) {
    ancestorContextFiles.unshift(contextFile);  // 祖先目录前置
    seenPaths.add(contextFile.path);
  }

  if (currentDir === root) break;
  currentDir = resolve(currentDir, "..");
}
```

**文件名优先级**:
1. `AGENTS.md` / `AGENTS.MD` / `CLAUDE.md` / `CLAUDE.MD`
2. 扫描顺序按候选列表顺序，找到第一个即返回

**加载顺序**:
1. 全局上下文: `~/.pi/AGENTS.md` 或 `~/.pi/CLAUDE.md`
2. 祖先目录上下文: 从根目录到当前目录（按发现逆序，即越接近当前目录越靠后）
3. 当前目录上下文: `<cwd>/AGENTS.md` 或 `<cwd>/CLAUDE.md`

### 3. Skills 技能系统

**位置**: `packages/coding-agent/src/core/skills.ts`

技能是可复用的指令块，遵循 Agent Skills 规范。

**发现规则**:
```
目录包含 SKILL.md → 技能根目录（不递归，以该目录为 baseDir）
目录不包含 SKILL.md → 加载直接 .md 子文件，递归子目录
```

**Skill 接口定义**:
```typescript
export interface Skill {
  name: string;                    // 技能名称（来自 frontmatter.name 或父目录名）
  description: string;             // 技能描述（必需）
  filePath: string;                // SKILL.md 文件的绝对路径
  baseDir: string;                 // 技能根目录（SKILL.md 的父目录）
  sourceInfo: SourceInfo;          // 来源信息
  disableModelInvocation: boolean; // 是否禁止模型自动调用
}
```

**`disableModelInvocation` 属性**:
- 设置为 `true` 时，该技能不会出现在 system prompt 的 `<available_skills>` 列表中
- 模型无法自动发现和调用该技能
- 用户仍可通过 `/skill:name` 命令显式调用
- 适用于需要用户明确授权的敏感操作或低频工具

**验证规范**:
```typescript
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

function validateName(name: string): string[] {
  // 仅允许小写字母、数字、连字符
  if (!/^[a-z0-9-]+$/.test(name)) {
    return ["name contains invalid characters"];
  }
  // 不能以连字符开头或结尾
  // 不能包含连续连字符
}
```

**Prompt 格式化**:
```typescript
export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

  return `
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>${escapeXml(skill.name)}</name>
    <description>${escapeXml(skill.description)}</description>
    <location>${escapeXml(skill.filePath)}</location>
  </skill>
  ...
</available_skills>`;
}
```

### 4. Prompt Templates 提示词模板

**位置**: `packages/coding-agent/src/core/prompt-templates.ts`

提示词模板系统支持可重用的提示词片段，可通过 `/template-name` 语法引用。

**模板接口定义**:
```typescript
export interface PromptTemplate {
  name: string;           // 模板名称（文件名，不含 .md）
  description: string;    // 模板描述（来自 frontmatter 或首行）
  argumentHint?: string;  // 参数提示（来自 frontmatter.argument-hint）
  content: string;        // 模板内容（markdown body）
  sourceInfo: SourceInfo; // 来源信息
  filePath: string;       // 模板文件的绝对路径
}
```

**参数替换语法**:
模板内容支持以下占位符进行参数替换：
- `$1`, `$2`, ... - 按位置引用参数
- `$@` 或 `$ARGUMENTS` - 所有参数拼接
- `${@:N}` - 从第 N 个参数开始的所有参数（bash 风格切片）
- `${@:N:L}` - 从第 N 个参数开始的 L 个参数

**参数解析规则**:
```typescript
// 解析命令行参数（支持引号包裹的含空格参数）
parseCommandArgs('/template "arg with spaces" arg2')
// → ['arg with spaces', 'arg2']

// 参数替换示例
substituteArgs('Hello $1, welcome to $2', ['Alice', 'Wonderland'])
// → "Hello Alice, welcome to Wonderland"

substituteArgs('Args: ${@:2}', ['a', 'b', 'c', 'd'])
// → "Args: b c d" (从第2个参数开始)
```

**模板发现路径**:
1. 全局模板: `~/.pi/prompts/`
2. 项目模板: `<cwd>/.pi/prompts/`
3. CLI 显式指定的路径

**模板展开**:
```typescript
expandPromptTemplate('/review $1', templates)
// → 查找名为 "review" 的模板，将 $1 替换为传入的参数
```

### 5. Tools 工具说明生成

**位置**: `packages/coding-agent/src/core/tools/*.ts`

每个工具定义包含：
- `description`: 完整功能描述
- `promptSnippet`: 单行工具摘要（用于 system prompt）
- `promptGuidelines`: 使用指南列表

**示例** (read tool):
```typescript
{
  label: "read",
  description: "Read the contents of a file...",
  promptSnippet: "Read file contents",
  promptGuidelines: ["Use read to examine files instead of cat or sed."],
  parameters: readSchema,
}
```

**Prompt 拼接**:
```typescript
// 从 ToolDefinition 提取
const toolSnippets: Record<string, string> = {};
const promptGuidelines: string[] = [];

for (const name of validToolNames) {
  const snippet = this._toolPromptSnippets.get(name);
  if (snippet) toolSnippets[name] = snippet;

  const toolGuidelines = this._toolPromptGuidelines.get(name);
  if (toolGuidelines) promptGuidelines.push(...toolGuidelines);
}

// 生成工具列表
const toolsList = visibleTools
  .map((name) => `- ${name}: ${toolSnippets![name]}`)
  .join("\n");
```

### 6. 扩展系统集成

**位置**: `packages/coding-agent/src/core/extensions/`

扩展可以通过以下方式修改 system prompt:

1. **BeforeAgentStartEvent**:
```typescript
interface BeforeAgentStartEvent {
  buildSystemPrompt(options: BuildSystemPromptOptions): string;
  // 扩展可拦截并修改 options
}
```

2. **自定义工具注入**:
```typescript
// 扩展注册工具
ctx.registerTool({
  name: "myTool",
  promptSnippet: "Custom tool description",
  promptGuidelines: ["Custom guideline"],
  // ...
});
// 工具自动进入 system prompt
```

3. **资源覆盖**:
```typescript
// ResourceLoader 支持扩展覆盖
extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
skillsOverride?: (base: {...}) => {...};
systemPromptOverride?: (base: string | undefined) => string | undefined;
```

### 7. 动态信息注入

**日期格式化**:
```typescript
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
// 输出: "Current date: 2026-05-22"
```

**工作目录**:
```typescript
const promptCwd = resolvedCwd.replace(/\\/g, "/"); // Windows 兼容
// 输出: "Current working directory: /Users/user/project"
```

### 8. System Prompt 完整结构

```
[基础指令]
↓
[可用工具列表] (仅包含有 snippet 的工具)
↓
[Pi 文档路径] (readme, docs, examples)
↓
[扩展附加内容] (appendSystemPrompt)
↓
[项目上下文] (<project_context>标签)
  - AGENTS.md / CLAUDE.md (全局)
  - AGENTS.md / CLAUDE.md (祖先目录)
  - AGENTS.md / CLAUDE.md (当前目录)
↓
[技能列表] (<available_skills>标签)
  - 仅包含 disableModelInvocation=false 的技能
↓
[动态信息]
  - 当前日期
  - 工作目录
```

## Token 管理策略

### 上下文估算

pi agent 使用启发式方法估算 token 使用：

**位置**: `packages/coding-agent/src/core/compaction/`

```typescript
// 粗略估算: 1 token ≈ 4 字符
export function estimateContextTokens(messages: Message[]): number {
  // 实现略...
}

// 计算精确使用量
export async function calculateContextTokens(
  model: Model<any>,
  messages: Message[]
): Promise<number> {
  // 使用模型的 token counting API
}
```

### 压缩触发条件

```typescript
// 自动压缩阈值
const AUTO_COMPACT_THRESHOLD = 0.8; // 80% 上下文窗口

// 溢出检测
export function isContextOverflow(usage: ContextUsage): boolean {
  return usage.tokens !== null && usage.tokens > usage.contextWindow;
}
```

### 压缩时 Prompt 处理

压缩过程中，工具结果会被截断：
```typescript
const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... truncated]`;
}
```

## 配置系统交互

### SYSTEM.md 自定义

**发现顺序**:
1. `<cwd>/.pi/SYSTEM.md`
2. `~/.pi/SYSTEM.md`

```typescript
private discoverSystemPromptFile(): string | undefined {
  const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
  if (existsSync(projectPath)) return projectPath;

  const globalPath = join(this.agentDir, "SYSTEM.md");
  if (existsSync(globalPath)) return globalPath;

  return undefined;
}
```

### APPEND_SYSTEM.md 附加内容

**发现顺序**:
1. `<cwd>/.pi/APPEND_SYSTEM.md`
2. `~/.pi/APPEND_SYSTEM.md`

```typescript
// 支持多个 append 来源拼接
const appendSources = [
  this.discoverAppendSystemPromptFile(),
  // ... 其他来源
].filter(Boolean);
const appendSystemPrompt = appendSources.join("\n\n");
```

## 关键设计总结

| 特性 | 实现方式 | 文件位置 |
|------|----------|----------|
| **多源上下文加载** | 祖先目录遍历 + 全局/项目优先级 | `resource-loader.ts:loadProjectContextFiles` |
| **工具动态发现** | ToolDefinition 注册 + snippet 提取 | `agent-session.ts:_rebuildSystemPrompt` |
| **技能热加载** | SKILL.md 约定 + frontmatter 解析 + ignore 文件支持 | `skills.ts:loadSkillsFromDir` |
| **提示词模板** | 参数替换语法 + 路径发现 | `prompt-templates.ts:loadPromptTemplates` |
| **扩展集成** | BeforeAgentStartEvent + 资源覆盖钩子 | `extensions/runner.ts` |
| **日期/目录注入** | 格式化后拼接到 prompt 末尾 | `system-prompt.ts:buildSystemPrompt` |
| **Token 管理** | 启发式估算 + 精确计算 + 压缩触发 | `compaction/utils.ts` |
| **自定义覆盖** | SYSTEM.md 完全替换 / APPEND 追加 | `resource-loader.ts:discover*PromptFile` |

## 使用示例

### 添加项目级指令

创建 `.pi/INSTRUCTIONS.md` (会自动作为上下文加载):

```markdown
# 项目特定约定

- 始终使用 TypeScript strict 模式
- 组件放在 `src/components/` 目录
- 遵循 Git Flow 分支策略
```

### 创建自定义技能

创建 `.pi/skills/review/SKILL.md`:

```markdown
---
name: code-review
description: 执行代码审查，检查安全性、性能和可维护性
disable-model-invocation: false
---

# 代码审查指南

1. 安全检查: SQL 注入、XSS、认证缺失
2. 性能检查: N+1 查询、内存泄漏
3. 可维护性: 命名、模块化、文档

输出格式:
- [问题类型] 文件:行号 - 描述
```

### 使用 Prompt Templates

创建 `.pi/prompts/review.md`:

```markdown
---
description: 代码审查提示词模板
argument-hint: <file-path> <review-type>
---

请对 $1 进行 $2 审查：

1. 安全性检查
2. 性能分析
3. 代码规范

关注点: ${@:2}
```

使用方式: `/review src/app.ts security performance`

### 覆盖 System Prompt

创建 `.pi/SYSTEM.md`:

```markdown
You are a senior TypeScript engineer specializing in React applications.
...
```

### 附加额外指令

创建 `.pi/APPEND_SYSTEM.md`:

```markdown
## 额外约束

- 优先使用函数组件而非类组件
- 使用 Tailwind CSS 进行样式处理
```

## 扩展开发指南

### 修改 Prompt

```typescript
export default createExtension({
  async setup(ctx) {
    ctx.events.on('beforeAgentStart', async (event) => {
      event.options.customPrompt = `
        ${event.options.customPrompt}

        扩展特定: 始终在提交前运行测试套件。
      `;
    });
  }
});
```

### 注册自定义工具

```typescript
ctx.registerTool({
  name: 'dbQuery',
  promptSnippet: 'Execute database queries',
  promptGuidelines: [
    'Prepared statements only',
    'Limit results to 100 rows'
  ],
  parameters: Type.Object({
    sql: Type.String()
  }),
  async execute(input) {
    // 实现...
  }
});
```

## 总结

pi agent 的 system prompt 构建系统具有以下特点：

1. **模块化**: 上下文、技能、工具、扩展各司其职
2. **分层发现**: 从全局到项目到扩展，优先级明确
3. **动态热加载**: 资源变更时无需重启
4. **可扩展**: 扩展可深度参与 prompt 构建流程
5. **Token 感知**: 自动压缩避免上下文溢出

这种设计使得 pi agent 既保持了核心指令的稳定性，又支持用户和扩展的灵活定制。
