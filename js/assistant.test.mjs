import test from 'node:test';
import assert from 'node:assert/strict';

const assistant = await import('./assistant.js');

test('buildMessages：system 开头，历史裁剪，问题在末尾', () => {
  const past = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `q${i}` }));
  const messages = assistant.buildMessages({ question: '这题怎么做？', history: past });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /刷题助手/);
  assert.equal(messages.length, 1 + 20 + 1);
  assert.equal(messages.at(-1).content, '这题怎么做？');
  assert.equal(messages[1].content, 'q10'); // 只保留最近 20 条
});

test('buildMessages：附带题目上下文与草稿', () => {
  const messages = assistant.buildMessages({
    question: '哪里错了？',
    context: { kind: 'problem', title: '1. 两数之和', body: '给定数组 nums……' },
    draft: { lang: 'python', mode: 'core', code: 'def twoSum():\n    pass' },
  });
  const last = messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /【当前题目】1\. 两数之和/);
  assert.match(last.content, /给定数组 nums……/);
  assert.match(last.content, /【我的代码（python \/ core）】/);
  assert.ok(last.content.indexOf('给定数组') < last.content.indexOf('哪里错了？'));
});

test('buildMessages：文章上下文使用对应标签；超长内容截断', () => {
  const messages = assistant.buildMessages({
    question: '总结一下',
    context: { kind: 'article', title: '时间复杂度入门', body: 'x'.repeat(9000) },
  });
  const last = messages.at(-1);
  assert.match(last.content, /【当前知识文章】时间复杂度入门/);
  assert.match(last.content, /内容过长已截断/);
});

test('上下文注册表：读写与清空', () => {
  assistant.setAssistantContext({ kind: 'problem', title: 't', body: 'b' });
  assert.deepEqual(assistant.getAssistantContext(), { kind: 'problem', title: 't', body: 'b' });
  assistant.setAssistantContext({ kind: 'weird', title: 't', body: 'b' });
  assert.equal(assistant.getAssistantContext().kind, 'problem'); // 未知 kind 归一为 problem
  assistant.setAssistantContext(null);
  assert.equal(assistant.getAssistantContext(), null);
});

test('上下文变更时通知监听器，异常监听不影响设置', () => {
  const seen = [];
  assistant.setContextListener((ctx) => seen.push(ctx));
  assistant.setAssistantContext({ kind: 'article', title: 'a', body: 'b' });
  assistant.setAssistantContext(null);
  assert.deepEqual(seen, [{ kind: 'article', title: 'a', body: 'b' }, null]);
  assistant.setContextListener(() => { throw new Error('boom'); });
  assistant.setAssistantContext(null); // 不应抛出
  assistant.setContextListener(null);
  assistant.setAssistantContext({ kind: 'problem', title: 'x', body: 'y' });
  assert.equal(seen.length, 2); // 注销后不再通知
});

test('草稿读取器：注册、异常与注销', () => {
  assert.equal(assistant.getDraft(), null);
  assistant.registerDraftProvider(() => ({ lang: 'python', mode: 'core', code: '  ' }));
  assert.equal(assistant.getDraft(), null); // 空草稿视为无
  assistant.registerDraftProvider(() => ({ lang: 'javascript', mode: 'acm', code: 'let a = 1;' }));
  assert.equal(assistant.getDraft().code, 'let a = 1;');
  assistant.registerDraftProvider(() => { throw new Error('boom'); });
  assert.equal(assistant.getDraft(), null);
  assistant.registerDraftProvider(null);
  assert.equal(assistant.getDraft(), null);
});

test('对话历史：追加与清空', () => {
  assistant.clearHistory();
  assistant.appendHistory('user', '你好');
  assistant.appendHistory('assistant', '你好！');
  assert.deepEqual(assistant.getHistory(), [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！' },
  ]);
  assistant.clearHistory();
  assert.deepEqual(assistant.getHistory(), []);
});

test('resolveConfig：预设回退与斜杠裁剪', () => {
  assert.deepEqual(assistant.resolveConfig({ preset: 'deepseek', baseUrl: '', apiKey: 'k', model: '' }), {
    baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', viaProxy: false,
  });
  const custom = assistant.resolveConfig({ preset: 'custom', baseUrl: 'http://127.0.0.1:9000/v1/', apiKey: 'k', model: 'm' });
  assert.equal(custom.baseUrl, 'http://127.0.0.1:9000/v1');
  assert.equal(custom.model, 'm');
  const unknown = assistant.resolveConfig({ preset: 'nope', baseUrl: 'https://x/v1', apiKey: '', model: '' });
  assert.equal(unknown.baseUrl, 'https://x/v1');
});

test('resolveConfig：命中不支持跨域的端点时自动改走本地代理', () => {
  const via = assistant.resolveConfig({ preset: 'custom', baseUrl: 'https://api.kimi.com/coding/v1/', apiKey: 'k', model: 'kimi-k2' });
  assert.equal(via.baseUrl, 'http://127.0.0.1:8966/v1');
  assert.equal(via.viaProxy, true);
  // 只填裸地址（没带 /v1）时自动补全；官方端点不受影响
  assert.equal(assistant.proxyUrlFor('https://api.kimi.com/coding'), 'http://127.0.0.1:8966/v1');
  assert.equal(assistant.proxyUrlFor('https://api.moonshot.cn/v1'), null);
  const official = assistant.resolveConfig({ preset: 'moonshot', baseUrl: '', apiKey: 'k', model: '' });
  assert.equal(official.viaProxy, false);
});

test('SSE 解析：普通分片、跨 chunk 断行、[DONE] 与注释行', () => {
  let out = '';
  const parser = assistant.createSseParser((d) => { out += d; });
  parser.feed(': ping\n\ndata: {"choices":[{"delta":{"content":"你"}}]}\n\n');
  assert.equal(out, '你');
  // 第二条消息跨两个 chunk
  parser.feed('data: {"choices":[{"delta":{"con');
  assert.equal(out, '你');
  parser.feed('tent":"好"}}]}\ndata: [DONE]\n');
  parser.flush();
  assert.equal(out, '你好');
});

test('SSE 解析：\\r\\n 行尾与非法 JSON 行跳过', () => {
  let out = '';
  const parser = assistant.createSseParser((d) => { out += d; });
  parser.feed('data: not-json\r\n');
  parser.feed('data: {"choices":[{"delta":{"content":"A"}}]}\r\n');
  parser.feed('event: message\r\n');
  parser.flush();
  assert.equal(out, 'A');
});

test('SSE 解析：[DONE] 后忽略同批次与后续分片内容', () => {
  let out = '';
  const parser = assistant.createSseParser(delta => { out += delta; });
  const token = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
  parser.feed(token('有效'));
  parser.feed('data: [DO');
  assert.equal(parser.done, false);
  parser.feed(`NE]\r\n${token('忽略')}data: {`);
  assert.equal(parser.done, true);
  parser.feed(token('也忽略'));
  parser.flush();
  assert.equal(out, '有效');
});

test('SSE 解析：末行没有换行的 [DONE] 在 flush 时终止', () => {
  const parser = assistant.createSseParser(() => assert.fail('不能输出结束后的内容'));
  parser.feed('data: [DONE]');
  parser.flush();
  assert.equal(parser.done, true);
  parser.feed('data: {"choices":[{"delta":{"content":"忽略"}}]}\n');
  parser.flush();
});

test('chat：[DONE] 结束仍开放的响应流并释放读取锁', { timeout: 1000 }, async (t) => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"完成"}}]}\ndata: [DONE]\n',
      ));
    },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(stream));
  let output = '';
  await assistant.chat({
    config: { preset: 'custom', baseUrl: 'https://example.test/v1', apiKey: 'synthetic', model: 'm' },
    messages: [],
    onToken: token => { output += token; },
  });
  assert.equal(output, '完成');
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test('chat：缺少配置时给出明确错误', async () => {
  await assert.rejects(
    assistant.chat({ config: { preset: 'custom', baseUrl: '', apiKey: '', model: '' }, messages: [] }),
    /尚未配置 API 接口地址/
  );
  await assert.rejects(
    assistant.chat({ config: { preset: 'custom', baseUrl: 'http://x/v1', apiKey: '', model: 'm' }, messages: [] }),
    /尚未配置 API Key/
  );
});
