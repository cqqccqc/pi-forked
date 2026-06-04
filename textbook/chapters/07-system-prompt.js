/**
 * 第7章：System Prompt — Agent 的规则书
 *
 * 深入理解 System Prompt 如何动态构建——从多个来源收集上下文、
 * 注入规则和技能、格式化工具列表，最终组装成 Agent 的行为规范。
 */
window.__chapters = window.__chapters || [];
window.__chapters.push({
  id: 7,
  title: 'System Prompt：给 Agent 设定行为规则',
  desc: '理解 System Prompt 如何动态构建——从多个来源收集上下文、注入规则和技能，最终组装成 Agent 的行为规范。',

  objectives: [
    '理解 System Prompt 的作用——Agent 的"员工手册"',
    '掌握 buildSystemPrompt() 的动态构建流程',
    '了解 ResourceLoader 的多源资源加载机制',
    '理解 CLAUDE.md / AGENTS.md 的注入机制',
    '了解 Skills 技能系统和 Prompt Templates 模板系统',
  ],

  render(container) {
    // === Section 1:
    const s0 = document.createElement('div');
    s0.className = 'content-section';
    s0.innerHTML = `
      <h2>7.1 System Prompt 是什么</h2>
      <p>每个 Agent 在开始工作前，都需要知道三件事：<strong>它是谁、能做什么、该怎么做</strong>。</p>

      <div class="info-card">
        <h4>📋 System Prompt = Agent 的"员工手册"</h4>
        <p>就像新员工入职时会拿到一本员工手册——上面写着公司的规章制度、工作流程、注意事项——System Prompt 就是给 LLM 的"入职手册"。它在每次对话开始时，作为第一条消息发送给 LLM。</p>
      </div>

      <p>System Prompt 里包含了什么？来看看 Pi Agent 实际生成的 System Prompt 结构：</p>
      <table class="content-table">
        <tr><th>组成部分</th><th>内容</th><th>来源</th></tr>
        <tr><td>身份定义</td><td>"You are an expert coding assistant..."</td><td>默认模板 或 SYSTEM.md</td></tr>
        <tr><td>可用工具</td><td>read、bash、edit、write 等工具列表</td><td>ToolDefinition 的 promptSnippet</td></tr>
        <tr><td>使用指南</td><td>"Be concise in your responses" 等</td><td>默认规则 + promptGuidelines</td></tr>
        <tr><td>项目上下文</td><td>CLAUDE.md / AGENTS.md 内容</td><td>多级目录发现</td></tr>
        <tr><td>可用技能</td><td>技能名称和描述列表</td><td>.pi/skills/ 目录</td></tr>
        <tr><td>动态信息</td><td>当前日期、工作目录</td><td>运行时计算</td></tr>
      </table>

      <p>所有这些内容不是写死的，而是<strong>在每次 Agent 启动时动态组装</strong>的。这就是 System Prompt 构建系统的核心价值。</p>
    `;
    container.appendChild(s0);

    // === Section 2:
    const s1 = document.createElement('div');
    s1.className = 'content-section';
    s1.innerHTML = `
      <h2>7.2 多源输入：System Prompt 的原材料</h2>
      <p>System Prompt 的原材料来自多个独立来源，每个来源专注于一类信息：</p>

      <h3>7.2.1 CLAUDE.md / AGENTS.md —— 项目说明书</h3>
      <p>这是最重要的上下文来源。Pi Agent 会从<strong>当前目录向上遍历到根目录</strong>，收集所有遇到的 CLAUDE.md 或 AGENTS.md 文件：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/resource-loader.ts</span></div>
        <pre><code class="language-typescript">function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
  const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
  for (const filename of candidates) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      return { path: filePath, content: readFileSync(filePath, "utf-8") };
    }
  }
  return null;
}</code></pre>
      </div>

      <p>加载顺序遵循严格的优先级：</p>
      <div class="step-list">
        <li>
          <h4>全局上下文</h4>
          <p><code>~/.pi/AGENTS.md</code> 或 <code>~/.pi/CLAUDE.md</code> —— 适用于所有项目的通用规则</p>
        </li>
        <li>
          <h4>祖先目录上下文</h4>
          <p>从根目录到当前目录，按发现顺序排列。越接近当前目录的越靠后（优先级越高）</p>
        </li>
        <li>
          <h4>当前目录上下文</h4>
          <p><code>&lt;cwd&gt;/AGENTS.md</code> 或 <code>&lt;cwd&gt;/CLAUDE.md</code> —— 当前项目的特定规则</p>
        </li>
      </div>

      <h3>7.2.2 SYSTEM.md —— 完全自定义</h3>
      <p>如果你想让 Agent 扮演完全不同的角色，可以在项目或全局目录创建一个 <code>SYSTEM.md</code>。这会<strong>完全替换</strong>默认的 System Prompt。</p>
      <p>发现路径（按优先级）：<code>.pi/SYSTEM.md</code> → <code>~/.pi/SYSTEM.md</code></p>

      <h3>7.2.3 APPEND_SYSTEM.md —— 追加指令</h3>
      <p>如果你只想<strong>追加</strong>指令而不是替换，使用 <code>APPEND_SYSTEM.md</code>。内容会被追加到 System Prompt 的末尾。</p>

      <h3>7.2.4 Skills —— 可加载的专业技能</h3>
      <p>Skills 是存放在 <code>.pi/skills/</code> 或 <code>~/.pi/skills/</code> 目录中的 Markdown 文件。每个 Skill 有自己的 frontmatter 描述，LLM 可以根据任务描述决定是否加载它。</p>
      <p>后面 7.4 节会详细讲解 Skills 机制。</p>

      <h3>7.2.5 Extensions —— 扩展注入</h3>
      <p>扩展可以在 <code>before_agent_start</code> 事件中修改 System Prompt，或者通过注册工具时的 <code>promptSnippet</code> 和 <code>promptGuidelines</code> 间接影响它。</p>
    `;
    container.appendChild(s1);

    // === Section 3:
    const s2 = document.createElement('div');
    s2.className = 'content-section';
    s2.innerHTML = `
      <h2>7.3 buildSystemPrompt()：组装流水线</h2>
      <p>所有原材料最终在 <code>buildSystemPrompt()</code> 函数中组装。它的核心签名如下：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/system-prompt.ts</span></div>
        <pre><code class="language-typescript">export interface BuildSystemPromptOptions {
  customPrompt?: string;             // 自定义 System Prompt（替换默认）
  selectedTools?: string[];          // 可用工具列表
  toolSnippets?: Record&lt;string, string&gt;; // 工具摘要
  promptGuidelines?: string[];       // 使用指南
  appendSystemPrompt?: string;       // 追加内容
  cwd: string;                       // 工作目录
  contextFiles?: Array&lt;{ path: string; content: string }&gt;; // 上下文文件
  skills?: Skill[];                  // 技能列表
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string;</code></pre>
      </div>

      <p>构建流程图解：</p>
      <div class="diagram-container">
        <div class="diagram-caption">▲ System Prompt 构建流程</div>
      </div>

      <p>整个构建过程可以分解为以下步骤：</p>
      <div class="step-list">
        <li>
          <h4>1. 收集原材料</h4>
          <p>ResourceLoader 从多个来源收集所有需要的资源：contextFiles（来自 loadProjectContextFiles）、skills（来自 loadSkills）、toolSnippets 和 promptGuidelines（来自各工具的 ToolDefinition），以及 SYSTEM.md / APPEND_SYSTEM.md</p>
        </li>
        <li>
          <h4>2. 判断是否自定义 Prompt</h4>
          <p>如果有 customPrompt（来自 SYSTEM.md），使用它作为基础，但仍然追加 contextFiles、skills 和动态信息。没有 customPrompt 则使用默认模板</p>
        </li>
        <li>
          <h4>3. 构建工具列表</h4>
          <p>只列出有 promptSnippet 的工具，格式为 "工具名: 描述"。没有 snippet 的工具不会出现在列表中</p>
        </li>
        <li>
          <h4>4. 构建指南列表</h4>
          <p>从默认规则（如 "Be concise"）开始，添加每个工具的 promptGuidelines，去重后拼接</p>
        </li>
        <li>
          <h4>5. 拼接项目上下文</h4>
          <p>将 CLAUDE.md / AGENTS.md 内容以 XML 标签包裹，每个文件一个 <code>&lt;project_instructions&gt;</code> 块</p>
        </li>
        <li>
          <h4>6. 拼接技能列表</h4>
          <p>将 visible skills（disableModelInvocation=false）格式化为 XML 格式的 <code>&lt;available_skills&gt;</code></p>
        </li>
        <li>
          <h4>7. 追加动态信息</h4>
          <p>最后添加当前日期和工作目录</p>
        </li>
      </div>

      <p>实际代码展示了这个线性拼接过程：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/system-prompt.ts</span></div>
        <pre><code class="language-typescript">// 步骤 5-7 的核心拼接逻辑
let prompt = \`You are an expert coding assistant...

Available tools:
\${toolsList}

Guidelines:
\${guidelines}\`;

// 步骤 5: 追加项目上下文
if (contextFiles.length > 0) {
  prompt += "\\n\\n&lt;project_context&gt;\\n\\n";
  for (const { path, content } of contextFiles) {
    prompt += \`&lt;project_instructions path="\${path}"&gt;
\${content}
&lt;/project_instructions&gt;\\n\\n\`;
  }
  prompt += "&lt;/project_context&gt;\\n";
}

// 步骤 6: 追加技能列表
if (hasRead && skills.length > 0) {
  prompt += formatSkillsForPrompt(skills);
}

// 步骤 7: 追加动态信息
const date = \`\${year}-\${month}-\${day}\`;
prompt += \`\\nCurrent date: \${date}\`;
prompt += \`\\nCurrent working directory: \${promptCwd}\`;</code></pre>
      </div>
    `;
    container.appendChild(s2);

    // Render the diagram
    const diagramDiv = s2.querySelector('.diagram-container');
    Diagrams.drawSystemPromptFlow(diagramDiv);

    // === Section 4:
    const s3 = document.createElement('div');
    s3.className = 'content-section';
    s3.innerHTML = `
      <h2>7.4 Skills 系统：可发现的专业技能</h2>
      <p>Skills 是存放在 Markdown 文件中的可复用指令块，遵循 <a href="https://agentskills.io/integrate-skills" target="_blank">Agent Skills 规范</a>。</p>

      <h3>7.4.1 Skill 的发现规则</h3>
      <p>Skills 通过目录扫描来发现，规则非常直观：</p>
      <table class="content-table">
        <tr><th>条件</th><th>行为</th></tr>
        <tr><td>目录包含 SKILL.md</td><td>该目录被视为一个 Skill，不再递归子目录</td></tr>
        <tr><td>目录不包含 SKILL.md</td><td>加载该目录中的直接 .md 子文件，递归子目录寻找 SKILL.md</td></tr>
      </table>

      <h3>7.4.2 Skill 的 Frontmatter 结构</h3>
      <div class="code-block">
        <div class="code-label"><span class="file-path">.pi/skills/my-skill/SKILL.md</span></div>
        <pre><code class="language-plaintext">---
name: code-review
description: 执行代码审查，检查安全性、性能和可维护性
disable-model-invocation: false
---

# 代码审查指南

1. 安全检查: SQL 注入、XSS、认证缺失
2. 性能检查: N+1 查询、内存泄漏
3. 可维护性: 命名、模块化、文档</code></pre>
      </div>

      <p>核心字段：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:16px;">
        <li><strong>name</strong>：技能名称（小写字母、数字、连字符，最长64字符）。如不指定则使用父目录名</li>
        <li><strong>description</strong>：必需。LLM 根据此描述判断是否加载该技能</li>
        <li><strong>disable-model-invocation</strong>：设为 true 时，该技能不会出现在 System Prompt 中，模型无法自动发现。用户仍可通过 <code>/skill:name</code> 显式调用</li>
      </ul>

      <h3>7.4.3 技能如何进入 System Prompt</h3>
      <p>formatSkillsForPrompt() 函数将技能列表格式化为 LLM 可理解的 XML：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/skills.ts</span></div>
        <pre><code class="language-typescript">export function formatSkillsForPrompt(skills: Skill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

  const lines = [
    "The following skills provide specialized instructions...",
    "Use the read tool to load a skill's file...",
    "",
    "&lt;available_skills&gt;",
  ];

  for (const skill of visibleSkills) {
    lines.push("  &lt;skill&gt;");
    lines.push(\`    &lt;name&gt;\${escapeXml(skill.name)}&lt;/name&gt;\`);
    lines.push(\`    &lt;description&gt;\${escapeXml(skill.description)}&lt;/description&gt;\`);
    lines.push(\`    &lt;location&gt;\${escapeXml(skill.filePath)}&lt;/location&gt;\`);
    lines.push("  &lt;/skill&gt;");
  }

  lines.push("&lt;/available_skills&gt;");
  return lines.join("\\n");
}</code></pre>
      </div>
    `;
    container.appendChild(s3);

    // === Section 5:
    const s4 = document.createElement('div');
    s4.className = 'content-section';
    s4.innerHTML = `
      <h2>7.5 ResourceLoader：中央调度器</h2>
      <p><code>ResourceLoader</code> 是所有资源的中央协调器。它负责从多个来源加载扩展、技能、提示词模板、主题和上下文文件。</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/resource-loader.ts</span></div>
        <pre><code class="language-typescript">export interface ResourceLoader {
  getExtensions(): LoadExtensionsResult;
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
  getAgentsFiles(): { agentsFiles: Array&lt;{ path: string; content: string }&gt; };
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  extendResources(paths: ResourceExtensionPaths): void;
  reload(): Promise&lt;void&gt;;
}</code></pre>
      </div>

      <h3>资源发现路径优先级</h3>
      <p>ResourceLoader 从以下路径按优先级发现资源：</p>
      <table class="content-table">
        <tr><th>优先级</th><th>来源</th><th>路径</th></tr>
        <tr><td>最高</td><td>项目本地设置</td><td><code>.pi/settings.json</code> 中配置的包和路径</td></tr>
        <tr><td></td><td>项目自动发现</td><td><code>.pi/{skills,prompts,themes,extensions}/</code></td></tr>
        <tr><td></td><td>全局设置</td><td><code>~/.pi/agent/settings.json</code> 中配置的包和路径</td></tr>
        <tr><td></td><td>全局自动发现</td><td><code>~/.pi/{skills,prompts,themes,extensions}/</code></td></tr>
        <tr><td>最低</td><td>扩展注入</td><td>扩展运行时通过 extendResources 动态提供</td></tr>
      </table>

      <h3>覆盖机制</h3>
      <p>ResourceLoader 提供了多个 override 回调，允许扩展和配置完全控制资源加载结果：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/resource-loader.ts</span></div>
        <pre><code class="language-typescript">export interface DefaultResourceLoaderOptions {
  // ... 基础路径配置 ...

  // 覆盖回调 —— 允许外部完全控制资源结果
  extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
  skillsOverride?: (base: { skills: Skill[] }) => { skills: Skill[] };
  promptsOverride?: (base: { prompts: PromptTemplate[] }) => { prompts: PromptTemplate[] };
  themesOverride?: (base: { themes: Theme[] }) => { themes: Theme[] };
  agentsFilesOverride?: (base: { agentsFiles: ... }) => { agentsFiles: ... };
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  appendSystemPromptOverride?: (base: string[]) => string[];
}</code></pre>
      </div>
      <p>这些 override 形成了一条资源处理链：自动发现 → 包解析 → 覆盖回调 → 最终结果。</p>
    `;
    container.appendChild(s4);

    // === Section 6:
    const s5 = document.createElement('div');
    s5.className = 'content-section';
    s5.innerHTML = `
      <h2>7.6 深入：ResourceLoader 的多源加载与技能发现</h2>
      <p>前面 7.4 和 7.5 节从概念上描述了 Skills 系统和 ResourceLoader，这一节深入源码，看它们如何协同工作。</p>

      <h3>Skills 的递归发现算法</h3>
      <p><code>loadSkillsFromDirInternal()</code> 实现了递归的技能发现，核心规则非常清晰：</p>
      <ol style="color:var(--text-secondary);padding-left:20px;margin-bottom:16px;">
        <li>如果目录中包含 <code>SKILL.md</code>，将其作为技能加载，<strong>不再递归子目录</strong></li>
        <li>否则，加载根目录中直接的 .md 子文件，然后<strong>递归子目录</strong>寻找 SKILL.md</li>
        <li>自动跳过隐藏文件（. 开头）、node_modules，支持 .gitignore / .ignore / .fdignore 忽略规则</li>
      </ol>
      <div class="code-block">
        <div class="code-label"><span class="file-path">skills.ts — loadSkillsFromDirInternal() 递归发现</span></div>
        <pre><code class="language-typescript">function loadSkillsFromDirInternal(
  dir: string, source: string, includeRootFiles: boolean,
  ignoreMatcher?: IgnoreMatcher, rootDir?: string,
): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  if (!existsSync(dir)) return { skills, diagnostics };

  const root = rootDir ?? dir;
  const ig = ignoreMatcher ?? ignore();
  addIgnoreRules(ig, dir, root);  // 加载 .gitignore / .ignore / .fdignore

  const entries = readdirSync(dir, { withFileTypes: true });

  // 规则 1: 检查是否有 SKILL.md，有则加载并立即返回，不再递归
  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const fullPath = join(dir, entry.name);
    const relPath = toPosixPath(relative(root, fullPath));
    if (!isFile || ig.ignores(relPath)) continue;

    const result = loadSkillFromFile(fullPath, source);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics };  // 关键：找到 SKILL.md 就停止！
  }

  // 规则 2: 没有 SKILL.md，遍历子项递归发现
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;

    const fullPath = join(dir, entry.name);
    // ...检查 symlink、ignore 规则（省略）...

    if (isDirectory) {
      // 递归子目录，includeRootFiles=false（只有顶层才能用根 .md 文件）
      const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
      skills.push(...subResult.skills);
      diagnostics.push(...subResult.diagnostics);
    } else if (isFile && includeRootFiles && entry.name.endsWith(".md")) {
      // 加载根目录中的 .md 文件作为技能
      const result = loadSkillFromFile(fullPath, source);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
    }
  }
  return { skills, diagnostics };
}</code></pre>
      </div>

      <h3>loadSkillFromFile：从 Markdown 到 Skill 对象</h3>
      <p>每个 Skill 文件被解析时，frontmatter 中的字段会被提取和校验。名称和描述都遵循 Agent Skills 规范的严格约束：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">skills.ts — loadSkillFromFile()</span></div>
        <pre><code class="language-typescript">function loadSkillFromFile(filePath: string, source: string): {
  skill: Skill | null; diagnostics: ResourceDiagnostic[];
} {
  const rawContent = readFileSync(filePath, "utf-8");
  const { frontmatter } = parseFrontmatter&lt;SkillFrontmatter&gt;(rawContent);
  const skillDir = dirname(filePath);
  const parentDirName = basename(skillDir);

  // 校验描述：必填，最长 1024 字符
  const descErrors = validateDescription(frontmatter.description);
  if (!frontmatter.description || frontmatter.description.trim() === "")
    return { skill: null, diagnostics };  // 无描述则不加载

  // 校验名称：仅小写字母、数字、连字符，最长 64 字符，不能以连字符开头/结尾
  const name = frontmatter.name || parentDirName;
  const nameErrors = validateName(name);

  return {
    skill: {
      name,                                   // 显式指定 > 父目录名
      description: frontmatter.description,
      filePath,
      baseDir: skillDir,                     // 用于解析 Skill 内的相对路径
      sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    },
    diagnostics: [...nameErrors, ...descErrors],
  };
}</code></pre>
      </div>

      <h3>ResourceLoader.reload()：全局加载协调</h3>
      <p><code>reload()</code> 方法是 ResourceLoader 的中央入口。它按顺序处理所有资源类型（扩展 -> 技能 -> 提示模板 -> 主题 -> 上下文文件 -> System Prompt），每一步都遵循同样的五步模式：</p>
      <ol style="color:var(--text-secondary);padding-left:20px;margin-bottom:16px;">
        <li><strong>自动发现</strong>：扫描项目目录 <code>.pi/</code> 和全局目录 <code>~/.pi/</code></li>
        <li><strong>路径合并</strong>：合并 CLI 参数、设置文件、扩展注入的显式路径</li>
        <li><strong>调用加载函数</strong>：如 loadSkills、loadPromptTemplates 等</li>
        <li><strong>Overide 回调</strong>：允许外部通过回调完全控制最终结果</li>
        <li><strong>附加 SourceInfo</strong>：追踪每个资源的来源（user/project/extension/cli）</li>
      </ol>
      <div class="code-block">
        <div class="code-label"><span class="file-path">resource-loader.ts — reload() 中技能加载的完整流程</span></div>
        <pre><code class="language-typescript">async reload(): Promise&lt;void&gt; {
  await this.settingsManager.reload();
  const resolvedPaths = await this.packageManager.resolve();

  // 步骤 1-2: 自动发现 + 路径合并
  const enabledSkills = getEnabledResources(resolvedPaths.skills).map(mapSkillPath);
  const skillPaths = this.noSkills
    ? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
    : this.mergePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

  this.lastSkillPaths = skillPaths;

  // 步骤 3-5: 调用加载函数 -> Override -> SourceInfo
  this.updateSkillsFromPaths(skillPaths, metadataByPath);

  // ...同样的模式处理 themes、prompts、agentsFiles、systemPrompt ...
  // 最终所有资源都被加载并可供 buildSystemPrompt() 使用
}</code></pre>
      </div>

      <h3>技能名称冲突的去重策略</h3>
      <p><code>loadSkills()</code> 函数通过 Map 去重，遵循 <strong>先到先得</strong> 原则。默认目录（全局 -> 项目）先加载，显式路径后加载。后加载的同名技能会被忽略并产生 collision 诊断信息。</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">skills.ts — loadSkills() 去重逻辑</span></div>
        <pre><code class="language-typescript">export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
  const skillMap = new Map&lt;string, Skill&gt;();
  const realPathSet = new Set&lt;string&gt;();   // symlink 去重

  function addSkills(result: LoadSkillsResult) {
    for (const skill of result.skills) {
      const realPath = canonicalizePath(skill.filePath);
      if (realPathSet.has(realPath)) continue;     // 同一文件（symlink）跳过

      const existing = skillMap.get(skill.name);
      if (existing) {
        collisionDiagnostics.push({                 // 名称冲突：记录，保留先加载的
          type: "collision",
          message: \`name "\${skill.name}" collision\`,
          path: skill.filePath,
          collision: { resourceType: "skill", name: skill.name,
                       winnerPath: existing.filePath, loserPath: skill.filePath },
        });
      } else {
        skillMap.set(skill.name, skill);
        realPathSet.add(realPath);
      }
    }
  }

  // 优先级：默认目录先加载 -> 显式路径后加载（冲突时后者被丢弃）
  if (includeDefaults) {
    addSkills(loadSkillsFromDirInternal(join(agentDir, "skills"), "user", true));
    addSkills(loadSkillsFromDirInternal(resolve(cwd, ".pi", "skills"), "project", true));
  }
  for (const rawPath of skillPaths) {
    // 处理每个显式路径（目录递归或单文件加载）
    addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
  }

  return { skills: Array.from(skillMap.values()), diagnostics };
}</code></pre>
      </div>

      <div class="info-card">
        <h4>设计要点：Override 模式的价值</h4>
        <p>ResourceLoader 为每种资源提供了 override 回调（skillsOverride、promptsOverride、themesOverride、systemPromptOverride 等），允许扩展在"自动发现 + 加载"之后完全控制最终结果。这是一个关键的扩展点——没有它，构建系统就成了封闭的黑盒，无法适应特殊的项目需求。</p>
      </div>
    `;
    container.appendChild(s5);

    // === Section 7:
    const s6 = document.createElement('div');
    s6.className = 'content-section';
    s6.innerHTML = `
      <h2>7.7 动态信息注入</h2>
      <p>System Prompt 的最后部分注入运行时信息，让 Agent 知道自己所处的时间和环境：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/core/system-prompt.ts</span></div>
        <pre><code class="language-typescript">// 日期格式化
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const day = String(now.getDate()).padStart(2, "0");
const date = \`\${year}-\${month}-\${day}\`;
// 示例输出: "Current date: 2026-06-03"

// 工作目录（Windows 兼容）
const promptCwd = resolvedCwd.replace(/\\\\/g, "/");
// 示例输出: "Current working directory: /Users/user/project"

prompt += \`\\nCurrent date: \${date}\`;
prompt += \`\\nCurrent working directory: \${promptCwd}\`;</code></pre>
      </div>

      <p>这两个信息看似简单，但对 Agent 的行为有重要影响：</p>
      <ul style="list-style:disc;padding-left:20px;color:var(--text-secondary);margin-bottom:16px;">
        <li><strong>当前日期</strong>：让 Agent 知道"现在是什么时候"。比如搜索最新版本的依赖、判断 API 是否已过时、生成带时间戳的文件名</li>
        <li><strong>工作目录</strong>：让 Agent 知道"我在哪里"。所有相对路径操作都以此为基准</li>
      </ul>

      <div class="info-card">
        <h4>💡 为什么日期很重要？</h4>
        <p>LLM 的训练数据有截止日期。如果不知道当前日期，它可能会推荐过时版本的库、引用已废弃的 API，或生成不正确的"当前年份"信息。明确告诉它日期，能大幅减少这类问题。</p>
      </div>
    `;
    container.appendChild(s6);

    // === Section 8:
    const s7 = document.createElement('div');
    s7.className = 'content-section';
    s7.innerHTML = `
      <h2>7.8 最终产物：完整的 System Prompt 结构</h2>
      <p>经过上述所有步骤，最终生成的 System Prompt 具有以下层次结构：</p>

      <div class="code-block">
        <div class="code-label"><span class="file-path">最终 System Prompt 结构（示意）</span></div>
        <pre><code class="language-plaintext">[基础指令 - 默认模板或 SYSTEM.md]
  You are an expert coding assistant operating inside pi...

[可用工具列表]
  Available tools:
  - read: Read file contents
  - bash: Execute shell commands
  - edit: Make precise edits to files
  ...

[使用指南]
  Guidelines:
  - Be concise in your responses
  ...

[Pi 文档路径]
  Pi documentation (read only when the user asks about pi itself...):
  - Main documentation: /path/to/readme.md
  ...

[项目上下文] (如果存在 CLAUDE.md / AGENTS.md)
  &lt;project_context&gt;
  &lt;project_instructions path="/Users/user/project/CLAUDE.md"&gt;
  ...项目特定的指令和规范...
  &lt;/project_instructions&gt;
  &lt;/project_context&gt;

[可用技能列表] (如果有 skills)
  &lt;available_skills&gt;
    &lt;skill&gt;
      &lt;name&gt;code-review&lt;/name&gt;
      &lt;description&gt;执行代码审查...&lt;/description&gt;
      &lt;location&gt;/Users/user/.pi/skills/review/SKILL.md&lt;/location&gt;
    &lt;/skill&gt;
  &lt;/available_skills&gt;

[动态信息]
  Current date: 2026-06-03
  Current working directory: /Users/user/project</code></pre>
      </div>

      <p>这整个结构都是<strong>每次 Agent 启动时动态构建</strong>的。修改 CLAUDE.md、添加新 Skill、注册新工具后，无需重启——下一次 System Prompt 构建就会自动包含新内容。</p>
    `;
    container.appendChild(s7);

    // === Section 9:
    const s8 = document.createElement('div');
    s8.className = 'content-section';
    s8.innerHTML = `
      <h2>7.9 深入：上下文工程与 KV Cache 优化</h2>
      <p>System Prompt 不只是"告诉 Agent 规则"——它还直接影响<strong>性能和成本</strong>。理解 LLM 的 KV Cache 机制，才能设计出高效率的 Agent。</p>

      <h3>7.9.1 什么是 KV Cache</h3>
      <p>LLM 每次推理时，会对输入 token 计算 Key-Value 矩阵（用于 Attention 机制）。如果两次请求的<strong>前缀相同</strong>，LLM 可以复用之前的计算结果——这就是 <strong>KV Cache（也称 Prefix Cache）</strong>。</p>
      <table class="content-table">
        <tr><th>请求</th><th>Cache 状态</th><th>成本</th></tr>
        <tr><td>首次请求（cold start）</td><td>全部 token 都要计算</td><td>全价（input price）</td></tr>
        <tr><td>前缀命中（cache hit）</td><td>前缀部分复用缓存</td><td><strong>仅 ~10%</strong>（cache read price）</td></tr>
        <tr><td>前缀变化（cache miss）</td><td>缓存失效，重新计算</td><td>全价</td></tr>
      </table>
      <p>Coding Agent 的对话是<strong>持续追加</strong>的——每一轮都在上轮基础上加新消息。这意味着：<strong>如果 System Prompt 和工具定义不变，它们在每一轮都是前缀缓存命中</strong>。</p>

      <h3>7.9.2 Pi 的三断点缓存策略</h3>
      <p>Pi 通过 <code>cacheControlFormat: "anthropic"</code> 配置，在消息数组中<strong>精确标记 3 个缓存断点</strong>：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/ai/src/providers/openai-completions.ts — applyAnthropicCacheControl</span></div>
        <pre><code class="language-typescript">function applyAnthropicCacheControl(messages, tools, cacheControl) {
  // 断点 1: System Prompt 最后一条 user/assistant 消息
  addCacheControlToSystemPrompt(messages, cacheControl);

  // 断点 2: 最后一个工具定义
  addCacheControlToLastTool(tools, cacheControl);

  // 断点 3: 最后一条对话消息（user 或 assistant）
  addCacheControlToLastConversationMessage(messages, cacheControl);
}</code></pre>
      </div>

      <p>三个断点的作用：</p>
      <table class="content-table">
        <tr><th>断点</th><th>标记位置</th><th>缓存了什么</th><th>为什么这样设计</th></tr>
        <tr>
          <td><strong>断点 1</strong></td>
          <td>System Prompt</td>
          <td>整个 System Prompt 文本（~500行规则 + CLAUDE.md + skills 列表）</td>
          <td>System Prompt 在整个 session 中不变，始终命中</td>
        </tr>
        <tr>
          <td><strong>断点 2</strong></td>
          <td>最后一个工具定义</td>
          <td>System Prompt + 工具列表（read/bash/edit/write...的 JSON Schema）</td>
          <td>工具定义在 session 中也不变（除非扩展动态注册）</td>
        </tr>
        <tr>
          <td><strong>断点 3</strong></td>
          <td>最后一条对话消息</td>
          <td>System Prompt + 工具 + <strong>当前轮之前的所有消息</strong></td>
          <td>新消息追加在断点之后，缓存前缀复用</td>
        </tr>
      </table>

      <div class="dg">
        <div class="dg-cap">▲ 三断点缓存模型：绿色区域 = Cache 命中，灰色 = 需重新计算</div>
      </div>

      <h3>7.9.3 Byte-Stable：为什么 System Prompt 必须保持稳定</h3>
      <p>KV Cache 的命中条件是<strong>逐字节精确匹配前缀</strong>。如果 System Prompt 中嵌入了会变化的内容（如当前时间、随机 ID），每次请求的前缀都不同 → <strong>缓存全部失效</strong>。</p>
      <p>Pi 的做法：</p>
      <ul>
        <li><strong>动态信息放在最后</strong>：当前日期、工作目录等变化的内容追加在 System Prompt 末尾（断点之后），不影响前缀稳定性</li>
        <li><strong>CLAUDE.md 内容固定后才注入</strong>：文件内容一旦加载就不再变化，不会在对话过程中重新读取</li>
        <li><strong>工具定义的顺序固定</strong>：按字母序排列，确保每次构建的 JSON Schema 完全一致</li>
      </ul>

      <h3>7.9.4 缓存保留策略：短期 vs 长期</h3>
      <table class="content-table">
        <tr><th>模式</th><th>TTL</th><th>适用场景</th></tr>
        <tr><td><strong>Ephemeral</strong>（短期，默认）</td><td>~5 分钟</td><td>快速对话，短任务</td></tr>
        <tr><td><strong>Long</strong>（长期）</td><td>1 小时（Anthropic）/ 24 小时（OpenAI）</td><td>长 session，间断后恢复</td></tr>
      </table>
      <p>配置方式：Provider 的 <code>cacheRetention</code> 字段设为 <code>"ephemeral"</code> 或 <code>"long"</code>。长保留模式下，即使对话暂停一小时回来，System Prompt + 工具定义仍然缓存命中。</p>

      <h3>7.9.5 Compaction 与 Cache 的协同</h3>
      <p>当对话太长、接近上下文窗口上限时，第6章的 Compaction 机制会<strong>压缩旧消息为摘要</strong>。这不仅是 token 优化，也影响缓存：</p>
      <div class="step-list">
        <li>
          <h4>压缩前</h4>
          <p>[System Prompt | 工具定义 | 100轮对话 | 最新消息] → 前缀太长，cache 可能逐出</p>
        </li>
        <li>
          <h4>压缩后</h4>
          <p>[System Prompt | 工具定义 | 摘要 | 最近20轮 | 最新消息] → 前缀缩短，cache 命中率提升</p>
        </li>
      </div>
      <p>Compaction 使用一个专门的 LLM 调用来生成摘要，保留关键上下文（Goal / Progress / Key Decisions / Next Steps），丢弃冗余细节。这确保压缩后的前缀仍然是高质量的缓存候选。</p>

      <h3>7.9.6 对开发者意味着什么</h3>
      <div class="callout cl-tip">
        <strong>💡 构建自己的 Agent 时的最佳实践</strong>
        <ul>
          <li>System Prompt 中<strong>不要嵌入会变化的内容</strong>（时间戳、随机串、request ID）</li>
          <li>工具定义的<strong>顺序保持固定</strong></li>
          <li>如果使用自定义 SYSTEM.md，<strong>在 session 中途不要修改它</strong></li>
          <li>在 System Prompt + 工具定义之后、对话消息之前放置 cache 断点</li>
        </ul>
      </div>
    `;
    container.appendChild(s8);

    // Render cache model diagram
    const cacheDiv = s8.querySelector('.dg');
    if (cacheDiv && typeof Diagrams !== 'undefined') {
      Diagrams.drawCacheModel(cacheDiv);
    }

    // === Section 10:
    const s9 = document.createElement('div');
    s9.className = 'content-section';
    s9.innerHTML = `
      <h2>7.10 消息处理：用户输入到 Agent Loop 的完整链路</h2>
      <p>System Prompt 准备好之后，Agent 等待用户输入。但用户的输入不一定都是"任务描述"——Pi 支持<strong>斜杠命令</strong>、<strong>Prompt 模板调用</strong>、<strong>技能调用</strong>等多种交互方式。让我们看看一条用户输入在到达 Agent Loop 之前经历了什么。</p>

      <h3>7.10.1 入口：setupEditorSubmitHandler</h3>
      <p>在交互模式下，用户输入通过终端编辑器提交。提交后的处理逻辑在 <code>interactive-mode.ts</code> 中：</p>
      <div class="code-block">
        <div class="code-label"><span class="file-path">packages/coding-agent/src/modes/interactive/interactive-mode.ts</span></div>
        <pre><code class="language-typescript">this.defaultEditor.onSubmit = async (text: string) => {
  text = text.trim();
  if (!text) return;

  // ① 先检查是否斜杠命令
  if (text === "/settings") { this.showSettingsSelector(); return; }
  if (text === "/model" || text.startsWith("/model ")) {
    await this.handleModelCommand(/*...*/); return;
  }
  if (text === "/export") { await this.handleExportCommand(text); return; }
  if (text === "/new") { await this.handleNewSessionCommand(); return; }
  // ... 20 个内置命令

  // ② 再检查是否扩展命令 / prompt 模板 / 技能命令
  if (text.startsWith("/")) {
    const result = await this.extensionRunner.emitCommand({ text });
    if (result?.handled) return;  // 扩展处理了，不进入 Agent Loop
  }

  // ③ 都不是 → 进入 Agent Loop
  await this.handleNewTask(text);
};</code></pre>
      </div>

      <h3>7.10.2 四类命令来源</h3>
      <p>Pi 的斜杠命令来自<strong>四个不同的来源</strong>，统一合并到一个自动补全列表中：</p>
      <table class="content-table">
        <tr><th>来源</th><th>数量</th><th>示例</th><th>实现</th></tr>
        <tr>
          <td><strong>内置命令</strong></td>
          <td>20 个</td>
          <td><code>/settings</code>, <code>/model</code>, <code>/new</code>, <code>/compact</code>, <code>/fork</code>, <code>/tree</code>, <code>/export</code>, <code>/quit</code></td>
          <td><code>BUILTIN_SLASH_COMMANDS</code> 常量 + 逐个 if-else 分发</td>
        </tr>
        <tr>
          <td><strong>Prompt 模板</strong></td>
          <td>动态</td>
          <td><code>/review</code>（来自 .pi/prompts/review.md）</td>
          <td><code>promptTemplates.map()</code> 自动注册为命令</td>
        </tr>
        <tr>
          <td><strong>扩展注册</strong></td>
          <td>动态</td>
          <td>自定义命令（扩展通过 <code>registerCommand()</code> 注册）</td>
          <td><code>extensionRunner.getRegisteredCommands()</code></td>
        </tr>
        <tr>
          <td><strong>技能命令</strong></td>
          <td>动态</td>
          <td><code>/skill:my-skill</code>（来自 .pi/skills/my-skill.md）</td>
          <td>每个 Skill 自动生成 <code>/skill:&lt;name&gt;</code> 命令</td>
        </tr>
      </table>

      <div class="code-block">
        <div class="code-label"><span class="file-path">interactive-mode.ts — 四源合并</span></div>
        <pre><code class="language-typescript">// 1. 内置命令
const slashCommands = BUILTIN_SLASH_COMMANDS.map(c => ({ name: c.name, ... }));

// 2. Prompt 模板 → 命令
const templateCommands = this.session.promptTemplates.map(cmd => ({
  name: cmd.name, description: cmd.description, ...
}));

// 3. 扩展命令
const extensionCommands = this.session.extensionRunner
  .getRegisteredCommands()
  .filter(cmd => !builtinCommandNames.has(cmd.name));

// 4. 技能命令
const skillCommandList = this.session.resourceLoader.getSkills().skills
  .map(skill => ({ name: \`skill:\${skill.name}\`, description: skill.description }));

// 合并为统一的自动补全列表
return new CombinedAutocompleteProvider([
  ...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList
]);</code></pre>
      </div>

      <h3>7.10.3 Skill 命令的工作原理</h3>
      <p>当用户输入 <code>/skill:my-skill</code> 时，Pi 不会把它当作普通的 agent prompt。而是：</p>
      <div class="step-list">
        <li>
          <h4>匹配命令名</h4>
          <p>TUI 层检查输入是否匹配 <code>/skill:&lt;name&gt;</code> 模式，找到对应的 skill 文件路径</p>
        </li>
        <li>
          <h4>加载 Skill 内容</h4>
          <p>读取 <code>.pi/skills/my-skill.md</code> 文件，解析 frontmatter 和正文</p>
        </li>
        <li>
          <h4>注入为 System Prompt 的一部分</h4>
          <p>Skill 的正文内容被注入到 System Prompt 的附加部分（appendSystemPrompt），告诉 LLM "用户激活了这个技能"</p>
        </li>
        <li>
          <h4>进入 Agent Loop</h4>
          <p>剩余文本（命令后面的参数）作为用户消息，进入正常的 Agent Loop</p>
        </li>
      </div>

      <h3>7.10.4 消息分发的设计哲学</h3>
      <p>Pi 的消息处理体现了 <strong>"先拦截，后兜底"</strong> 的设计模式：</p>
      <table class="content-table">
        <tr><th>优先级</th><th>匹配规则</th><th>处理方式</th></tr>
        <tr><td>最高</td><td>精确匹配内置命令（<code>/settings</code>）</td><td>直接执行命令处理器，<strong>不进入 Agent Loop</strong></td></tr>
        <tr><td>高</td><td>匹配内置命令 + 参数（<code>/model gpt</code>）</td><td>提取参数，执行命令处理器</td></tr>
        <tr><td>中</td><td>匹配扩展/模板/技能命令（<code>/review</code>）</td><td>分发给扩展系统，扩展决定是否处理</td></tr>
        <tr><td>低（兜底）</td><td>不匹配任何命令的普通文本</td><td>作为任务描述进入 <strong>Agent Loop</strong>（第4章）</td></tr>
      </table>

      <p>这个设计确保了：用户既可以用斜杠命令快速操作（换模型、导出会话、压缩上下文），也可以用自然语言描述任务让 Agent 自主完成。两者共用同一个输入框，无缝切换。</p>
    `;
    container.appendChild(s9);
  },

  quiz: [
    {
      question: 'System Prompt 对 Agent 的作用类似于什么？',
      options: [
        '源代码——定义了 Agent 的内部实现',
        '员工手册——告诉 Agent 它是谁、能做什么、该怎么做',
        '配置文件——只包含开关和参数',
        '日志文件——记录 Agent 的历史行为',
      ],
      answer: 1,
      explanation: 'System Prompt 就像给 Agent 的"入职手册"，包含了身份定义、可用工具、使用指南、项目上下文等，告诉 LLM 它应该扮演什么角色以及如何行为。',
    },
    {
      question: '以下哪个不是 System Prompt 的来源？',
      options: [
        'CLAUDE.md / AGENTS.md 上下文文件',
        'Skills 技能文件（.pi/skills/）',
        '编译后的二进制代码',
        'SYSTEM.md 自定义 Prompt',
      ],
      answer: 2,
      explanation: 'System Prompt 的内容来自文本文件（CLAUDE.md、AGENTS.md、SKILL.md、SYSTEM.md）、工具定义和运行时信息，不涉及编译后的二进制代码。',
    },
    {
      question: 'Skill 的 disableModelInvocation 属性有什么作用？',
      options: [
        '禁用该 Skill 的所有功能',
        '阻止该 Skill 出现在 System Prompt 中，但用户仍可显式调用',
        '阻止用户加载该 Skill',
        '使该 Skill 仅在开发模式下可用',
      ],
      answer: 1,
      explanation: 'disableModelInvocation=true 时，该 Skill 不会出现在 System Prompt 的 available_skills 列表中，LLM 无法自动发现。但用户仍能通过 /skill:name 命令显式调用。',
    },
    {
      question: 'buildSystemPrompt() 中日期和工作目录信息被注入到 System Prompt 的什么位置？',
      options: [
        '最开头',
        '中间部分',
        '最末尾',
        '随机位置',
      ],
      answer: 2,
      explanation: '日期和工作目录信息被追加到 System Prompt 的最末尾。这样 LLM 在处理完所有规则和上下文后，最后看到的就是当前的环境信息。',
    },
  ],

  coding: [
    {
      title: '实现上下文文件加载器',
      prompt: '编写一个 loadContextFiles 函数，从指定目录向上遍历到根目录，收集所有 CLAUDE.md 或 AGENTS.md 文件。返回按发现顺序排列的文件列表（从根到当前目录）。每个文件包含 path 和 content 字段。',
      hint: '从 startDir 开始循环，每次检查目录中是否存在候选文件（AGENTS.md, CLAUDE.md）。用 Set 去重已加载的路径。找到后 unshift 到数组开头（越接近根的越靠前）。循环终止条件：到达根目录或 parentDir === currentDir。',
      answer: `import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

function loadContextFileFromDir(dir) {
  const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
  for (const filename of candidates) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      return { path: filePath, content: readFileSync(filePath, "utf-8") };
    }
  }
  return null;
}

function loadContextFiles(startDir) {
  const contextFiles = [];
  const seenPaths = new Set();
  let currentDir = resolve(startDir);
  const root = resolve("/");

  while (true) {
    const contextFile = loadContextFileFromDir(currentDir);
    if (contextFile && !seenPaths.has(contextFile.path)) {
      contextFiles.unshift(contextFile);    // 越接近根越靠前
      seenPaths.add(contextFile.path);
    }

    if (currentDir === root) break;

    const parentDir = resolve(currentDir, "..");
    if (parentDir === currentDir) break;    // 已到文件系统根
    currentDir = parentDir;
  }

  return contextFiles;
  // 结果: [{ path: "/CLAUDE.md", content: "..." },
  //        { path: "/home/project/CLAUDE.md", content: "..." }]
}`,
      explanation: '这是 resource-loader.ts 中 loadProjectContextFiles() 的简化实现。关键设计点：1) 候选文件名数组同时支持 CLAUDE.md 和 AGENTS.md；2) unshift 确保根目录文件排在前面（祖先上下文优先级低）；3) seenPaths Set 防止同一文件被多次加载。真实实现还额外从 agentDir（~/.pi/）加载全局上下文文件。',
    },
    {
      title: '实现 Skill Frontmatter 解析器',
      prompt: '编写一个 parseSkillFile 函数，读取 Markdown 文件并提取其 YAML frontmatter 中的 name 和 description 字段。如果 frontmatter 不存在或缺少 description，返回 null。name 如果未指定，使用父目录名作为默认值。',
      hint: '用正则 /^---\\n([\\s\\S]*?)\\n---/ 匹配 frontmatter 块。手动解析 YAML 的简单键值对（不需要完整 YAML 解析器，按行 split 后按 ":" 分割即可）。',
      answer: `import { readFileSync } from 'fs';
import { basename, dirname } from 'path';

function parseFrontmatter(content) {
  const match = content.match(/^---\\n([\\s\\S]*?)\\n---/);
  if (!match) return {};

  const yamlBlock = match[1];
  const result = {};
  for (const line of yamlBlock.split('\\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseSkillFile(filePath) {
  const rawContent = readFileSync(filePath, "utf-8");
  const frontmatter = parseFrontmatter(rawContent);
  const skillDir = dirname(filePath);
  const parentDirName = basename(skillDir);

  // name: 显式指定 > 父目录名
  const name = frontmatter.name || parentDirName;
  // description 必填
  const description = frontmatter.description;
  if (!description || description.trim() === "") {
    return null;  // 无描述不加载
  }

  // 校验 name: 只能是 a-z, 0-9, 连字符
  if (!/^[a-z0-9-]+$/.test(name) || name.length > 64) {
    console.warn(\`Invalid skill name: \${name}\`);
  }

  return {
    name,
    description,
    filePath,
    baseDir: skillDir,
    disableModelInvocation: frontmatter["disable-model-invocation"] === "true",
  };
}`,
      explanation: '这是 skills.ts 中 loadSkillFromFile() 的简化实现。核心设计：1) name 优先使用 frontmatter 显式指定，回退到父目录名；2) description 是加载的前置条件——缺失则不加载；3) 简单的 YAML 行解析足以处理大多数 frontmatter 场景。真实实现使用专门的 parseFrontmatter 工具函数处理更复杂的 YAML 格式。',
    },
    {
      title: '实现 Mini System Prompt Builder',
      prompt: '编写一个 buildMiniSystemPrompt 函数，接收工具列表、指南列表、上下文文件列表，拼接成简化的 System Prompt 字符串。要求：工具列表格式为 "工具名: 描述"，指南用编号列表，上下文文件包装在 XML 标签中。',
      hint: '用模板字符串拼接各部分。工具用 map 转成 "  - name: desc" 格式。指南按行编号。上下文文件每个包装成 <project_instructions> 标签，整体包裹在 <project_context> 中。',
      answer: `function buildMiniSystemPrompt(options) {
  const { tools, guidelines, contextFiles = [], cwd } = options;

  // 基础指令
  let prompt = \`You are an expert coding assistant.

Available tools:
\${tools.map(t => \`  - \${t.name}: \${t.description}\`).join('\\n')}

Guidelines:
\${guidelines.map((g, i) => \`\${i + 1}. \${g}\`).join('\\n')}\`;

  // 项目上下文
  if (contextFiles.length > 0) {
    prompt += '\\n\\n<project_context>\\n';
    for (const { path, content } of contextFiles) {
      prompt += \`  <project_instructions path="\${path}">\\n\`;
      prompt += \`\${content}\\n\`;
      prompt += '  </project_instructions>\\n';
    }
    prompt += '</project_context>\\n';
  }

  // 动态信息
  const now = new Date();
  const date = \`\${now.getFullYear()}-\${String(now.getMonth() + 1).padStart(2, '0')}-\${String(now.getDate()).padStart(2, '0')}\`;
  prompt += \`\\nCurrent date: \${date}\`;
  prompt += \`\\nCurrent working directory: \${cwd}\`;

  return prompt;
}

// 使用示例
const systemPrompt = buildMiniSystemPrompt({
  tools: [
    { name: 'read', description: '读取文件内容' },
    { name: 'bash', description: '执行终端命令' },
    { name: 'edit', description: '精确编辑文件' },
  ],
  guidelines: [
    '简洁回复，不要啰嗦',
    '修改文件前先阅读文件',
    '使用绝对路径',
  ],
  contextFiles: [
    { path: '/project/CLAUDE.md', content: '这是一个 TypeScript 项目...' },
  ],
  cwd: '/Users/dev/project',
});`,
      explanation: '这是 system-prompt.ts 中 buildSystemPrompt() 的简化实现。真实版本更复杂：支持 customPrompt 替换默认模板、skills 的 XML 格式列表、appendSystemPrompt 追加、去重逻辑、以及 Windows 路径兼容。但核心拼接模式是一样的：基础指令 -> 工具列表 -> 指南 -> 项目上下文 -> 动态信息。所有自定义消息类型都在 XML 标签中，这是一种将结构化信息注入 flat text prompt 的实用模式。',
    },
  ],

  summary: [
    'System Prompt 是 Agent 的"员工手册"，在每次 Agent 启动时动态构建，包含身份定义、工具列表、项目上下文、技能列表和动态信息',
    '多源输入机制：CLAUDE.md / AGENTS.md（项目上下文）、SYSTEM.md（自定义 Prompt）、Skills（可加载技能）、Extensions（扩展注入）',
    'buildSystemPrompt() 函数将各源材料按固定顺序拼接：基础指令 → 工具列表 → 指南 → 项目上下文 → 技能 → 动态信息',
    'ResourceLoader 是中央调度器，按优先级从项目本地、全局、扩展等多个来源加载资源，并提供 override 回调支持外部控制',
    'Skills 系统遵循 Agent Skills 规范，通过 SKILL.md 文件 + frontmatter 描述技能，LLM 根据描述决定是否加载',
    '动态信息（日期、工作目录）看似简单却至关重要——让 Agent 知道"现在是什么时候"和"我在哪里"',
  ],
});
