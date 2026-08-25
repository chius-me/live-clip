# LiveClip

LiveClip 是一个只运行在 Cloudflare 上的实时协作剪切板。打开同一个链接后，电脑和手机可以同时编辑纯文本或代码，修改通过 Yjs CRDT 增量同步，不会因为并发输入互相覆盖。

它适合「打开就能写、链接着就能协作」的场景。现有的 [Clip](https://clip.chius.cc/) 更适合保存后再分享；LiveClip 是独立项目，不修改 Clip。

计划域名：

```text
https://liveclip.chius.cc
```

## 产品截图

![LiveClip 编辑器](docs/screenshot.png)

协作编辑时顶部显示连接状态、在线人数和语言选择；其他用户的光标会出现在正文里。

## 技术架构

```text
浏览器 (React + Vite + Monaco + Yjs + y-monaco)
        │  HTTP / WebSocket
        ▼
Cloudflare Worker
  ├─ GET  /                 创建房间并 302 到 /p/{roomId}#{editSecret}
  ├─ POST /api/rooms        创建房间，JSON 返回 roomId 与 editSecret
  ├─ GET  /p/:roomId        静态前端（SPA）
  ├─ GET  /api/rooms/:id/ws WebSocket Upgrade → Durable Object
  └─ GET  /health           健康检查
        │
        ▼
每个文档一个 Durable Object（env.ROOMS.getByName(roomId)）
  ├─ WebSocket Hibernation API（this.ctx.acceptWebSocket）
  ├─ SQLite：snapshot + 增量 updates
  └─ Alarm：最后编辑后 RETENTION_DAYS 天过期删除
```

协作协议：

1. 客户端先发 JSON 认证帧 `{ type: "auth", editSecret }`。
2. 服务端回复 `auth-ok`（`editor` 或 `reader`），再交换 y-protocols 的 sync / awareness 二进制帧。
3. 文档更新先写入 SQLite，成功后再广播。累计约 100 条增量或达到体积阈值后合并为 snapshot。
4. Awareness（光标、在线名）只在内存和 WebSocket attachment 中，不入库。

## 为什么使用 Durable Objects

- 一个文档就是一个强一致的协调单元：连接、Yjs 文档、SQLite 都在同一 isolate 里，不需要 Redis 或中心 WebSocket 服务器。
- Hibernation 让空闲房间从内存中移出，WebSocket 仍由 Cloudflare 边缘挂起，费用和内存都可控。
- SQLite Storage 把 snapshot 和增量放在对象内部，冷启动后用 `snapshot + updates` 重建 `Y.Doc`。
- Alarm 按文档做保留期限，不必引入 D1 / Cron 全表扫描。

不使用 D1、KV、R2、Postgres、Supabase 或任何常驻 Node 进程。

## 本地开发

需要 Node.js 20+。

```bash
npm install
npx wrangler types          # 生成 worker-configuration.d.ts
npm run dev                 # Vite + wrangler 本地模拟 Durable Objects
```

浏览器打开终端里提示的本地地址（通常是 `http://localhost:5173`）。根路径会创建新文档并跳转到编辑链接。

不要用 `file://` 打开构建后的 HTML，浏览器无法对模块和 WebSocket 做正确的 Origin 校验。

常用命令：

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run deploy
```

## Cloudflare 资源创建

1. 准备一个 Cloudflare 账号。免费档即可试用；Durable Objects 有用量与可能的付费项，见下文。
2. 安装并登录 Wrangler：`npx wrangler login`。
3. 本项目不需要手动创建 KV / D1 / R2。部署时 Wrangler 会创建 Worker，并按 `wrangler.jsonc` 的 migration 注册 SQLite Durable Object 类 `Room`。
4. 可选：在 Cloudflare 仪表盘为 `liveclip.chius.cc` 添加自定义域，并完成 DNS。
5. 可选：创建 Turnstile 站点，把 site key 写入 `vars.TURNSTILE_SITE_KEY`，把 secret 用 `wrangler secret put TURNSTILE_SECRET` 注入。

不要把 Account ID、API Token 写进仓库。

## Wrangler 配置

`wrangler.jsonc` 包含：

- Worker 入口 `src/worker/index.ts`
- `compatibility_date`（与当前 Vitest pool 的 workerd 对齐）与 `nodejs_compat`（Yjs 需要）
- Durable Object binding `ROOMS` → class `Room`
- `new_sqlite_classes` migration
- Static Assets（SPA + `run_worker_first` 拦截 `/`、`/health`、`/api/*`）
- Observability
- 非敏感 `vars`：`RETENTION_DAYS`、大小与连接上限等

密钥不要放进 `vars`。Turnstile secret 只通过 `wrangler secret` 或本地 `.dev.vars`（已 gitignore）提供。

## Durable Object migration

```jsonc
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room"] }]
```

`v1` 只应执行一次。以后若新增 DO 类，追加新的 tag，不要改写已经发布的 migration。SQLite 表结构在对象构造时 `CREATE TABLE IF NOT EXISTS`。

## 自定义域名 liveclip.chius.cc

1. 在 Cloudflare 上托管 `chius.cc` 的 DNS。
2. 部署 Worker 后，在 Workers & Pages → liveclip → Settings → Domains 添加 `liveclip.chius.cc`。
3. 按提示添加 CNAME / 路由。橙云代理即可。
4. 把 `ALLOWED_ORIGINS` 设为 `https://liveclip.chius.cc`（同源请求始终允许；该变量用于额外 Origin）。
5. 生产环境建议将 `ENVIRONMENT` 设为 `production`，避免响应里出现开发期错误信息。

未完成 DNS 与证书前，不要认为生产域名已经可用。用 `GET https://liveclip.chius.cc/health` 验证。

## Turnstile（可选）

本地开发**不需要** Turnstile。未配置 `TURNSTILE_SECRET` 时，创建房间直接成功。

启用后：

1. 在 Turnstile 里添加站点，域名包含 `liveclip.chius.cc`、`localhost`。
2. `wrangler secret put TURNSTILE_SECRET`
3. 设置 `TURNSTILE_SITE_KEY`
4. `GET /` 会显示验证页，`POST /api/rooms` 必须带 `turnstileToken`

Turnstile 只拦新建房间，不拦进入已有链接。

## 部署步骤

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npx wrangler types
npx wrangler deploy
```

`npm run deploy` 等价于先构建再 `wrangler deploy`。Durable Objects 可能产生费用，部署前请确认账号套餐。

部署后先访问：

```text
https://<worker>.workers.dev/health
```

自定义域就绪后再访问 `https://liveclip.chius.cc/health`。

## 测试命令

```bash
npm test            # Vitest + @cloudflare/vitest-pool-workers，跑 Durable Object / Worker
npm run test:e2e    # Playwright，两个 Browser Context 模拟双设备
```

单元测试覆盖：房间初始化、写入与回读、snapshot 压缩、eviction 后恢复、未授权不能写、只读能收同步、超大消息、连接数上限、未过期 alarm 不删、过期删除、双 Y.Doc 并发收敛。

E2E 覆盖：两端打开同一编辑链接、不同位置并发输入后一致、刷新保留、断网编辑再重连收敛、只读可见不可写、在线人数与连接状态。

首次 E2E 需要：`npx playwright install chromium`。

## 数据保留策略

- 环境变量 `RETENTION_DAYS`，默认 `30`。
- 每次有效文档更新会刷新 `updated_at`，并 `setAlarm(updated_at + RETENTION_DAYS)`。
- Alarm 触发时重新读取 `updated_at`：未过期则改期；确已过期则先 `deleteAlarm()` 再 `deleteAll()`。
- 不会因为一次过期的旧 alarm 删掉仍在编辑的文档。
- Awareness / 光标不持久化。

## 编辑链接与只读链接的安全模型

| 类型 | 形式                                                | 能力                                     |
| ---- | --------------------------------------------------- | ---------------------------------------- |
| 只读 | `https://liveclip.chius.cc/p/{roomId}`              | 同步内容、看光标，服务端拒绝写入         |
| 编辑 | `https://liveclip.chius.cc/p/{roomId}#{editSecret}` | 持有 fragment 中的密钥即可编辑，无需注册 |

- `editSecret` 由浏览器或创建接口用 CSPRNG 生成（≥128 bit）。
- 服务端只存 SHA-256，明文不进数据库、日志、查询参数。
- URL fragment 不会随 HTTP 请求自动发给服务器。WebSocket 建立后由客户端在第一条认证消息里提交。
- 密钥可写入当前浏览器 `localStorage`（`liveclip.secret.{roomId}`），刷新后恢复编辑权。
- 房间 ID 为 128-bit Base64URL，并做格式校验，降低枚举风险。
- 知道只读链接不等于能写；写权限由 Durable Object 强制校验哈希。

## Cloudflare 免费额度和可能产生费用的项目

以 Cloudflare 当前公开说明为准，部署前请核对仪表盘与文档：

- **Workers 请求**：免费档有每日请求上限，超出后失败或需付费。
- **Durable Objects**：通常需要 Workers 付费档。计费项包括对象请求、时长、SQLite 存储与读写行数。空闲房间会 hibernate，但存储仍占用。
- **WebSocket**：连接数与消息会记入 DO 请求 / 时长。
- **Static Assets**：静态资源有免费额度，流量很大时可能产生费用。
- **Turnstile**：常有免费额度。
- **Workers Logs / Observability**：本项目默认开启，超量日志可能计费，可调 `head_sampling_rate`。

本 README 不保证价格数字。以 [Cloudflare 定价页](https://developers.cloudflare.com/workers/platform/pricing/) 为准。

## 当前限制

- 无账户系统、无版本历史、无评论。
- 仅纯文本 / 代码，不支持图片、文件、富文本。
- 单文档默认上限 1 MiB，单房间默认 50 连接。
- 知道编辑链接的人都能编辑，丢失链接等于丢失权限。
- 过期删除后不可恢复。
- 不提供跨区域多活；单个文档绑定一个 Durable Object。

## 故障排查

| 现象               | 处理                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| 一直「正在连接」   | 看浏览器控制台 WebSocket 是否 403（Origin）或 404（房间不存在）。必须通过 `npm run dev` / 部署域名访问。 |
| 能看不能写         | 地址栏是否有 `#editSecret`；是否被当成只读。工具栏应显示「可编辑」。                                     |
| 刷新后变成只读     | 本机 `localStorage` 被清，或打开的是只读链接。用原编辑链接再打开一次。                                   |
| 内容在重启后丢失   | 确认更新已显示「已保存」。检查 Durable Object migration 是否已应用。                                     |
| 部署失败 / DO 错误 | 确认 `new_sqlite_classes` 未重复执行；账号是否已开通 Durable Objects。                                   |
| Turnstile 失败     | 本地不要设 secret。生产核对 site key、secret、允许的域名。                                               |
| E2E 起不来         | `npx playwright install chromium`。端口 8787 被占用时设置 `E2E_PORT`。                                   |

不要把文档正文或 editSecret 贴进日志系统。

## 数据删除方法

- **自动**：超过保留期后 alarm 删除该 Durable Object 的全部存储。
- **立即作废访问**：不要分享链接。没有控制台「按房间删除」按钮；持有 Cloudflare 账号时可用 Wrangler / API 删除整个 Worker（会删掉所有房间）。
- **清空正文**：编辑器里的「清空文档」会同步成空文本，但房间和密钥仍在，直到过期。
- **本地开发数据**：删除项目下 `.wrangler/state` 后重新 `npm run dev`。

## 许可

MIT。界面参考了 [Rustpad](https://github.com/ekzhang/rustpad) 的交互，没有复制其 Rust/Warp 代码。Yjs、Monaco、y-monaco 遵循各自许可证。
