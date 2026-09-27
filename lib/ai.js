'use strict';

/**
 * AI 深度评估封装
 * 兼容任意 OpenAI 格式的 chat/completions 接口
 * 配置优先级：前端传入 config > 服务端环境变量
 */

const SYSTEM_PROMPT =
  '你是一位资深开源项目评审专家，正在为 GitHub 仓库出具「体检报告」的 AI 终审意见。' +
  '请基于给定数据客观、简洁地评估，不要编造数据中不存在的信息。' +
  '严格只输出一个 JSON 对象，不要输出任何多余文本、解释或代码块标记。';

/** 从体检报告中抽取供 AI 参考的关键事实 */
function buildFacts(report) {
  const b = report.basic || {};
  const dims = (report.score && report.score.dimensions) || [];
  return {
    仓库: b.full_name,
    简介: b.description || '(无)',
    主语言: b.language || '未知',
    Stars: b.stargazers_count,
    Forks: b.forks_count,
    Watchers: b.subscribers_count,
    OpenIssue与PR: b.open_issues_count,
    创建时间: b.created_at,
    最近推送: b.pushed_at,
    语言分布: (report.languages || []).slice(0, 8).map((l) => `${l.name} ${l.pct}%`).join(', ') || '未知',
    贡献者数: report.contributorsCount,
    活跃贡献者Top5: (report.topContributors || []).slice(0, 5).map((c) => `${c.login}(${c.contributions}次提交)`).join(', '),
    近4周提交数: report.activity ? report.activity.last4Weeks : null,
    上一周期提交数: report.activity ? report.activity.prev4Weeks : null,
    工程设施: report.features,
    最新Release: report.latestRelease ? `${report.latestRelease.tag_name} @ ${report.latestRelease.published_at}` : '无',
    本地评分: {
      总分: report.score && report.score.overall,
      分维度: dims.map((d) => `${d.label}:${d.value}`).join(', '),
    },
    体检非正常项: (report.checks || []).filter((c) => c.status !== 'ok').map((c) => `${c.name}[${c.status === 'warn' ? '提醒' : '异常'}]`),
  };
}

function buildUserPrompt(facts) {
  return [
    '以下是某公开 GitHub 仓库的体检数据（JSON）：',
    JSON.stringify(facts, null, 2),
    '',
    '请从以下五个维度打分（0-100 整数）：popularity(热度)、activity(活跃度)、community(社区健康)、standards(工程规范)、maintenance(可维护性)。',
    '然后给出综合分 overall（0-100 整数）、评级 grade（优秀/良好/一般/需关注 之一）。',
    '严格只输出如下结构的 JSON，字段必须完整：',
    '{"overall":数字,"grade":"优秀|良好|一般|需关注","scores":{"popularity":数字,"activity":数字,"community":数字,"standards":数字,"maintenance":数字},"summary":"不超过120字的中文总评","highlights":["亮点1","亮点2"],"risks":["风险1"],"suggestions":["建议1","建议2","建议3"]}',
  ].join('\n');
}

/** 从模型输出中宽容地提取 JSON（兼容代码块包裹等情况） */
function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * 调用 AI 生成评估
 * @param {object} report /api/analyze 返回的 report
 * @param {object} config { baseURL, apiKey, model }（可选）
 * @returns {{ ai: object, model: string }}
 */
async function askAi(report, config) {
  const apiKey = (config && config.apiKey) || process.env.OPENAI_API_KEY || '';
  const baseURL = ((config && config.baseURL) || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = (config && config.model) || process.env.AI_MODEL || 'gpt-4o-mini';

  if (!report || !report.basic) {
    const e = new Error('缺少有效的体检报告数据');
    e.code = 'AI_ERROR';
    throw e;
  }
  if (!apiKey) {
    const e = new Error('未配置 AI 服务');
    e.code = 'AI_NO_CONFIG';
    throw e;
  }

  const payload = {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(buildFacts(report)) },
    ],
  };

  let res;
  try {
    res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    const err = new Error('无法连接 AI 服务：' + (e && e.message ? e.message : e));
    err.code = 'AI_ERROR';
    throw err;
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || '';
    } catch {}
    const err = new Error(`AI 服务返回 ${res.status}${detail ? '：' + detail : ''}`);
    err.code = 'AI_ERROR';
    throw err;
  }

  const data = await res.json();
  const content =
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const ai = extractJson(content);
  if (!ai || typeof ai.overall !== 'number') {
    const err = new Error('AI 返回内容无法解析为评分 JSON，请检查模型是否支持结构化输出');
    err.code = 'AI_ERROR';
    throw err;
  }

  // 补全缺失字段，保证前端渲染稳定
  ai.scores = ai.scores || {};
  ai.highlights = Array.isArray(ai.highlights) ? ai.highlights : [];
  ai.risks = Array.isArray(ai.risks) ? ai.risks : [];
  ai.suggestions = Array.isArray(ai.suggestions) ? ai.suggestions : [];
  ai.summary = typeof ai.summary === 'string' ? ai.summary : '';
  if (!ai.grade) ai.grade = ai.overall >= 80 ? '优秀' : ai.overall >= 65 ? '良好' : ai.overall >= 50 ? '一般' : '需关注';

  return { ai, model };
}

module.exports = { askAi };
