# 时光卡片 · 日记

一个轻量的个人日记网站：从 Markdown 日记读取照片卡片，并通过新建页面记录文字和照片。适配桌面与手机布局，支持按日期浏览、前后切换。

> **关于存储改造：** 目标是将新日记写入 GitHub 仓库的 `resource/README.md` 和 `resource/image/`。但目前仓库中 API 代码仍包含 Cloudflare R2 逻辑，且 Wrangler 配置已移除 R2 绑定，因此 GitHub 存储迁移尚未完整。请不要把当前代码状态视为已完成或可用于生产的 GitHub 写入实现。

## 项目结构

```text
.
├── index.html                   # 网站入口
├── _routes.json                 # 将 /api/* 请求交给 Pages Functions
├── wrangler.toml                # Cloudflare Pages 配置
├── functions/
│   └── api/
│       ├── entries.js           # 日记读取与创建 API
│       └── images/
│           └── [[key]].js       # 日记图片读取 API
├── pages/
│   ├── build.sh                 # Linux/macOS/Cloudflare 构建脚本
│   ├── build.ps1                # Windows 构建脚本
│   ├── migrate-images.ps1       # 历史图片迁移脚本
│   ├── css/                     # 页面样式
│   ├── html/new.html            # 新建日记页面
│   └── js/                      # 日记浏览与创建逻辑
└── resource/
    ├── README.md                # 既有日记 Markdown
    ├── image/                   # 既有日记图片
    └── ...
```

## 日记内容与格式

既有日记保存在 [`resource/README.md`](./resource/README.md)，图片位于 [`resource/image/`](./resource/image/)。日记采用 Markdown 格式，日期、正文和图片引用组成一张卡片：

```markdown
**2024年04月13日**

在这里记录当时的心情

![image](image/2024041301.jpg)

---
```

`resource/README.md` 是日记数据文件，不是本项目的说明文档；本文件（仓库根目录的 `README.md`）用于介绍项目和部署方法。

## 本地预览

需要 Node.js 和 npm。在仓库根目录执行：

```sh
sh pages/build.sh
npx wrangler pages dev
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\pages\build.ps1
npx wrangler pages dev
```

新建页面需要通过本地 Pages 开发服务器或线上网站打开。直接使用 `file://` 打开时，API 请求无法正常工作。

## Cloudflare Pages 部署

项目根目录设为仓库根目录，构建命令为 `sh pages/build.sh`，构建输出目录为 `dist`，并启用 Pages Functions。`_routes.json` 将 `/api/*` 请求路由到 Functions。

## GitHub 存储配置目标

完整迁移后，GitHub 凭据必须只配置为 Cloudflare Pages 的服务端 Secret，不能放入网页、前端脚本或公开文档。页面提交用的日记写入密钥也必须与 GitHub Token 分开。建议 GitHub Token 使用仅限此仓库、仅具备所需 Contents 权限的 fine-grained PAT。

在迁移代码和 API 验证完成之前，请勿向页面输入 GitHub PAT，也不要把密钥提交到仓库。