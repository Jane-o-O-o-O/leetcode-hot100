import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');

if (unknownArgs.length) {
  console.error(`未知参数: ${unknownArgs.join(' ')}`);
  process.exit(2);
}

const ARTICLE_ORDER = [
  'complexity',
  'array-hashmap',
  'two-pointers',
  'sliding-window',
  'linked-list',
  'stack-queue',
  'binary-tree',
  'graph-dfs-bfs',
  'binary-search',
  'backtracking',
  'dynamic-programming',
  'heap-greedy',
  'bit-tricks',
];
const articleRank = new Map(ARTICLE_ORDER.map((slug, index) => [slug, index]));
const byFileName = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

async function loadEntries(directory, prefix) {
  const dir = resolve(root, directory);
  const names = (await readdir(dir))
    .filter((name) => name.endsWith('.js') && name !== 'index.js')
    .sort();
  const entries = [];
  for (const file of names) {
    const url = pathToFileURL(resolve(dir, file));
    url.searchParams.set('manifest', '1');
    const value = (await import(url.href)).default;
    if (!value || typeof value !== 'object') throw new Error(`${directory}/${file} 没有默认导出对象`);
    entries.push({ file: `./${file}`, value, prefix });
  }
  return entries;
}

function assertUnique(entries, key, label) {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry.value[key];
    if (value === undefined || value === null || value === '') throw new Error(`${entry.file} 缺少 ${key}`);
    if (seen.has(value)) throw new Error(`${label}重复: ${value}`);
    seen.add(value);
  }
}

function compact(value) {
  return JSON.stringify(value);
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

function problemSource(entries) {
  const sorted = [...entries].sort((a, b) => a.value.id - b.value.id || byFileName(a, b));
  assertUnique(sorted, 'id', '题号');
  assertUnique(sorted, 'slug', '题目 slug');
  const metadata = sorted.map(({ value }) => ({
    id: value.id,
    title: value.title,
    slug: value.slug,
    difficulty: value.difficulty,
    tags: value.tags,
  }));
  const tags = [...new Set(metadata.flatMap((problem) => problem.tags))].sort();
  return `// 题目轻量索引（由 tools/generate-manifests.mjs 生成，请勿手改）\n\nexport const problems = [\n${metadata.map((item) => `  ${compact(item)},`).join('\n')}\n];\n\nexport const allTags = ${compact(tags)};\n\nconst problemLoaders = new Map([\n${sorted.map(({ file, value }) => `  [${value.id}, () => import('${file}')],`).join('\n')}\n]);\n\nexport function hasProblem(id) {\n  return problemLoaders.has(Number(id));\n}\n\nexport async function loadProblem(id) {\n  const numericId = Number(id);\n  const loader = problemLoaders.get(numericId);\n  if (!loader) throw new Error(\`题目不存在: \${id}\`);\n  return (await loader()).default;\n}\n`;
}

function articleSource(entries) {
  const sorted = [...entries].sort((a, b) => {
    const ar = articleRank.has(a.value.slug) ? articleRank.get(a.value.slug) : Number.MAX_SAFE_INTEGER;
    const br = articleRank.has(b.value.slug) ? articleRank.get(b.value.slug) : Number.MAX_SAFE_INTEGER;
    return ar - br || byFileName(a, b);
  });
  assertUnique(sorted, 'slug', '文章 slug');
  const metadata = sorted.map(({ value }) => {
    const item = {
      slug: value.slug,
      title: value.title,
      intro: value.intro,
      tags: value.tags,
    };
    if (Array.isArray(value.relatedProblems)) item.relatedProblems = value.relatedProblems;
    return item;
  });
  return `// 知识文章轻量索引（由 tools/generate-manifests.mjs 生成，请勿手改）\n\nexport const articles = [\n${metadata.map((item) => `  ${compact(item)},`).join('\n')}\n];\n\nconst articleLoaders = new Map([\n${sorted.map(({ file, value }) => `  [${compact(value.slug)}, () => import('${file}')],`).join('\n')}\n]);\n\nexport function hasArticle(slug) {\n  return articleLoaders.has(slug);\n}\n\nexport async function loadArticle(slug) {\n  const loader = articleLoaders.get(slug);\n  if (!loader) throw new Error(\`知识文章不存在: \${slug}\`);\n  return (await loader()).default;\n}\n`;
}

async function update(path, expected) {
  let current = '';
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Git 在 Windows 上通常会把检出的 LF 转成 CRLF。生成内容本身未变时，
  // 不应因此让 `npm test` 误报清单过期。
  if (normalizeLineEndings(current) === normalizeLineEndings(expected)) return false;
  if (checkOnly) {
    console.error(`${relative(root, path)} 不是最新生成结果`);
    process.exitCode = 1;
    return true;
  }
  await writeFile(path, expected);
  console.log(`已生成 ${relative(root, path)}`);
  return true;
}

const [problemEntries, articleEntries] = await Promise.all([
  loadEntries('problems'),
  loadEntries('knowledge'),
]);
await Promise.all([
  update(resolve(root, 'problems/index.js'), problemSource(problemEntries)),
  update(resolve(root, 'knowledge/index.js'), articleSource(articleEntries)),
]);

if (checkOnly && !process.exitCode) console.log('manifest 已是最新状态');
