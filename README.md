# 情绪日记

个人日记网站，采用静态前端和 Cloudflare Pages Functions。日记正文单独保存在 [`diary/entries.md`](diary/entries.md)，图片存放在 `image/`，README 仅用于项目说明。

## 文件结构

```text
.
├── diary/
│   └── entries.md          # 日记正文，按日期组织的 Markdown
├── frontend/
│   ├── index.html          # 前端兼容入口
│   ├── pages/              # HTML 页面
│   │   ├── index.html      # 日记时间线
│   │   ├── login.html      # 登录页面
│   │   └── editor.html     # 日记编辑器
│   ├── styles/             # CSS 样式
│   │   ├── base.css
│   │   ├── timeline.css
│   │   ├── login.css
│   │   └── editor.css
│   └── scripts/            # JavaScript
│       ├── app.js
│       ├── login.js
│       └── editor.js
├── functions/              # Cloudflare Pages Functions 和 API
│   ├── _middleware.js      # 编辑器访问控制
│   ├── _utils/auth.js      # 会话与认证辅助逻辑
│   └── api/
│       ├── auth/           # 登录、登出接口
│       └── diary.js        # 保存日记和上传图片
├── image/                  # 日记图片
├── audio/                  # 音频资源
├── love/                   # 其他内容资源
├── locked.md               # 历史页面内容
├── index.html              # 网站根入口
└── README.md               # 项目说明和部署配置
```

## 日记内容格式

在 `diary/entries.md` 中使用 Markdown 编写日记。日期标题格式为 `--2024年9月6日`，条目之间可用 `----` 分隔。图片继续引用仓库根目录下的资源，例如 `![image](image/2024090601.jpg)`。网页读取该文件，编辑器也会将新条目追加到该文件。

## Cloudflare Pages 配置

在 Cloudflare Pages 项目的 **Settings → Variables and Secrets** 中设置以下变量。账号密码、会话签名密钥和 GitHub Token 应作为 Secret 保存，切勿提交到仓库。

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `EDITOR_USERNAME` | 是 | 编辑器登录账号 |
| `EDITOR_PASSWORD` | 是 | 编辑器登录密码 |
| `EDITOR_SESSION_SECRET` | 是 | 用于签名登录会话的长随机密钥 |
| `GITHUB_TOKEN` | 是，或使用 `GH_TOKEN` | GitHub 访问令牌；需要对配置的仓库具有内容写入权限，用于保存日记及上传图片 |
| `GH_TOKEN` | 备用 | `GITHUB_TOKEN` 未设置时使用的兼容变量名 |
| `GITHUB_OWNER` | 否 | GitHub 仓库所有者，默认 `heyebei` |
| `GITHUB_REPO` | 否 | GitHub 仓库名称，默认 `emotion` |
| `GITHUB_BRANCH` | 否 | 写入日记和图片的分支，默认 `main` |

请至少为 Production 环境配置运行所需的变量。若要在 Preview 部署中测试编辑器，也需单独配置 Preview 环境变量。新增或修改变量后重新部署以使配置生效。

## 部署

将 GitHub 仓库连接到 Cloudflare Pages，并以仓库根目录作为项目根目录。保留 `functions/` 在仓库根目录，使 Cloudflare Pages 能发现 Functions。部署后从站点根路径打开日记主页；编辑器登录和日记写入由 Pages Functions 处理。
