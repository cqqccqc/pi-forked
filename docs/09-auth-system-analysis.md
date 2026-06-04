# Pi Agent 认证系统分析

## 概述

Pi Agent 实现了一个灵活的多 provider 认证系统，支持 OAuth 2.0 流程和 API Key 两种认证方式。该系统设计用于处理不同 AI 服务提供商的认证差异，包括 Anthropic、OpenAI、GitHub Copilot 等。

## 架构设计

### 核心组件

```
packages/ai/src/utils/oauth/          # OAuth 实现
├── types.ts                          # 类型定义
├── device-code.ts                    # Device Code Flow 轮询 (RFC 8628)
├── anthropic.ts                      # Anthropic OAuth
├── github-copilot.ts                 # GitHub Copilot OAuth
├── openai-codex.ts                   # OpenAI Codex OAuth (浏览器 + 设备码双模式)
├── pkce.ts                           # PKCE 工具
├── oauth-page.ts                     # 回调页面 HTML
└── index.ts                          # Provider 注册表 & registry 管理

packages/coding-agent/src/core/       # 认证存储和管理
├── auth-storage.ts                   # 认证凭证存储
└── auth-guidance.ts                  # 用户引导信息

packages/ai/src/                      # Provider 集成
├── env-api-keys.ts                   # 环境变量支持
└── providers/                        # 各 provider 实现
```

## 1. OAuth 流程实现

### 1.1 通用接口 (OAuthProviderInterface)

```typescript
interface OAuthProviderInterface {
  readonly id: OAuthProviderId;
  readonly name: string;

  // 运行登录流程，返回需要持久化的凭证
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;

  // 是否使用本地回调服务器
  usesCallbackServer?: boolean;

  // 刷新过期的凭证
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;

  // 将凭证转换为 provider 的 API key 字符串
  getApiKey(credentials: OAuthCredentials): string;

  // 可选：修改此 provider 的模型（如更新 baseUrl）
  modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
}
```

### 1.2 凭证类型

```typescript
type OAuthCredentials = {
  refresh: string;   // 刷新令牌
  access: string;    // 访问令牌
  expires: number;   // 过期时间戳
  [key: string]: unknown;
};

type OAuthDeviceCodeInfo = {
  userCode: string;           // 用户输入的验证码
  verificationUri: string;    // 验证 URL
  intervalSeconds?: number;   // 轮询间隔
  expiresInSeconds?: number;  // 过期时间
};
```

## 2. Anthropic OAuth 实现

### 2.1 流程图

```
┌─────────┐      ┌──────────────┐      ┌─────────────────┐
│  用户   │ ───> │  Pi Agent    │ ───> │ Anthropic API  │
└─────────┘      └──────────────┘      └─────────────────┘
                      │
                      │ 1. 启动本地回调服务器
                      │    (127.0.0.1:53692)
                      │
                      │ 2. 生成 PKCE verifier/challenge
                      │
                      │ 3. 打开浏览器
                      │
                 ┌────▼────┐
                 │ 用户登录 │
                 └────┬────┘
                      │
                      │ 4. 回调到本地服务器
                      │    ?code=...&state=...
                      │
                      │ 5. 交换授权码获取 token
                      │    POST platform.claude.com/v1/oauth/token
                      │
                      │ 6. 存储凭证到 auth.json
                      ▼
              ┌───────────────┐
              │ auth.json     │
              │ {             │
              │   "anthropic": {
              │     "type": "oauth",
              │     "access": "...",
              │     "refresh": "...",
              │     "expires": timestamp
              │   }          │
              │ }            │
              └───────────────┘
```

### 2.2 PKCE 安全机制

```typescript
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  // 生成随机 verifier
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);

  // 计算 SHA-256 challenge
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));

  return { verifier, challenge };
}
```

### 2.3 授权码交换

```typescript
async function exchangeAuthorizationCode(
  code: string,
  state: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthCredentials> {
  const responseBody = await postJson(TOKEN_URL, {
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    state,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });

  const tokenData = JSON.parse(responseBody);
  return {
    refresh: tokenData.refresh_token,
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000, // 提前5分钟过期
  };
}
```

### 2.4 Token 刷新

```typescript
export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
  const responseBody = await postJson(TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const data = JSON.parse(responseBody);
  return {
    refresh: data.refresh_token,
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}
```

## 3. GitHub Copilot OAuth 实现

### 3.1 Device Code Flow 通用实现

`device-code.ts` 提供了符合 RFC 8628 标准的通用 Device Code Flow 轮询机制：

```typescript
type OAuthDeviceCodePollResult<T> =
  | { status: "pending" }      // 等待用户授权
  | { status: "slow_down" }    // 需降低轮询频率
  | { status: "complete"; value: T }  // 授权成功，携带泛型返回值
  | { status: "failed"; message: string };

async function pollOAuthDeviceCodeFlow<T>(options: {
  intervalSeconds?: number;
  expiresInSeconds?: number;
  poll: () => Promise<OAuthDeviceCodePollResult<T>>;
  signal?: AbortSignal;
}): Promise<T>;
```

**关键特性：**
- **slow_down 处理**：收到 `slow_down` 响应时，每次增加 5 秒轮询间隔（RFC 8628 3.5 节）
- **超时检测**：区分普通超时和 `slow_down` 导致的超时（WSL/VM 环境时钟漂移）
- **可中断**：通过 `AbortSignal` 支持用户取消
- **最小间隔**：1 秒，防止过度轮询

### 3.2 GitHub Copilot 流程

GitHub Copilot 使用 Device Code Flow，适用于无法直接使用浏览器回调的场景：

```
┌─────────┐      ┌──────────────┐      ┌─────────────────┐
│  用户   │ ───> │  Pi Agent    │ ───> │ GitHub API      │
└─────────┘      └──────────────┘      └─────────────────┘
                      │
                      │ 1. 请求 device code
                      │    POST github.com/login/device/code
                      │
                      ▼
              ┌───────────────┐
              │ 显示验证 URL  │
              │ 和 user_code  │
              └───────────────┘
                      │
                 ┌────▼────┐
                 │ 用户在   │
                 │ 浏览器   │
                 │ 输入代码 │
                 └────┬────┘
                      │
                      │ 2. pollOAuthDeviceCodeFlow 轮询
                      │    POST github.com/login/oauth/access_token
                      │    (处理 pending/slow_down/complete)
                      │
                      │ 3. 获取 Copilot token
                      │    POST api.github.com/copilot_internal/v2/token
                      │
                      │ 4. 启用所有模型 (enableAllGitHubCopilotModels)
                      │
                      ▼
              ┌───────────────┐
              │ 存储凭证      │
              └───────────────┘
```

### 3.3 企业版支持

GitHub Copilot 支持企业版部署：

```typescript
async function loginGitHubCopilot(options: {
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<OAuthCredentials> {
  // 1. 提示输入企业域名
  const input = await options.onPrompt({
    message: "GitHub Enterprise URL/domain (blank for github.com)",
    placeholder: "company.ghe.com",
    allowEmpty: true,
  });

  // 1.1 检查用户是否取消
  if (options.signal?.aborted) {
    throw new Error("Login cancelled");
  }

  // 1.2 域名验证
  const trimmed = input.trim();
  const enterpriseDomain = normalizeDomain(input);
  if (trimmed && !enterpriseDomain) {
    throw new Error("Invalid GitHub Enterprise URL/domain");
  }
  const domain = enterpriseDomain || "github.com";

  // 2. 启动 Device Flow
  const device = await startDeviceFlow(domain);
  options.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    intervalSeconds: device.interval,
    expiresInSeconds: device.expires_in,
  });

  // 3. 轮询 GitHub access token
  const githubAccessToken = await pollForGitHubAccessToken(domain, device, options.signal);

  // 4. 交换为 Copilot token
  const credentials = await refreshGitHubCopilotToken(githubAccessToken, enterpriseDomain ?? undefined);

  // 5. 启用所有模型
  options.onProgress?.("Enabling models...");
  await enableAllGitHubCopilotModels(credentials.access, enterpriseDomain ?? undefined);
  return credentials;
}
```

### 3.4 模型启用机制

登录成功后自动启用所有 GitHub Copilot 模型：

```typescript
async function enableAllGitHubCopilotModels(
  token: string,
  enterpriseDomain?: string,
  onProgress?: (model: string, success: boolean) => void,
): Promise<void> {
  const models = getModels("github-copilot");
  await Promise.all(
    models.map(async (model) => {
      const success = await enableGitHubCopilotModel(token, model.id, enterpriseDomain);
      onProgress?.(model.id, success);
    }),
  );
}
```

### 3.5 动态 Base URL 解析

Copilot token 包含 `proxy-ep` 字段，动态解析 API 端点：

```typescript
// Token 格式: tid=...;exp=...;proxy-ep=proxy.individual.githubcopilot.com;...
function getBaseUrlFromToken(token: string): string | null {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (!match) return null;
  const proxyHost = match[1];
  const apiHost = proxyHost.replace(/^proxy\./, "api.");
  return `https://${apiHost}`;
}
```

## 4. OpenAI Codex OAuth 实现

OpenAI Codex 实现了双模式 OAuth 登录：浏览器授权码流程（与 Anthropic 类似）和设备码流程（headless 环境）。用户登录时会先选择登录方式。

### 4.1 常量与端点

```typescript
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";

// Device Code 端点
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;

const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
```

与 Anthropic 的主要差异：
- 端口：1455 vs 53692
- 回调路径：`/auth/callback` vs `/callback`
- 额外参数：`id_token_add_organizations=true`、`codex_cli_simplified_flow=true`、`originator`
- Scope：`openid profile email offline_access`
- 凭证包含 `accountId` 字段（从 JWT access token 中提取 `chatgpt_account_id`）

### 4.2 登录方式选择

```typescript
export const openaiCodexOAuthProvider: OAuthProviderInterface = {
  id: "openai-codex",
  name: "ChatGPT Plus/Pro (Codex Subscription)",
  usesCallbackServer: true,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const loginMethod = await callbacks.onSelect({
      message: "Select OpenAI Codex login method:",
      options: [
        { id: "browser", label: "Browser login (default)" },
        { id: "device_code", label: "Device code login (headless)" },
      ],
    });

    if (loginMethod === "device_code") {
      return loginOpenAICodexDeviceCode({ ... });
    }
    return loginOpenAICodex({ ... });
  },
};
```

### 4.3 浏览器登录流程 (loginOpenAICodex)

```
┌─────────┐      ┌──────────────┐      ┌─────────────────┐
│  用户   │ ───> │  Pi Agent    │ ───> │  OpenAI API     │
└─────────┘      └──────────────┘      └─────────────────┘
                      │
                      │ 1. createAuthorizationFlow()
                      │    生成 PKCE verifier/challenge
                      │    生成 state (crypto.randomBytes)
                      │    构建授权 URL (含 id_token_add_organizations,
                      │      codex_cli_simplified_flow, originator 等参数)
                      │
                      │ 2. startLocalOAuthServer(state)
                      │    在 127.0.0.1:1455 启动回调服务器
                      │    路径: /auth/callback
                      │    错误时返回 oauthErrorHtml
                      │    成功时返回 oauthSuccessHtml
                      │
                      │ 3. onAuth({ url, instructions })
                      │    展示 URL 并打开浏览器
                      │
                      │ 4. 竞速机制 (onManualCodeInput)
                      │    ┌─ 浏览器回调: server.waitForCode()
                      │    └─ 手动粘贴: onManualCodeInput()
                      │      → 两者竞速，先完成者胜出
                      │
                      │ 5. 解析授权输入 (parseAuthorizationInput)
                      │    支持格式: URL, code#state, code=..&state=.., 纯 code
                      │
                      │ 6. exchangeAuthorizationCodeForCredentials()
                      │    交换授权码 → 获取 token → 提取 accountId
                      │
                      ▼
              ┌───────────────┐
              │ 存储凭证      │
              │ access,       │
              │ refresh,      │
              │ expires,      │
              │ accountId     │
              └───────────────┘
```

**核心函数签名：**

```typescript
export async function loginOpenAICodex(options: {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;  // 手动粘贴回调，与浏览器回调竞速
  originator?: string;                         // OAuth originator 参数，默认 "pi"
}): Promise<OAuthCredentials>;
```

**手动输入竞速机制（onManualCodeInput）：**

当提供了 `onManualCodeInput` 回调时，系统同时启动两条路径：
1. 本地回调服务器等待浏览器重定向
2. 调用 `onManualCodeInput()` 等待用户粘贴代码

两条路径竞速，先完成者胜出。如果手动输入失败或取消，会终止浏览器等待。这种设计让用户既可以使用浏览器自动完成，也可以在浏览器无法打开时手动粘贴授权码。

**输入解析（parseAuthorizationInput）：**

```typescript
function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  // 支持以下格式:
  // 1. 完整 URL: https://localhost:1455/auth/callback?code=...&state=...
  // 2. code#state 格式
  // 3. code=...&state=... 格式（URLSearchParams）
  // 4. 纯授权码
}
```

### 4.4 设备码登录流程 (loginOpenAICodexDeviceCode)

适用于 headless 环境或无浏览器的场景：

```typescript
export async function loginOpenAICodexDeviceCode(options: {
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  signal?: AbortSignal;
}): Promise<OAuthCredentials> {
  // 1. startOpenAICodexDeviceAuth()
  //    POST /api/accounts/deviceauth/usercode
  //    请求: { client_id: CLIENT_ID }
  //    返回: { device_auth_id, user_code, interval }
  //    404 时提示使用浏览器登录

  // 2. onDeviceCode({ userCode, verificationUri, intervalSeconds })
  //    展示 https://auth.openai.com/codex/device 和用户码

  // 3. pollOpenAICodexDeviceAuth()
  //    使用 pollOAuthDeviceCodeFlow 通用轮询
  //    轮询 POST /api/accounts/deviceauth/token
  //    处理 pending / slow_down / failed 状态
  //    成功返回 { authorizationCode, codeVerifier }

  // 4. exchangeAuthorizationCodeForCredentials()
  //    用授权码 + code_verifier + DEVICE_REDIRECT_URI 交换 token
}
```

**设备码轮询的 special-cased 状态：**
- `403` 或 `404` → 用户尚未授权，视为 `pending`
- `deviceauth_authorization_pending` → `pending`
- `slow_down` → 降低轮询频率
- 成功 (`200`) → 返回 `authorizationCode` 和 `codeVerifier`

### 4.5 JWT 解析与 accountId 提取

OpenAI Codex 的 access token 是一个 JWT，包含 `chatgpt_account_id`：

```typescript
function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = atob(parts[1]);  // Base64 解码 payload
  return JSON.parse(payload);
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
}
```

`credentialsFromToken()` 会验证 accountId 存在，如果缺失则抛出错误。

### 4.6 Token 交换与刷新

```typescript
// 交换授权码
async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string = REDIRECT_URI,
  signal?: AbortSignal,
): Promise<OAuthToken> {
  return fetchWithLoginCancellation(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  }).then(r => readTokenResponse(r, "exchange"));
}

// 刷新 token
async function refreshAccessToken(refreshToken: string): Promise<OAuthToken> {
  return fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  }).then(r => readTokenResponse(r, "refresh"));
}
```

**关键差异：**
- Token 交换**不**传 `state` 参数（与 Anthropic 不同）
- `fetchWithLoginCancellation` 会检测 `AbortSignal`，区分"用户取消"和"网络错误"
- `readTokenResponse` 验证响应包含 `access_token`、`refresh_token`、`expires_in` 三个必要字段
- Token 过期使用 `Date.now() + expires_in * 1000`，**不**提前 5 分钟（与 Anthropic 不同）

### 4.7 模块依赖的懒加载

由于此模块可在浏览器环境被引用（虽然是 Node.js 专用功能），使用了懒加载避免打包问题：

```typescript
// NEVER convert to top-level imports - breaks browser/Vite builds
let _randomBytes: typeof import("node:crypto").randomBytes | null = null;
let _http: typeof import("node:http") | null = null;
if (typeof process !== "undefined" && (process.versions?.node || process.versions?.bun)) {
  import("node:crypto").then((m) => { _randomBytes = m.randomBytes; });
  import("node:http").then((m) => { _http = m; });
}
```

## 5. API Key 管理

### 5.1 存储后端抽象

```typescript
interface AuthStorageBackend {
  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
  withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}
```

实现了两种后端：
- `FileAuthStorageBackend`: 文件存储，支持文件锁
- `InMemoryAuthStorageBackend`: 内存存储，用于测试

### 5.2 凭证类型

```typescript
type ApiKeyCredential = {
  type: "api_key";
  key: string;
};

type OAuthCredential = {
  type: "oauth";
} & OAuthCredentials;

type AuthCredential = ApiKeyCredential | OAuthCredential;
```

### 5.3 优先级顺序

```typescript
async getApiKey(providerId: string, options?: { includeFallback?: boolean }): Promise<string | undefined> {
  // 1. 运行时覆盖 (CLI --api-key)
  const runtimeKey = this.runtimeOverrides.get(providerId);
  if (runtimeKey) return runtimeKey;

  const cred = this.data[providerId];

  // 2. 存储的 API key
  if (cred?.type === "api_key") {
    return resolveConfigValue(cred.key);
  }

  // 3. OAuth token (自动刷新)
  if (cred?.type === "oauth") {
    const provider = getOAuthProvider(providerId);
    if (provider) {
      const needsRefresh = Date.now() >= cred.expires;
      if (needsRefresh) {
        const result = await this.refreshOAuthTokenWithLock(providerId);
        if (result) return result.apiKey;
      }
      return provider.getApiKey(cred);
    }
  }

  // 4. 环境变量
  const envKey = getEnvApiKey(providerId);
  if (envKey) return envKey;

  // 5. Fallback resolver (models.json 自定义 providers)
  if (options?.includeFallback !== false) {
    return this.fallbackResolver?.(providerId) ?? undefined;
  }

  return undefined;
}
```

## 6. Token 刷新机制

### 6.1 分布式锁设计

当多个 pi 实例同时运行时，使用文件锁防止竞态条件：

```typescript
private async refreshOAuthTokenWithLock(
  providerId: OAuthProviderId,
): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
  const provider = getOAuthProvider(providerId);
  if (!provider) return null;

  const result = await this.storage.withLockAsync(async (current) => {
    const currentData = this.parseStorageData(current);
    this.data = currentData;
    this.loadError = null;

    const cred = currentData[providerId];
    if (cred?.type !== "oauth") return { result: null };

    // 检查是否真的需要刷新（其他实例可能已刷新）
    if (Date.now() < cred.expires) {
      return { result: { apiKey: provider.getApiKey(cred), newCredentials: cred } };
    }

    // 执行刷新
    const refreshed = await getOAuthApiKey(providerId, oauthCreds);
    if (!refreshed) return { result: null };

    // 合并并持久化
    const merged: AuthStorageData = {
      ...currentData,
      [providerId]: { type: "oauth", ...refreshed.newCredentials },
    };
    this.data = merged;
    return { result: refreshed, next: JSON.stringify(merged, null, 2) };
  });

  return result;
}
```

### 6.2 刷新失败处理

```typescript
try {
  const result = await this.refreshOAuthTokenWithLock(providerId);
  if (result) return result.apiKey;
} catch (error) {
  this.recordError(error);
  // 刷新失败 - 重新读取文件检查其他实例是否成功
  this.reload();
  const updatedCred = this.data[providerId];

  if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
    // 其他实例刷新成功，使用那些凭证
    return provider.getApiKey(updatedCred);
  }

  // 刷新真正失败 - 返回 undefined
  return undefined;
}
```

## 7. 环境变量支持

### 7.1 Provider 映射

```typescript
function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  if (provider === "github-copilot") {
    return ["COPILOT_GITHUB_TOKEN"];
  }

  // ANTHROPIC_OAUTH_TOKEN 优先于 ANTHROPIC_API_KEY
  if (provider === "anthropic") {
    return ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
  }

  const envMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    "azure-openai-responses": "AZURE_OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GEMINI_API_KEY",
    "google-vertex": "GOOGLE_CLOUD_API_KEY",
    // ... 更多映射
  };

  const envVar = envMap[provider];
  return envVar ? [envVar] : undefined;
}
```

### 7.2 特殊 Provider

#### Google Vertex AI (ADC)

```typescript
if (provider === "google-vertex") {
  const hasCredentials = hasVertexAdcCredentials();
  const hasProject = !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
  const hasLocation = !!process.env.GOOGLE_CLOUD_LOCATION;

  if (hasCredentials && hasProject && hasLocation) {
    return "<authenticated>";
  }
}
```

#### Amazon Bedrock

```typescript
if (provider === "amazon-bedrock") {
  // 支持多种凭证来源：
  // 1. AWS_PROFILE
  // 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
  // 3. AWS_BEARER_TOKEN_BEDROCK
  // 4. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI (ECS)
  // 5. AWS_WEB_IDENTITY_TOKEN_FILE (IRSA)
  if (
    process.env.AWS_PROFILE ||
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE
  ) {
    return "<authenticated>";
  }
}
```

## 8. OAuth 在 Provider 中的使用

### 8.1 Anthropic Provider

```typescript
function createClient(
  model: Model<"anthropic-messages">,
  apiKey: string,
  // ...
): { client: Anthropic; isOAuthToken: boolean } {
  const isOAuthToken = isOAuthToken(apiKey);

  if (isOAuthToken(apiKey)) {
    return {
      client: new Anthropic({
        apiKey: null,
        authToken: apiKey,  // OAuth 使用 Bearer auth
        baseURL: model.baseUrl,
        defaultHeaders: {
          "anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20"].join(","),
          "user-agent": `claude-cli/${claudeCodeVersion}`,
          "x-app": "cli",
        },
      }),
      isOAuthToken: true,
    };
  }

  // API key auth
  return {
    client: new Anthropic({
      apiKey,  // API key 使用 apiKey auth
      authToken: null,
      baseURL: model.baseUrl,
    }),
    isOAuthToken: false,
  };
}

function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}
```

### 8.2 GitHub Copilot Provider

```typescript
if (model.provider === "github-copilot") {
  const client = new Anthropic({
    apiKey: null,
    authToken: apiKey,  // Bearer auth
    baseURL: model.baseUrl,
    defaultHeaders: mergeHeaders(
      {
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": betaFeatures.join(","),
      },
      copilotDynamicHeaders,  // 动态生成的请求头
      model.headers,
      optionsHeaders,
    ),
  });

  return { client, isOAuthToken: false };
}
```

## 9. 用户界面组件

### 9.1 OAuth Selector

提供登录/登出的 provider 选择界面：

```typescript
export class OAuthSelectorComponent extends Container implements Focusable {
  private searchInput: Input;
  private filteredProviders: AuthSelectorProvider[];
  private selectedIndex: number = 0;
  private mode: "login" | "logout";

  private formatStatusIndicator(provider: AuthSelectorProvider): string {
    const credential = this.authStorage.get(provider.id);
    if (credential?.type === provider.authType) return " ✓ configured";
    if (credential) {
      const label = credential.type === "oauth" ? "subscription configured" : "API key configured";
      return " • " + label;
    }
    // ... 其他状态
  }
}
```

### 9.2 Login Dialog

处理 OAuth 登录流程的用户界面：

```typescript
export class LoginDialogComponent extends Container implements Focusable {
  private contentContainer: Container;
  private input: Input;
  private abortController = new AbortController();

  showAuth(url: string, instructions?: string): void {
    // 显示 URL 并尝试打开浏览器
    const openCmd = process.platform === "darwin" ? "open" :
                    process.platform === "win32" ? "start" : "xdg-open";
    exec(`${openCmd} "${url}"`);
  }

  showPrompt(message: string, placeholder?: string): Promise<string> {
    // 显示输入框并等待用户输入
    return new Promise((resolve, reject) => {
      this.inputResolver = resolve;
      this.inputRejecter = reject;
    });
  }
}
```

## 10. 认证失败处理

### 10.1 错误记录

```typescript
export class AuthStorage {
  private errors: Error[] = [];

  private recordError(error: unknown): void {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    this.errors.push(normalizedError);
  }

  drainErrors(): Error[] {
    const drained = [...this.errors];
    this.errors = [];
    return drained;
  }
}
```

### 10.2 状态查询

```typescript
getAuthStatus(provider: string): AuthStatus {
  if (this.data[provider]) {
    return { configured: true, source: "stored" };
  }

  if (this.runtimeOverrides.has(provider)) {
    return { configured: false, source: "runtime", label: "--api-key" };
  }

  const envKeys = findEnvKeys(provider);
  if (envKeys?.[0]) {
    return { configured: false, source: "environment", label: envKeys[0] };
  }

  if (this.fallbackResolver?.(provider)) {
    return { configured: false, source: "fallback", label: "custom provider config" };
  }

  return { configured: false };
}
```

## 11. 关键设计总结

| 特性 | 实现方式 |
|------|---------|
| **OAuth 流程** | 授权码 + PKCE (Anthropic/OpenAI Codex 浏览器模式), Device Code + RFC 8628 (GitHub Copilot, OpenAI Codex headless 模式) |
| **Device Code 轮询** | 独立 `device-code.ts` 模块，支持 slow_down、超时检测、可中断 |
| **Token 刷新** | 自动刷新 + 文件锁防止竞态条件 |
| **凭证存储** | JSON 文件 (auth.json) + 内存缓存 |
| **优先级** | 运行时 > 存储 > OAuth > 环境变量 > Fallback |
| **多实例** | 文件锁确保只有一个实例执行刷新 |
| **错误恢复** | 刷新失败后重读文件，使用其他实例的刷新结果 |
| **特殊 Provider** | Google Vertex ADC, Amazon Bedrock IAM, GitHub Enterprise |
| **安全** | PKCE, 提前5分钟过期 (Anthropic/Copilot), 文件权限 0600 |
| **UI 集成** | 登录对话框、provider 选择器、状态指示器、登录方式选择 |
| **Copilot 特性** | 自动启用模型、动态 proxy-ep 解析、企业版支持 |
| **OpenAI Codex 特性** | 双模式登录（浏览器/设备码）、手动输入竞速、JWT accountId 提取 |

## 12. 安全考虑

1. **PKCE (Proof Key for Code Exchange)**: 防止授权码拦截攻击
2. **State 参数**: 防止 CSRF 攻击
3. **提前过期**: Anthropic 和 GitHub Copilot 的 Token 在实际过期前 5 分钟标记为过期，避免临界情况；OpenAI Codex 使用精确过期时间
4. **文件权限**: auth.json 创建时设置 0600 权限
5. **Bearer 认证**: OAuth token 使用 Authorization header 而非查询参数

## 13. 扩展性

### 注册自定义 Provider

```typescript
import { registerOAuthProvider } from "@earendil-works/pi-ai/oauth";

registerOAuthProvider({
  id: "my-provider",
  name: "My Provider",
  usesCallbackServer: false,

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    // 实现登录逻辑
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    // 实现刷新逻辑
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },

  modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[] {
    // 可选：修改模型配置
  },
});
```

### Provider Registry 管理

除了 `registerOAuthProvider` 外，提供了完整的 registry 生命周期管理：

```typescript
import {
  registerOAuthProvider,
  unregisterOAuthProvider,
  resetOAuthProviders,
  getOAuthProviders,
  getOAuthProvider,
} from "@earendil-works/pi-ai/oauth";

// 注册自定义 provider（覆盖同 ID 的 built-in provider）
registerOAuthProvider({ ... });

// 注销 provider
// - 如果是 built-in provider，恢复为 built-in 实现
// - 如果是自定义 provider，完全移除
unregisterOAuthProvider("my-provider");

// 重置所有 provider 为 built-in 实现
resetOAuthProviders();

// 获取所有已注册的 provider
const providers: OAuthProviderInterface[] = getOAuthProviders();

// 按 ID 获取单个 provider
const provider = getOAuthProvider("anthropic");
```

### 自定义认证存储后端

```typescript
import { AuthStorage, AuthStorageBackend } from "@earendil-works/pi-ai/coding-agent";

class CustomAuthBackend implements AuthStorageBackend {
  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    // 实现同步锁逻辑
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
    // 实现异步锁逻辑
  }
}

const storage = AuthStorage.fromStorage(new CustomAuthBackend());
```
