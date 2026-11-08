# Cloudflare Worker 部署说明

此分支将原来的 Cloudflare Pages Functions 路由迁移到 Cloudflare Worker：Worker 处理登录、登出、保存日记及编辑器访问控制；静态页面仍由 Workers Static Assets 提供。

## Cloudflare 配置

1. 将 Cloudflare 项目部署方式设为 **Workers Builds / Worker**，不要继续使用 Pages 部署配置。
2. 构建命令使用 `npx wrangler deploy`。仓库根目录的 `wrangler.jsonc` 会告诉 Wrangler 使用 `worker.js` 和静态资产配置，不要额外传入 Pages 的 `--project-name`。
3. 在 Worker 的 **Settings → Variables and Secrets** 中配置以下变量。敏感值必须设为 Secret：
   - `EDITOR_USERNAME`
   - `EDITOR_PASSWORD`
   - `EDITOR_SESSION_SECRET`
   - `GITHUB_TOKEN`（或兼容变量名 `GH_TOKEN`）
   - 可选：`GITHUB_OWNER`（默认 `heyebei`）、`GITHUB_REPO`（默认 `emotion`）、`GITHUB_BRANCH`（默认 `main`）
4. 重新部署后测试主页、登录、登出及日记保存接口。

`wrangler.jsonc` 将仓库根目录作为资产目录，以保持当前前端、`diary/`、`image/`、`audio/`、`love/` 的现有 URL 不变。Worker 会拦截并拒绝访问 `functions/`、`.github/` 和部署配置等项目源码路径。仓库中不应存放任何密钥。

## 本地预览与部署

```sh
npx wrangler dev
npx wrangler deploy
```

本地预览需要通过 `.dev.vars` 或 Cloudflare Secret 配置注入 Worker 运行变量；不要提交 `.dev.vars`。
