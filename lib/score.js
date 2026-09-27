'use strict';

/**
 * 本地启发式评分引擎
 * 无需任何外部服务即可给出五维评分 + 综合健康分 + 10 项体检明细
 */

const DAY = 86400000;

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

/** 对数刻度打分：让 100 star 与 100k star 都能拉开区分度 */
function logScore(x, cap) {
  if (!x || x <= 0) return 0;
  return clamp(Math.round((Math.log10(x + 1) / Math.log10(cap + 1)) * 100));
}

/** 时间新近度打分 */
function recencyScore(days) {
  if (days <= 7) return 100;
  if (days <= 14) return 88;
  if (days <= 30) return 74;
  if (days <= 60) return 60;
  if (days <= 90) return 45;
  if (days <= 180) return 28;
  if (days <= 365) return 12;
  return 5;
}

/**
 * 计算五维评分与综合分
 * @param {object} a 分析报告（analyzeRepo 的产出）
 */
function computeScores(a) {
  const b = a.basic || {};
  const stars = b.stargazers_count || 0;
  const forks = b.forks_count || 0;
  const daysSincePush = a.daysSincePush == null ? 9999 : a.daysSincePush;
  const c4 = (a.activity && a.activity.last4Weeks) || 0;

  // 热度：Stars 65% + Forks 35%（对数刻度）
  const popularity = clamp(Math.round(logScore(stars, 100000) * 0.65 + logScore(forks, 20000) * 0.35));

  // 活跃度：推送新近度 60% + 近 4 周提交频次 40%
  const activity = clamp(Math.round(recencyScore(daysSincePush) * 0.6 + clamp(c4 * 5) * 0.4));

  // 社区：贡献者规模分段 + 有 Issue/PR 互动加分
  const contrib = a.contributorsCount || 0;
  let community =
    contrib >= 50 ? 95 : contrib >= 10 ? 80 : contrib >= 5 ? 65 : contrib >= 2 ? 45 : contrib === 1 ? 20 : 10;
  if ((b.open_issues_count || 0) > 0) community = clamp(community + 8);

  // 规范：文档与工程化设施齐备程度
  const f = a.features || {};
  const hasLicenseMeta = b.license && b.license.spdx_id && b.license.spdx_id !== 'NOASSERTION';
  const topicCount = (b.topics || []).length;
  const standards = clamp(
    (f.readme ? 30 : 0) +
      (hasLicenseMeta || f.licenseFile ? 20 : 0) +
      (f.description ? 10 : 0) +
      (topicCount >= 3 ? 10 : topicCount > 0 ? 5 : 0) +
      (f.contributing ? 10 : 0) +
      (f.ci ? 15 : 0) +
      (f.tests ? 5 : 0)
  );

  // 维护：推送新近度 40% + Release 节奏 30% + Issue 积压率 30%
  const rel = a.latestRelease;
  const relDays = rel ? Math.floor((Date.now() - new Date(rel.published_at).getTime()) / DAY) : null;
  const relScore = rel ? (relDays <= 90 ? 100 : relDays <= 365 ? 70 : 40) : 10;
  const openIssues = b.open_issues_count || 0;
  const issueRatio = stars > 0 ? openIssues / stars : openIssues > 0 ? 0.5 : 0;
  const issueScore = issueRatio <= 0.01 ? 100 : issueRatio <= 0.05 ? 80 : issueRatio <= 0.15 ? 60 : issueRatio <= 0.5 ? 40 : 25;
  const maintenance = clamp(Math.round(recencyScore(daysSincePush) * 0.4 + relScore * 0.3 + issueScore * 0.3));

  // 综合分（加权）
  const overall = clamp(Math.round(popularity * 0.2 + activity * 0.25 + community * 0.15 + standards * 0.2 + maintenance * 0.2));
  const grade = overall >= 80 ? '优秀' : overall >= 65 ? '良好' : overall >= 50 ? '一般' : '需关注';

  return {
    dimensions: [
      { key: 'popularity', label: '热度', value: popularity },
      { key: 'activity', label: '活跃度', value: activity },
      { key: 'community', label: '社区', value: community },
      { key: 'standards', label: '规范', value: standards },
      { key: 'maintenance', label: '维护', value: maintenance },
    ],
    overall,
    grade,
  };
}

function item(name, status, detail, suggestion) {
  return { name, status, detail: detail || '', suggestion: suggestion || '' };
}

/**
 * 生成 10 项体检明细
 * status: ok=正常 / warn=提醒 / bad=异常
 */
function buildChecks(a) {
  const b = a.basic || {};
  const f = a.features || {};
  const stars = b.stargazers_count || 0;
  const openIssues = b.open_issues_count || 0;
  const checks = [];

  // 1. README
  checks.push(
    f.readme
      ? item('README 文档', 'ok', '根目录已提供 README，项目上手信息完备', '保持文档与项目演进同步')
      : item('README 文档', 'bad', '未在根目录发现 README', '补充项目简介、安装方式与使用示例')
  );

  // 2. 许可证
  const spdx = b.license && b.license.spdx_id && b.license.spdx_id !== 'NOASSERTION' ? b.license.spdx_id : null;
  checks.push(
    spdx
      ? item('开源许可证', 'ok', `采用 ${spdx} 许可证`, '')
      : f.licenseFile
        ? item('开源许可证', 'warn', '发现许可证文件，但 GitHub 元数据未识别', '确认许可证类型，便于 GitHub 正确标注')
        : item('开源许可证', 'bad', '未发现开源许可证', '添加 LICENSE 文件，明确代码授权范围')
  );

  // 3. 贡献指南
  checks.push(
    f.contributing
      ? item('贡献指南', 'ok', '提供 CONTRIBUTING 贡献指南', '')
      : item('贡献指南', 'warn', '未发现 CONTRIBUTING', '添加 CONTRIBUTING.md 可降低外部协作门槛（可选）')
  );

  // 4. CI/CD
  checks.push(
    f.ci
      ? item('CI/CD 配置', 'ok', '已配置持续集成流水线', '')
      : item('CI/CD 配置', 'warn', '未发现 CI 配置', '建议接入 GitHub Actions 保障提交质量（可选）')
  );

  // 5. 描述与标签
  const topicCount = (b.topics || []).length;
  if (b.description && topicCount >= 3) {
    checks.push(item('描述与标签', 'ok', `简介完整，含 ${topicCount} 个主题标签`, ''));
  } else if (b.description || topicCount > 0) {
    checks.push(item('描述与标签', 'warn', '简介或主题标签不够完整', '完善 description 与 topics，提升项目可发现性'));
  } else {
    checks.push(item('描述与标签', 'bad', '缺少仓库简介与标签', '补充 description 与 topics'));
  }

  // 6. 提交活跃度
  const dp = a.daysSincePush == null ? 9999 : a.daysSincePush;
  if (dp <= 30) {
    checks.push(item('提交活跃度', 'ok', `最近推送于 ${dp} 天前`, ''));
  } else if (dp <= 90) {
    checks.push(item('提交活跃度', 'warn', `最近推送于 ${dp} 天前`, '项目节奏放缓，使用前建议关注维护状态'));
  } else {
    checks.push(item('提交活跃度', 'bad', `已 ${dp} 天未推送`, '长期未更新，使用前请评估维护风险'));
  }

  // 7. Issue 处理（注：GitHub open_issues_count 含 PR）
  if (openIssues === 0) {
    checks.push(item('Issue 处理', 'ok', '当前无未关闭的 Issue / PR', ''));
  } else {
    const ratio = stars > 0 ? openIssues / stars : null;
    if (ratio === null || ratio <= 0.05) {
      checks.push(item('Issue 处理', 'ok', `Open Issue/PR 共 ${openIssues} 个，相对规模可控`, ''));
    } else if (ratio <= 0.3) {
      checks.push(item('Issue 处理', 'warn', `Open Issue/PR 共 ${openIssues} 个，占比偏高`, '建议及时回应或定期整理 issue 列表'));
    } else {
      checks.push(item('Issue 处理', 'bad', `Open Issue/PR 共 ${openIssues} 个，积压明显`, '建立 issue 分类、认领与关闭机制'));
    }
  }

  // 8. 版本发布
  const rel = a.latestRelease;
  if (rel) {
    const rd = Math.floor((Date.now() - new Date(rel.published_at).getTime()) / DAY);
    checks.push(
      rd <= 180
        ? item('版本发布', 'ok', `最新 Release ${rel.tag_name} 发布于 ${rd} 天前`, '')
        : item('版本发布', 'warn', `最新 Release ${rel.tag_name} 已发布 ${rd} 天`, '若持续发版请更新 Release 记录')
    );
  } else {
    checks.push(item('版本发布', 'warn', '未发现正式 Release', '通过 tag 发版的仓库可忽略；否则建议规范版本发布'));
  }

  // 9. 社区规模
  const cc = a.contributorsCount || 0;
  if (cc >= 5) {
    checks.push(item('社区规模', 'ok', `共 ${cc} 位贡献者参与`, ''));
  } else if (cc >= 2) {
    checks.push(item('社区规模', 'warn', `仅 ${cc} 位贡献者`, '鼓励更多成员参与维护，降低单点风险'));
  } else if (cc === 1) {
    checks.push(item('社区规模', 'bad', '仅 1 位贡献者', '存在单点维护风险，建议扩大维护者梯队'));
  } else {
    checks.push(item('社区规模', 'warn', '暂无贡献者数据', ''));
  }

  // 10. 测试
  checks.push(
    f.tests
      ? item('测试覆盖', 'ok', '发现测试相关目录或文件', '')
      : item('测试覆盖', 'warn', '未发现测试目录', '添加自动化测试，保障重构与迭代质量')
  );

  return checks;
}

module.exports = { computeScores, buildChecks };
