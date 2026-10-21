// AI 助手纯逻辑层（无 DOM，可在 Node 下测试）：
// - OpenAI 兼容 API 预设与流式（SSE）调用
// - 页面上下文注册表（当前题目 / 知识文章 / 草稿代码）
// - 内存中的对话历史（不落盘，刷新即清空）

export const PRESETS = [
  { id: 'moonshot', label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];

const SYSTEM_PROMPT = [
  '你是一个算法刷题助手，在一个 LeetCode Hot 100 本地刷题网页里回答用户的问题。',
  '要求：用简体中文回答；简洁聚焦，先讲思路再给代码；代码用 fenced code block 并标注语言。',
  '如果用户附带了当前题目或文章，优先结合该内容作答；用户贴出的代码有问题时先指出关键错误。',
].join('\n');

// 发送时最多携带的历史消息条数，防止 token 无限增长。
const MAX_HISTORY_MESSAGES = 20;
// 附带上下文与草稿的长度上限，避免把超长内容整个塞进请求。
const MAX_CONTEXT_CHARS = 8000;
const MAX_DRAFT_CHARS = 6000;

// ---------- 页面上下文注册表 ----------
// ctx = { kind: 'problem' | 'article', title: string, body: string } | null
let pageContext = null;
// draftProvider = () => ({ lang: string, mode: string, code: string } | null)
let draftProvider = null;
// 上下文在路由异步加载完成后才被设置，通过监听器通知 UI 刷新
let contextListener = null;

export function setAssistantContext(ctx) {
  pageContext = ctx && typeof ctx === 'object' && typeof ctx.title === 'string' && typeof ctx.body === 'string'
    ? { kind: ctx.kind === 'article' ? 'article' : 'problem', title: ctx.title, body: ctx.body }
    : null;
  if (contextListener) {
    try {
      contextListener(pageContext);
    } catch {
      // 监听器异常不影响路由
    }
  }
}

export function setContextListener(fn) {
  contextListener = typeof fn === 'function' ? fn : null;
}

export function getAssistantContext() {
  return pageContext;
}

export function registerDraftProvider(fn) {
  draftProvider = typeof fn === 'function' ? fn : null;
}

export function getDraft() {
  if (!draftProvider) return null;
  try {
    const draft = draftProvider();
    return draft && typeof draft.code === 'string' && draft.code.trim() ? draft : null;
  } catch {
    return null;
  }
}

// ---------- 对话历史（仅内存） ----------
const history = [];

export function getHistory() {
  return [...history];
}

export function appendHistory(role, content) {
  history.push({ role, content });
}

export function clearHistory() {
  history.length = 0;
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n……（内容过长已截断）` : text;
}

// 拼装一次请求的消息：system + 裁剪后的历史 + 当前问题（可携带页面上下文与草稿）。
export function buildMessages({ question, context = null, draft = null, history: past = [] } = {}) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  messages.push(...past.slice(-MAX_HISTORY_MESSAGES));
  let content = question;
  if (context) {
    const label = context.kind === 'article' ? '当前知识文章' : '当前题目';
    content = `【${label}】${context.title}\n${clip(context.body, MAX_CONTEXT_CHARS)}\n\n${content}`;
  }
  if (draft) {
    content += `\n\n【我的代码（${draft.lang} / ${draft.mode}）】\n\`\`\`\n${clip(draft.code, MAX_DRAFT_CHARS)}\n\`\`\``;
  }
  messages.push({ role: 'user', content });
  return messages;
}

// ---------- SSE 流式解析 ----------
// 返回一个增量解析器：feed(chunkText) 处理数据，回调 onDelta(content) 逐段输出，
// 兼容跨 chunk 断行、`data: [DONE]`、空行与注释行。
export function createSseParser(onDelta) {
  let buffer = '';
  let done = false;
  const handleLine = (line) => {
    if (done || !line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
      return;
    }
    if (!payload) return;
    try {
      const json = JSON.parse(payload);
      for (const choice of json.choices || []) {
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta) onDelta(delta);
      }
    } catch {
      // 半包/非 JSON 行直接跳过，后续 chunk 会补齐或自然结束
    }
  };
  return {
    get done() { return done; },
    feed(text) {
      if (done) return;
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 最后一段可能是不完整的行，留给下一次
      for (const line of lines) {
        handleLine(line.replace(/\r$/, ''));
        if (done) {
          buffer = '';
          break;
        }
      }
    },
    flush() {
      if (buffer) {
        handleLine(buffer.replace(/\r$/, ''));
        buffer = '';
      }
    },
  };
}

// ---------- API 调用 ----------
// 已知不支持浏览器跨域直连的端点：命中时自动改走本地 CORS 代理（tools/cors-proxy.mjs）。
// bare：用户只填到 match、没带版本路径（/v1）时的补全路径。
const LOCAL_PROXY_BASE = 'http://127.0.0.1:8966';
const PROXY_ROUTES = [
  { match: 'https://api.kimi.com/coding', bare: '/v1' },
];

export function proxyUrlFor(baseUrl) {
  for (const route of PROXY_ROUTES) {
    if (baseUrl === route.match) return LOCAL_PROXY_BASE + route.bare;
    if (baseUrl.startsWith(`${route.match}/`)) return LOCAL_PROXY_BASE + baseUrl.slice(route.match.length);
  }
  return null;
}

export function resolveConfig(cfg) {
  const preset = PRESETS.find((p) => p.id === cfg?.preset) || PRESETS.find((p) => p.id === 'custom');
  const direct = (cfg?.baseUrl || preset.baseUrl).replace(/\/+$/, '');
  const proxied = proxyUrlFor(direct);
  return {
    baseUrl: proxied || direct,
    apiKey: cfg?.apiKey || '',
    model: cfg?.model || preset.model,
    viaProxy: proxied !== null,
  };
}

export async function chat({ config, messages, signal, onToken }) {
  const { baseUrl, apiKey, model, viaProxy } = resolveConfig(config);
  if (!baseUrl) throw new Error('尚未配置 API 接口地址');
  if (!apiKey) throw new Error('尚未配置 API Key');
  if (!model) throw new Error('尚未配置模型名');
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (viaProxy) {
      throw new Error('无法连接本地代理（127.0.0.1:8966）：该接口不支持浏览器直连，需要本地代理转发。请用一键启动脚本启动，或手动运行 node tools/cors-proxy.mjs');
    }
    throw new Error(`无法连接 API（可能是网络或跨域问题）：${error?.message || error}`);
  }
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`API 返回错误（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onToken);
  try {
    while (!parser.done) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.flush();
  } finally {
    // [DONE] ends the response even if the server keeps its HTTP stream open.
    if (parser.done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
