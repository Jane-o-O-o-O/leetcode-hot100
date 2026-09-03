// 知识文章轻量索引（由 tools/generate-manifests.mjs 生成，请勿手改）

export const articles = [
  {"slug":"complexity","title":"时间复杂度入门","intro":"看懂大 O 记号，学会估算自己的代码会不会超时","tags":["数学","模拟"],"relatedProblems":[1,35,53,56,78]},
  {"slug":"array-hashmap","title":"数组与哈希表","intro":"数组随机访问与哈希表 O(1) 查找，空间换时间的两大基石","tags":["数组","哈希表","前缀和","计数"],"relatedProblems":[1,41,49,128,238,438,560]},
  {"slug":"two-pointers","title":"双指针","intro":"对撞、快慢、分离三种形态，用两个指针省掉一层循环","tags":["双指针","数组","字符串"],"relatedProblems":[11,15,19,21,141,283,287]},
  {"slug":"sliding-window","title":"滑动窗口","intro":"用两个指针维护一个「窗口」，在 O(n) 时间内处理子串 / 子数组问题","tags":["滑动窗口"]},
  {"slug":"linked-list","title":"链表","intro":"指针基本功：dummy 哨兵、反转链表、快慢指针三大套路","tags":["链表","双指针","递归"],"relatedProblems":[2,19,21,23,24,25,138,141,142,146,148,160,206,234]},
  {"slug":"stack-queue","title":"栈、队列与单调栈","intro":"栈、队列、单调栈与单调队列：括号匹配到滑动窗口最大值","tags":["栈","队列","单调栈","单调队列","设计"]},
  {"slug":"binary-tree","title":"二叉树与递归","intro":"递归两大范式、DFS/BFS 遍历模板与二叉搜索树的有序性","tags":["树","二叉树","深度优先搜索","广度优先搜索","递归"],"relatedProblems":[94,98,101,102,104,199,226,230,236,543]},
  {"slug":"graph-dfs-bfs","title":"图的 DFS 与 BFS","intro":"把网格和依赖关系都看成图，用两种遍历解决连通性与最短路径","tags":["图","深度优先搜索","广度优先搜索","并查集","拓扑排序","矩阵"],"relatedProblems":[79,200,207,994]},
  {"slug":"binary-search","title":"二分查找","intro":"每次砍掉一半搜索范围，前提是有单调性可以判断方向","tags":["二分查找","数组"],"relatedProblems":[4,33,34,35,74,153]},
  {"slug":"backtracking","title":"回溯算法","intro":"在解空间树上做选择、递归、撤销选择，穷举所有合法方案","tags":["回溯","数组","字符串","矩阵"],"relatedProblems":[17,22,39,46,51,78,79,131]},
  {"slug":"dynamic-programming","title":"动态规划入门","intro":"把大问题拆成小问题、存下答案反复用：状态、转移、初始值、遍历顺序四要素","tags":["动态规划","记忆化搜索","数组","字符串"],"relatedProblems":[53,62,70,72,198,300,322,416,1143]},
  {"slug":"heap-greedy","title":"堆与贪心","intro":"用堆动态维护「最值」，用贪心每步取局部最优：Top K 与中位数的标配","tags":["堆（优先队列）","贪心","排序","设计"],"relatedProblems":[55,215,295,347,763]},
  {"slug":"bit-tricks","title":"位运算与实用技巧","intro":"异或消消乐、lowbit、补码常识，加上原地算法省空间的三种套路","tags":["位运算","数学","计数","模拟"],"relatedProblems":[41,75,136,169,189,287]},
];

const articleLoaders = new Map([
  ["complexity", () => import('./complexity.js')],
  ["array-hashmap", () => import('./array-hashmap.js')],
  ["two-pointers", () => import('./two-pointers.js')],
  ["sliding-window", () => import('./sliding-window.js')],
  ["linked-list", () => import('./linked-list.js')],
  ["stack-queue", () => import('./stack-queue.js')],
  ["binary-tree", () => import('./binary-tree.js')],
  ["graph-dfs-bfs", () => import('./graph-dfs-bfs.js')],
  ["binary-search", () => import('./binary-search.js')],
  ["backtracking", () => import('./backtracking.js')],
  ["dynamic-programming", () => import('./dynamic-programming.js')],
  ["heap-greedy", () => import('./heap-greedy.js')],
  ["bit-tricks", () => import('./bit-tricks.js')],
]);

export function hasArticle(slug) {
  return articleLoaders.has(slug);
}

export async function loadArticle(slug) {
  const loader = articleLoaders.get(slug);
  if (!loader) throw new Error(`知识文章不存在: ${slug}`);
  return (await loader()).default;
}
