'use strict';

/**
 * GitHub 仓库体检中心 · 零依赖服务端
 * 仅需 Node.js >= 18（使用内置 http 与全局 fetch），无需 npm install
 *
 * 职责：
 *  1. 静态文件服务（public/）
 *  2. GET  /api/analyze?url=<仓库地址>  —— 代理 GitHub REST API 并生成体检报告
 *  3. POST /api/ai-score               —— 代理 OpenAI 兼容接口生成 AI 评估
 *  4. GET  /api/health                 —— 健康检查
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { computeScores, buildChecks } = require('./lib/score');
const { askAi } = require('./lib/ai');

const DAY = 86400000;

/* ---------------- 极简 .env 加载（可选，优先级低于真实环境变量） ----------------
 * 注意：必须先加载 .env、再读取下方配置常量，否则 .env 中的值不会生效。 */
function loadDotEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = val;
    }
  } catch {}
}
loadDotEnv();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const GITHUB_API = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------- 基础工具 ---------------- */

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(buf);
  });
}

/* ---------------- GitHub 输入解析 ---------------- */

/**
 * 支持以下输入形式：
 *  - https://github.com/owner/repo（可带后续路径 / tree/main/...）
 *  - http://www.github.com/owner/repo.git
 *  - github.com/owner/repo
 *  - git@github.com:owner/repo.git
 *  - owner/repo
 */
function parseRepoInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  const scp = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (scp) return { owner: scp[1], repo: scp[2] };

  if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    const [o, r] = s.split('/');
    return { owner: o, repo: r.replace(/\.git$/i, '') };
  }

  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.)?github\.com\//i.test(s)) s = 'https://' + s;
    else return null;
  }

  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
}

/* ---------------- GitHub API 客户端 ---------------- */

function ghHeaders() {
  const h = {
    'User-Agent': 'github-repo-checkup',
    Accept: 'application/vnd.github+json',
  };
  if (GITHUB_TOKEN) h.Authorization = 'Bearer ' + GITHUB_TOKEN;
  return h;
}

/**
 * 请求 GitHub API。
 * - 404 且 ok404=true 时返回 null（用于可选资源）
 * - 限流时抛出 RATE_LIMITED
 */
async function gh(pathname, { ok404 = false } = {}) {
  let res;
  try {
    res = await fetch(GITHUB_API + pathname, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    const err = new Error('GitHub API 网络请求失败：' + (e && e.message ? e.message : e));
    err.code = 'NETWORK';
    throw err;
  }
  if (res.status === 404 && ok404) return null;
  if (res.status === 404) {
    const err = new Error('仓库不存在，或为私有仓库');
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
    const err = new Error('GitHub API 配额已用尽');
    err.code = 'RATE_LIMITED';
    err.resetAt = reset;
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('GitHub API 返回 ' + res.status);
    err.code = 'GITHUB_ERROR';
    err.status = res.status;
    throw err;
  }
  return res;
}

/** 可失败的并行请求：限流必须向上抛，其余（404/网络抖动）降级为 null */
function soft(p) {
  return p.catch((e) => {
    if (e && e.code === 'RATE_LIMITED') throw e;
    return null;
  });
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj && obj[k] !== undefined) o[k] = obj[k];
  return o;
}

/* ---------------- 仓库分析 ---------------- */

// 简单内存缓存（5 分钟），节约 API 配额
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function analyzeRepo(owner, repo) {
  const key = (owner + '/' + repo).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return { ...hit.report, meta: { ...hit.report.meta, cached: true } };
  }

  // 1. 仓库基础信息（失败直接终止）
  const basicRes = await gh(`/repos/${owner}/${repo}`);
  const raw = await basicRes.json();

  // 2. 并行抓取可选资源
  const [langsRes, contribCountRes, topContribRes, commitsRes, contentsRes] = await Promise.all([
    soft(gh(`/repos/${owner}/${repo}/languages`, { ok404: true })),
    soft(gh(`/repos/${owner}/${repo}/contributors?per_page=1`, { ok404: true })),
    soft(gh(`/repos/${owner}/${repo}/contributors?per_page=8`, { ok404: true })),
    soft(gh(`/repos/${owner}/${repo}/commits?per_page=100`, { ok404: true })),
    soft(gh(`/repos/${owner}/${repo}/contents`, { ok404: true })),
  ]);

  let latestRelease = null;
  try {
    const r = await gh(`/repos/${owner}/${repo}/releases/latest`, { ok404: true });
    if (r) {
      const j = await r.json();
      latestRelease = { tag_name: j.tag_name, name: j.name, published_at: j.published_at, html_url: j.html_url };
    }
  } catch {}

  // 3. 语言分布
  const langs = langsRes ? await langsRes.json().catch(() => ({})) : {};
  const langEntries = Object.entries(langs).sort((a, b) => b[1] - a[1]);
  const langTotal = langEntries.reduce((s, [, v]) => s + v, 0);
  const languages = langEntries.map(([name, bytes]) => ({
    name,
    bytes,
    pct: langTotal ? Number(((bytes / langTotal) * 100).toFixed(1)) : 0,
  }));

  // 4. 贡献者：总数（Link header 最后一页）+ Top 8
  let contributorsCount = 0;
  if (contribCountRes) {
    const link = contribCountRes.headers.get('link') || '';
    const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    contributorsCount = m ? Number(m[1]) : 1;
  }
  let topContributors = [];
  if (topContribRes) {
    const arr = await topContribRes.json().catch(() => []);
    if (Array.isArray(arr)) {
      topContributors = arr.map((c) => pick(c, ['login', 'contributions', 'avatar_url', 'html_url']));
    }
  }

  // 5. 近 100 条提交 → 活跃度
  const commitsArr = commitsRes ? await commitsRes.json().catch(() => []) : [];
  const commits = Array.isArray(commitsArr) ? commitsArr : [];
  const now = Date.now();
  const WEEKS = 12;
  const weekly = [];
  for (let i = 0; i < WEEKS; i++) {
    const d = new Date(now - (i * 7 + 6) * DAY);
    weekly.push({
      label: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      count: 0,
    });
  }
  // weekly[0] 为最近 7 天
  for (const c of commits) {
    const t = c && c.commit && c.commit.author && Date.parse(c.commit.author.date);
    if (!t) continue;
    const idx = Math.floor((now - t) / DAY / 7);
    if (idx >= 0 && idx < WEEKS) weekly[WEEKS - 1 - idx].count++;
  }
  const last4Weeks = weekly.slice(8).reduce((s, w) => s + w.count, 0);
  const prev4Weeks = weekly.slice(4, 8).reduce((s, w) => s + w.count, 0);
  const lastCommit = commits[0] && commits[0].commit && commits[0].commit.author ? commits[0].commit.author.date : null;

  // 6. 根目录文件 → 工程设施检测
  let rootNames = [];
  if (contentsRes) {
    const arr = await contentsRes.json().catch(() => []);
    if (Array.isArray(arr)) rootNames = arr.map((x) => String(x.name || ''));
  }

  let workflows = [];
  if (rootNames.includes('.github')) {
    try {
      const r = await gh(`/repos/${owner}/${repo}/contents/.github/workflows`, { ok404: true });
      if (r) {
        const arr = await r.json().catch(() => []);
        if (Array.isArray(arr)) workflows = arr.map((x) => String(x.name || ''));
      }
    } catch {}
  }
  let ghDirNames = [];
  if (rootNames.includes('.github')) {
    try {
      const r = await gh(`/repos/${owner}/${repo}/contents/.github`, { ok404: true });
      if (r) {
        const arr = await r.json().catch(() => []);
        if (Array.isArray(arr)) ghDirNames = arr.map((x) => String(x.name || ''));
      }
    } catch {}
  }

  const features = {
    readme: rootNames.some((n) => /^readme(\.|$)/i.test(n)),
    licenseFile: rootNames.some((n) => /^(license|licence|copying)(\.|$)/i.test(n)),
    contributing: rootNames.some((n) => /^contributing(\.|$)/i.test(n)) || ghDirNames.some((n) => /^contributing(\.|$)/i.test(n)),
    codeOfConduct: rootNames.some((n) => /^code_of_conduct(\.|$)/i.test(n)) || ghDirNames.some((n) => /^code_of_conduct(\.|$)/i.test(n)),
    ci:
      workflows.length > 0 ||
      rootNames.some((n) => /^\.travis\.yml$|^\.gitlab-ci\.yml$|^jenkinsfile$|^circle\.yml$/i.test(n)) ||
      rootNames.includes('.circleci'),
    tests: rootNames.some((n) => /^(tests?|__tests__|spec|e2e)(\/|$)/i.test(n)),
    description: !!raw.description,
  };

  // 7. 日期与评分
  const daysSincePush = raw.pushed_at ? Math.max(0, Math.floor((now - Date.parse(raw.pushed_at)) / DAY)) : null;
  const basic = {
    ...pick(raw, [
      'full_name', 'html_url', 'description', 'stargazers_count', 'forks_count', 'subscribers_count',
      'open_issues_count', 'created_at', 'updated_at', 'pushed_at', 'language', 'default_branch',
      'size', 'homepage', 'archived',
    ]),
    license: raw.license ? { spdx_id: raw.license.spdx_id, name: raw.license.name } : null,
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    owner: raw.owner ? pick(raw.owner, ['login', 'avatar_url', 'html_url']) : null,
  };
  const analysis = {
    basic,
    languages,
    contributorsCount,
    topContributors,
    activity: { weekly, last4Weeks, prev4Weeks },
    dates: { created: raw.created_at, updated: raw.updated_at, pushed: raw.pushed_at, lastCommit },
    features,
    latestRelease,
    daysSincePush,
  };
  // 评分与体检明细必须在 basic 填充之后计算
  analysis.score = computeScores(analysis);
  analysis.checks = buildChecks(analysis);

  const report = {
    ...analysis,
    meta: {
      fetchedAt: new Date().toISOString(),
      rateLimitRemaining: basicRes.headers.get('x-ratelimit-remaining'),
      token: !!GITHUB_TOKEN,
      cached: false,
    },
  };

  cache.set(key, { ts: Date.now(), report });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return report;
}

/* ---------------- HTTP 服务 ---------------- */

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');

    // ---- 仓库分析 ----
    if (u.pathname === '/api/analyze') {
      const input = u.searchParams.get('url') || '';
      const parsed = parseRepoInput(input);
      if (!parsed) {
        return json(res, 400, {
          ok: false,
          code: 'INVALID_URL',
          message: '无法识别的仓库地址',
          hint: '请输入 GitHub 仓库地址（如 https://github.com/owner/repo）或 owner/repo 形式',
        });
      }
      try {
        const report = await analyzeRepo(parsed.owner, parsed.repo);
        return json(res, 200, { ok: true, report });
      } catch (e) {
        if (e.code && e.code !== 'NETWORK') {
          return json(res, e.status || 502, { ok: false, code: e.code, message: e.message, resetAt: e.resetAt });
        }
        return json(res, 502, { ok: false, code: e.code || 'GITHUB_ERROR', message: e.message });
      }
    }

    // ---- AI 评分 ----
    if (u.pathname === '/api/ai-score' && req.method === 'POST') {
      let body = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {}
      try {
        const result = await askAi(body.report, body.config || {});
        return json(res, 200, { ok: true, ...result });
      } catch (e) {
        if (e.code === 'AI_NO_CONFIG') {
          return json(res, 400, {
            ok: false,
            code: 'AI_NO_CONFIG',
            message: '尚未配置 AI 服务',
            hint: '请点击右上角「AI 设置」填写 OpenAI 兼容接口信息，或在服务端配置 OPENAI_API_KEY 环境变量',
          });
        }
        return json(res, 502, { ok: false, code: 'AI_ERROR', message: e.message });
      }
    }

    // ---- 健康检查 ----
    if (u.pathname === '/api/health') {
      return json(res, 200, { ok: true, githubToken: !!GITHUB_TOKEN, githubApi: GITHUB_API });
    }

    // ---- 静态文件 ----
    serveStatic(u.pathname, res);
  } catch (e) {
    console.error('[server] uncaught:', e);
    if (!res.headersSent) json(res, 500, { ok: false, code: 'SERVER_ERROR', message: '服务器内部错误：' + e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请更换端口启动：PORT=3001 node server.js`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log('🩺 GitHub 仓库体检中心已启动');
  console.log(`   本机访问: http://localhost:${PORT}`);
  console.log(`   GitHub Token: ${GITHUB_TOKEN ? '已配置（5000 次/小时）' : '未配置（60 次/小时，建议配置 GITHUB_TOKEN）'}`);
  console.log(`   AI 评分: ${process.env.OPENAI_API_KEY ? '服务端已配置' : '未在服务端配置（可在页面右上角「AI 设置」中填写）'}`);
});
