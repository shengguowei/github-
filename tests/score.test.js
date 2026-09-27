'use strict';

/**
 * 评分引擎单元测试（Node.js 内置 test runner，零依赖）
 * 运行：node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const { computeScores, buildChecks } = require('../lib/score');

/** 构造一份合成的分析报告（simulate analyzeRepo 的产出） */
function makeReport(overrides = {}) {
  return Object.assign(
    {
      basic: {
        full_name: 'octocat/hello-world',
        description: 'A demo repository',
        stargazers_count: 1200,
        forks_count: 300,
        open_issues_count: 5,
        license: { spdx_id: 'MIT' },
        topics: ['demo', 'nodejs', 'api'],
      },
      daysSincePush: 1,
      activity: { last4Weeks: 20 },
      contributorsCount: 8,
      features: { readme: true, licenseFile: true, description: true, contributing: true, ci: true, tests: true },
      latestRelease: { tag_name: 'v1.0.0', published_at: new Date(Date.now() - 10 * 86400000).toISOString() },
    },
    overrides
  );
}

function dimOf(score, key) {
  return score.dimensions.find((d) => d.key === key).value;
}

test('健康仓库应获得高分与优秀评级', () => {
  const s = computeScores(makeReport());
  assert.ok(s.overall >= 80, 'overall=' + s.overall);
  assert.strictEqual(s.grade, '优秀');
  assert.strictEqual(s.dimensions.length, 5);
});

test('空仓库应获得低分与需关注评级', () => {
  const s = computeScores({
    basic: {},
    daysSincePush: 9999,
    activity: { last4Weeks: 0 },
    contributorsCount: 0,
    features: {},
    latestRelease: null,
  });
  assert.ok(s.overall < 50, 'overall=' + s.overall);
  assert.strictEqual(s.grade, '需关注');
});

test('热度维度随 Stars 增长单调上升', () => {
  const lo = dimOf(computeScores(makeReport({ basic: { stargazers_count: 10, forks_count: 0 } })), 'popularity');
  const hi = dimOf(computeScores(makeReport({ basic: { stargazers_count: 10000, forks_count: 1000 } })), 'popularity');
  assert.ok(hi > lo, `hi(${hi}) 应大于 lo(${lo})`);
});

test('活跃度随推送时间衰减', () => {
  const fresh = dimOf(computeScores(makeReport({ daysSincePush: 1 })), 'activity');
  const stale = dimOf(computeScores(makeReport({ daysSincePush: 400 })), 'activity');
  assert.ok(fresh > stale, `fresh(${fresh}) 应大于 stale(${stale})`);
});

test('空输入不抛错且分数在合法区间', () => {
  const s = computeScores({});
  assert.strictEqual(typeof s.overall, 'number');
  assert.ok(s.overall >= 0 && s.overall <= 100);
});

test('体检明细共 10 项且字段完整', () => {
  const checks = buildChecks(makeReport());
  assert.strictEqual(checks.length, 10);
  for (const c of checks) {
    assert.ok(c.name, 'name 缺失');
    assert.ok(['ok', 'warn', 'bad'].includes(c.status), '非法状态: ' + c.status);
    assert.strictEqual(typeof c.detail, 'string');
    assert.strictEqual(typeof c.suggestion, 'string');
  }
});

test('缺 README 时对应项为异常，补齐后为正常', () => {
  const no = buildChecks(makeReport({ features: {} }));
  const yes = buildChecks(makeReport());
  assert.strictEqual(no[0].name, 'README 文档');
  assert.strictEqual(no[0].status, 'bad');
  assert.strictEqual(yes[0].status, 'ok');
});

test('简介与主题标签齐全时描述项为正常', () => {
  const c = buildChecks(makeReport()).find((x) => x.name === '描述与标签');
  assert.strictEqual(c.status, 'ok');
});
