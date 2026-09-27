'use strict';

/* ============ GitHub 仓库体检中心 · 前端逻辑 ============ */

const $ = (s) => document.querySelector(s);

const state = { report: null };
const charts = {};

/* ---------------- 常量 ---------------- */

const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
  Go: '#00ADD8', Rust: '#dea584', 'C++': '#f34b7d', C: '#555555', 'C#': '#178600',
  Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
  Shell: '#89e051', HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', SCSS: '#c6538c',
  'Jupyter Notebook': '#DA5B0B', PowerShell: '#012456', Lua: '#000080', Haskell: '#5e5086',
  R: '#198CE7', 'Objective-C': '#438eff', Elixir: '#6e4a7e', Zig: '#ec915c', Solidity: '#AA6746',
  Makefile: '#427819', Dockerfile: '#384d54', Perl: '#0298c3', Scala: '#c22d40', Clojure: '#db5855',
  'Vim script': '#199f4b', 'Emacs Lisp': '#c065db', Nix: '#7e7eff', Julia: '#a270ba',
};
const FALLBACK_COLORS = ['#0ea5a4', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#3b82f6', '#84cc16', '#e11d48'];
const GRADE_COLORS = { 优秀: '#10b981', 良好: '#3b82f6', 一般: '#f59e0b', 需关注: '#ef4444' };
const STATUS_META = { ok: ['✅', '正常'], warn: ['⚠️', '提醒'], bad: ['❌', '异常'] };
const ERROR_META = {
  INVALID_URL: { icon: '🔍', title: '地址无法识别' },
  NOT_FOUND: { icon: '🫥', title: '仓库不存在' },
  RATE_LIMITED: { icon: '🚦', title: 'GitHub API 限流' },
  NETWORK: { icon: '📡', title: '网络异常' },
  GITHUB_ERROR: { icon: '⚠️', title: 'GitHub 接口异常' },
  SERVER_ERROR: { icon: '💥', title: '服务异常' },
};
const LOADING_MSGS = [
  '正在连接 GitHub…',
  '正在采集仓库指标…',
  '正在统计贡献者与提交记录…',
  '正在计算五维健康分…',
  '正在生成体检报告…',
];

/* ---------------- 工具函数 ---------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtNum(n) {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtSize(kb) {
  if (kb == null) return '-';
  return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
}

function langColor(name, i) {
  return LANG_COLORS[name] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2200);
}

/* ---------------- 加载动画 ---------------- */

let loadTimer = null;
function startLoadingMsgs() {
  let i = 0;
  $('#loading-text').textContent = LOADING_MSGS[0];
  stopLoadingMsgs();
  loadTimer = setInterval(() => {
    i = (i + 1) % LOADING_MSGS.length;
    $('#loading-text').textContent = LOADING_MSGS[i];
  }, 1600);
}
function stopLoadingMsgs() {
  if (loadTimer) { clearInterval(loadTimer); loadTimer = null; }
}

/* ---------------- 主流程 ---------------- */

async function checkRepo(input) {
  input = (input || '').trim();
  if (!input) { toast('请先输入仓库地址'); return; }
  $('#repo-input').value = input;

  hide($('#error'));
  hide($('#report'));
  show($('#loading'));
  startLoadingMsgs();

  try {
    const res = await fetch('/api/analyze?url=' + encodeURIComponent(input));
    const data = await res.json();
    if (!data.ok) { showError(data); return; }
    state.report = data.report;
    renderReport(data.report);
    addHistory(input, data.report.basic.full_name);
    try { history.replaceState(null, '', '/?repo=' + encodeURIComponent(input)); } catch {}
    hide($('#loading'));
    show($('#report'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showError({ code: 'NETWORK', message: '请求失败：' + e.message, hint: '请确认服务已启动（node server.js）且本机可访问 GitHub' });
  } finally {
    stopLoadingMsgs();
    hide($('#loading'));
  }
}

function showError(data) {
  const meta = ERROR_META[data.code] || { icon: '⚠️', title: '出错了' };
  $('#error-icon').textContent = meta.icon;
  $('#error-title').textContent = meta.title;
  $('#error-message').textContent = data.message || '发生未知错误';
  $('#error-hint').textContent = data.hint || '';

  const extra = $('#error-extra');
  extra.innerHTML = '';
  if (data.code === 'RATE_LIMITED' && data.resetAt) {
    const t = new Date(data.resetAt);
    const mins = Math.max(1, Math.round((data.resetAt - Date.now()) / 60000));
    extra.textContent = `配额预计 ${t.toLocaleTimeString('zh-CN')} 重置（约 ${mins} 分钟后）。配置 GITHUB_TOKEN 可提升至 5000 次/小时，详见 README。`;
  }
  hide($('#loading'));
  show($('#error'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- 报告渲染 ---------------- */

function makeChart(id) {
  if (typeof echarts === 'undefined') return null;
  const el = document.getElementById(id);
  if (!el) return null;
  if (charts[id]) charts[id].dispose();
  const c = echarts.init(el);
  charts[id] = c;
  return c;
}

function renderReport(r) {
  const b = r.basic;
  $('#r-avatar').src = (b.owner && b.owner.avatar_url) || '';

  $('#r-name').innerHTML =
    `<a href="${esc(b.html_url)}" target="_blank" rel="noreferrer">${esc(b.full_name)}</a>` +
    (b.archived ? '<span class="tag-archived">已归档</span>' : '');
  $('#r-desc').textContent = b.description || '（暂无简介）';
  $('#r-topics').innerHTML = (b.topics || []).slice(0, 10).map((t) => `<span class="topic">#${esc(t)}</span>`).join('');

  const lic = b.license && b.license.spdx_id && b.license.spdx_id !== 'NOASSERTION' ? b.license.spdx_id : '未声明';
  const facts = [
    ['主语言', b.language || '未知'],
    ['创建于', fmtDate(b.created_at)],
    ['最近推送', fmtDate(b.pushed_at)],
    ['许可证', lic],
    ['默认分支', b.default_branch || '-'],
    ['仓库大小', fmtSize(b.size)],
  ];
  if (b.homepage) facts.push(['主页', '']);
  $('#r-facts').innerHTML = facts
    .map(([k, v], i) =>
      k === '主页'
        ? `<span class="fact"><b>主页</b><a href="${esc(b.homepage)}" target="_blank" rel="noreferrer" style="color:var(--primary)">${esc(b.homepage)}</a></span>`
        : `<span class="fact"><b>${k}</b>${esc(v)}</span>`
    )
    .join('');

  renderGauge(r);
  renderStats(r);
  renderRadar(r);
  renderActivity(r);
  renderLangs(r);
  renderContribs(r);
  renderChecks(r);
  resetAiPanel();
}

/* 健康分仪表盘 */
function renderGauge(r) {
  const c = makeChart('chart-gauge');
  if (!c) return;
  const color = GRADE_COLORS[r.score.grade] || '#0d9488';
  c.setOption({
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      radius: '98%',
      center: ['50%', '60%'],
      progress: { show: true, width: 15, roundCap: true, itemStyle: { color } },
      axisLine: { roundCap: true, lineStyle: { width: 15, color: [[1, '#e8edf3']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      anchor: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 40,
        fontWeight: 700,
        color,
        offsetCenter: [0, '-4%'],
        formatter: '{value}',
      },
      data: [{ value: r.score.overall }],
    }],
  });
  const badge = $('#r-grade');
  badge.textContent = `${r.score.grade} · 综合健康`;
  badge.style.background = color + '1a';
  badge.style.color = color;
}

/* 核心指标卡 */
function renderStats(r) {
  const b = r.basic;
  const a = r.activity;
  const trend = a.last4Weeks - a.prev4Weeks;
  const cards = [
    { icon: '⭐', label: 'Stars', value: fmtNum(b.stargazers_count) },
    { icon: '🍴', label: 'Forks', value: fmtNum(b.forks_count) },
    { icon: '👀', label: 'Watchers', value: fmtNum(b.subscribers_count) },
    { icon: '🐝', label: 'Open Issue / PR', value: fmtNum(b.open_issues_count) },
    { icon: '👥', label: '贡献者', value: fmtNum(r.contributorsCount) },
    {
      icon: '📈',
      label: '近 4 周提交',
      value: fmtNum(a.last4Weeks),
      trendHtml:
        `<span class="trend ${trend > 0 ? 'up' : trend < 0 ? 'down' : ''}">` +
        `${trend > 0 ? '▲' : trend < 0 ? '▼' : '—'} ${Math.abs(trend)}</span>`,
    },
  ];
  $('#stats-grid').innerHTML = cards
    .map(
      (c) => `
      <div class="stat-card">
        <div class="stat-icon">${c.icon}</div>
        <div class="stat-body">
          <div class="stat-value">${c.value}${c.trendHtml || ''}</div>
          <div class="stat-label">${c.label}</div>
        </div>
      </div>`
    )
    .join('');
}

/* 五维雷达 */
function renderRadar(r) {
  const c = makeChart('chart-radar');
  if (!c) return;
  c.setOption({
    tooltip: {},
    radar: {
      indicator: r.score.dimensions.map((d) => ({ name: d.label, max: 100 })),
      radius: '62%',
      center: ['50%', '52%'],
      axisName: { color: '#475569', fontSize: 12 },
      splitArea: { areaStyle: { color: ['#ffffff', '#f8fafc'] } },
      splitLine: { lineStyle: { color: '#e5e9f0' } },
      axisLine: { lineStyle: { color: '#e5e9f0' } },
    },
    series: [{
      type: 'radar',
      data: [{
        value: r.score.dimensions.map((d) => d.value),
        name: '健康分',
        symbolSize: 5,
        lineStyle: { color: '#0d9488', width: 2.5 },
        itemStyle: { color: '#0d9488' },
        areaStyle: { color: 'rgba(13,148,136,0.18)' },
      }],
    }],
  });
}

/* 近 12 周提交活跃 */
function renderActivity(r) {
  const c = makeChart('chart-activity');
  if (!c) return;
  const weeks = r.activity.weekly;
  c.setOption({
    grid: { left: 36, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: weeks.map((w) => w.label),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e5e9f0' } },
      axisTick: { show: false },
      axisLabel: { color: '#6b7280', fontSize: 11, interval: 2 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    series: [{
      type: 'line',
      data: weeks.map((w) => w.count),
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { color: '#0d9488', width: 2.5 },
      itemStyle: { color: '#0d9488' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(13,148,136,0.28)' },
          { offset: 1, color: 'rgba(13,148,136,0.02)' },
        ]),
      },
    }],
  });
}

/* 语言分布环图 */
function renderLangs(r) {
  const list = r.languages || [];
  const empty = $('#langs-empty');
  if (!list.length) {
    hide($('#chart-langs'));
    show(empty);
    return;
  }
  show($('#chart-langs'));
  hide(empty);
  const c = makeChart('chart-langs');
  if (!c) return;
  c.setOption({
    tooltip: { trigger: 'item', formatter: '{b}：{d}%' },
    legend: {
      type: 'scroll',
      bottom: 0,
      icon: 'circle',
      itemWidth: 9,
      itemHeight: 9,
      textStyle: { color: '#475569', fontSize: 11 },
      pageIconSize: 9,
    },
    series: [{
      type: 'pie',
      radius: ['44%', '68%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
      label: { show: false },
      emphasis: { label: { show: false } },
      data: list.map((l, i) => ({ name: l.name, value: l.bytes, itemStyle: { color: langColor(l.name, i) } })),
    }],
  });
}

/* Top 贡献者条形图 */
function renderContribs(r) {
  const list = (r.topContributors || []).slice(0, 8);
  const empty = $('#contribs-empty');
  if (!list.length) {
    hide($('#chart-contribs'));
    show(empty);
    return;
  }
  show($('#chart-contribs'));
  hide(empty);
  const c = makeChart('chart-contribs');
  if (!c) return;
  const rev = list.slice().reverse();
  c.setOption({
    grid: { left: 10, right: 48, top: 10, bottom: 10, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (p) => `${esc(p[0].name)}<br/>累计提交：${p[0].value}`,
    },
    xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
    yAxis: {
      type: 'category',
      data: rev.map((x) => (x.login.length > 14 ? x.login.slice(0, 13) + '…' : x.login)),
      axisLabel: { color: '#475569', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: rev.map((x) => x.contributions),
      barWidth: 12,
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#2dd4bf' },
          { offset: 1, color: '#0d9488' },
        ]),
        borderRadius: [0, 6, 6, 0],
      },
      label: { show: true, position: 'right', color: '#6b7280', fontSize: 11 },
    }],
  });
}

/* 体检明细表 */
function renderChecks(r) {
  $('#checks-body').innerHTML = r.checks
    .map((c) => {
      const [icon, label] = STATUS_META[c.status] || ['•', '—'];
      return `<tr>
        <td class="ck-name">${esc(c.name)}</td>
        <td><span class="pill ${c.status}">${icon} ${label}</span></td>
        <td>${esc(c.detail)}</td>
        <td class="ck-sug">${esc(c.suggestion)}</td>
      </tr>`;
    })
    .join('');
}

/* ---------------- AI 评估 ---------------- */

function getAiConfig() {
  try {
    return JSON.parse(localStorage.getItem('checkup_ai_config') || '{}');
  } catch {
    return {};
  }
}

function resetAiPanel() {
  show($('#ai-hint'));
  hide($('#ai-result'));
  hide($('#ai-error'));
  const btn = $('#btn-ai');
  btn.disabled = false;
  btn.textContent = '生成 AI 评估';
}

async function runAi() {
  if (!state.report) return;
  const btn = $('#btn-ai');
  btn.disabled = true;
  btn.textContent = '评估中…';
  hide($('#ai-error'));

  const cfg = getAiConfig();
  try {
    const res = await fetch('/api/ai-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: state.report, config: cfg.apiKey ? cfg : null }),
    });
    const data = await res.json();
    if (!data.ok) {
      showAiError(data);
      return;
    }
    renderAi(data.ai, data.model);
  } catch (e) {
    showAiError({ message: '请求失败：' + e.message });
  } finally {
    btn.disabled = false;
    btn.textContent = '重新生成 AI 评估';
  }
}

function showAiError(data) {
  const el = $('#ai-error');
  let text = '⚠️ ' + (data.message || 'AI 调用失败');
  if (data.code === 'AI_NO_CONFIG') text += ' —— 点击右上角「AI 设置」进行配置';
  if (data.hint) text += `<br/><span style="color:#9ca3af">${esc(data.hint)}</span>`;
  el.innerHTML = text;
  show(el);
  hide($('#ai-result'));
}

function renderAi(ai, model) {
  hide($('#ai-hint'));
  hide($('#ai-error'));
  show($('#ai-result'));

  const gradeEl = $('#ai-grade');
  const color = GRADE_COLORS[ai.grade] || '#6b7280';
  gradeEl.textContent = `AI 综合评分 ${ai.overall} · ${ai.grade}`;
  gradeEl.style.background = color + '1a';
  gradeEl.style.color = color;

  const labels = { popularity: '热度', activity: '活跃度', community: '社区', standards: '规范', maintenance: '维护' };
  $('#ai-scores').innerHTML = Object.entries(labels)
    .map(([k, label]) => {
      const v = ai.scores && ai.scores[k];
      if (typeof v !== 'number') return '';
      const cls = v >= 80 ? 'ok' : v >= 65 ? 'good' : v >= 50 ? 'mid' : 'low';
      return `<div class="ai-score-row">
        <span class="ai-score-label">${label}</span>
        <div class="ai-score-track"><div class="ai-score-bar ${cls}" style="width:${Math.max(2, Math.min(100, v))}%"></div></div>
        <span class="ai-score-val">${v}</span>
      </div>`;
    })
    .join('');

  $('#ai-summary').textContent = ai.summary || '';

  const fillList = (sel, arr) => {
    $(sel).innerHTML = arr && arr.length
      ? arr.map((x) => `<li>${esc(x)}</li>`).join('')
      : '<li class="ai-empty">（无）</li>';
  };
  fillList('#ai-highlights', ai.highlights);
  fillList('#ai-risks', ai.risks);
  fillList('#ai-suggestions', ai.suggestions);

  $('#ai-model').textContent = `模型：${model || '未知'} · AI 评估基于公开数据与本地体检结果，仅供参考`;
}

/* ---------------- 历史记录 ---------------- */

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem('checkup_history') || '[]');
  } catch {
    return [];
  }
}

function addHistory(input, name) {
  let list = getHistory().filter((x) => x.input !== input);
  list.unshift({ input, name, ts: Date.now() });
  list = list.slice(0, 6);
  localStorage.setItem('checkup_history', JSON.stringify(list));
  renderHistory();
}

function renderHistory() {
  const list = getHistory();
  const el = $('#history');
  if (!list.length) { hide(el); return; }
  show(el);
  el.innerHTML =
    '<span class="h-title">🕘 最近体检：</span>' +
    list.map((x) => `<button class="chip" type="button" data-repo="${esc(x.input)}" title="${esc(x.input)}">${esc(x.name || x.input)}</button>`).join('');
}

/* ---------------- AI 设置弹窗 ---------------- */

function openSettings() {
  const cfg = getAiConfig();
  $('#cfg-base').value = cfg.baseURL || '';
  $('#cfg-key').value = cfg.apiKey || '';
  $('#cfg-model').value = cfg.model || '';
  show($('#settings-modal'));
}
function closeSettings() { hide($('#settings-modal')); }

function saveSettings() {
  const cfg = {
    baseURL: $('#cfg-base').value.trim(),
    apiKey: $('#cfg-key').value.trim(),
    model: $('#cfg-model').value.trim(),
  };
  localStorage.setItem('checkup_ai_config', JSON.stringify(cfg));
  closeSettings();
  toast(cfg.apiKey ? '✅ AI 配置已保存（浏览器本地）' : '已保存：AI Key 为空，将使用服务端环境变量');
}

function clearSettings() {
  localStorage.removeItem('checkup_ai_config');
  $('#cfg-base').value = '';
  $('#cfg-key').value = '';
  $('#cfg-model').value = '';
  toast('已清除本地 AI 配置');
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    checkRepo($('#repo-input').value);
  });

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-repo]');
    if (chip) checkRepo(chip.dataset.repo);
  });

  $('#btn-settings').addEventListener('click', openSettings);
  $('#modal-mask').addEventListener('click', closeSettings);
  $('#cfg-save').addEventListener('click', saveSettings);
  $('#cfg-clear').addEventListener('click', clearSettings);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });

  $('#btn-ai').addEventListener('click', runAi);

  window.addEventListener('resize', () => {
    Object.values(charts).forEach((c) => c && c.resize && c.resize());
  });
}

/* ---------------- 启动 ---------------- */

bindEvents();
renderHistory();

const initialRepo = new URLSearchParams(location.search).get('repo');
if (initialRepo) {
  $('#repo-input').value = initialRepo;
  checkRepo(initialRepo);
}
