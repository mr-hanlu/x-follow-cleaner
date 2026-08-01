# X 关注清理助手技术说明

本文档描述 `0.8.0` 的当前实现、数据流、模块边界和后续多语言改造方案。面向后续维护者和接手项目的 AI；普通用户请先阅读 [README.md](./README.md) 上半部分。

## 1. 项目目标与边界

项目帮助用户在本地完成四件事：

1. 从当前登录的 X 账号导出完整关注列表。
2. 匿名请求每个账号的公开主页，估算最近可见活动时间。
3. 在静态网页中筛选并标记保留、待取消或已处理。
4. 把待取消队列交回 X 页面，由油猴脚本按批次和间隔执行。

当前刻意不做以下事情：

- 不保存公开主页原始 HTML 或原始推文 JSON。
- 不统计推文样本量、原创、回复、转推和引用比例。
- 不使用服务器数据库，也不把 X 登录凭据发送给静态页面。
- 不承诺绕过 X 的访问控制、频率限制或风控。

## 2. 技术形态

项目由一个油猴脚本和一个纯静态网页组成，不使用 React、后端 API 或数据库。

```text
X 页面
  └─ 油猴脚本
      ├─ Following 导出（登录态）
      ├─ 公开主页探测（匿名请求）
      ├─ GM 本地存储
      └─ 分批取消关注（登录态）

Cloudflare 静态页面
  ├─ 从油猴同步或导入 CSV
  ├─ 本地筛选与审核标记
  ├─ 导出带进度的 CSV
  └─ 将完整待取消选择写回油猴
```

同一仓库可以同时维护两部分。Cloudflare 部署 `web/`，Greasy Fork 或网页安装入口使用构建出的 `web/download/x-follow-cleaner.user.js`。

## 3. 目录与模块职责

```text
src/metadata.txt       油猴元数据、权限、匹配域名和版本
src/core.js            数据结构、GM 存储、账号隔离、CSV、日期工具
src/curl.js            cURL 解析与请求模板净化
src/following.js       Following 分页导出与断点续跑
src/profile-probe.js   匿名公开主页请求与最近状态解析
src/unfollow.js        取消队列、请求模板和分批执行
src/bridge.js          静态页面与油猴存储之间的事件桥
src/panel.js           X 页面中的控制面板、进度条和日志
src/main.js            启动入口及油猴菜单

web/index.html         静态页面结构
web/styles.css         页面布局、筛选吸顶和响应式样式
web/dashboard.js       筛选、标记、CSV 和桥接交互

scripts/build.mjs      拼接源码并注入正式或本地页面地址
scripts/test.mjs       构建、存储隔离、探测和队列测试
dist/                  本地构建产物
web/download/          网页提供安装的构建产物
```

## 4. 当前功能说明

### 4.1 Following 关注列表导出

- 用户从浏览器 Network 面板复制一次当前 `Following` 请求的 cURL。
- 脚本解析 GraphQL URL、`variables`、`features` 和允许使用的请求头。
- `userId` 作为数据所属账号 `source_user_id`。
- 每页请求后解析账号资料和底部 cursor，立即写入 GM 存储。
- 页面刷新或任务中断后从已保存 cursor 继续，不重新覆盖已完成数据。
- 原始 cURL、Cookie 和 `ct0` 不写入数据集。

导出的基础账号字段包括 ID、用户名、显示名、主页链接、蓝标、认证类型、粉丝数、关注数和保护状态。字段是否存在取决于当时 X 返回结构。

### 4.2 匿名公开主页探测

- 使用 `GM_xmlhttpRequest({ anonymous: true })` 请求 `https://x.com/{screen_name}`。
- 请求不携带当前 X 登录 Cookie，但仍会暴露正常网络 IP 和请求特征。
- 解析响应中的顶层 `article` 与 `/status/{id}` 链接。
- 根据状态 ID 的 Snowflake 时间取响应中最新的可见状态。
- 原始响应解析后丢弃，只保存结构化结果。
- 支持本次上限、请求间隔、1–8 并发、全选和失败重试。
- 探测结果只更新探测字段；累计 5 条或等待 2 秒后批量保存，暂停、完成、异常和页面隐藏时强制刷新缓冲区。
- 同一账号的探测任务使用带过期时间的任务租约，避免多个 X 标签页重复执行。

`last_post_at` 的准确含义是“匿名公开主页响应中可解析到的最新状态时间”。它不是完整发推历史，可能不包含登录后内容、受保护内容或 X 未在匿名 HTML 中下发的内容。

### 4.3 静态筛选页面

- 页面打开或刷新后自动从油猴脚本同步，并监听分层存储变化实时刷新。
- 也支持直接导入 CSV。
- 支持按名称、用户名、ID、活跃天数上下限、粉丝数上下限、探测状态、蓝标和审核状态筛选。
- 支持排序、快速筛选、分页、批量保留、批量待取消、清空和撤销。
- 单账号可打开主页或最近状态链接。
- 审核进度保存在页面 `localStorage`，并按 `source_user_id` 隔离。
- “保存进度 CSV”会导出当前数据及最新审核标记。

### 4.4 网页与油猴的数据桥

静态页与油猴脚本运行在同一个页面上下文中，通过自定义事件交换数据：

| 事件 | 方向 | 作用 |
| --- | --- | --- |
| `xfc:bridge-ready` | 油猴 → 网页 | 通知桥接已经就绪 |
| `xfc:request-dataset` | 网页 → 油猴 | 请求当前活动账号的数据 |
| `xfc:dataset` | 油猴 → 网页 | 返回账号、队列和来源账号 ID |
| `xfc:save-reviews` | 网页 → 油猴 | 只写回用户实际修改的审核标记 |
| `xfc:reviews-saved` | 油猴 → 网页 | 通知保存成功并返回统计 |
| `xfc:reviews-error` | 油猴 → 网页 | 返回账号切换等写入错误 |

桥接不会把 Cookie、`ct0`、Authorization 或原始 cURL交给网页代码。

### 4.5 待取消队列与执行

- 网页只发送变化的审核标记；活动队列由最新 `remove` 标记减去成功历史动态计算。
- 空选择会清空尚未执行的活动队列。
- 已成功取消的账号保留在数据集中，标为 `done`，但从活动队列移除。
- 再次发送队列时会过滤 `unfollow_status=success` 或已有 `unfollowed_at` 的账号。
- 执行前比较当前登录账号 `twid` 与数据集 `source_user_id`，避免串号。
- 默认自动生成 `friendships/destroy.json` 请求模板；也保留手动 cURL 模板能力。
- 支持设置本批数量和请求间隔；执行前持久化 `executing`，成功历史保存后才从队列移除。
- 上次任务若在请求期间中断，会进入 `needs_review`，不会自动重复执行。
- 遇到 HTTP 429 时停止，已完成进度不会丢失。

## 5. 数据模型

对界面和 CSV 暴露的合并数据结构：

```js
{
  schema_version: "x-follow-cleaner-v3",
  source_user_id: "当前账号数字 ID",
  updated_at: "ISO 时间",
  completed_following: false,
  following_cursor: "可选",
  following_page: 0,
  profile_probe: { /* 探测任务状态 */ },
  accounts: []
}
```

主要账号字段：

| 字段 | 含义 |
| --- | --- |
| `account_id` | 被关注账号数字 ID，主键 |
| `screen_name` / `name` | 用户名与显示名 |
| `profile_url` | X 主页地址 |
| `is_blue_verified` / `verified_type` | 认证信息 |
| `followers_count` / `following_count` | Following 返回的数量 |
| `protected` | 是否为保护账号 |
| `last_post_at` / `inactive_days` | 最近匿名可见状态时间及距今天数 |
| `last_post_id` / `last_post_url` | 最近匿名可见状态 ID 与链接 |
| `data_status` / `fetched_at` | 探测结果与探测时间 |
| `review_status` | 空、`keep`、`remove` 或 `done` |
| `unfollow_status` | 最近一次取消结果 |
| `unfollowed_at` | 成功取消时间 |
| `unfollow_http_status` | 最近一次取消请求 HTTP 状态 |

CSV 列名属于稳定交换协议。后续增加语言时不能翻译这些列名，否则会破坏旧文件兼容性。

## 6. 本地存储与账号隔离

油猴侧按职责分层存储，读取时按 `account_id` 合并：

```text
xfc:active-source:v1
xfc:accounts:v3:{source_user_id}
xfc:probe-results:v1:{source_user_id}
xfc:reviews:v1:{source_user_id}
xfc:unfollow-history:v1:{source_user_id}
xfc:task-lease:v1:{source_user_id}:{task_type}
xfc:unfollow-template:v2:{source_user_id}
xfc:unfollow-queue:v2:{source_user_id}
xfc:settings:v1
```

静态页审核状态主要键：

```text
xfc-dashboard-review-state-v3:{source_user_id}
```

旧版 `xfc:dataset:v2:*` 和未隔离数据在首次读取时自动拆分迁移；旧数据保留为回退备份。清空按钮只删除当前活动账号的分层数据、任务租约、请求模板和队列，不跨账号删除。

## 7. 状态与错误口径

常见 `data_status`：

- `ok`：解析到至少一个公开状态。
- `protected`：保护账号。
- `suspended`：账号被冻结。
- `not_found`：账号不存在。
- `empty_timeline`：页面明确表示没有内容。
- `no_visible_posts`：页面存在但未解析到公开状态。
- `rate_limited`：触发限流。
- `http_*`：其他 HTTP 状态。
- `request_error` / `parse_error`：网络或解析失败。

不能把 `no_visible_posts` 直接解释为长期未活跃；它只代表本次匿名响应没有可解析状态。

## 8. 构建、测试与部署

项目无第三方运行依赖，使用 Node.js 执行构建和测试：

```bash
npm test
npm run build
```

正式构建读取 `.env.production` 中的 `DASHBOARD_URL`，生成：

```text
dist/x-follow-cleaner.user.js
web/download/x-follow-cleaner.user.js
```

Cloudflare 推荐配置：

```text
Root directory: x-follow-cleaner
Build command: npm run build
Build output directory: web
```

发布油猴版本时同时更新 `src/metadata.txt` 与 `package.json` 版本，运行测试和正式构建，再提交两个构建产物。

## 9. 安全约束

- 登录态请求仅在 `x.com` 页面执行。
- 匿名探测必须保持 `anonymous: true`。
- 不把登录凭据或完整请求模板注入静态页事件。
- 取消关注属于有外部影响的操作，必须由用户主动开始并保留确认步骤。
- 不自动提高并发或取消频率；429 必须停止而不是无限重试。
- 不在自动测试中执行真实取消关注请求。

## 10. 后续多语言方案

当前页面文案直接写在 HTML 和 JavaScript 中。为了保持项目简单，建议继续使用原生 JavaScript，不引入 React 或大型 i18n 库。

### 10.1 最小实现

新增一个共享字典文件，例如：

```js
const messages = {
  "zh-CN": {
    "app.title": "关注清理台",
    "help.title": "使用流程",
    "filter.title": "筛选账号"
  },
  en: {
    "app.title": "Following Cleaner",
    "help.title": "How it works",
    "filter.title": "Filter accounts"
  }
};
```

HTML 静态文案使用 `data-i18n="app.title"` 标记；带参数的运行时提示使用 `t(key, params)`。语言优先级建议为：

1. 用户手动选择并保存的语言。
2. `navigator.language`。
3. 默认 `zh-CN`。

语言选择保存为：

```text
xfc:locale:v1
```

油猴面板和静态页应使用相同语言代码，但各自读取本地设置，不依赖服务器同步。

### 10.2 必须保持稳定的内容

以下内容不能随显示语言变化：

- GM 与 localStorage 键名。
- 自定义事件名。
- `schema_version`。
- CSV 英文字段名和内部状态值。
- GraphQL 参数名、API 路径和请求头。

只翻译界面标签、说明文字、日志消息和状态显示名称。内部仍保存 `keep`、`remove`、`done`、`rate_limited` 等稳定值。

### 10.3 格式化规则

- 数量使用 `Intl.NumberFormat(locale)`。
- 日期使用 `Intl.DateTimeFormat(locale)`。
- 不在翻译字符串中拼接中文量词；使用参数模板，例如 `{count} accounts`。
- 中英文都要测试长文本按钮、窄屏换行、弹窗高度和筛选栏吸顶。

### 10.4 推荐实施顺序

1. 抽出静态页固定 HTML 文案。
2. 抽出 `dashboard.js` 的动态提示和状态名称。
3. 抽出油猴 `panel.js` 文案。
4. 抽出 Following、探测、桥接和取消关注日志。
5. 增加中文、英文构建测试和关键界面浏览器测试。

第一阶段只支持 `zh-CN` 与 `en` 即可，不要同时引入地区变体、在线翻译后台或复杂路由。

## 11. 后续维护重点

- X GraphQL query ID、features 和响应结构可能变化，Following 解析需要定期验证。
- X 匿名主页 HTML 可能变化，需要用已知活跃账号检查 `last_post_at`。
- 修改数据结构时应增加新的 `schema_version` 或迁移逻辑，不能直接破坏旧 CSV。
- 修改队列逻辑时必须继续保证成功账号不会重复执行、空快照能清空未执行队列、账号不匹配时拒绝写入。
- 发布前至少执行 `npm test`、`npm run build` 和一次静态页/油猴面板人工交互检查。
