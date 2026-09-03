// 列表页：进度统计 + 按难度（默认）/平铺/按分类分组视图 + 筛选/搜索

import { problems, allTags } from '../../problems/index.js';
import {
  getProgress,
  getLearningState,
  getMistakes,
  exportAll,
  importAll,
  getListView,
  setListView,
  getCollapsedGroups,
  setCollapsedGroups,
  getListFilters,
  setListFilters,
  getOnboardingDismissed,
  setOnboardingDismissed,
  MAX_BACKUP_BYTES,
} from '../store.js';
import { recommendTodayDetailed, RECOMMEND_REASONS } from '../recommend.js';
import { isReviewDue } from '../review.js';
import { topbarHtml } from './topbar.js';

const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '困难' };
const DIFF_ORDER = ['easy', 'medium', 'hard'];
const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };
const VIEWS = [
  ['diff', '按难度'],
  ['flat', '平铺'],
  ['tags', '按分类'],
];

// 分类视图：每题只归入最具特征的一个分类，避免一题在多组中重复。
// 顺序即分组展示顺序——辨识度高的技巧标签靠前，宽泛标签靠后兜底。
const CATEGORY_PRIORITY = [
  '单调栈', '单调队列', '滑动窗口', '链表', '堆（优先队列）', '双指针',
  '前缀和', '贪心', '回溯', '动态规划', '字典树', '设计',
  '二分查找', '记忆化搜索', '拓扑排序', '位运算', '二叉搜索树', '二叉树',
  '树', '图', '深度优先搜索', '广度优先搜索', '哈希表', '双向链表',
  '栈', '队列', '数据流', '矩阵', '数学', '字符串',
  '模拟', '排序', '计数', '分治', '归并排序', '快速选择',
  '桶排序', '组合数学', '并查集', '递归', '数组',
];
const CATEGORY_RANK = new Map(CATEGORY_PRIORITY.map((t, i) => [t, i]));

// 分组的展示顺序：按专题内容本身的学习难度由易到难（与知识库学习路径一致），
// 与组内题目数量、题目难度标签无关。未列出的标签排最后。
const TOPIC_ORDER = [
  '数学', '模拟', '数组', '哈希表', '前缀和', '计数', '字符串',
  '双指针', '滑动窗口',
  '链表', '双向链表', '递归',
  '栈', '队列', '单调栈', '单调队列',
  '树', '二叉树', '二叉搜索树', '深度优先搜索', '广度优先搜索',
  '图', '并查集', '拓扑排序', '矩阵',
  '二分查找', '回溯', '动态规划', '记忆化搜索',
  '堆（优先队列）', '贪心', '排序', '设计',
  '位运算', '字典树', '分治', '归并排序', '快速选择', '桶排序', '组合数学', '数据流',
];
const TOPIC_RANK = new Map(TOPIC_ORDER.map((t, i) => [t, i]));
export { TOPIC_ORDER, TOPIC_RANK };

// 一题有多个标签时，取优先级最高（最具特征）的标签作为它的唯一分类。
export function primaryCategory(p) {
  let best = p.tags[0] || '其他';
  let bestRank = CATEGORY_RANK.get(best) ?? CATEGORY_PRIORITY.length;
  for (const t of p.tags) {
    const rank = CATEGORY_RANK.get(t) ?? CATEGORY_PRIORITY.length;
    if (rank < bestRank) {
      best = t;
      bestRank = rank;
    }
  }
  return best;
}
const STATUS_FILTERS = [
  ['', '全部'],
  ['none', '未开始'],
  ['attempted', '已尝试'],
  ['solved', '已通过'],
  ['mistake', '错题'],
  ['review', '待复习', '已到计划复习时间的题目'],
];
// 与做题页约定：进入题目前写入当前筛选结果 id 序列，供上一题/下一题使用。
const LIST_QUEUE_KEY = 'hot100_list_queue';
const LIST_SCROLL_KEY = 'hot100_list_scroll_y';
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderList(container) {
  const savedFilters = getListFilters();
  const state = {
    q: savedFilters.q,
    diff: DIFF_ORDER.includes(savedFilters.diff) ? savedFilters.diff : '',
    tag: allTags.includes(savedFilters.tag) ? savedFilters.tag : '',
    status: STATUS_FILTERS.some(([v]) => v === savedFilters.status) ? savedFilters.status : '',
    view: getListView(),
  };
  const collapsed = new Set(getCollapsedGroups());

  const progress = getProgress();
  const learning = getLearningState();
  const mistakes = getMistakes();
  const now = Date.now();
  const total = problems.length;
  // localStorage 是同步 API。列表重绘时不能为每一行重复读取、解析同一份 JSON；
  // 进入页面时建立一次快照，后续筛选、分组与随机选题均做 O(1) 内存查询。
  const statusById = new Map(problems.map((problem) => {
    const modes = progress[problem.id];
    let status = 'none';
    if (modes?.core?.solved || modes?.acm?.solved) status = 'solved';
    else if ((modes?.core?.attempts || 0) > 0 || (modes?.acm?.attempts || 0) > 0) status = 'attempted';
    return [problem.id, status];
  }));
  const problemStatus = (id) => statusById.get(id) || 'none';
  const isMistake = (id) => Boolean(mistakes[id]);
  const solvedCount = problems.filter((p) => problemStatus(p.id) === 'solved').length;
  const diffStats = DIFF_ORDER.map((d) => {
    const list = problems.filter((p) => p.difficulty === d);
    const solved = list.filter((p) => problemStatus(p.id) === 'solved').length;
    return { d, solved, total: list.length };
  });
  const coreSolved = problems.filter((p) => progress[p.id] && progress[p.id].core && progress[p.id].core.solved).length;
  const acmSolved = problems.filter((p) => progress[p.id] && progress[p.id].acm && progress[p.id].acm.solved).length;
  const independentCount = problems.filter((p) => learning.problems[String(p.id)]?.mastery === 'independent').length;
  const assistedCount = problems.filter((p) => learning.problems[String(p.id)]?.mastery === 'assisted').length;
  const reviewDueCount = problems.filter((p) => isReviewDue(learning.problems[String(p.id)]?.review, now)).length;
  const problemById = new Map(problems.map((p) => [String(p.id), p]));
  // 新用户（没有任何学习记录）兜底：简单优先 + 题号升序，推荐前三题。
  const isNewUser = Object.keys(learning.problems).length === 0;
  const todayItems = isNewUser
    ? [...problems]
        .sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty) || a.id - b.id)
        .slice(0, 3)
        .map((p) => ({ p, reason: 'new' }))
    : recommendTodayDetailed(problems.map((p) => p.id), learning, { at: now, limit: 3 })
        .map(({ id, reason }) => ({ p: problemById.get(String(id)), reason }))
        .filter((item) => item.p);

  container.innerHTML = `
    ${topbarHtml('list')}
    ${
      getOnboardingDismissed()
        ? ''
        : `<div class="onboarding-banner" id="onboarding-banner">
        <span>第一次来？建议先读<a href="#/knowledge/complexity">《时间复杂度入门》</a>，再从<a href="#/problem/1">第 1 题</a>开始。</span>
        <button type="button" class="onboarding-close" id="onboarding-close" aria-label="关闭新手提示">×</button>
      </div>`
    }
    <div class="stats" aria-label="刷题统计">
      <div class="stat-card">
        <div class="num">${solvedCount} / ${total}</div>
        <div class="label">已通过题目</div>
        <div class="bar" role="progressbar" aria-label="已通过进度" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${solvedCount}"><div style="width: ${total ? Math.round((solvedCount / total) * 100) : 0}%"></div></div>
      </div>
      <div class="stat-card">
        <div class="num" style="font-size:16px;padding-top:4px">
          ${diffStats
            .map(
              (s) =>
                `<span class="diff ${s.d}" style="width:auto">${DIFF_LABEL[s.d]}</span> ${s.solved}/${s.total}`
            )
            .join(' &nbsp;·&nbsp; ')}
        </div>
        <div class="label">按难度通过情况</div>
      </div>
      <div class="stat-card" title="核心代码：只写函数本体；ACM：自己处理输入输出">
        <div class="num" style="font-size:16px;padding-top:4px">核心 ${coreSolved} · ACM ${acmSolved}</div>
        <div class="label">按模式通过题目数</div>
      </div>
      <div class="stat-card" title="独立掌握 = 不看提示和题解通过；借助 = 看过提示或题解；待复习 = 已到计划复习时间">
        <div class="num" style="font-size:16px;padding-top:4px">独立 ${independentCount} · 借助 ${assistedCount} · 待复习 ${reviewDueCount}</div>
        <div class="label">学习掌握状态</div>
      </div>
    </div>
    <section class="pgroup" id="today-section" aria-labelledby="today-title">
      <div class="pgroup-head">
        <span class="pgroup-name" id="today-title">今日任务</span>
        <span class="pgroup-count">${todayItems.length} 题</span>
      </div>
      <div class="pgroup-body">
        ${todayItems.length ? todayItems.map(({ p, reason }) => rowHtml(p, reason)).join('') : '<div class="empty-tip">暂无可推荐题目</div>'}
      </div>
    </section>
    <div class="filters" role="search" aria-label="题目筛选">
      <input type="search" id="f-q" aria-label="搜索题目" placeholder="搜索题目（编号 / 名称）" value="${escapeHtml(state.q)}">
      <select id="f-diff" aria-label="按难度筛选">
        <option value="">全部难度</option>
        ${DIFF_ORDER.map((d) => `<option value="${d}">${DIFF_LABEL[d]}</option>`).join('')}
      </select>
      <select id="f-tag" aria-label="按标签筛选">
        <option value="">全部标签</option>
        ${allTags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
      </select>
      <div class="seg" id="view-seg" role="group" aria-label="列表视图">
        ${VIEWS.map(([v, l]) => `<button data-view="${v}" class="${v === state.view ? 'active' : ''}" aria-pressed="${v === state.view}">${l}</button>`).join('')}
      </div>
      <button class="tool-btn" id="random-btn" title="随机跳转到一道未通过的题">🎲 随机一题</button>
      <button class="tool-btn" id="toggle-groups" hidden aria-expanded="true">全部折叠</button>
    </div>
    <div class="filters" style="padding-top:0">
      <div class="chips" id="status-chips" role="group" aria-label="按完成状态筛选">
        ${STATUS_FILTERS.map(([v, l, t]) => `<button data-s="${v}" class="${v === state.status ? 'active' : ''}" aria-pressed="${v === state.status}"${t ? ` title="${t}"` : ''}>${l}</button>`).join('')}
      </div>
      <span id="filter-result" class="data-tip" role="status" aria-live="polite"></span>
    </div>
    <div id="plist-wrap"></div>
    <div class="footer-tip">进度、代码草稿与列表偏好由浏览器本地保存 · 判题在本地浏览器内完成</div>
    <div class="data-bar">
      <button class="tool-btn" id="export-btn">⬇ 导出刷题数据</button>
      <label for="import-mode" class="data-tip">导入方式</label>
      <select id="import-mode" aria-label="导入方式">
        <option value="merge">合并现有数据</option>
        <option value="replace">替换现有数据</option>
      </select>
      <button class="tool-btn" id="import-btn">⬆ 选择备份文件</button>
      <input type="file" id="import-file" accept=".json,application/json" hidden>
      <span class="data-tip" id="data-tip" role="status" aria-live="polite"></span>
    </div>
  `;

  const wrapEl = container.querySelector('#plist-wrap');
  // 下拉选项应用持久化的筛选值（搜索框与 chips 已在模板中回填）。
  container.querySelector('#f-diff').value = state.diff;
  container.querySelector('#f-tag').value = state.tag;

  function statusIcon(id) {
    const st = problemStatus(id);
    if (st === 'solved') return '<span class="solved" role="img" aria-label="已通过" title="已通过">✓</span>';
    if (st === 'attempted') return '<span class="attempted" role="img" aria-label="已尝试" title="已尝试">◐</span>';
    return '<span aria-label="未开始" title="未开始">—</span>';
  }

  function modeBadges(id) {
    const p = progress[id] || {};
    const learned = learning.problems[String(id)];
    const coreDone = p.core && p.core.solved;
    const acmDone = p.acm && p.acm.solved;
    const mastery = learned?.mastery === 'independent'
      ? '<span class="mode-badge done" title="独立掌握 = 不看提示和题解通过">独立掌握</span>'
      : learned?.mastery === 'assisted'
        ? '<span class="mode-badge" title="在提示或答案帮助下通过">借助通过</span>'
        : '';
    const review = isReviewDue(learned?.review, now)
      ? '<span class="mode-badge" title="已到计划复习时间">待复习</span>'
      : '';
    return `<div class="mode-badges" aria-label="题目状态">
      ${mastery}${review}
      <span class="mode-badge ${coreDone ? 'done' : ''}" title="核心代码模式：只写函数本体">核心${coreDone ? ' ✓' : ''}</span>
      <span class="mode-badge ${acmDone ? 'done' : ''}" title="ACM 模式：自己处理输入输出">ACM${acmDone ? ' ✓' : ''}</span>
    </div>`;
  }

  function rowHtml(p, reason = '') {
    const reasonBadge = RECOMMEND_REASONS[reason]
      ? `<span class="rec-reason rec-reason-${reason}">${RECOMMEND_REASONS[reason]}</span>`
      : '';
    return `
      <div class="plist-row" data-pid="${p.id}">
        <div class="status">${statusIcon(p.id)}</div>
        <div class="pid">${p.id}</div>
        <div class="ptitle"><a href="#/problem/${p.id}">${escapeHtml(p.title)}</a>${reasonBadge}</div>
        ${modeBadges(p.id)}
        <div class="row-tags">${p.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        <div class="diff ${p.difficulty}">${DIFF_LABEL[p.difficulty]}</div>
      </div>`;
  }

  function match(p) {
    const q = state.q.trim().toLowerCase();
    // 按难度视图下难度下拉框隐藏，难度由分组直接展示，不再作为筛选条件。
    if (state.view !== 'diff' && state.diff && p.difficulty !== state.diff) return false;
    if (state.tag && !p.tags.includes(state.tag)) return false;
    if (state.status === 'mistake') {
      if (!isMistake(p.id)) return false;
    } else if (state.status === 'review') {
      if (!isReviewDue(learning.problems[String(p.id)]?.review, now)) return false;
    } else if (state.status && problemStatus(p.id) !== state.status) {
      return false;
    }
    if (q && !(`${p.id}`.includes(q) || p.title.toLowerCase().includes(q) || p.slug.includes(q))) return false;
    return true;
  }

  // 进入题目前把当前筛选结果的 id 顺序写入 sessionStorage（做题页读取）。
  function writeListQueue() {
    try {
      sessionStorage.setItem(LIST_QUEUE_KEY, JSON.stringify(problems.filter(match).map((p) => p.id)));
    } catch {
      // sessionStorage 不可用（如隐私模式）时静默跳过，不影响跳转
    }
  }

  function persistFilters() {
    const saved = setListFilters({ q: state.q, diff: state.diff, tag: state.tag, status: state.status });
    if (!saved.ok) showTip(`保存筛选条件失败：${saved.error.message}`, { persistent: true, error: true });
  }

  // 折叠状态约定：按分类分组默认展开（键在集合中 = 已折叠）；
  // 按难度分组默认折叠（键在集合中 = 用户手动展开过），首次进入即全部收起。
  function isGroupCollapsed(key) {
    return state.view === 'diff' ? !collapsed.has(key) : collapsed.has(key);
  }

  function groupHtml(key, label, list) {
    const solved = list.filter((p) => problemStatus(p.id) === 'solved').length;
    const isCollapsed = isGroupCollapsed(key);
    // 难度分组的名称本身已是难度，不再重复展示组内难度分布。
    const diffText = key.startsWith('diff:')
      ? ''
      : (() => {
          const diffCount = { easy: 0, medium: 0, hard: 0 };
          for (const p of list) diffCount[p.difficulty] += 1;
          return DIFF_ORDER.filter((d) => diffCount[d])
            .map((d) => `${DIFF_LABEL[d]} ${diffCount[d]}`)
            .join(' · ');
        })();
    return `
      <div class="pgroup" data-group="${escapeHtml(key)}">
        <button type="button" class="pgroup-head" aria-expanded="${!isCollapsed}">
          <span class="pgroup-arrow" aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
          <span class="pgroup-name">${escapeHtml(label)}</span>
          <span class="pgroup-diff">${diffText}</span>
          <span class="pgroup-count">${solved}/${list.length}</span>
        </button>
        <div class="pgroup-body" ${isCollapsed ? 'hidden' : ''}>
          ${list.map((p) => rowHtml(p)).join('')}
        </div>
      </div>`;
  }

  function renderRows() {
    const rows = problems.filter(match);
    container.querySelector('#filter-result').textContent = `显示 ${rows.length} 道题`;
    if (state.view === 'flat') {
      wrapEl.innerHTML = `<div class="plist">${
        rows.length ? rows.map((p) => rowHtml(p)).join('') : '<div class="empty-tip">没有匹配的题目</div>'
      }</div>`;
      lastGroupKeys = [];
      syncToggleGroupsBtn();
      return;
    }
    let groups;
    if (state.view === 'diff') {
      // 按难度分组视图：简单/中等/困难三组，组内按题号升序，默认全部折叠。
      groups = DIFF_ORDER
        .map((d) => [`diff:${d}`, DIFF_LABEL[d], rows.filter((p) => p.difficulty === d)])
        .filter(([, , list]) => list.length);
    } else {
      // 按分类分组视图：每题只出现在其最具特征的一个分类中；
      // 组内由易到难、同难度按题号；分组之间按专题内容的学习难度排序（TOPIC_ORDER）。
      const map = new Map();
      for (const p of rows) {
        const cat = primaryCategory(p);
        if (!map.has(cat)) map.set(cat, []);
        map.get(cat).push(p);
      }
      groups = [...map.entries()]
        .map(([t, list]) => [
          `tag:${t}`,
          t,
          list.sort((x, y) => (DIFF_RANK[x.difficulty] - DIFF_RANK[y.difficulty]) || (x.id - y.id)),
        ])
        .sort((a, b) =>
          (TOPIC_RANK.get(a[1]) ?? TOPIC_ORDER.length) - (TOPIC_RANK.get(b[1]) ?? TOPIC_ORDER.length)
        );
    }
    wrapEl.innerHTML = groups.length
      ? groups.map(([key, label, list]) => groupHtml(key, label, list)).join('')
      : '<div class="plist"><div class="empty-tip">没有匹配的题目</div></div>';
    wrapEl.querySelectorAll('.pgroup-head').forEach((btn) =>
      btn.addEventListener('click', () => {
        const key = btn.closest('.pgroup').dataset.group;
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        const saved = setCollapsedGroups([...collapsed]);
        if (!saved.ok) showTip(`保存折叠状态失败：${saved.error.message}`, { persistent: true, error: true });
        renderRows();
      })
    );
    // 全部展开/折叠按钮状态（保存当前组键，供一键操作）
    lastGroupKeys = groups.map(([key]) => key);
    syncToggleGroupsBtn();
  }

  let lastGroupKeys = [];
  function syncToggleGroupsBtn() {
    const btn = container.querySelector('#toggle-groups');
    btn.hidden = state.view === 'flat';
    if (state.view === 'flat') return;
    const allCollapsed = lastGroupKeys.length > 0 && lastGroupKeys.every((k) => isGroupCollapsed(k));
    btn.textContent = allCollapsed ? '全部展开' : '全部折叠';
    btn.setAttribute('aria-expanded', String(!allCollapsed));
  }

  function syncFilterVisibility() {
    // 分组视图下隐藏与该分组维度重复的下拉筛选。
    container.querySelector('#f-diff').style.display = state.view === 'diff' ? 'none' : '';
    container.querySelector('#f-tag').style.display = state.view === 'tags' ? 'none' : '';
    syncToggleGroupsBtn();
  }

  let renderFrame = 0;
  let filterSaveTimer = 0;
  function scheduleRowsRender() {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderRows();
    });
  }
  function scheduleFilterPersist() {
    clearTimeout(filterSaveTimer);
    filterSaveTimer = setTimeout(() => {
      filterSaveTimer = 0;
      persistFilters();
    }, 180);
  }

  container.querySelector('#f-q').addEventListener('input', (e) => {
    state.q = e.target.value;
    scheduleFilterPersist();
    scheduleRowsRender();
  });
  container.querySelector('#f-diff').addEventListener('change', (e) => {
    state.diff = e.target.value;
    persistFilters();
    renderRows();
  });
  container.querySelector('#f-tag').addEventListener('change', (e) => {
    state.tag = e.target.value;
    persistFilters();
    renderRows();
  });
  container.querySelector('#view-seg').addEventListener('click', (e) => {
    const v = e.target.dataset.view;
    if (!v || v === state.view) return;
    state.view = v;
    const saved = setListView(v);
    if (!saved.ok) showTip(`保存列表视图失败：${saved.error.message}`, { persistent: true, error: true });
    container.querySelectorAll('#view-seg button').forEach((b) => {
      const active = b.dataset.view === v;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    syncFilterVisibility();
    renderRows();
  });

  // 状态筛选 chips（全部 / 未开始 / 已尝试 / 已通过 / 错题 / 待复习）
  container.querySelector('#status-chips').addEventListener('click', (e) => {
    const s = e.target.dataset.s;
    if (s === undefined) return;
    state.status = s;
    persistFilters();
    container.querySelectorAll('#status-chips button').forEach((b) => {
      const active = b.dataset.s === s;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    renderRows();
  });

  // 新手横幅：关闭后持久化，不再显示
  const onboardingClose = container.querySelector('#onboarding-close');
  if (onboardingClose) {
    onboardingClose.addEventListener('click', () => {
      const saved = setOnboardingDismissed(true);
      if (!saved.ok) showTip(`保存新手引导偏好失败：${saved.error.message}`, { persistent: true, error: true });
      container.querySelector('#onboarding-banner')?.remove();
    });
  }

  // 今日任务：整行点击跳转（写列表队列；链接与按钮自身交互除外）
  container.querySelector('#today-section').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const row = e.target.closest('.plist-row');
    if (!row) return;
    writeListQueue();
    if (e.target.closest('a')) return;
    location.hash = `#/problem/${row.dataset.pid}`;
  });

  // 随机一题：优先从未通过的匹配题目中抽
  container.querySelector('#random-btn').addEventListener('click', () => {
    const rows = problems.filter(match);
    const pool = rows.filter((p) => problemStatus(p.id) !== 'solved');
    const finalPool = pool.length ? pool : rows.length ? rows : problems;
    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    writeListQueue();
    location.hash = `#/problem/${pick.id}`;
  });

  // 全部展开 / 全部折叠（分组视图）
  container.querySelector('#toggle-groups').addEventListener('click', () => {
    const allCollapsed = lastGroupKeys.length > 0 && lastGroupKeys.every((k) => isGroupCollapsed(k));
    // 按难度视图中键在集合里表示“已展开”，与按分类视图的增删方向相反。
    if (allCollapsed) {
      lastGroupKeys.forEach((k) => (state.view === 'diff' ? collapsed.add(k) : collapsed.delete(k)));
    } else {
      lastGroupKeys.forEach((k) => (state.view === 'diff' ? collapsed.delete(k) : collapsed.add(k)));
    }
    const saved = setCollapsedGroups([...collapsed]);
    if (!saved.ok) showTip(`保存折叠状态失败：${saved.error.message}`, { persistent: true, error: true });
    renderRows();
  });

  // ---------- 数据导出 / 导入 ----------
  const dataTip = container.querySelector('#data-tip');
  let tipTimer = 0;
  const showTip = (msg, { persistent = false, error = false } = {}) => {
    clearTimeout(tipTimer);
    dataTip.setAttribute('role', error ? 'alert' : 'status');
    dataTip.textContent = msg;
    if (!persistent) {
      tipTimer = setTimeout(() => {
        if (dataTip.textContent === msg) dataTip.textContent = '';
      }, 4000);
    }
  };

  function backupSummary(payload, file) {
    const size = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KiB`;
    if (payload?.version === 2 && payload.data && typeof payload.data === 'object') {
      const count = (value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : 0;
      return `${file.name}（${size}，版本 2）：进度 ${count(payload.data.progress)} 题，学习记录 ${count(payload.data.learning?.problems)} 题，错题 ${count(payload.data.mistakes)} 题，草稿 ${count(payload.data.drafts)} 份`;
    }
    const itemCount = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? Object.keys(payload.data).length
      : 0;
    return `${file.name}（${size}，版本 ${payload?.version ?? '未知'}）：${itemCount} 个数据项`;
  }

  container.querySelector('#export-btn').addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hot100-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showTip('已导出（进度 / 学习记录 / 错题集 / 草稿 / 偏好设置）');
    } catch (err) {
      showTip(`导出失败：${err?.message || '无法读取或序列化本地数据'}`, { persistent: true, error: true });
    }
  });

  const importFile = container.querySelector('#import-file');
  const importMode = container.querySelector('#import-mode');
  container.querySelector('#import-btn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      showTip(`导入失败：文件为 ${(file.size / 1024 / 1024).toFixed(2)} MiB，超过 5 MiB 限制，未读取文件`, { persistent: true, error: true });
      return;
    }

    try {
      const payload = JSON.parse(await file.text());
      const mode = importMode.value;
      const summary = backupSummary(payload, file);
      const effect = mode === 'replace'
        ? '替换模式会删除本地现有刷题数据，再写入该备份。'
        : '合并模式会更新备份中的同名数据，并保留备份未包含的本地数据。';
      showTip(`待导入：${summary}`, { persistent: true });
      if (!confirm(`${summary}\n\n${effect}\n确定继续？`)) {
        showTip('已取消导入');
        return;
      }
      const result = importAll(payload, { mode });
      showTip(`导入成功：${result.imported} 个数据项，${mode === 'replace' ? '替换' : '合并'}模式`, { persistent: true });
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      const message = err?.message || '文件无法解析';
      if (message.startsWith('导入失败：')) {
        const rollback = err?.rolledBack === true
          ? '已自动恢复导入前的数据。'
          : err?.rolledBack === false
            ? '自动回滚失败，请立即导出现有数据并停止继续操作。'
            : '无法确认数据已持久化。';
        showTip(`持久化失败：${message.slice(5)}。${rollback}`, { persistent: true, error: true });
      } else {
        showTip(`导入失败：${message}`, { persistent: true, error: true });
      }
    }
  });

  syncFilterVisibility();
  renderRows();

  // 从题目页等页面返回时，恢复离开列表页时的滚动位置（只恢复一次）。
  try {
    const scrollY = Number(sessionStorage.getItem(LIST_SCROLL_KEY));
    sessionStorage.removeItem(LIST_SCROLL_KEY);
    if (Number.isFinite(scrollY) && scrollY > 0) window.scrollTo(0, scrollY);
  } catch {
    // sessionStorage 不可用时忽略
  }

  // 整行点击跳转（写列表队列；链接和按钮自身的交互除外）
  wrapEl.addEventListener('click', (e) => {
    const row = e.target.closest('.plist-row');
    if (!row) return;
    writeListQueue();
    if (e.target.closest('a, button')) return;
    location.hash = `#/problem/${row.dataset.pid}`;
  });
  return () => {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    clearTimeout(filterSaveTimer);
    if (filterSaveTimer) persistFilters();
    // 离开列表页时记录滚动位置，供返回时恢复。
    try {
      sessionStorage.setItem(LIST_SCROLL_KEY, String(window.scrollY || 0));
    } catch {
      // sessionStorage 不可用时忽略
    }
  };
}
