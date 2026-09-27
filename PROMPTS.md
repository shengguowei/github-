# Vibe Coding 过程记录

本项目完全使用 AI Coding 工具（WorkBuddy）以对话方式从零生成。以下为主要提示词，供参考。

## 1. 原始需求（任务来源）

> 任务：在 48 小时内完成 Github 仓库"体检"工具。
>
> 需求：提供 web 页面，用户输入某个公开 Github 仓库的 url，对这个仓库进行分析并可视化的形式展示相关指标（如 Star 数、Fork 数，编程语言分布等）。
>
> 加分项：结合 AI 给出项目评分。
>
> 要求：
> 1. 核心功能可以跑通。
> 2. 不限技术栈，鼓励使用 AI Coding 工具。
> 3. 提交结果时，请给出完整代码以及运行方式说明（直接提供 github 仓库地址或者打包的代码）。
> 4. 其他：可以附加提供 Vibe Coding 过程中的提示词或截图。

## 2. 开发提示词（核心设计指令）

> 请实现一个「GitHub 仓库体检中心」Web 应用，从零创建完整可运行项目，技术选型与约束如下：
>
> - **零依赖后端**：Node.js（≥18）内置 http 模块 + 全局 fetch，禁止任何 npm 依赖，`node server.js` 一条命令启动，降低运行门槛；
> - **后端职责**：
>   - 静态文件服务（public/）；
>   - `/api/analyze` 代理 GitHub REST API：解析 owner/repo（支持完整 URL / owner/repo / git@ 形式 / .git 后缀），并发抓取 repo、languages、contributors（Link header 算总数）、commits（近 100 条算 12 周活跃）、contents（检测 README/LICENSE/CONTRIBUTING/CI/测试目录）、releases/latest；限流与 404 友好处理；5 分钟内存缓存；支持 GITHUB_TOKEN / GITHUB_API_BASE 环境变量；
>   - `/api/ai-score` AI 评分代理：OpenAI 兼容 chat/completions，Key / baseURL / 模型支持环境变量与前端传入，输出严格 JSON（总评、五维分、亮点、风险、建议），宽容解析（剥离代码块围栏、截取首尾大括号）；
> - **本地启发式评分引擎**（lib/score.js）：热度/活跃度/社区/规范/维护五维 0-100 分 + 加权综合分（20/25/15/20/20）+ 四档评级 + 10 项体检明细（README、许可证、CONTRIBUTING、CI、描述标签、提交活跃度、Issue 处理、Release、社区规模、测试），确保不配 AI Key 时"体检"核心功能依然完整；
> - **前端**：原生 HTML/CSS/JS + 本地内置 ECharts（不用 CDN，离线可用），医疗体检报告视觉风格：
>   - 健康分仪表盘（gauge）+ 评级徽章、五维雷达、近 12 周提交活跃折线（面积渐变）、语言分布环图（GitHub 官方语言配色）、Top 贡献者横向条形图；
>   - 10 项体检明细表（✅ 正常 / ⚠️ 提醒 / ❌ 异常）、核心指标卡（Stars/Forks/Watchers/Open Issue/贡献者/近 4 周提交+环比）、AI 评估卡（五维进度条+总评+亮点/风险/建议）、AI 设置弹窗（存 localStorage）、历史体检记录、?repo=owner/repo URL 直达；
>   - 全中文界面、浅色主题、响应式布局，加载动画与错误分支（404/限流/网络/非法输入）完整。

## 3. 迭代提示词（节选）

> "启动服务并用接口工具验证 /api/analyze 对 facebook/react 返回 ok:true、字段完整；验证非法输入返回 INVALID_URL、不存在仓库返回 NOT_FOUND。"

> "用无头浏览器打开 http://127.0.0.1:3000/?repo=facebook/react，等待报告渲染完成后整页截图，存入 docs/screenshots/ 作为提交材料。"

> "把项目打包为 zip（含全部源码与本地 ECharts，不含临时文件），并完善 README 的运行方式说明。"

## 4. 产出

- 完整零依赖源码（运行方式见 README）
- 运行截图（docs/screenshots/）
