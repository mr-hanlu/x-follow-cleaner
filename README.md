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
DASHBOARD_URL="https://你的正式域名/" npm run build
npm test
```

构建会生成两份相同的安装文件：

```text
dist/x-follow-cleaner.user.js
web/download/x-follow-cleaner.user.js
```

`DASHBOARD_URL` 很重要：油猴必须提前声明允许在哪个筛选页面运行。本地默认值是 `http://localhost:8788/`，正式发布必须改成实际域名并重新构建。

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
- 环境变量：`DASHBOARD_URL=https://你的正式域名/`

部署完成后，访问：

```text
https://你的正式域名/download/x-follow-cleaner.user.js
```

即可安装与当前筛选页域名匹配的油猴脚本。

如果使用 Cloudflare 自动生成的预览域名，每次预览域名可能不同，油猴不会自动获得新的 `@match`。日常使用应绑定一个固定的正式域名。

## 使用流程

1. 在正式页面安装油猴脚本；
2. 登录 X，进入“正在关注”页面；
3. 打开 Network，复制一次 `Following` 请求的 cURL；
4. 在右下角控制面板粘贴并开始导出；
5. 在“匿名探测公开主页”中设置本次数量和间隔，分批运行；
6. 打开筛选页面，点击“从油猴同步”；
7. 筛选并批量标记，点击“发送待取消队列”；
8. 回到 X，复制一次 `friendships/destroy.json` cURL 并保存模板；
9. 设置本批数量和请求间隔，明确确认后执行一批；
10. 随时保存进度 CSV。

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
- 公开主页 HTML 结构变化时，解析器可能返回 `no_visible_posts`，应先小批量验证后再扩大采集。
- 油猴存储承担本地数据和断点保存。应定期导出 CSV，避免浏览器数据被清理后无法恢复。
- 自动化批量取消可能触发平台限制。工具只执行用户明确确认的有限批次，遇到异常立即停止。
