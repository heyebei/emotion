# 时光卡片 · 日记

一个轻量的个人日记网站：从 Markdown 日记读取已有的照片卡片，并在新建页面记录文案和照片。适配桌面和手机布局，支持按日期浏览、前后切换。

新建日记使用 Cloudflare Pages Functions 和 R2 储存，不会修改仓库中的 `resource/README.md`，也不需要为每篇新日记重新部署网站。

## 项目结构

```text
.
├── index.html                   # 网站入口
├── _routes.json                 # 只将 /api/* 请求交给 Pages Functions
├── wrangler.toml                # Cloudflare Pages 与 R2 绑定配置
├── .gitignore                   # 忽略 dist、Wrangler 临时文件和本地密钥
├── functions/
│   └── api/
│       ├── entries.js           # 列出、创建 R2 中的 Markdown 日记
│       └── images/
│           └── [[key]].js       # 从 R2 读取新旧日记照片
├── pages/
│   ├── build.sh                 # Cloudflare/Linux 构建脚本
│   ├── build.ps1                # Windows 本地构建脚本
│   ├── migrate-images.ps1       # 将旧日记引用的照片迁移至 R2
│   ├── css/
│   │   ├── styles.css           # 日记浏览页面样式
│   │   └── new.css              # 新建日记页面样式
│   ├── html/
│   │   └── new.html             # 新建日记表单
│   └── js/
│       ├── app.js               # 日记读取、时间轴与卡片切换
│       └── create.js            # 照片预览和日记上传
└── resource/
    ├── README.md                # 旧日记及其 Markdown 照片引用
    ├── image/                   # 仓库中已有的日记照片
    └── ...
```

部署时，[`pages/build.sh`](./pages/build.sh) 将入口页、页面静态资源、旧日记 Markdown 和 `_routes.json` 复制到 `dist/`。旧照片不会复制到 Pages 部署包，避免发布约 1.2 GB 的历史照片。`functions/` 保留在仓库根目录，以供 Pages Functions 处理 API。

## 日记与照片的储存

- **已有日记**：保留在 [`resource/README.md`](./resource/README.md)，无需迁移或修改。
- **新日记**：每篇以独立的 Markdown 文件写入 R2 的 `resource/journal/年/月/日/` 路径。
- **照片**：写入同一个 R2 桶的 `resource/image/` 路径，文件名由服务器根据日记日期、上传时间和随机编号生成。
- Markdown 仍使用日期、文案和照片引用的格式。每篇独立保存，避免大文件持续增长或并发写入覆盖。
- 日记浏览页面合并旧的 README 日记和 R2 中的新日记，按日期倒序显示。

例如，新日记在 R2 中会保存为：

```text
resource/journal/2026/11/09/2026-11-09-时间戳-随机编号.md
resource/image/20261109_时间_随机编号.jpg
```

单篇 Markdown 内容如下：

```markdown
**2026年11月09日**

在这里写下当时的心情

![image](../../../../image/20261109_102030_123456abcdef.jpg)

---
```

文案不会直接追加到 README。这样可以避免持续增大 README，也避免每次保存都重写同一个文件。历史日记无需迁移；如果希望新部署的网站显示历史照片，则需要将旧图片迁移到 R2。

## 本地预览

运行环境需要安装 Node.js 和 npm。首次运行 `npx wrangler` 时，npm 会下载 Wrangler。

在 Windows PowerShell 中构建并启动 Pages：

```powershell
powershell -ExecutionPolicy Bypass -File .\pages\build.ps1
npx wrangler pages dev
```

在 macOS、Linux 或 Cloudflare 构建环境中：

```sh
sh pages/build.sh
npx wrangler pages dev
```

默认情况下，Wrangler 在本地提供 R2 开发环境。要进行上传测试，在仓库根目录创建 `.dev.vars`，设置本地写入密钥：

```dotenv
DIARY_WRITE_TOKEN="替换为至少32个字符的随机密钥"
```

`.dev.vars` 已加入 `.gitignore`，不要提交、分享或放入公开网页。

## Cloudflare 部署

### 1. 创建 R2 桶

先登录 Cloudflare：

```sh
npx wrangler login
```

然后创建生产和预览桶：

```sh
npx wrangler r2 bucket create emotion-diary
npx wrangler r2 bucket create emotion-diary-preview
```

[`wrangler.toml`](./wrangler.toml) 将生产和预览桶绑定到 `DIARY_BUCKET`。如果 Cloudflare 控制台中已有不同名称的项目或绑定，请先核对配置，勿直接覆盖现有生产环境设置。

### 2. 上传历史照片

Pages 静态资源单个文件不能超过 25 MiB；历史照片总量也不适合直接打包进网站。以下命令将 README 中引用的每张本地图片各上传一次，保留图片在 `resource/image/` 下的原始相对路径：

```powershell
powershell -ExecutionPolicy Bypass -File .\pages\migrate-images.ps1
```

迁移预览桶时：

```powershell
powershell -ExecutionPolicy Bypass -File .\pages\migrate-images.ps1 -BucketName emotion-diary-preview
```

确认目标桶后才运行实际上传；先用 `-WhatIf` 预览将要上传的文件：

```powershell
powershell -ExecutionPolicy Bypass -File .\pages\migrate-images.ps1 -WhatIf
```

此脚本使用 Wrangler 登录状态及远程 R2 操作，会上传实际文件。请先创建目标桶、检查上传目标和文件数量。运行前确保原始图片路径存在。迁移图片与创建网站日记是不同的步骤；没有 R2 桶和有效绑定时，云端日记和照片 API 不会工作。

### 3. 配置 Pages 项目

在 Cloudflare Pages 项目中设置：

| 配置项 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 构建命令 | `sh pages/build.sh` |
| 构建输出目录 | `dist` |
| Functions 路由 | 仓库根目录中的 `functions/` |
| Pages Functions 构建系统 | V2 |

`_routes.json` 限制 Functions 只处理 `/api/*`，普通页面、样式、脚本和静态文件使用 Pages 静态资源服务。每次部署时，确认生产与预览环境中的 `DIARY_BUCKET` 绑定分别指向对应的桶。

> Pages Functions 不能修改部署中的仓库文件。上传内容只保存到 R2，不会自动变更或提交到 Git，也不会写回 `resource/README.md`。

### 4. 配置写入密钥

在 Cloudflare Pages 项目的 **Settings → Variables and Secrets** 中，为 **Production** 和 **Preview** 分别配置名为 `DIARY_WRITE_TOKEN` 的 **Secret**。密钥应是独立生成、至少 32 个字符的随机值。需要保存新日记的用户在新建表单中输入对应环境的密钥；服务端检查该值后才允许上传。传输应使用 HTTPS。

**不要**把真实密钥填入 `wrangler.toml`、脚本、公开文档、源代码或网页源码，也不要提交 `.dev.vars`。输入上传密钥的浏览器和使用者需要可信；这套简单的密钥校验不提供多用户账号、登录管理、上传频率限制或编辑权限。若网站面向不可信访客公开，请先增加可靠的身份认证与请求限制。

**预览和生产使用的密钥、R2 桶可能不同。** 上传前确认当前所在环境及访问权限。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/entries` | 返回 R2 中的新 Markdown 日记，按日期倒序排列 |
| `POST` | `/api/entries` | 创建日记；使用 `multipart/form-data` 提交 `date`、`text` 和 `photo`，并在 `Authorization` 请求标头中以 Bearer 方案携带写入密钥 |
| `GET` | `/api/images/{path}` | 读取 R2 中的照片。仅接受图片文件路径；路径遍历会被拒绝 |

照片接口支持 JPG、PNG、WebP 以及历史日记中使用的 GIF/JPEG。新上传仅接受 JPG、PNG、WebP，最大 12 MiB；服务端会检查照片文件签名，而不只相信文件名或浏览器提供的 MIME 类型。读取接口只返回图片内容类型；错误的路径、格式、密钥或储存配置会收到明确的 HTTP 错误。

## 注意事项

- `resource/README.md` 是原有日记内容来源；部署或整理时不要将其替换成上传接口的储存文件。
- README 中引用的旧照片需要事先上传到 R2，线上页面才能通过 `/api/images/...` 显示它们。若 R2 中没有对应照片，页面会尝试使用原静态路径；目前构建产物不包含历史照片，因此这不是线上迁移的替代方案。
- 新建日记先上传照片，再写入 Markdown；如果 Markdown 写入失败，接口会尽力删除刚上传的孤立照片。网络中断时仍应通过首页确认是否已创建，避免重复提交。
- 新建页面需要通过本地 Pages 开发服务器或线上网站打开。仅用 `file://` 直接打开静态 HTML 时，API 和跨页面数据读取不会正常运行。
- Pages 静态资源有文件数量和单文件大小限制；构建脚本不会复制整个 `resource/image/`。上传新的历史照片后，可使用迁移脚本补充 R2 内容。
- R2 桶包含个人日记和照片。请为 Cloudflare 项目及密钥设置妥善的访问权限，并保管好账户和本地 Wrangler 凭据。
