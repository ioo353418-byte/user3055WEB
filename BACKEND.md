# 后端对接说明

本项目当前**无独立后端**,采用 GitHub Pages + GitHub Contents API 作为"伪后端"方案。
本文档说明:

1. 当前伪后端的工作方式
2. 未来部署真后端时需要实现的接口规范
3. 切换到真后端的最小改动步骤

---

## 1. 当前架构(伪后端)

```
┌──────────────┐         ┌──────────────────────┐
│  展示页       │  fetch  │  raw.githubusercontent │
│  index.html  │ ──────► │  data/*.json           │
└──────────────┘         │  data/diaries/*.md     │
                          └──────────────────────┘
                                   ▲
                                   │ commit
┌──────────────┐         ┌──────────────────────┐
│  管理页       │  PUT/   │  GitHub REST API v3   │
│  admin.html  │  DELETE │  /repos/.../contents  │
│  + PAT       │ ──────► │                        │
└──────────────┘         └──────────────────────┘
```

- **展示页**: 直接通过 `raw.githubusercontent.com` 读取仓库中的 JSON / Markdown 文件,无需鉴权。
- **管理页**: 用户在浏览器输入 GitHub PAT(`sessionStorage` 存储),通过 GitHub Contents API 直接 commit 文件到仓库。
- **数据存储**: 仓库本身就是数据库,每次写入即一次 commit。

### 1.1 数据文件结构

#### `data/projects.json`

```json
[
  {
    "id": "lt7k8a1",
    "name": "机械臂控制程序",
    "description": "基于 MuJoCo 的 6 自由度机械臂仿真",
    "tags": ["Python", "MuJoCo"],
    "archivePath": "data/uploads/1786963200-机械臂.zip",
    "createdAt": "2026-08-17T10:00:00.000Z",
    "updatedAt": "2026-08-17T10:00:00.000Z"
  }
]
```

#### `data/games.json`

```json
[
  {
    "id": "lt7k8a2",
    "name": "像素冒险",
    "progress": 35,
    "description": "主线关卡已完成 3/10,正在调试战斗系统",
    "backupPath": "data/uploads/1786963300-pixel-backup.zip",
    "createdAt": "2026-08-17T10:00:00.000Z",
    "updatedAt": "2026-08-17T10:00:00.000Z"
  }
]
```

#### `data/diaries.json`

```json
[
  {
    "id": "lt7k8a3",
    "title": "今天完成了一个 demo",
    "date": "2026-08-17",
    "summary": "完成了机械臂抓取的初步演示",
    "markdownPath": "data/diaries/2026-08-17-今天完成了一个demo.md",
    "createdAt": "2026-08-17T10:00:00.000Z",
    "updatedAt": "2026-08-17T10:00:00.000Z"
  }
]
```

### 1.2 PAT 权限要求

在 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens 创建:

- **Repository access**: Only select repositories → 选择本仓库
- **Repository permissions**:
  - Contents: Read and Write(必需)
  - Metadata: Read(自动勾选)

> PAT 仅在浏览器 `sessionStorage` 中保存,关闭标签即清除。**请勿**把 PAT 写入仓库文件或公开页面。

---

## 2. 未来真后端接口规范

如果后续要部署独立后端(例如 Vercel Functions / Cloudflare Workers / 自建 Node 服务),
请实现以下 RESTful 接口。前端 `assets/js/api.js` 中的方法签名保持不变,
只需把内部实现替换为指向后端的 `fetch` 调用。

### 2.1 通用约定

- **Base URL**: 由 `assets/js/config.js` 的 `backendApiBase` 指定(例如 `https://api.example.com`)
- **认证**: `Authorization: Bearer <token>`(可以是 PAT,也可以是后端自签的 JWT)
- **请求/响应格式**: `application/json`(文件上传除外,使用 `multipart/form-data`)
- **错误响应**: `{ "error": { "code": "...", "message": "..." } }`,HTTP 状态码遵循 RESTful 约定

### 2.2 鉴权

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/validate` | 校验 token 是否有效,返回用户信息 |

### 2.3 工程资源

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 获取工程列表 |
| POST | `/projects` | 新增工程(JSON body) |
| PUT | `/projects/:id` | 更新工程 |
| DELETE | `/projects/:id` | 删除工程(同时删除关联压缩包) |
| POST | `/projects/:id/archive` | 上传/替换压缩包(`multipart/form-data`,字段名 `file`) |

### 2.4 游戏进度

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/games` | 获取游戏列表 |
| POST | `/games` | 新增游戏 |
| PUT | `/games/:id` | 更新游戏 |
| DELETE | `/games/:id` | 删除游戏 |
| POST | `/games/:id/backup` | 上传/替换备份压缩包 |

### 2.5 个人日记

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/diaries` | 获取日记索引列表 |
| POST | `/diaries` | 新增日记(JSON body,可包含 markdown 内容) |
| PUT | `/diaries/:id` | 更新日记 |
| DELETE | `/diaries/:id` | 删除日记 |
| GET | `/diaries/:id/markdown` | 获取日记 markdown 原文(返回 `text/markdown`) |
| POST | `/diaries/:id/markdown` | 上传/替换 markdown 文件(`multipart/form-data`) |

### 2.6 文件存储(可选)

如果后端不把压缩包存在 Git 仓库,而是对象存储(如 S3 / OSS):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/files/:path` | 下载文件(直接 302 重定向到对象存储签名 URL) |

> 此时 `projects.json` / `games.json` 中的 `archivePath` / `backupPath` 字段建议改为完整 URL,
> 或保持相对路径由前端拼接 `backendApiBase + '/files/' + path`。

---

## 3. 切换步骤(伪后端 → 真后端)

1. 实现上述接口(任意后端技术栈)
2. 修改 `assets/js/config.js`:
   ```js
   backendApiBase: 'https://your-backend.example.com'
   ```
3. 修改 `assets/js/api.js`:在每个方法中添加分支,当 `backendApiBase` 非空时走后端接口。
   方法签名保持不变,上层 `home.js` / `admin.js` 无需修改。

伪代码示例(以 `listProjects` 为例):

```js
async listProjects() {
    if (cfg.backendApiBase) {
        const resp = await fetch(`${cfg.backendApiBase}/projects`, {
            headers: authHeaders()
        });
        if (!resp.ok) throw await parseError(resp);
        return await resp.json();
    }
    // 回退到 GitHub Contents API
    return ghGetJson(cfg.github.paths.projects, []);
}
```

4. (可选)在 `admin.html` 登录卡片中提示用户:后端模式可使用账号密码登录,而非 PAT。

---

## 4. 安全注意事项

- **当前伪后端模式**: PAT 仅在浏览器 `sessionStorage`,刷新标签不丢失,关闭标签即清除。请勿在公共电脑上登录。
- **真后端模式**: 建议使用 HttpOnly Cookie 或短期 JWT,避免 token 暴露在 JS 中。
- **CORS**: 真后端需配置允许 `https://<user>.github.io` 跨域访问。
- **文件大小**: GitHub Contents API 单文件限制 100MB(实际推荐 < 25MB),
  超过请使用 Git LFS 或迁移到对象存储。

---

## 5. 文件结构总览

```
仓库根目录
├── index.html                  # 展示页
├── admin.html                  # 管理页
├── BACKEND.md                  # 本文档
├── assets/
│   ├── css/
│   │   └── style.css           # 共享样式
│   └── js/
│       ├── config.js           # 全局配置(开发者信息 / 仓库信息 / backendApiBase)
│       ├── api.js              # API 抽象层(GitHub Contents API 实现)
│       └── pages/
│           ├── home.js         # 展示页逻辑
│           └── admin.js        # 管理页逻辑
└── data/
    ├── projects.json           # 工程列表数据
    ├── games.json              # 游戏进度数据
    ├── diaries.json            # 日记索引数据
    ├── diaries/                # 日记 markdown 原文
    │   └── README.md
    └── uploads/                # 上传的压缩包(Git 自动创建,无需提前建目录)
```
