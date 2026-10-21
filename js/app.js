// 入口：hash 路由 + 全局主题切换

import { hasArticle, loadArticle } from '../knowledge/index.js';
import { hasProblem, loadProblem } from '../problems/index.js';
import { getThemePref, setThemePref } from './store.js';
import { setAssistantContext } from './assistant.js';
import { initAssistant } from './views/assistant.js';

const app = document.getElementById('app');
let cleanup = null;
let routeSequence = 0;

// ---------- 全局主题切换（右下角悬浮按钮） ----------

function initThemeToggle() {
  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.title = '切换亮色 / 暗色';
  document.body.appendChild(btn);
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (window.monaco) {
      window.monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
    }
  };
  let theme = getThemePref();
  apply(theme);
  btn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    setThemePref(theme);
    apply(theme);
  });
}

initThemeToggle();
initAssistant();

function disposeCurrentView() {
  const dispose = cleanup;
  cleanup = null;
  if (dispose) {
    try {
      dispose();
    } catch (error) {
      console.error('页面清理失败', error);
    }
  }
  app.classList.remove('app-wide');
  setAssistantContext(null);
}

const BASE_TITLE = 'Hot 100 刷题';

function renderMessage(title, message, retry = false) {
  app.innerHTML = `
    <div class="empty-tip" style="margin-top:48px">
      <h2></h2>
      <p style="margin-top:12px"></p>
      ${retry ? '<button class="btn" type="button" style="margin-top:16px">重试</button>' : ''}
    </div>`;
  app.querySelector('h2').textContent = title;
  app.querySelector('p').textContent = message;
  if (retry) app.querySelector('button').addEventListener('click', route);
}

function finishRoute(sequence, title) {
  if (sequence !== routeSequence) return false;
  document.title = title;
  const focusTarget = app.querySelector('h1, h2') || app;
  if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
  focusTarget.focus({ preventScroll: true });
  return true;
}

function commitMessage(sequence, documentTitle, title, message, retry = false) {
  if (sequence !== routeSequence) return;
  renderMessage(title, message, retry);
  finishRoute(sequence, documentTitle);
}

function commitView(sequence, title, render) {
  if (sequence !== routeSequence) return;
  const dispose = render();
  if (sequence !== routeSequence) {
    if (typeof dispose === 'function') dispose();
    return;
  }
  cleanup = typeof dispose === 'function' ? dispose : null;
  finishRoute(sequence, title);
}

async function route() {
  const sequence = ++routeSequence;
  disposeCurrentView();
  renderMessage('加载中…', '正在加载页面资源');

  const hash = location.hash || '#/';
  try {
    if (hash === '#/') {
      const { renderList } = await import('./views/list.js');
      commitView(sequence, `题库 · ${BASE_TITLE}`, () => renderList(app));
      return;
    }
    if (hash === '#/mistakes') {
      const { renderMistakes } = await import('./views/mistakes.js');
      commitView(sequence, `错题集 · ${BASE_TITLE}`, () => renderMistakes(app));
      return;
    }
    if (hash === '#/knowledge') {
      const { renderKnowledge } = await import('./views/knowledge.js');
      commitView(sequence, `知识补充 · ${BASE_TITLE}`, () => renderKnowledge(app));
      return;
    }

    const knowledgeMatch = hash.match(/^#\/knowledge\/([a-z0-9-]+)$/);
    if (knowledgeMatch) {
      const slug = knowledgeMatch[1];
      if (!hasArticle(slug)) {
        commitMessage(sequence, `页面未找到 · ${BASE_TITLE}`, '404', '没有找到这篇知识文章');
        return;
      }
      const [{ renderKnowledgeDetail }, article] = await Promise.all([
        import('./views/knowledgeDetail.js'),
        loadArticle(slug),
      ]);
      if (sequence !== routeSequence) return;
      setAssistantContext({ kind: 'article', title: article.title, body: article.content });
      commitView(sequence, `${article.title} · ${BASE_TITLE}`, () => renderKnowledgeDetail(app, article));
      return;
    }

    const problemMatch = hash.match(/^#\/problem\/(\d+)$/);
    if (problemMatch) {
      const id = Number(problemMatch[1]);
      if (!hasProblem(id)) {
        commitMessage(sequence, `页面未找到 · ${BASE_TITLE}`, '404', '没有找到这道题目');
        return;
      }
      const [{ renderProblem }, problem] = await Promise.all([
        import('./views/problem.js'),
        loadProblem(id),
      ]);
      if (sequence !== routeSequence) return;
      setAssistantContext({ kind: 'problem', title: `${problem.id}. ${problem.title}`, body: problem.description });
      commitView(sequence, `${problem.id}. ${problem.title} · ${BASE_TITLE}`, () => renderProblem(app, problem));
      return;
    }

    commitMessage(sequence, `页面未找到 · ${BASE_TITLE}`, '404', '没有找到这个页面');
  } catch (error) {
    if (sequence !== routeSequence) return;
    console.error('页面加载失败', error);
    const detail = error instanceof Error ? error.message : String(error);
    commitMessage(sequence, `加载失败 · ${BASE_TITLE}`, '加载失败', detail || '请稍后重试', true);
  }
}

window.addEventListener('hashchange', route);
route();
