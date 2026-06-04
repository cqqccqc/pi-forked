# pi-tui 终端 UI 渲染系统深度分析

## 目录
- [1. 整体架构](#1-整体架构)
- [2. 差分渲染原理](#2-差分渲染原理)
- [3. 组件系统](#3-组件系统)
- [4. 文本编辑器组件](#4-文本编辑器组件)
- [5. Markdown 渲染机制](#5-markdown-渲染机制)
- [6. 快捷键系统](#6-快捷键系统)
- [7. 交互模式实现](#7-交互模式实现)
- [8. 工具执行进度显示](#8-工具执行进度显示)
- [9. 性能优化策略](#9-性能优化策略)
- [10. 关键设计总结](#10-关键设计总结)

---

## 1. 整体架构

### 1.1 模块划分

pi-tui 采用了清晰的分层架构，核心模块职责明确：

```
packages/tui/src/
├── tui.ts              # 核心 TUI 类，差分渲染引擎
├── terminal.ts         # 终端抽象层（含输入清理、日志记录）
├── stdin-buffer.ts     # 输入缓冲和分批处理
├── keys.ts             # 键盘输入解析
├── keybindings.ts      # 快捷键管理
├── utils.ts            # 文本处理工具（宽度计算、换行等）
├── word-navigation.ts  # 单词级光标导航（前后跳转）
├── native-modifiers.ts # macOS 原生修饰键检测
├── components/         # 可复用组件集合
│   ├── editor.ts       # 文本编辑器
│   ├── markdown.ts     # Markdown 渲染器
│   ├── loader.ts       # 加载动画
│   ├── select-list.ts  # 选择列表
│   └── ...
├── autocomplete.ts      # 自动补全框架
└── terminal-image.ts   # 图像渲染支持
```

### 1.2 核心抽象

#### Component 接口

所有可渲染组件必须实现 `Component` 接口：

```typescript
export interface Component {
  /** 渲染组件为文本行数组 */
  render(width: number): string[];
  
  /** 可选：处理键盘输入 */
  handleInput?(data: string): void;
  
  /** 是否接收 key release 事件（Kitty 协议） */
  wantsKeyRelease?: boolean;
  
  /** 使缓存失效，强制重新渲染 */
  invalidate(): void;
}
```

#### Focusable 接口

对于需要显示硬件光标的组件（如输入框）：

```typescript
export interface Focusable {
  focused: boolean;  // 由 TUI 设置
}
```

#### TUI 主类

核心功能：
- **差分渲染引擎**：只更新变化的屏幕区域
- **组件容器**：继承自 `Container`，管理子组件
- **输入分发**：将键盘事件路由到焦点组件
- **Overlay 管理**：支持模态对话框、下拉菜单等浮层
- **硬件光标定位**：支持 IME 候选窗口定位

---

## 2. 差分渲染原理

### 2.1 核心算法

pi-tui 的差分渲染位于 `tui.ts` 的 `doRender()` 方法中，采用以下策略：

```typescript
private doRender(): void {
  // 1. 渲染所有组件获取新内容
  let newLines = this.render(width);
  
  // 2. 合成 overlay 内容
  if (this.overlayStack.length > 0) {
    newLines = this.compositeOverlays(newLines, width, height);
  }
  
  // 3. 查找首个和最后一个变化行
  let firstChanged = -1;
  let lastChanged = -1;
  for (let i = 0; i < maxLines; i++) {
    if (oldLine !== newLine) {
      if (firstChanged === -1) firstChanged = i;
      lastChanged = i;
    }
  }
  
  // 4. 只更新变化的区域
  if (firstChanged !== -1) {
    // 移动光标到 firstChanged
    // 渲染从 firstChanged 到 lastChanged 的行
  }
}
```

### 2.2 优化技术

| 优化技术 | 说明 |
|---------|------|
| **行级差分** | 只重写变化的行，而非整个屏幕 |
| **CSI 光标定位** | 使用 ANSI 转义序列精确定位光标 |
| **同步输出** | 使用 `\x1b[?2026h` 批量更新避免闪烁 |
| **视图口追踪** | 追踪 `viewportTop` 和 `hardwareCursorRow` 减少移动 |
| **延迟渲染** | 16ms 最小间隔避免过度渲染 |

### 2.3 渲染流程图

```
┌─────────────────────────────────────────────────────────┐
│ requestRender()                                         │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ scheduleRender()                                       │
│ - 节流：最小间隔 16ms                                    │
│ - 批量多次请求为一次渲染                                  │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│ doRender()                                              │
│                                                         │
│ 1. 检查是否需要全屏重绘：                                │
│    - 首次渲染                                            │
│    - 宽度变化                                            │
│    - 高度变化（非 Termux）                               │
│    - 内容缩小且 clearOnShrink=true                       │
│                                                         │
│ 2. 如果全屏重绘：                                        │
│    - 清屏、写入所有行、重置状态                          │
│                                                         │
│ 3. 否则差分更新：                                        │
│    a) 找出 firstChanged 和 lastChanged                   │
│    b) 移动光标到 firstChanged                            │
│    c) 渲染变化行                                        │
│    d) 清理多余行                                        │
│    e) 更新硬件光标位置                                   │
└─────────────────────────────────────────────────────────┘
```

### 2.4 关键代码片段

```typescript
// 查找变化行
for (let i = 0; i < maxLines; i++) {
  const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
  const newLine = i < newLines.length ? newLines[i] : "";
  
  if (oldLine !== newLine) {
    if (firstChanged === -1) {
      firstChanged = i;
    }
    lastChanged = i;
  }
}

// 只渲染变化行
const renderEnd = Math.min(lastChanged, newLines.length - 1);
for (let i = firstChanged; i <= renderEnd; i++) {
  buffer += "\r\n";  // 换行
  buffer += "\x1b[2K";  // 清除当前行
  buffer += newLines[i];  // 输出内容
}
```

---

## 3. 组件系统

### 3.1 基础组件

pi-tui 提供了丰富的基础组件：

| 组件 | 功能 | 特点 |
|-----|------|-----|
| `Text` | 纯文本显示 | 支持自动换行、内边距 |
| `Box` | 边框容器 | 绘制 Unicode 边框 |
| `Spacer` | 空白占位 | 用于布局间距 |
| `Loader` | 加载动画 | 可配置帧和间隔 |
| `Editor` | 多行编辑器 | 支持自动补全、历史记录 |
| `Input` | 单行输入 | 含 kill ring、undo stack、单词导航、粘贴缓冲 |
| `Markdown` | Markdown 渲染 | 支持代码块、表格、链接 |
| `SelectList` | 选择列表 | 键盘导航、滚动显示 |
| `Image` | 图像显示 | Kitty/iTerm2 协议 |
| `TruncatedText` | 可截断文本 | 支持"展开/收起" |

### 3.2 Container 容器

```typescript
export class Container implements Component {
  children: Component[] = [];
  
  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const childLines = child.render(width);
      lines.push(...childLines);
    }
    return lines;
  }
}
```

特点：
- **垂直布局**：子组件从上到下排列
- **递归渲染**：支持嵌套容器
- **统一宽度**：所有组件获得相同宽度参数

### 3.3 Overlay 系统

Overlay 是浮层组件（对话框、菜单）的基础：

```typescript
showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
  const entry = {
    component,
    options,
    preFocus: this.focusedComponent,  // 保存焦点
    hidden: false,
    focusOrder: ++this.focusOrderCounter,
  };
  this.overlayStack.push(entry);
  this.setFocus(component);  // 转移焦点
  this.requestRender();
  return handle;  // 返回控制句柄
}
```

Overlay 定位选项：
```typescript
export interface OverlayOptions {
  width?: SizeValue;           // 宽度：数字或百分比
  minWidth?: number;           // 最小宽度（列数）
  maxHeight?: SizeValue;       // 最大高度
  anchor?: OverlayAnchor;      // 锚点位置（center, top-left 等）
  offsetX?: number;            // 水平偏移
  offsetY?: number;            // 垂直偏移
  row?: SizeValue;             // 绝对行位置
  col?: SizeValue;             // 绝对列位置
  margin?: OverlayMargin | number; // 边距（数字则应用于四边）
  visible?: (w, h) => boolean; // 可见性条件
  nonCapturing?: boolean;      // 是否不捕获焦点
}
```

合成算法：
```typescript
private compositeOverlays(lines: string[], width: number, height: number): string[] {
  const result = [...lines];
  
  // 扩展到足够高度以支持绝对定位
  const workingHeight = Math.max(result.length, height, minLinesNeeded);
  while (result.length < workingHeight) {
    result.push("");
  }
  
  // 按焦点顺序渲染 overlay
  for (const { overlayLines, row, col, w } of rendered) {
    for (let i = 0; i < overlayLines.length; i++) {
      const idx = viewportStart + row + i;
      result[idx] = this.compositeLineAt(
        result[idx], 
        overlayLines[i], 
        col, 
        w, 
        width
      );
    }
  }
  
  return result;
}
```

---

## 4. 文本编辑器组件

### 4.1 编辑器架构

Editor 组件是 pi-tui 中最复杂的组件，提供了完整的文本编辑功能：

```typescript
export class Editor implements Component, Focusable {
  // 状态
  private state: EditorState = {
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  };
  
  // 编辑功能
  private undoStack = new UndoStack<EditorState>();
  private killRing = new KillRing();  // Emacs-style kill/yank
  private history: string[];          // 命令历史
  
  // 自动补全
  private autocompleteProvider?: AutocompleteProvider;
  private autocompleteList?: SelectList;
  
  // 粘贴追踪（大文本处理）
  private pastes: Map<number, string>;  // id -> content
  private pasteCounter: number;
}
```

### 4.2 核心功能

#### 4.2.1 光标移动

支持多种光标移动模式：

| 移动类型 | 实现细节 |
|---------|---------|
| **字符级** | 使用 Intl.Segmenter 按字素（grapheme）移动，支持 paste 标记视为原子单位 |
| **单词级** | 委托 `word-navigation.ts` 的 `findWordBackward`/`findWordForward`，基于 Intl.Segmenter word 粒度 |
| **行级** | 通过 `moveToVisualLine` 支持跨逻辑行的垂直移动，自动处理字换行后的视觉行跳转 |
| **Sticky Column** | `computeVerticalMoveColumn` 决策表实现，垂直移动时记忆并恢复偏好视觉列 |
| **字符跳转** | `Ctrl+]` 向前/向后跳转到指定字符，多行搜索 |

```typescript
private moveCursor(deltaLine: number, deltaCol: number): void {
  this.lastAction = null;
  const visualLines = this.buildVisualLineMap(this.lastWidth);
  const currentVisualLine = this.findCurrentVisualLine(visualLines);

  if (deltaLine !== 0) {
    // 委托给 moveToVisualLine，内含 sticky column 和原子段吸附逻辑
    const targetVisualLine = currentVisualLine + deltaLine;
    if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
      this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
    }
  }

  if (deltaCol !== 0) {
    // 按字素移动；在行首/行尾可自动换行到上/下一行
    if (deltaCol > 0 && this.state.cursorCol < currentLine.length) {
      const graphemes = [...this.segment(afterCursor, "grapheme")];
      this.setCursorCol(this.state.cursorCol + graphemes[0].segment.length);
    } else if (deltaCol < 0 && this.state.cursorCol > 0) {
      const graphemes = [...this.segment(beforeCursor, "grapheme")];
      this.setCursorCol(this.state.cursorCol - lastGrapheme.segment.length);
    }
  }
}
```

单词导航由 `findWordBackward`/`findWordForward`（`word-navigation.ts`）实现，支持自定义分段器和原子段识别（如 paste 标记）。

#### 4.2.2 自动补全

支持两种补全模式：

```typescript
// 1. Slash 命令补全（如 /help）
if (char === "/" && this.isAtStartOfMessage()) {
  this.tryTriggerAutocomplete();
}

// 2. 符号补全（@mentions, #tags）
if (char === "@" || char === "#") {
  const charBeforeSymbol = textBeforeCursor[textBeforeCursor.length - 2];
  if (textBeforeCursor.length === 1 || charBeforeSymbol === " ") {
    this.tryTriggerAutocomplete();
  }
}
```

自动补全提供者接口：
```typescript
export interface AutocompleteProvider {
  getSuggestions(
    lines: string[],
    line: number,
    col: number,
    options: { signal: AbortSignal; force: boolean }
  ): Promise<AutocompleteSuggestions | null>;
  
  applyCompletion(
    lines: string[],
    line: number,
    col: number,
    item: AutocompleteItem,
    prefix: string
  ): { lines: string[]; cursorLine: number; cursorCol: number };
}
```

#### 4.2.3 大粘贴处理

对于大文本粘贴（>10 行或 >1000 字符），插入标记而非实际内容：

```typescript
if (pastedLines.length > 10 || totalChars > 1000) {
  this.pasteCounter++;
  const pasteId = this.pasteCounter;
  this.pastes.set(pasteId, filteredText);
  
  const marker = pastedLines.length > 10
    ? `[paste #${pasteId} +${pastedLines.length} lines]`
    : `[paste #${pasteId} ${totalChars} chars]`;
  this.insertTextAtCursorInternal(marker);
}
```

使用 `segmentWithMarkers` 将标记视为原子单位：
```typescript
function segmentWithMarkers(text: string, validIds: Set<number>): Iterable<Intl.SegmentData> {
  // 匹配 [paste #1 +123 lines] 格式
  const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
  // 返回合并的 segment
}
```

### 4.3 字换行（Word Wrapping）

Editor 使用智能字换行算法，支持 paste 标记视为原子单位：

```typescript
export function wordWrapLine(
  line: string,
  maxWidth: number,
  preSegmented?: Intl.SegmentData[]
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let currentWidth = 0;
  let chunkStart = 0;

  // 记录换行机会：空白后的非空白字素位置
  let wrapOppIndex = -1;
  let wrapOppWidth = 0;

  for (const seg of segments) {
    const width = visibleWidth(seg.segment);

    if (currentWidth + width > maxWidth) {
      if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + width <= maxWidth) {
        // 回溯到换行机会处（剩余内容 + 当前字素仍不超宽）
        chunks.push({ text: line.slice(chunkStart, wrapOppIndex), ... });
        chunkStart = wrapOppIndex;
        currentWidth -= wrapOppWidth;
      } else if (chunkStart < charIndex) {
        // 无可用换行机会：在当前位置强制断行
        chunks.push({ text: line.slice(chunkStart, charIndex), ... });
        chunkStart = charIndex;
        currentWidth = 0;
      }
    }

    // 原子段（如 paste 标记）宽于 maxWidth 时：递归调用自身按字素级拆行
    if (gWidth > maxWidth) {
      const subChunks = wordWrapLine(grapheme, maxWidth);
      // 除最后一块外全部推入（保持原子段的逻辑整体性）
      ...
    }

    // 记录换行机会：空白后跟非空白（含 paste 标记）
    if (isWs && next && !isWhitespaceChar(next.segment)) {
      wrapOppIndex = next.index;
      wrapOppWidth = currentWidth;
    }
  }

  return chunks;
}
```

关键改进：
- **paste 标记识别**：`isPasteMarker()` 配合 `segmentWithMarkers()` 将 `[paste #N ...]` 视为原子段
- **原子段子换行**：当原子段宽度超过 `maxWidth` 时，递归调用 `wordWrapLine` 按字素拆行，但保持逻辑上的原子性
- **回溯条件优化**：只有回溯后剩余内容+当前字素仍不超宽时才回溯，否则强制断行

---

## 5. Markdown 渲染机制

### 5.1 渲染流程

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Markdown 文本 │ -> │  Marked 解析 │ -> │ Token 流     │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ Token 渲染   │
                                         │ - heading    │
                                         │ - code       │
                                         │ - list       │
                                         │ - table      │
                                         │ - quote      │
                                         └──────┬───────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ 换行 + 填充   │
                                         │ - wrapText   │
                                         │ - padding    │
                                         │ - background │
                                         └──────┬───────┘
                                                │
                                                ▼
                                         ┌──────────────┐
                                         │ ANSI 样式    │
                                         │ - colors     │
                                         │ - bold       │
                                         │ - underline  │
                                         └──────────────┘
```

### 5.2 关键实现

#### 5.2.1 代码高亮

```typescript
export interface MarkdownTheme {
  highlightCode?: (code: string, lang?: string) => string[];
  codeBlockIndent?: string;  // 默认 "  "
}
```

使用 `marked` 库的 Tokenizer 扩展实现严格删除线：
```typescript
class StrictStrikethroughTokenizer extends Tokenizer {
  override del(src: string): Tokens.Del | undefined {
    const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
    if (!match) return undefined;
    
    const text = match[2];
    return { type: "del", raw: match[0], text, tokens: this.lexer.inlineTokens(text) };
  }
}
```

#### 5.2.2 表格渲染

支持自适应列宽的表格：

```typescript
private renderTable(token: Tokens.Table, availableWidth: number, ...): string[] {
  // 1. 计算边框开销: "│ " + (n-1) * " │ " + " │" = 3n + 1
  const borderOverhead = 3 * numCols + 1;
  const availableForCells = availableWidth - borderOverhead;
  
  // 2. 计算自然宽度（每列内容需要）
  const naturalWidths: number[] = [];
  for (const cell of token.header) {
    naturalWidths[i] = visibleWidth(this.renderInlineTokens(cell.tokens));
  }
  
  // 3. 分配列宽
  let columnWidths: number[];
  if (totalNaturalWidth <= availableWidth) {
    // 自然宽度足够
    columnWidths = naturalWidths.map((w, i) => Math.max(w, minColumnWidths[i]));
  } else {
    // 需要压缩
    const extraWidth = availableForCells - minCellsWidth;
    columnWidths = minColumnWidths.map((minW, i) => {
      const grow = Math.floor((naturalWidths[i] - minW) / totalGrowPotential * extraWidth);
      return minW + grow;
    });
  }
  
  // 4. 渲染表格边框和内容
  lines.push(`┌─${topBorderCells.join("─┬─")}─┐`);
  // ... 渲染行
}
```

#### 5.2.3 链接渲染

支持终端可点击链接（OSC 8），含 mailto 特殊处理：
```typescript
case "link": {
  const linkText = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
  const styledLink = this.theme.link(this.theme.underline(linkText));

  if (getCapabilities().hyperlinks) {
    // OSC 8: 可点击链接，URL 不显示在行内
    result += hyperlink(styledLink, token.href) + stylePrefix;
  } else {
    // 回退：当链接文本与 href 不同时，打印 URL
    // mailto: 链接特殊处理：email 自动链接的 text 不含 mailto: 前缀
    const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
    if (token.text === token.href || token.text === hrefForComparison) {
      result += styledLink + stylePrefix;
    } else {
      result += styledLink + this.theme.linkUrl(` (${token.href})`) + stylePrefix;
    }
  }
}
```

---

## 6. 快捷键系统

### 6.1 架构设计

快捷键系统采用类型安全的可扩展架构：

```typescript
// 全局快捷键定义（可扩展）
export interface Keybindings {
  "tui.editor.cursorUp": true;
  "tui.editor.cursorDown": true;
  // ...
}

export type Keybinding = keyof Keybindings;

// 快捷键定义
export interface KeybindingDefinition {
  defaultKeys: KeyId | KeyId[];
  description?: string;
}
```

### 6.2 键盘输入解析

支持三种协议：
1. **Kitty 键盘协议** - 最现代，支持所有修饰键组合
2. **xterm modifyOtherKeys** - 备用方案
3. **传统转义序列** - 向后兼容

```typescript
export function matchesKey(data: string, keyId: KeyId): boolean {
  const parsed = parseKeyId(keyId);  // "ctrl+c" -> {key:"c", ctrl:true}
  
  // Kitty 协议匹配
  if (matchesKittySequence(data, codepoint, modifier)) {
    return true;
  }
  
  // modifyOtherKeys 匹配
  if (matchesModifyOtherKeys(data, keycode, modifier)) {
    return true;
  }
  
  // 传统转义序列
  if (data === "\x03") return true;  // Ctrl+C
  
  return false;
}
```

#### 6.2.1 macOS 原生修饰键检测

为了处理不支持 Kitty 协议的终端（如 Apple Terminal），pi-tui 在 macOS 上提供了原生修饰键检测：

```typescript
// native-modifiers.ts
export type ModifierKey = "shift" | "command" | "control" | "option";

export function isNativeModifierPressed(key: ModifierKey): boolean {
  const helper = loadNativeModifiersHelper();
  if (!helper) return false;
  try {
    return helper.isModifierPressed(key) === true;
  } catch {
    return false;
  }
}
```

原生模块加载机制：
- 仅在 macOS (darwin) 平台加载
- 支持 x64 和 arm64 架构
- 从 `native/darwin/prebuilds/darwin-{arch}/darwin-modifiers.node` 加载
- 支持多种安装位置（模块目录、可执行文件目录等）
- 使用单例模式缓存加载结果

Apple Terminal 特殊处理：
```typescript
// terminal.ts
const APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";

export function normalizeAppleTerminalInput(
  data: string, 
  isAppleTerminal: boolean, 
  isShiftPressed: boolean
): string {
  // Apple Terminal 无法报告 Shift+Enter，需要使用原生检测
  if (isAppleTerminal && data === "\r" && isShiftPressed) {
    return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;  // 转换为 Kitty 协议格式
  }
  return data;
}
```

在 `setupStdinBuffer()` 中集成：
```typescript
this.stdinBuffer.on("data", (sequence) => {
  if (this.inputHandler) {
    const isAppleTerminal = sequence === "\r" && isAppleTerminalSession();
    const input = normalizeAppleTerminalInput(
      sequence,
      isAppleTerminal,
      isAppleTerminal && isNativeModifierPressed("shift"),
    );
    this.inputHandler(input);
  }
});
```

### 6.3 Kitty 协议解析

```typescript
function parseKittySequence(data: string): ParsedKittySequence | null {
  // CSI u 格式: \x1b[<codepoint>;<mod>:<event>u
  const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
  if (csiUMatch) {
    return {
      codepoint: parseInt(csiUMatch[1], 10),
      shiftedKey: csiUMatch[2] ? parseInt(csiUMatch[2], 10) : undefined,
      baseLayoutKey: csiUMatch[3] ? parseInt(csiUMatch[3], 10) : undefined,
      modifier: parseInt(csiUMatch[4], 10) - 1,
      eventType: parseEventType(csiUMatch[5]),
    };
  }
  return null;
}
```

### 6.4 快捷键匹配流程

```typescript
export class KeybindingsManager {
  matches(data: string, keybinding: Keybinding): boolean {
    const keys = this.keysById.get(keybinding) ?? [];
    for (const key of keys) {
      if (matchesKey(data, key)) return true;
    }
    return false;
  }
}
```

---

## 7. 交互模式实现

### 7.1 InteractiveMode 架构

交互模式是 pi-tui 的主要使用场景，核心职责：

```typescript
export class InteractiveMode {
  private runtimeHost: AgentSessionRuntime;
  private ui: TUI;
  private chatContainer: Container;      // 消息历史
  private pendingMessagesContainer: Container;
  private statusContainer: Container;   // 状态行
  private editor: EditorComponent;      // 输入框
  private footer: FooterComponent;      // 底部信息
  
  // 组件追踪
  private streamingComponent?: AssistantMessageComponent;
  private pendingTools = new Map<string, ToolExecutionComponent>();
}
```

### 7.2 消息流渲染

```
用户输入
   │
   ▼
UserMessageComponent (用户消息气泡)
   │
   ▼
AgentSession 处理
   │
   ├─► 思考中... (Loader)
   │
   ├─► 工具调用 (ToolExecutionComponent)
   │       │
   │       └─► 进度更新
   │
   └─► AssistantMessageComponent (响应流式渲染)
           │
           ├─► Markdown 流式渲染
           ├─► 代码块语法高亮
           └─► 图像内联显示
```

### 7.3 消息组件层次

```
Container
├── UserMessageComponent
│   └── Markdown (用户输入渲染)
├── AssistantMessageComponent
│   ├── Markdown (响应内容)
│   ├── Image (内联图像)
│   ├── Selector (选项按钮)
│   └── ThinkingBlock (思考内容)
├── ToolExecutionComponent
│   ├── BashExecutionComponent
│   └── 其他工具
└── SkillInvocationMessageComponent
```

---

## 8. 工具执行进度显示

### 8.1 ToolExecutionComponent

```typescript
export class ToolExecutionComponent implements Component {
  private toolName: string;
  private status: ToolExecutionStatus;
  private output: string[];
  private spinnerFrame = 0;
  
  render(width: number): string[] {
    const statusIcon = {
      running: ["⠋", "⠙", "⠹", "⠸", "⠼"][this.spinnerFrame % 5],
      completed: "✓",
      failed: "✗",
    }[this.status];
    
    return [
      `${statusIcon} ${this.theme.toolName(this.toolName)}`,
      ...this.output.map(line => this.theme.output(line)),
    ];
  }
}
```

### 8.2 Bash 执行组件

```typescript
export class BashExecutionComponent extends ToolExecutionComponent {
  private command: string;
  private exitCode?: number;
  private duration?: number;
  
  render(width: number): string[] {
    const header = this.formatHeader();
    const commandLine = this.theme.command(this.command);
    
    return [
      header,
      `${this.theme.prompt("$")} ${commandLine}`,
      ...this.renderOutput(),
      this.formatFooter(),
    ];
  }
  
  private formatFooter(): string {
    if (this.exitCode === undefined) {
      return "";  // 运行中
    }
    const icon = this.exitCode === 0 ? this.theme.success("✓") : this.theme.error("✗");
    const status = this.exitCode === 0 ? "success" : "failed";
    return `${icon} Exited with ${status} (code: ${this.exitCode}) in ${this.duration}ms`;
  }
}
```

### 8.3 进度更新机制

```typescript
// 在 InteractiveMode 中
this.runtimeHost.on("toolStart", (toolCall) => {
  const component = new ToolExecutionComponent(toolCall.tool.name);
  this.pendingTools.set(toolCall.id, component);
  this.chatContainer.addChild(component);
  this.ui.requestRender();
});

this.runtimeHost.on("toolOutput", (toolCall, output) => {
  const component = this.pendingTools.get(toolCall.id);
  component.appendOutput(output);
  this.ui.requestRender();
});

this.runtimeHost.on("toolEnd", (toolCall, result) => {
  const component = this.pendingTools.get(toolCall.id);
  component.setStatus(result.error ? "failed" : "completed");
  this.ui.requestRender();
});
```

---

## 9. 性能优化策略

### 9.1 渲染优化

| 策略 | 实现位置 | 效果 |
|-----|---------|------|
| **渲染节流** | `MIN_RENDER_INTERVAL_MS = 16` | 限制最大 60fps |
| **差分更新** | `doRender()` | 只更新变化行 |
| **缓存机制** | Markdown.cachedLines | 避免重复计算 |
| **按需失效** | `invalidate()` | 精确控制重绘 |
| **批量更新** | `\x1b[?2026h` | 减少终端同步 |

### 9.2 终端抽象与日志记录

ProcessTerminal 实现了完整的终端抽象接口，并支持调试日志记录：

```typescript
export class ProcessTerminal implements Terminal {
  private writeLogPath = (() => {
    const env = process.env.PI_TUI_WRITE_LOG || "";
    if (!env) return "";
    try {
      if (fs.statSync(env).isDirectory()) {
        // 生成带时间戳的日志文件名
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
        return path.join(env, `tui-${ts}-${process.pid}.log`);
      }
    } catch {
      // Not an existing directory - use as-is (file path)
    }
    return env;
  })();
  
  write(data: string): void {
    process.stdout.write(data);
    if (this.writeLogPath) {
      try {
        fs.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
      } catch {
        // Ignore logging errors
      }
    }
  }
}
```

通过设置 `PI_TUI_WRITE_LOG` 环境变量，可以将所有 TUI 输出记录到文件以便调试。

### 9.3 文本处理优化

```typescript
// 宽度缓存（LRU）
const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();

export function visibleWidth(str: string): number {
  // 快速路径：纯 ASCII
  if (isPrintableAscii(str)) {
    return str.length;
  }
  
  // 检查缓存
  const cached = widthCache.get(str);
  if (cached !== undefined) return cached;
  
  // 计算并缓存
  const width = calculateWidth(str);
  if (widthCache.size >= WIDTH_CACHE_SIZE) {
    const firstKey = widthCache.keys().next().value;
    widthCache.delete(firstKey);
  }
  widthCache.set(str, width);
  return width;
}
```

### 9.4 输入缓冲与清理

#### StdinBuffer 输入缓冲

```typescript
export class StdinBuffer {
  private timeout: number;  // 批次分割超时
  private buffer = "";
  
  process(data: string): void {
    this.buffer += data;
    
    // 使用超时分批
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.buffer) {
        this.emit("data", this.buffer);
        this.buffer = "";
      }
    }, this.timeout);
  }
}
```

#### 输入清理（drainInput）

为了防止 Kitty 键释放事件在慢速 SSH 连接上泄漏到父 shell，pi-tui 实现了输入清理机制：

```typescript
async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
  // 1. 禁用 Kitty 键盘协议，防止生成新的转义序列
  if (this._kittyProtocolActive) {
    process.stdout.write("\x1b[<u");
    this._kittyProtocolActive = false;
  }
  
  // 2. 临时移除输入处理器
  const previousHandler = this.inputHandler;
  this.inputHandler = undefined;
  
  // 3. 等待所有待处理输入被消费
  let lastDataTime = Date.now();
  const onData = () => { lastDataTime = Date.now(); };
  process.stdin.on("data", onData);
  
  try {
    while (true) {
      const now = Date.now();
      const timeLeft = endTime - now;
      if (timeLeft <= 0) break;  // 超时
      if (now - lastDataTime >= idleMs) break;  // 空闲超时
      await new Promise((resolve) => 
        setTimeout(resolve, Math.min(idleMs, timeLeft))
      );
    }
  } finally {
    process.stdin.removeListener("data", onData);
    this.inputHandler = previousHandler;
  }
}
```

这个机制确保：
- 在退出前消费所有待处理的键盘事件
- 防止键释放事件泄漏到父 shell
- 支持超时和空闲检测避免无限等待

### 9.5 渲染调试支持

`doRender()` 内置了多层调试机制：

- **`PI_DEBUG_REDRAW=1`**：全量重绘触发时记录原因（宽度/高度变化、clearOnShrink 等）到 `~/.pi/agent/pi-debug.log`
- **`PI_TUI_DEBUG=1`**：每次渲染将完整差分状态（firstChanged、viewportTop、新旧行内容、buffer）写入 `/tmp/tui/` 目录
- **崩溃保护**：当渲染行宽度超过终端宽度时，自动导出所有渲染行到 `~/.pi/agent/pi-crash.log`，清理终端后抛出明确错误
- **`PI_TUI_WRITE_LOG`**：（见 9.2）将所有 TUI 输出记录到文件

---

## 10. 关键设计总结

### 10.1 设计原则

| 原则 | 说明 | 示例 |
|-----|------|-----|
| **组件化** | 所有 UI 元素都是组件 | Text, Markdown, Editor |
| **单一职责** | 每个模块职责明确 | terminal.ts 只处理终端抽象 |
| **类型安全** | 利用 TypeScript 类型系统 | KeyId 类型确保快捷键正确 |
| **性能优先** | 差分渲染、缓存、节流 | 只更新变化区域 |
| **可扩展** | 声明式快捷键、主题系统 | 通过声明合并扩展 Keybindings |

### 10.2 核心技术选型

| 技术 | 原因 |
|-----|------|
| **Intl.Segmenter** | 正确处理 Unicode 字素、Emoji |
| **Marked** | 成熟的 Markdown 解析器 |
| **ANSI 转义** | 终端样式标准 |
| **Kitty 协议** | 最完整的键盘输入支持 |
| **OSC 8** | 终端可点击链接 |

### 10.3 差分渲染对比

| 框架 | 粒度 | 协议 |
|-----|------|-----|
| pi-tui | 行级差分 | 自定义 ANSI |
| blessed | 全屏刷新 | ncurses |
| ink | 组件级 | React-like |
| terminal-kit | 行级 | 自定义 |

### 10.4 设计模式

1. **组件模式**：统一的 `Component` 接口
2. **容器模式**：`Container` 管理子组件
3. **策略模式**：不同的 `AutocompleteProvider`
4. **观察者模式**：事件监听 (`AgentSession` 事件)
5. **命令模式**：`KeybindingsManager` 封装快捷键

### 10.5 性能指标

| 指标 | 目标 | 实现 |
|-----|------|-----|
| 渲染延迟 | < 20ms | 16ms 节流 + 差分更新 |
| 输入响应 | < 10ms | 直接事件分发 |
| 内存占用 | < 50MB | LRU 缓存限制 |
| 支持终端尺寸 | 80x24 ~ 300x100 | 动态适应 |
| 最大行数 | ~10000 行 | 虚拟滚动支持 |

---

## 附录

### A. ANSI 转义序列速查

| 序列 | 功能 |
|-----|------|
| `\x1b[2K` | 清除行 |
| `\x1b[H` | 光标归位 |
| `\x1b[{n}A` | 上移 n 行 |
| `\x1b[{n}B` | 下移 n 行 |
| `\x1b[{n}G` | 移动到第 n 列 |
| `\x1b[?2026h` | 开始同步更新 |
| `\x1b[?2026l` | 结束同步更新 |
| `\x1b[?25l` | 隐藏光标 |
| `\x1b[?25h` | 显示光标 |
| `\x1b]8;;{url}\x07` | 超链接开始 |
| `\x1b]8;;\x07` | 超链接结束 |

### B. 组件继承关系

```
                    Component
                       │
        ┌──────────────┼──────────────┐
        │              │              │
     Container      Editor          Focusable
        │              │              │
    ┌───┴───┐         │         ┌───┴────┐
  Loader  SelectList │         Editor   Input
    │        │        │           │
   Text    Text    Markdown    CustomEditor
```

### C. 文件索引

| 文件 | 行数 | 职责 |
|-----|------|-----|
| tui.ts | ~1490 | 核心 TUI 和差分渲染 |
| editor.ts | ~2230 | 文本编辑器 |
| markdown.ts | ~815 | Markdown 渲染 |
| keys.ts | ~1400 | 键盘输入解析 |
| utils.ts | ~1150 | 文本处理工具（宽度计算、换行、ANSI追踪等） |
| terminal.ts | ~570 | 终端抽象（含 Kitty 协商、Apple Terminal 处理、输入清理、日志记录） |
| word-navigation.ts | ~120 | 单词级光标导航（纯函数） |
| native-modifiers.ts | ~60 | macOS 原生修饰键检测 |
| stdin-buffer.ts | ~80 | 输入缓冲和分批处理 |
| terminal-image.ts | ~480 | 图像渲染支持（Kitty/iTerm2 协议） |
| interactive-mode.ts | ~6000+ | 交互模式实现 |

---

*文档生成时间: 2026-05-22*
*最后更新: 2026-06-02*
*分析基于版本: pi-tui@latest (main branch)*
