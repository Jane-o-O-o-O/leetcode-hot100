// 题目数据校验器
// 用法：
//   node tools/validate.mjs                 校验 problems/index.js 登记的全部题目
//   node tools/validate.mjs problems/p002-add-two-numbers.js ...   只校验指定文件
//
// 校验内容：
// 1. 数据格式完整性（必填字段、用例非空、两种模式 × 三种语言的模板与答案）
// 2. 六套参考代码（core/acm × javascript/python/cpp）全部跑通自己的测试用例
//    - JS 在 node 内直接执行；Python 自动探测 python3/python；C++ 自动探测 g++/clang++/c++

import { readdir } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { compareResult, compareAcmOutput } from '../js/compare.js';
import { runJavascriptCore } from './validation-runtime.mjs';
import { cppCoreSource, parseCppJudgeOutput } from '../js/judge-cpp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBLEM_BASELINE = 100;
const CORE_CASE_BASELINE = 960;
const ACM_CASE_BASELINE = 960;

const TIMEOUT_MS = 10000;

const pythonRuntime = (() => {
  for (const command of ['python3', 'python']) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: TIMEOUT_MS });
    const version = `${result.stdout || ''}${result.stderr || ''}`;
    if (!result.error && result.status === 0 && /^Python 3\./.test(version.trim())) return command;
  }
  return null;
})();

// ---------- 链表/二叉树构造与序列化（与 js/judge.js 中的判定逻辑保持一致） ----------

function buildList(arr) {
  const d = { val: 0, next: null };
  let c = d;
  for (const v of arr) {
    c.next = { val: v, next: null };
    c = c.next;
  }
  return d.next;
}
function buildCycle(arr, pos) {
  const d = { val: 0, next: null };
  let c = d;
  const nodes = [];
  for (const v of arr) {
    c.next = { val: v, next: null };
    c = c.next;
    nodes.push(c);
  }
  if (pos >= 0 && pos < nodes.length) c.next = nodes[pos];
  return d.next;
}
function listToArray(h) {
  const r = [];
  let g = 0;
  while (h && g++ < 100000) {
    r.push(h.val);
    h = h.next;
  }
  return r;
}
function buildTree(arr) {
  if (!arr || !arr.length || arr[0] == null) return null;
  const nodes = arr.map((v) => (v == null ? null : { val: v, left: null, right: null }));
  let j = 1;
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]) continue;
    if (j < nodes.length) nodes[i].left = nodes[j++] || null;
    if (j < nodes.length) nodes[i].right = nodes[j++] || null;
  }
  return nodes[0];
}
function treeToArray(root) {
  if (!root) return [];
  const r = [];
  const q = [root];
  while (q.length) {
    const n = q.shift();
    if (n) {
      r.push(n.val);
      q.push(n.left);
      q.push(n.right);
    } else r.push(null);
  }
  while (r.length && r[r.length - 1] === null) r.pop();
  return r;
}
function buildListArray(arr2d) {
  return arr2d.map((a) => buildList(a));
}
function buildIntersect(shared, aOnly, bOnly) {
  const sharedHead = buildList(shared);
  const attach = (only) => {
    if (!only.length) return sharedHead;
    const h = buildList(only);
    let t = h;
    while (t.next) t = t.next;
    t.next = sharedHead;
    return h;
  };
  return [attach(aOnly), attach(bOnly)];
}
function buildRandomList(desc) {
  const nodes = desc.map(([v]) => ({ val: v, next: null, random: null }));
  nodes.forEach((n, i) => {
    n.next = nodes[i + 1] || null;
    n.random = desc[i][1] === null ? null : nodes[desc[i][1]];
  });
  return nodes.length ? nodes[0] : null;
}
function randomListToArray(head) {
  const nodes = [];
  let cur = head;
  let g = 0;
  while (cur && g++ < 100000) {
    nodes.push(cur);
    cur = cur.next;
  }
  const idx = new Map(nodes.map((n, i) => [n, i]));
  return nodes.map((n) => [n.val, n.random ? idx.get(n.random) : null]);
}
function nodeIndex(head, node) {
  if (node === null || node === undefined) return -1;
  let i = 0;
  let g = 0;
  let cur = head;
  while (cur && g++ < 100000) {
    if (cur === node) return i;
    cur = cur.next;
    i++;
  }
  return -1;
}
function buildArgs(spec, args) {
  const out = [];
  const treeCache = {};
  const getTree = (i) => {
    if (!(i in treeCache)) treeCache[i] = buildTree(args[i]);
    return treeCache[i];
  };
  const findNode = (root, val) => {
    if (!root) return null;
    const q = [root];
    while (q.length) {
      const n = q.shift();
      if (n.val === val) return n;
      if (n.left) q.push(n.left);
      if (n.right) q.push(n.right);
    }
    return null;
  };
  for (let i = 0; i < args.length; i++) {
    const s = spec && spec[i];
    const kind = s ? s.kind : 'plain';
    if (kind === 'skip') continue;
    if (kind === 'list') out.push(buildList(args[i]));
    else if (kind === 'cycleList') out.push(buildCycle(args[i], args[s.posArg]));
    else if (kind === 'tree') out.push(getTree(i));
    else if (kind === 'treeNode') out.push(findNode(getTree(s.treeArg), args[i]));
    else if (kind === 'listArray') out.push(buildListArray(args[i]));
    else if (kind === 'randomList') out.push(buildRandomList(args[i]));
    else if (kind === 'intersectLists') {
      const pair = buildIntersect(args[i], args[i + 1], args[i + 2]);
      out.push(pair[0], pair[1]);
    } else out.push(JSON.parse(JSON.stringify(args[i])));
  }
  return out;
}
function serializeJs(v, kind) {
  if (kind === 'list') return listToArray(v);
  if (kind === 'tree') return treeToArray(v);
  if (kind === 'randomList') return randomListToArray(v);
  if (kind === 'nodeVal') return v === null || v === undefined ? null : v.val;
  return v;
}

// ---------- Python 判题 ----------

const PY_RUNNER = `
import json, sys, copy

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
def __build_list(arr):
    dummy = ListNode()
    cur = dummy
    for v in arr:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next
def __build_cycle(arr, pos):
    dummy = ListNode()
    cur = dummy
    nodes = []
    for v in arr:
        cur.next = ListNode(v)
        cur = cur.next
        nodes.append(cur)
    if 0 <= pos < len(nodes):
        cur.next = nodes[pos]
    return dummy.next
def __list_to_array(h):
    r = []
    while h is not None:
        r.append(h.val)
        h = h.next
    return r
def __build_tree(arr):
    if not arr or arr[0] is None:
        return None
    nodes = [None if v is None else TreeNode(v) for v in arr]
    j = 1
    for i in range(len(nodes)):
        if nodes[i] is None:
            continue
        if j < len(nodes):
            nodes[i].left = nodes[j]
            j += 1
        if j < len(nodes):
            nodes[i].right = nodes[j]
            j += 1
    return nodes[0]
def __tree_to_array(root):
    if root is None:
        return []
    r = []
    q = [root]
    while q:
        n = q.pop(0)
        if n is None:
            r.append(None)
        else:
            r.append(n.val)
            q.append(n.left)
            q.append(n.right)
    while r and r[-1] is None:
        r.pop()
    return r
def __ser(x):
    if isinstance(x, (list, tuple)):
        return [__ser(i) for i in x]
    return x
def __build_list_array(arr2d):
    return [__build_list(a) for a in arr2d]
def __build_intersect(shared, a_only, b_only):
    shared_head = __build_list(shared)
    def attach(only):
        if not only:
            return shared_head
        h = __build_list(only)
        t = h
        while t.next is not None:
            t = t.next
        t.next = shared_head
        return h
    return [attach(a_only), attach(b_only)]
def __build_random_list(desc):
    nodes = [ListNode(v) for v, _ in desc]
    for i, n in enumerate(nodes):
        n.next = nodes[i + 1] if i + 1 < len(nodes) else None
        n.random = None if desc[i][1] is None else nodes[desc[i][1]]
    return nodes[0] if nodes else None
def __random_nodes(head):
    nodes = []
    seen = set()
    cur = head
    while cur is not None and len(nodes) < 100000:
        if id(cur) in seen:
            raise ValueError('链表 next 指针形成环')
        seen.add(id(cur))
        nodes.append(cur)
        cur = cur.next
    if cur is not None:
        raise ValueError('链表过长')
    return nodes
def __random_list_to_array(head):
    nodes = __random_nodes(head)
    idx = {id(n): i for i, n in enumerate(nodes)}
    result = []
    for n in nodes:
        if n.random is not None and id(n.random) not in idx:
            raise ValueError('random 必须指向返回链表中的节点或 null')
        result.append([n.val, None if n.random is None else idx[id(n.random)]])
    return result
def __tree_contains(root, target):
    if target is None:
        return False
    q = [root]
    while q:
        node = q.pop(0)
        if node is None:
            continue
        if node is target:
            return True
        q.extend([node.left, node.right])
    return False
def __contract_before(args, contract):
    state = {}
    if contract and 'preserveRandomListArg' in contract:
        state['randomSnapshot'] = json.dumps(__random_list_to_array(args[contract['preserveRandomListArg']]))
    return state
def __contract_after(args, got, contract, state):
    if not contract:
        return
    if 'preserveRandomListArg' in contract:
        now = json.dumps(__random_list_to_array(args[contract['preserveRandomListArg']]))
        if now != state['randomSnapshot']:
            raise ValueError('调用后不得修改输入链表')
    if 'deepCopyRandomListArg' in contract:
        originals = {id(node) for node in __random_nodes(args[contract['deepCopyRandomListArg']])}
        copies = __random_nodes(got)
        if any(id(node) in originals for node in copies):
            raise ValueError('必须返回由全新节点组成的深拷贝')
        __random_list_to_array(got)
    if 'returnNodeFromTreeArg' in contract and not __tree_contains(args[contract['returnNodeFromTreeArg']], got):
        raise ValueError('必须返回输入树中的节点对象')
def __node_index(head, node):
    if node is None:
        return -1
    i = 0
    g = 0
    cur = head
    while cur is not None and g < 100000:
        if cur is node:
            return i
        cur = cur.next
        i += 1
        g += 1
    return -1
def __build_args(spec, args):
    out = []
    tree_cache = {}
    def get_tree(i):
        if i not in tree_cache:
            tree_cache[i] = __build_tree(args[i])
        return tree_cache[i]
    def find_node(root, val):
        q = [root]
        while q:
            n = q.pop(0)
            if n is None:
                continue
            if n.val == val:
                return n
            q.append(n.left)
            q.append(n.right)
        return None
    for i, a in enumerate(args):
        s = spec[i] if spec and i < len(spec) else None
        kind = s['kind'] if s else 'plain'
        if kind == 'skip':
            continue
        if kind == 'list':
            out.append(__build_list(a))
        elif kind == 'cycleList':
            out.append(__build_cycle(a, args[s['posArg']]))
        elif kind == 'tree':
            out.append(get_tree(i))
        elif kind == 'treeNode':
            out.append(find_node(get_tree(s['treeArg']), a))
        elif kind == 'listArray':
            out.append(__build_list_array(a))
        elif kind == 'randomList':
            out.append(__build_random_list(a))
        elif kind == 'intersectLists':
            pair = __build_intersect(a, args[i + 1], args[i + 2])
            out.append(pair[0])
            out.append(pair[1])
        else:
            out.append(copy.deepcopy(a))
    return out
def __serialize(v, kind):
    if kind == 'list':
        return __list_to_array(v)
    if kind == 'tree':
        return __tree_to_array(v)
    if kind == 'randomList':
        return __random_list_to_array(v)
    if kind == 'nodeVal':
        return None if v is None else v.val
    return __ser(v)

__payload = json.loads(sys.stdin.read())
__spec = __payload['argSpec']
__cases = __payload['tests']
__fname = __payload.get('functionName')
__result_kind = __payload['resultKind']
__design = __payload.get('design')
__cname = __payload.get('className')
__contract = __payload.get('judgeContract')

try:
    __code_obj = compile(__payload['code'], '<solution>', 'exec')
except SyntaxError as e:
    print(json.dumps({'compileError': str(e)}))
    sys.exit(0)

__ns = {}
try:
    exec(__code_obj, __ns)
except Exception as e:
    print(json.dumps({'compileError': str(e)}))
    sys.exit(0)

if __design:
    __cls = __ns.get(__cname)
    if not callable(__cls):
        print(json.dumps({'compileError': 'class not found: ' + str(__cname)}))
        sys.exit(0)
    __results = []
    for t in __cases:
        try:
            __obj = None
            __out_ops = []
            for __op, __params in zip(t['ops'], t['params']):
                if __op == __cname:
                    __obj = __cls(*__params)
                    __out_ops.append(None)
                else:
                    __r = getattr(__obj, __op)(*__params)
                    __out_ops.append(None if __r is None else __r)
            __results.append({'ok': True, 'got': __out_ops})
        except Exception as e:
            __results.append({'ok': False, 'error': str(e)})
    print(json.dumps({'results': __results}))
    sys.exit(0)

__fn = __ns.get(__fname)
if not callable(__fn):
    print(json.dumps({'compileError': 'function not found: ' + __fname}))
    sys.exit(0)

__results = []
for t in __cases:
    try:
        __args = __build_args(__spec, t['args'])
        __state = __contract_before(__args, __contract)
        __got = __fn(*__args)
        __contract_after(__args, __got, __contract, __state)
        if __result_kind == 'nodeIndex':
            __got = __node_index(__args[0], __got)
        elif __result_kind == 'inputTree':
            __got = __tree_to_array(__args[0])
        elif __result_kind == 'inputArray':
            __got = __args[0]
        else:
            __got = __serialize(__got, __result_kind)
        __results.append({'ok': True, 'got': __got})
    except Exception as e:
        __results.append({'ok': False, 'error': str(e)})
print(json.dumps({'results': __results}))
`;

function runPythonCore(p) {
  const payload = JSON.stringify({
    code: p.solutions.core.python,
    argSpec: p.argSpec || null,
    tests: p.tests,
    functionName: p.functionName,
    resultKind: p.resultKind || 'plain',
    judgeContract: p.judgeContract || null,
    design: !!p.design,
    className: p.className || null,
  });
  const r = spawnSync(pythonRuntime, ['-X', 'utf8', '-c', PY_RUNNER], {
    input: payload,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (r.error) return { compileError: `${pythonRuntime} 执行失败: ${r.error.message}` };
  if (r.status !== 0) return { compileError: `${pythonRuntime} 异常退出: ${(r.stderr || '').slice(0, 500)}` };
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { compileError: `${pythonRuntime} 输出无法解析: ${r.stdout.slice(0, 300)} ${(r.stderr || '').slice(0, 300)}` };
  }
}

function runPythonAcm(code, input) {
  const r = spawnSync(pythonRuntime, ['-X', 'utf8', '-c', code], {
    input,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (r.error) return { ok: false, error: r.error.message, stdout: '' };
  if (r.status !== 0) return { ok: false, error: (r.stderr || '非零退出').slice(0, 500), stdout: r.stdout || '' };
  return { ok: true, stdout: r.stdout };
}

// ---------- C++ 本地编译运行（兼容 GNU 与 macOS/Xcode Clang） ----------

const cppCompiler = (() => {
  for (const command of ['g++', 'clang++', 'c++']) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: TIMEOUT_MS });
    if (!result.error && result.status === 0) return command;
  }
  return null;
})();

let cppTmpDir = null;

// 完整编译（生成可执行文件），返回 { binary } 或 { compileError }
function cppCompile(source, tag) {
  if (!cppTmpDir) cppTmpDir = mkdtempSync(join(tmpdir(), 'letcode-cpp-'));
  const base = join(cppTmpDir, tag.replace(/[^a-zA-Z0-9_-]/g, '_'));
  writeFileSync(`${base}.cpp`, source);
  const r = spawnSync(cppCompiler, ['-std=c++17', '-O2', `${base}.cpp`, '-o', base], { encoding: 'utf8', timeout: 120000 });
  if (r.error) return { compileError: r.error.message };
  if (r.status !== 0) return { compileError: (r.stderr || '编译失败').slice(0, 800) };
  return { binary: base };
}

// 仅语法检查（模板用，快）
function cppSyntaxCheck(source) {
  const r = spawnSync(cppCompiler, ['-std=c++17', '-fsyntax-only', '-x', 'c++', '-'], {
    input: source,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (r.error) return r.error.message;
  if (r.status !== 0) return (r.stderr || '语法错误').slice(0, 800);
  return null;
}

function runCppBinary(binary, input) {
  const r = spawnSync(binary, [], { input, encoding: 'utf8', timeout: TIMEOUT_MS });
  if (r.error) return { ok: false, error: r.error.message, stdout: '' };
  if (r.status !== 0) return { ok: false, error: (r.stderr || `非零退出 ${r.status}`).slice(0, 500), stdout: r.stdout || '' };
  return { ok: true, stdout: r.stdout };
}

// ---------- 单项校验 ----------

const failures = [];
const notes = [];

function fail(p, msg) {
  failures.push(`[${p.id} ${p.slug}] ${msg}`);
}

const ARG_KINDS = new Set(['plain', 'list', 'cycleList', 'tree', 'treeNode', 'skip', 'listArray', 'intersectLists', 'randomList']);
const COMPARES = new Set(['exact', 'sortedArray', 'multiset', 'nestedMultiset', 'anyOf', 'balancedBst']);
const RESULT_KINDS = new Set(['plain', 'list', 'tree', 'randomList', 'nodeVal', 'nodeIndex', 'inputTree', 'inputArray']);
const CONTRACT_KEYS = new Set(['preserveRandomListArg', 'deepCopyRandomListArg', 'returnNodeFromTreeArg']);
const IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const NON_EMPTY_STRING_FIELDS = ['title', 'slug', 'description', 'idea', 'explanation'];

function checkSchema(p, file) {
  const required = ['id', ...NON_EMPTY_STRING_FIELDS, 'difficulty', 'tags', 'hints', 'compare', 'tests', 'acmTests', 'templates', 'solutions'];
  for (const key of required) {
    if (p[key] === undefined || p[key] === null) fail(p, `缺少字段 ${key}`);
  }
  if (!Number.isSafeInteger(p.id) || p.id <= 0) fail(p, `id 非法: ${p.id}`);
  for (const key of NON_EMPTY_STRING_FIELDS) {
    if (typeof p[key] !== 'string' || !p[key].trim()) fail(p, `${key} 必须是非空字符串`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || '')) fail(p, `slug 非法: ${p.slug}`);
  const expectedFile = `p${String(p.id).padStart(3, '0')}-${p.slug}.js`;
  if (file && basename(file) !== expectedFile) fail(p, `文件名应为 ${expectedFile}，实际为 ${basename(file)}`);
  if (!['easy', 'medium', 'hard'].includes(p.difficulty)) fail(p, `difficulty 非法: ${p.difficulty}`);
  if (!Array.isArray(p.tags) || !p.tags.length || p.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) fail(p, 'tags 必须是非空字符串数组');
  if (new Set(p.tags || []).size !== (p.tags || []).length) fail(p, 'tags 含重复项');
  if (!Array.isArray(p.hints) || p.hints.length !== 4) fail(p, 'hints 必须恰好包含四层提示');
  else p.hints.forEach((hint, index) => {
    if (typeof hint !== 'string' || hint.trim().length < 8 || !/[\u3400-\u9fff]/.test(hint)) fail(p, `hints[${index}] 必须是针对性的中文提示`);
  });
  if (!COMPARES.has(p.compare)) fail(p, `compare 非法: ${p.compare}`);
  if (p.resultKind !== undefined && !RESULT_KINDS.has(p.resultKind)) fail(p, `resultKind 非法: ${p.resultKind}`);
  if (p.numericTolerance !== undefined && (!Number.isFinite(p.numericTolerance) || p.numericTolerance < 0)) fail(p, 'numericTolerance 必须是非负有限数');
  if (!Array.isArray(p.tests) || !p.tests.length) fail(p, 'tests 为空');
  if (!Array.isArray(p.acmTests) || !p.acmTests.length) fail(p, 'acmTests 为空');
  (p.acmTests || []).forEach((test, index) => {
    if (typeof test.input !== 'string' || typeof test.output !== 'string') fail(p, `ACM 用例 ${index + 1} 的 input/output 必须是字符串`);
  });
  for (const mode of ['core', 'acm']) {
    for (const lang of ['javascript', 'python', 'cpp']) {
      if (typeof p.templates?.[mode]?.[lang] !== 'string' || !p.templates[mode][lang].trim()) fail(p, `缺少模板 templates.${mode}.${lang}`);
      if (typeof p.solutions?.[mode]?.[lang] !== 'string' || !p.solutions[mode][lang].trim()) fail(p, `缺少答案 solutions.${mode}.${lang}`);
    }
  }

  if (p.design) {
    if (!IDENTIFIER.test(p.className || '')) fail(p, `className 非法: ${p.className}`);
    if (p.functionName !== undefined) fail(p, '设计题不应配置 functionName');
    if (p.argSpec !== undefined || p.resultKind !== undefined || p.judgeContract !== undefined) fail(p, '设计题不应配置 argSpec/resultKind/judgeContract');
    (p.tests || []).forEach((test, index) => {
      const validLengths = Array.isArray(test.ops) && Array.isArray(test.params) && Array.isArray(test.expected)
        && test.ops.length > 0 && test.ops.length === test.params.length && test.ops.length === test.expected.length;
      if (!validLengths) return fail(p, `设计类用例 ${index + 1} 的 ops/params/expected 非法`);
      if (test.ops[0] !== p.className || test.expected[0] !== null) fail(p, `设计类用例 ${index + 1} 必须先构造 ${p.className} 并期望 null`);
      if (test.ops.slice(1).includes(p.className)) fail(p, `设计类用例 ${index + 1} 只能构造一次`);
      test.ops.forEach((operation, opIndex) => {
        if (!IDENTIFIER.test(operation) || !Array.isArray(test.params[opIndex])) fail(p, `设计类用例 ${index + 1} 的操作 ${opIndex + 1} 非法`);
      });
    });
  } else {
    if (!IDENTIFIER.test(p.functionName || '')) fail(p, `functionName 非法: ${p.functionName}`);
    (p.tests || []).forEach((test, index) => {
      if (!Array.isArray(test.args) || !Object.hasOwn(test, 'expected')) fail(p, `用例 ${index + 1} 缺少 args/expected`);
      if (p.argSpec && test.args?.length !== p.argSpec.length) fail(p, `用例 ${index + 1} 参数数量与 argSpec 不一致`);
    });
  }

  if (p.argSpec !== undefined && !Array.isArray(p.argSpec)) fail(p, 'argSpec 必须是数组');
  (p.argSpec || []).forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || !ARG_KINDS.has(entry.kind)) return fail(p, `argSpec[${index}].kind 非法: ${entry?.kind}`);
    if (entry.kind === 'cycleList' && (!Number.isInteger(entry.posArg) || entry.posArg < 0 || entry.posArg >= p.argSpec.length)) fail(p, `argSpec[${index}].posArg 非法`);
    if (entry.kind === 'treeNode' && (!Number.isInteger(entry.treeArg) || p.argSpec[entry.treeArg]?.kind !== 'tree')) fail(p, `argSpec[${index}].treeArg 必须指向 tree 参数`);
    if (entry.kind === 'intersectLists' && (p.argSpec[index + 1]?.kind !== 'skip' || p.argSpec[index + 2]?.kind !== 'skip')) fail(p, `argSpec[${index}] 后必须跟两个 skip`);
  });
  if (p.resultKind === 'nodeIndex' && p.argSpec?.[0]?.kind !== 'cycleList') fail(p, 'nodeIndex 要求首参数为 cycleList');
  if (p.resultKind === 'inputTree' && p.argSpec?.[0]?.kind !== 'tree') fail(p, 'inputTree 要求首参数为 tree');
  if (p.resultKind === 'randomList' && !p.argSpec?.some((entry) => entry.kind === 'randomList')) fail(p, 'randomList 结果要求 randomList 参数');

  if (p.judgeContract !== undefined && (!p.judgeContract || typeof p.judgeContract !== 'object' || Array.isArray(p.judgeContract))) fail(p, 'judgeContract 必须是对象');
  for (const [key, argIndex] of Object.entries(p.judgeContract || {})) {
    if (!CONTRACT_KEYS.has(key)) fail(p, `judgeContract 字段非法: ${key}`);
    if (!Number.isInteger(argIndex) || argIndex < 0) fail(p, `judgeContract.${key} 必须是非负参数下标`);
    const expectedKind = key === 'returnNodeFromTreeArg' ? 'tree' : 'randomList';
    if (p.argSpec?.[argIndex]?.kind !== expectedKind) fail(p, `judgeContract.${key} 必须指向 ${expectedKind} 参数`);
  }
}

function checkJsCore(p) {
  const raw = runJavascriptCore(p);
  if (raw.compileError) {
    fail(p, `core/javascript 编译失败: ${raw.compileError}`);
    return;
  }
  raw.results.forEach((result, index) => {
    if (!result.ok) fail(p, `core/javascript 用例 ${index + 1} 运行异常: ${result.error}`);
    else if (!compareResult(p.tests[index].expected, result.got, p.compare, p.numericTolerance || 0)) {
      fail(p, `core/javascript 用例 ${index + 1} 错误: 期望 ${JSON.stringify(p.tests[index].expected)}，实得 ${JSON.stringify(result.got)}`);
    }
  });
}

function checkJsAcm(p) {
  let userFn;
  try {
    userFn = new Function('input', 'console', p.solutions.acm.javascript);
  } catch (e) {
    fail(p, `acm/javascript 编译失败: ${e.message}`);
    return;
  }
  p.acmTests.forEach((t, i) => {
    const lines = [];
    const fakeConsole = {
      log: (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    };
    try {
      userFn(t.input, fakeConsole);
      const stdout = lines.length ? lines.join('\n') + '\n' : '';
      if (!compareAcmOutput(t.output, stdout, p.numericTolerance ?? 0)) {
        fail(p, `acm/javascript 用例 ${i + 1} 错误: 期望 ${JSON.stringify(t.output)}，实得 ${JSON.stringify(stdout)}`);
      }
    } catch (e) {
      fail(p, `acm/javascript 用例 ${i + 1} 运行异常: ${e.message}`);
    }
  });
}

function checkPyCore(p) {
  if (!pythonRuntime) return;
  const raw = runPythonCore(p);
  if (raw.compileError) {
    fail(p, `core/python 编译失败: ${raw.compileError}`);
    return;
  }
  raw.results.forEach((r, i) => {
    const t = p.tests[i];
    if (!r.ok) {
      fail(p, `core/python 用例 ${i + 1} 运行异常: ${r.error}`);
    } else if (!compareResult(t.expected, r.got, p.compare, p.numericTolerance || 0)) {
      fail(p, `core/python 用例 ${i + 1} 错误: 期望 ${JSON.stringify(t.expected)}，实得 ${JSON.stringify(r.got)}`);
    }
  });
}

function checkPyAcm(p) {
  if (!pythonRuntime) return;
  p.acmTests.forEach((t, i) => {
    const r = runPythonAcm(p.solutions.acm.python, t.input);
    if (!r.ok) {
      fail(p, `acm/python 用例 ${i + 1} 运行异常: ${r.error}`);
    } else if (!compareAcmOutput(t.output, r.stdout, p.numericTolerance ?? 0)) {
      fail(p, `acm/python 用例 ${i + 1} 错误: 期望 ${JSON.stringify(t.output)}，实得 ${JSON.stringify(r.stdout)}`);
    }
  });
}

function checkCppCore(p) {
  if (!cppCompiler || typeof p.solutions?.core?.cpp !== 'string') return;
  const { binary, compileError } = cppCompile(cppCoreSource(p, p.solutions.core.cpp), `p${p.id}-core`);
  if (compileError) {
    fail(p, `core/cpp 编译失败: ${compileError}`);
    return;
  }
  const r = runCppBinary(binary, '');
  if (!r.ok) {
    fail(p, `core/cpp 运行失败: ${r.error}`);
    return;
  }
  const { results } = parseCppJudgeOutput(r.stdout);
  if (results.length !== p.tests.length) {
    fail(p, `core/cpp 判题结果数量不符: 期望 ${p.tests.length}，实得 ${results.length}`);
    return;
  }
  results.forEach((result, index) => {
    if (!result.ok) fail(p, `core/cpp 用例 ${index + 1} 运行异常: ${result.error}`);
    else if (!compareResult(p.tests[index].expected, result.got, p.compare, p.numericTolerance || 0)) {
      fail(p, `core/cpp 用例 ${index + 1} 错误: 期望 ${JSON.stringify(p.tests[index].expected)}，实得 ${JSON.stringify(result.got)}`);
    }
  });
}

function checkCppAcm(p) {
  if (!cppCompiler || typeof p.solutions?.acm?.cpp !== 'string') return;
  const { binary, compileError } = cppCompile(p.solutions.acm.cpp, `p${p.id}-acm`);
  if (compileError) {
    fail(p, `acm/cpp 编译失败: ${compileError}`);
    return;
  }
  p.acmTests.forEach((t, i) => {
    const r = runCppBinary(binary, t.input);
    if (!r.ok) {
      fail(p, `acm/cpp 用例 ${i + 1} 运行异常: ${r.error}`);
    } else if (!compareAcmOutput(t.output, r.stdout, p.numericTolerance ?? 0)) {
      fail(p, `acm/cpp 用例 ${i + 1} 错误: 期望 ${JSON.stringify(t.output)}，实得 ${JSON.stringify(r.stdout)}`);
    }
  });
}

function checkTemplateSyntax(p) {
  for (const mode of ['core', 'acm']) {
    try {
      new Function(p.templates[mode].javascript);
    } catch (e) {
      fail(p, `模板 templates.${mode}.javascript 语法错误: ${e.message}`);
    }
    if (pythonRuntime) {
      const r = spawnSync(pythonRuntime, ['-X', 'utf8', '-c', `compile(${JSON.stringify(p.templates[mode].python)}, '<t>', 'exec')`], {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
      });
      if (r.status !== 0) fail(p, `模板 templates.${mode}.python 语法错误: ${(r.stderr || '').slice(0, 300)}`);
    }
    if (cppCompiler && typeof p.templates?.[mode]?.cpp === 'string') {
      // core 模板需拼上判题 preamble 才有 ListNode/TreeNode 等定义；ACM 模板是完整程序
      const source = mode === 'core' ? cppCoreSource(p, p.templates.core.cpp) : p.templates.acm.cpp;
      const syntaxError = cppSyntaxCheck(source);
      if (syntaxError) fail(p, `模板 templates.${mode}.cpp 语法错误: ${syntaxError}`);
    }
  }
}

// ---------- 全局清单、知识文章与主流程 ----------

function globalFail(message) {
  failures.push(`[全局] ${message}`);
}

function assertUnique(items, key, label) {
  const seen = new Map();
  for (const item of items) {
    const value = item.problem[key];
    if (seen.has(value)) globalFail(`${label}重复: ${JSON.stringify(value)}（${seen.get(value)} / ${item.file}）`);
    else seen.set(value, item.file);
  }
}

async function importDefault(file) {
  const module = await import(pathToFileURL(file).href);
  if (!module.default || typeof module.default !== 'object') throw new Error(`${file} 没有默认导出对象`);
  return module.default;
}

async function scanProblemFiles() {
  const directory = resolve(ROOT, 'problems');
  const names = (await readdir(directory)).filter((name) => /^p\d{3,}-.+\.js$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({ file: resolve(directory, name), problem: await importDefault(resolve(directory, name)) })));
}

function checkProblemManifest(entries, manifest, allTags) {
  if (entries.length !== PROBLEM_BASELINE) globalFail(`题目文件应恰好 ${PROBLEM_BASELINE} 个，实际 ${entries.length}`);
  if (manifest.length !== PROBLEM_BASELINE) globalFail(`题目 manifest 应恰好 ${PROBLEM_BASELINE} 项，实际 ${manifest.length}`);
  assertUnique(entries, 'id', '题号');
  assertUnique(entries, 'slug', 'slug');
  assertUnique(entries, 'title', '标题');

  const byId = new Map(entries.map((entry) => [entry.problem.id, entry]));
  for (const metadata of manifest) {
    const entry = byId.get(metadata.id);
    if (!entry) {
      globalFail(`manifest 存在孤儿题目 ID ${metadata.id}`);
      continue;
    }
    const expected = Object.fromEntries(['id', 'title', 'slug', 'difficulty', 'tags'].map((key) => [key, entry.problem[key]]));
    if (JSON.stringify(metadata) !== JSON.stringify(expected)) globalFail(`manifest 元数据与题目文件不一致: ID ${metadata.id}`);
    byId.delete(metadata.id);
  }
  for (const entry of byId.values()) globalFail(`题目文件未登记到 manifest: ${basename(entry.file)}`);
  const sortedIds = manifest.map(({ id }) => id);
  if (sortedIds.some((id, index) => index > 0 && sortedIds[index - 1] >= id)) globalFail('题目 manifest 未按 ID 严格递增排序');
  const expectedTags = [...new Set(entries.flatMap(({ problem }) => problem.tags))].sort();
  if (JSON.stringify(allTags) !== JSON.stringify(expectedTags)) globalFail('allTags 与完整题目标签集合不一致');

  const coreCases = entries.reduce((sum, { problem }) => sum + problem.tests.length, 0);
  const acmCases = entries.reduce((sum, { problem }) => sum + problem.acmTests.length, 0);
  if (coreCases < CORE_CASE_BASELINE) globalFail(`core 用例低于基线 ${CORE_CASE_BASELINE}，实际 ${coreCases}`);
  if (acmCases < ACM_CASE_BASELINE) globalFail(`ACM 用例低于基线 ${ACM_CASE_BASELINE}，实际 ${acmCases}`);
  notes.push(`题库基线：${entries.length} 题，core ${coreCases} 例，ACM ${acmCases} 例`);
}

function checkRunnableExamples(article, file, exampleOwners) {
  const pattern = /```(run-js|run-py|run-cpp)#([a-z0-9]+(?:-[a-z0-9]+)*)\s*\n([\s\S]*?)```/g;
  const langByFence = { 'run-js': 'javascript', 'run-py': 'python', 'run-cpp': 'cpp' };
  const languagesById = new Map();
  let count = 0;
  for (const match of article.content.matchAll(pattern)) {
    count += 1;
    const language = langByFence[match[1]];
    const exampleId = match[2];
    if (exampleOwners.has(exampleId) && exampleOwners.get(exampleId) !== article.slug) globalFail(`运行示例 ID 跨文章重复: ${exampleId}`);
    exampleOwners.set(exampleId, article.slug);
    const languages = languagesById.get(exampleId) || new Set();
    if (languages.has(language)) globalFail(`${basename(file)} 的 ${exampleId} 重复定义 ${language} 示例`);
    languages.add(language);
    languagesById.set(exampleId, languages);
    if (language === 'javascript') {
      try {
        new Function('console', match[3])({ log() {} });
      } catch (error) {
        globalFail(`${basename(file)} 运行示例 ${exampleId} 失败: ${error.message}`);
      }
    } else if (language === 'python' && pythonRuntime) {
      const result = spawnSync(pythonRuntime, ['-X', 'utf8', '-c', match[3]], { encoding: 'utf8', timeout: TIMEOUT_MS });
      if (result.error || result.status !== 0) globalFail(`${basename(file)} 运行示例 ${exampleId} 失败: ${result.error?.message || result.stderr.slice(0, 300)}`);
    } else if (cppCompiler) {
      const { binary, compileError } = cppCompile(match[3], `k-${exampleId}`);
      if (compileError) {
        globalFail(`${basename(file)} 运行示例 ${exampleId} 编译失败: ${compileError}`);
      } else {
        const r = runCppBinary(binary, '');
        if (!r.ok) globalFail(`${basename(file)} 运行示例 ${exampleId} 失败: ${r.error}`);
      }
    }
  }
  if (!count) globalFail(`${basename(file)} 缺少带 example ID 的可运行示例`);
  for (const [exampleId, languages] of languagesById) {
    if (!languages.has('javascript') || !languages.has('python') || !languages.has('cpp')) {
      globalFail(`${basename(file)} 的 ${exampleId} 必须同时提供 JS、Python 与 C++ 示例`);
    }
  }
  return count;
}

async function checkKnowledge(problemIds) {
  const directory = resolve(ROOT, 'knowledge');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.js') && name !== 'index.js').sort();
  const entries = await Promise.all(files.map(async (name) => ({ file: resolve(directory, name), article: await importDefault(resolve(directory, name)) })));
  const { articles, loadArticle } = await import(pathToFileURL(resolve(directory, 'index.js')).href);
  const slugs = new Set();
  const exampleOwners = new Map();
  let runnableCount = 0;
  for (const { article, file } of entries) {
    for (const key of ['slug', 'title', 'intro', 'content']) {
      if (typeof article[key] !== 'string' || !article[key].trim()) globalFail(`${basename(file)} 的 ${key} 必须是非空字符串`);
    }
    if (basename(file) !== `${article.slug}.js`) globalFail(`${basename(file)} 与文章 slug ${article.slug} 不一致`);
    if (slugs.has(article.slug)) globalFail(`知识文章 slug 重复: ${article.slug}`);
    slugs.add(article.slug);
    if (!Array.isArray(article.tags) || !article.tags.length) globalFail(`${basename(file)} tags 为空`);
    for (const relation of article.relatedProblems || []) {
      const id = Number.isSafeInteger(relation) ? relation : relation?.id;
      if (!Number.isSafeInteger(id) || !problemIds.has(id)) globalFail(`${basename(file)} 关联不存在的题目 ID ${JSON.stringify(relation)}`);
    }
    runnableCount += checkRunnableExamples(article, file, exampleOwners);
  }
  const manifestSlugs = new Set(articles.map(({ slug }) => slug));
  for (const slug of slugs) if (!manifestSlugs.has(slug)) globalFail(`知识文章未登记到 manifest: ${slug}`);
  for (const metadata of articles) {
    if (!slugs.has(metadata.slug)) globalFail(`知识 manifest 存在孤儿文章: ${metadata.slug}`);
    const full = await loadArticle(metadata.slug);
    if (full.slug !== metadata.slug) globalFail(`loadArticle(${metadata.slug}) 返回错误文章`);
  }
  notes.push(`知识库：${entries.length} 篇文章，${runnableCount} 个可运行示例`);
}

async function main() {
  const requestedFiles = process.argv.slice(2);
  let entries;
  if (requestedFiles.length) {
    entries = await Promise.all(requestedFiles.map(async (file) => {
      const absolute = resolve(ROOT, file);
      return { file: absolute, problem: await importDefault(absolute) };
    }));
  } else {
    entries = await scanProblemFiles();
    const { problems: manifest, allTags } = await import(pathToFileURL(resolve(ROOT, 'problems/index.js')).href);
    checkProblemManifest(entries, manifest, allTags);
    await checkKnowledge(new Set(entries.map(({ problem }) => problem.id)));
  }

  if (!entries.length) {
    console.log('没有可校验的题目');
    return;
  }
  if (!pythonRuntime) notes.push('警告：未找到 Python 3，Python 参考代码与模板跳过执行校验（仅做数据格式校验）');
  if (!cppCompiler) notes.push('警告：未找到 g++ / clang++ / c++，C++ 参考代码与模板跳过编译执行校验（仅做数据格式校验）');
  for (const { problem, file } of entries) {
    checkSchema(problem, file);
    checkTemplateSyntax(problem);
    checkJsCore(problem);
    checkJsAcm(problem);
    checkPyCore(problem);
    checkPyAcm(problem);
    checkCppCore(problem);
    checkCppAcm(problem);
    notes.push(`${problem.id} ${problem.slug}: 六套参考答案校验完成`);
  }

  console.log(notes.join('\n'));
  if (failures.length) {
    console.error(`\n共 ${failures.length} 个问题:`);
    console.error(failures.map((message) => `  ✗ ${message}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`\n全部 ${entries.length} 道题校验通过 ✓`);
}

await main();
