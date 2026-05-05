# 部署指南

本项目是一个静态站 + Cloudflare Pages Functions 后端，数据存放在 GitHub 仓库本身（`data/donations.json`、`data/sponsors.json` + `images/`），通过管理面板调用 Functions，再由 Functions 走 GitHub Contents API 写回仓库，触发 Cloudflare Pages 自动重新部署。

## 目录结构

```
.
├── index.html              展示页（时间线）
├── admin.html              管理面板
├── assets/                 静态资源（CSS / JS / 头像 / 二维码）
├── data/donations.json     公益记录数据
├── data/sponsors.json      赞赏名单数据（可选；首次提交会自动创建）
├── images/                 证书图片（txgy / xwgc / uploads）
└── functions/              Cloudflare Pages Functions
    ├── _lib/               共享代码（auth / github 客户端）
    └── api/                /api/* 路由
```

## 一、把项目推到 GitHub

```bash
cd /Users/baizhu/Documents/GitHub/like
git init
git add .
git commit -m "init: charity records site"
git branch -M main
git remote add origin https://github.com/<你的用户名>/like.git
git push -u origin main
```

## 二、生成 GitHub Personal Access Token (PAT)

管理面板需要写回仓库。访问 <https://github.com/settings/personal-access-tokens/new>，创建 **Fine-grained PAT**：

- **Repository access**: Only select repositories → 选中 `like` 仓库
- **Permissions** → Repository permissions：
  - `Contents`: **Read and write**
  - `Metadata`: Read-only（默认）
- **Expiration**: 按需，建议 90 天～1 年

复制 token（仅在创建时显示一次）。

## 三、部署到 Cloudflare Pages

1. 登录 <https://dash.cloudflare.com/> → Workers & Pages → Create → Pages → **Connect to Git**。
2. 授权并选择 `like` 仓库，分支 `main`。
3. 构建设置：
   - Framework preset: **None**
   - Build command: 留空
   - Build output directory: `/` （默认）
4. **Environment variables**（Settings → Environment variables，把变量加到 **Production** 和 **Preview** 两个环境）：

| 变量名               | 必填 | 说明                                             |
|--------------------|----|------------------------------------------------|
| `GITHUB_TOKEN`     | ✅  | 上一步生成的 PAT                                    |
| `GITHUB_OWNER`     | ✅  | 你的 GitHub 用户名                                  |
| `GITHUB_REPO`      | ✅  | `like`                                         |
| `GITHUB_BRANCH`    |    | 默认 `main`                                      |
| `ADMIN_PASSWORD`   | ✅  | 登录管理面板的密码（请使用强密码）                          |
| `SESSION_SECRET`   | ✅  | 会话签名密钥，随机长字符串。生成：`openssl rand -hex 32` |
| `COMMITTER_NAME`   |    | 提交作者名（默认 `like-bot`）                      |
| `COMMITTER_EMAIL`  |    | 提交邮箱（默认 `like-bot@users.noreply.github.com`） |

5. 保存设置后触发首次部署。部署完成访问 `https://<your-project>.pages.dev/`。

## 四、使用流程

- **公开展示页**：`https://<your-domain>/`
- **管理面板**：`https://<your-domain>/admin.html`
  1. 输入 `ADMIN_PASSWORD` 登录。
  2. 切换「公益记录 / 赞赏名单」标签页管理两类数据。
  3. 「+ 新增记录」打开表单，填写信息并选择证书图片 → 保存。
  4. 后端流程：
     - 图片：`POST /api/upload`（前端先用 Canvas 压缩 ≤1600px / JPEG q=0.85）→ GitHub Contents API → 写入 `images/uploads/`，返回路径。
     - 公益记录：`POST/PUT/DELETE /api/records[/:id]` → 读取 `data/donations.json` → 修改 → 提交回仓库。
     - 赞赏名单：`POST/PUT/DELETE /api/sponsors[/:id]` → 读取 `data/sponsors.json` → 修改 → 提交回仓库。
  5. Cloudflare Pages 检测到新 commit，自动重新构建（约 30~60 秒后生效）。

> 提示：因为数据写回 Git 才生效，新增/编辑后展示页会有几十秒延迟。

## 五、本地预览

最小预览（仅静态展示页，不含管理面板）：

```bash
cd /Users/baizhu/Documents/GitHub/like
python3 -m http.server 8000
# 访问 http://127.0.0.1:8000/
```

完整预览（含 Functions），需要 [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)：

```bash
npm i -g wrangler
# 准备 .dev.vars（仅本地用，不要 commit）
cat > .dev.vars <<EOF
GITHUB_TOKEN=ghp_xxx
GITHUB_OWNER=yourname
GITHUB_REPO=like
GITHUB_BRANCH=main
ADMIN_PASSWORD=your-strong-password
SESSION_SECRET=$(openssl rand -hex 32)
EOF

wrangler pages dev . --port 8788
# 访问 http://127.0.0.1:8788/
```

`.dev.vars` 已被 `.gitignore` 排除，请勿提交。

## 六、安全说明

- 所有 `/api/*`（除 `login`/`logout`）都通过 `functions/api/_middleware.js` 强制校验签名 cookie。
- 会话 cookie 使用 HMAC-SHA256 签名，TTL 7 天，HttpOnly + Secure + SameSite=Lax。
- `ADMIN_PASSWORD` 比较使用恒定时间算法以减弱时间侧信道。
- `GITHUB_TOKEN` 仅存在于 Cloudflare 环境变量，浏览器永远拿不到。
- 上传接口限制图片格式（png/jpg/jpeg/gif/webp）和大小（≤8MB）。

## 七、新增字段或基金会

- 修改 `index.html` / `assets/app.js`：调整展示模板。
- 修改 `assets/admin.js` 与 `admin.html`：扩展表单字段。
- 修改 `functions/api/records.js` 与 `functions/api/records/[id].js`：在 `normalize()` 里加字段校验。
- 赞赏名单相关：`functions/api/sponsors.js`、`functions/api/sponsors/[id].js`，共享写回逻辑在 `functions/_lib/github.js` 的 `updateJsonFile()`。

## 八、故障排查

| 现象                                | 排查                                                                  |
|----------------------------------|---------------------------------------------------------------------|
| 登录返回 500「admin not configured」   | 确认 `ADMIN_PASSWORD` 与 `SESSION_SECRET` 都已配置                              |
| 保存返回「GitHub writeFile … 401/403」 | PAT 没有 `Contents: write` 权限或选错仓库                              |
| 保存返回「GitHub writeFile … 409」     | 极少数并发冲突，本系统会自动重试一次；再失败请刷新后重试                                       |
| 新记录不出现在展示页                       | Cloudflare Pages 还在重新构建。打开 Cloudflare 控制台 → Deployments 查看进度 |
| 上传图片 413                         | 文件大于 8MB，先压缩再上传（可在 `functions/api/upload.js` 调整 `MAX_BYTES`）        |
