# X 关注清理助手

这是一个同时包含油猴脚本和 Cloudflare Pages 静态页面的项目。

- 油猴脚本运行在 `x.com`，负责导出关注列表、匿名请求公开主页、保存断点和分批取消关注。
- 静态页面负责筛选、批量标记、CSV 备份，以及把待取消队列交回油猴脚本。
- 公开主页响应解析后立即丢弃，只持久化筛选页面需要的字段。
- Cloudflare 页面不会接收或保存 X Cookie、`ct0`、Authorization 或原始 cURL。

## 目录

```text
src/                 油猴脚本模块源码
scripts/build.mjs    无第三方依赖的构建脚本
dist/                本地构建的油猴安装文件
web/                 Cloudflare Pages 部署目录
web/download/        页面提供下载的油猴安装文件
```

虽然用户最终只安装一个 `.user.js`，开发源码仍按功能拆分：

- `following.js`：登录态导出 Following；
- `profile-probe.js`：`anonymous: true` 请求公开主页并提取最后可见活动；
- `unfollow.js`：接收队列并分批调用 `destroy.json`；
- `bridge.js`：油猴存储和静态页面之间的本地桥；
- `panel.js`：X 页面右下角控制面板。

## 本地构建

需要 Node.js，不需要安装 npm 依赖。

```bash
cd x-follow-cleaner
npm run build
npm test
```

构建会生成两份相同的安装文件：

```text
dist/x-follow-cleaner.user.js
web/download/x-follow-cleaner.user.js
```

正式地址已经写入 `.env.production`：

```text
DASHBOARD_URL=https://x-follow-cleaner.mrhanlu224.workers.dev/
```

油猴必须提前声明允许在哪个筛选页面运行。`npm run build` 会读取这个生产环境变量并生成正式版本；需要本地联调时使用 `npm run build:local`，生成匹配 `http://localhost:8788/` 的临时版本。

## 本地预览静态页面

页面本身不需要 React、数据库或后端服务。为了正确测试油猴跨页面桥，建议通过 HTTP 打开，而不是双击 `file://`：

```bash
cd web
python3 -m http.server 8788
```

然后访问 `http://localhost:8788/`。

## Cloudflare Pages

一个 Git 仓库可以同时管理油猴脚本和 Cloudflare 页面。Cloudflare Pages 推荐配置：

- Root directory：`x-follow-cleaner`
- Build command：`npm run build`
- Build output directory：`web`
- 环境变量：`DASHBOARD_URL=https://x-follow-cleaner.mrhanlu224.workers.dev/`

部署完成后，访问：

```text
https://x-follow-cleaner.mrhanlu224.workers.dev/download/x-follow-cleaner.user.js
```

即可安装与当前筛选页域名匹配的油猴脚本。

如果使用 Cloudflare 自动生成的预览域名，每次预览域名可能不同，油猴不会自动获得新的 `@match`。日常使用应绑定一个固定的正式域名。

## Greasy Fork 发布与自动同步

Greasy Fork 首次发布必须由账号所有者登录确认，不能只凭个人主页地址从外部直接创建脚本。首次导入完成后可以自动同步更新。

推荐使用项目 GitHub 仓库中的构建产物作为同步源：

```text
https://raw.githubusercontent.com/mr-hanlu/x-follow-cleaner/main/web/download/x-follow-cleaner.user.js
```

操作流程：

1. 登录 `Mr Hanlu` 的 Greasy Fork 账号；
2. 打开 `https://greasyfork.org/zh-CN/import`；
3. 填入上面的 Raw URL；
4. 同步方式选择“自动”；
5. 完成首次导入和脚本说明；
6. 在脚本管理页面按 Greasy Fork 提示配置 GitHub Webhook，可在仓库 push 后更快同步。

后续发布前必须：

1. 修改 `src/metadata.txt` 中的 `@version`；
2. 执行 `npm test && npm run build`；
3. 将源码以及 `web/download/x-follow-cleaner.user.js` 一起提交并推送到 `main`。

Greasy Fork 会定期读取 Raw URL；配置 GitHub Webhook 后可由 push 触发同步。直接从 Greasy Fork 安装的版本，其更新地址会被 Greasy Fork自动改写为 Greasy Fork 自己的地址。

## 使用流程

1. 在正式页面安装油猴脚本；
2. 登录 X，进入“正在关注”页面；
3. 打开 Network，复制一次 `Following` 请求的 cURL；
4. 在右下角控制面板粘贴并开始导出；
5. 在“匿名探测公开主页”中设置本次数量和间隔，分批运行；
6. 打开筛选页面，页面会自动从油猴同步，也可以手动再次同步；
7. 筛选并批量标记，点击“发送待取消队列”；
8. 回到 X，设置本批数量和请求间隔，明确确认后执行一批；
9. 随时保存进度 CSV。

取消关注的 `friendships/destroy.json` 请求模板默认由脚本生成，执行时再从当前页面读取 `ct0`，无需复制第二个 cURL。“高级兜底”仍允许在 X 改动内部接口后粘贴最新 cURL，也可以一键恢复自动模板。

## 进度与日志

三个长任务都有独立进度条：

- Following 总人数在接口结束前未知，因此导出过程中显示活动进度，并显示当前页数与累计人数；
- 匿名主页探测显示 `已完成 / 本轮总数`；
- 取消关注显示 `已完成 / 本批总数`。

按钮在任务运行时会禁用并显示“正在导出/探测/执行”，完成、停止和失败会使用不同的进度条状态。打开浏览器开发者工具 Console，使用 `XFC` 过滤即可查看带时间、模块、HTTP 状态和数量的日志。日志不会打印 cURL、Cookie、`ct0` 或 Authorization。

匿名主页探测支持设置 1–8 个并发工作槽，默认是 2。间隔时间按每个工作槽计算；并发越高，总请求速度越快，也越容易遇到429，建议先用 2，小批量确认稳定后再调整。所有并发请求的最终结果会串行写入油猴存储，避免互相覆盖进度。

取消关注区域提供“刷新队列”按钮，并显示队列总人数、待处理人数、成功人数、失败待重试人数及待处理账号列表。静态页面在另一个标签页写入队列后，支持的油猴版本会自动刷新；手动刷新按钮始终保留用于核对。

匿名探测进度使用“整个关注列表已探测人数 / 关注总人数”，而不是只显示本轮数量。本轮限制为50时，进度仍会显示例如 `已探测 350/7500 · 本轮 20/50`。关注导出页数、累计人数、整体探测进度、并发设置和取消队列都会持久化；刷新 X 页面重新打开面板后会从油猴存储恢复。刷新时仍标记为运行的任务会改为“上次任务因页面刷新中断”，可以继续执行。

## 多账号隔离

关注数据、匿名探测结果和取消队列均按 Following 请求中的 `source_user_id` 分开保存；静态页面的审核标记也使用该账号ID作为本地存储分区。切换 X 账号后重新导出 Following 会切换到对应数据分区，不会覆盖旧账号。

执行取消关注前，脚本会尝试从当前浏览器的 `twid` Cookie 读取登录账号ID并与队列所属账号比较。不一致时直接阻止执行；浏览器未提供可读 `twid` 时会在控制台警告，并要求用户自行确认。旧版单账号存储会在首次读取时迁移到账号隔离格式。

筛选页面打开或刷新时会自动请求油猴数据；页面启动与油猴桥就绪两个时机都会补发请求，避免加载顺序造成漏同步。“从油猴同步”和“发送待取消队列”也有运行提示；5 秒没有收到油猴数据桥响应时会明确显示超时原因。

## 请求隔离

| 功能 | 登录态 |
|---|---|
| 导出 Following | 使用当前 X 登录态，并在请求前重新读取 `ct0` |
| 请求公开主页 | 使用 `GM_xmlhttpRequest({ anonymous: true })`，不发送账号 Cookie |
| 取消关注 | 使用当前 X 登录态，并在请求前重新读取 `ct0` |

匿名请求仍会暴露当前网络 IP 和常规浏览器网络特征，也仍可能遇到限流。遇到 429 时工具会停止并保留已处理结果，不会尝试切换令牌或规避限制。

## 数据口径

公开主页目前只提供少量可见条目。`last_post_at` 表示匿名主页响应中可解析到的最新公开状态时间，不代表完整历史，也不能保证覆盖仅登录可见或受保护内容。

主要字段：

- `last_post_at` / `inactive_days`
- `last_post_id` / `last_post_url`
- `data_status` / `fetched_at`
- `followers_count` / `is_blue_verified`
- `review_status`
- `unfollow_status` / `unfollowed_at`

原始主页 HTML 不会持久化。

## 已知边界

- X 内部接口的 GraphQL query ID、features 和请求头可能变化，因此 Following 仍保留“粘贴当前 cURL”入口。
- 普通油猴脚本不能读取 Chrome 开发者工具里已经完成的 Network 历史记录。Following 若要自动捕获，需要脚本在页面请求发生前注入拦截器，而且 X 的 GraphQL query ID、features 与游标模板仍可能变化，因此当前版本优先保留手动 cURL。
- 公开主页 HTML 结构变化时，解析器可能返回 `no_visible_posts`，应先小批量验证后再扩大采集。
- 油猴存储承担本地数据和断点保存。应定期导出 CSV，避免浏览器数据被清理后无法恢复。
- 自动化批量取消可能触发平台限制。工具只执行用户明确确认的有限批次，遇到异常立即停止。
