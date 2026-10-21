import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the real router with deferred page loads and a small DOM boundary.
// Replacing module imports lets Node run these browser races without a browser.
const source = (await readFile(new URL('./app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/\bimport\(/g, 'loadModule(');

const article = { title: '数组', content: '数组知识正文' };
const problem = { id: 1, title: '两数之和', description: '题目正文' };
const settle = () => new Promise(resolve => setImmediate(resolve));

function createRouter(initialHash, slowKind) {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let assistantContext = null;
  const rendered = [];
  const listeners = new Map();
  const element = {
    textContent: '',
    addEventListener() {},
    hasAttribute: () => false,
    setAttribute() {},
    focus() {},
  };
  const app = {
    innerHTML: '',
    classList: { remove() {} },
    querySelector: () => element,
  };
  const document = {
    title: '',
    getElementById: () => app,
    createElement: () => ({ ...element }),
    body: { appendChild() {} },
    documentElement: { dataset: {} },
  };
  const location = { hash: initialHash };
  vm.runInNewContext(source, {
    document,
    location,
    window: { addEventListener: (event, handler) => listeners.set(event, handler) },
    hasArticle: () => true,
    hasProblem: () => true,
    loadArticle: () => slowKind === 'article' ? delayed : Promise.resolve(article),
    loadProblem: () => slowKind === 'problem' ? delayed : Promise.resolve(problem),
    getThemePref: () => 'light',
    setThemePref() {},
    initAssistant() {},
    setAssistantContext: context => { assistantContext = context; },
    loadModule: async () => ({
      renderKnowledgeDetail: () => rendered.push('article'),
      renderProblem: () => rendered.push('problem'),
    }),
    console,
  });
  return {
    navigate(hash) {
      location.hash = hash;
      return listeners.get('hashchange')();
    },
    release,
    getContext: () => structuredClone(assistantContext),
    document,
    rendered,
  };
}

test('a late article load cannot replace the active problem assistant context', async () => {
  const router = createRouter('#/knowledge/array-hashmap', 'article');
  await router.navigate('#/problem/1');
  router.release(article);
  await settle();
  assert.deepEqual(router.getContext(), {
    kind: 'problem', title: '1. 两数之和', body: problem.description,
  });
  assert.deepEqual(router.rendered, ['problem']);
  assert.equal(router.document.title, '1. 两数之和 · Hot 100 刷题');
});

test('a late problem load cannot replace the active article assistant context', async () => {
  const router = createRouter('#/problem/1', 'problem');
  await router.navigate('#/knowledge/array-hashmap');
  router.release(problem);
  await settle();
  assert.deepEqual(router.getContext(), {
    kind: 'article', title: article.title, body: article.content,
  });
  assert.deepEqual(router.rendered, ['article']);
  assert.equal(router.document.title, '数组 · Hot 100 刷题');
});
