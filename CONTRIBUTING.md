# 贡献指南（Contributing）

感谢对本项目的关注！欢迎通过 Issue 与 Pull Request 参与改进。

## 提交流程

1. Fork 本仓库并创建你的分支：`git checkout -b feat/your-feature`
2. 提交前请确保本地检查通过：

```bash
node --check server.js && node --check lib/score.js && node --check lib/ai.js
node --test tests/score.test.js
```

3. 发起 Pull Request，并简要描述改动动机与内容。

## 代码约定

- 保持零依赖原则：仅使用 Node.js 内置模块，不引入任何第三方包
- 遵循现有代码风格（CommonJS、单文件职责清晰）
- 提交信息使用简洁的祈使句（如 `Add xxx` / `Fix xxx`）

## 反馈问题

提交 Issue 时请附上：复现步骤、期望行为、实际行为（如涉及具体仓库请一并给出仓库地址）。
