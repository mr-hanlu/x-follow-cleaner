# Greasy Fork 页面说明

以下内容可直接分别粘贴到 Greasy Fork 的简体中文和英文“脚本描述”中。

## 简体中文

X/推特取关助手是一款本地优先的批量取关工具：导出正在关注列表、匿名检查最近可见推文时间、按距最近推文天数和粉丝数筛选，再将确认过的账号安全分批取消关注。

### 使用流程

1. 安装脚本并登录 X，打开自己的“正在关注”页面。
2. 按面板内“怎么复制 Following cURL？”的说明导出关注列表。
3. 匿名请求公开主页，获取最近可见推文时间。
4. 打开筛选页面，标记“保留”或“待取消”，然后发送队列。
5. 返回 X，设置每批数量和间隔，确认后分批执行。

### 主要功能

- 关注列表断点导出
- 匿名检查公开主页，不发送 X 登录 Cookie
- 距最近可见推文天数、粉丝数和状态筛选
- 批量标记、CSV 备份和多账号隔离
- 待处理取消队列、失败重试和已处理历史
- 429 时停止并保留进度

### 隐私与边界

关注数据和审核标记默认保存在当前浏览器。筛选页面不会接收 X Cookie、`ct0`、Authorization 或原始 cURL。匿名请求仍会暴露当前网络 IP，也可能遇到限流。最近可见推文时间来自公开页面中可解析到的少量内容，不代表完整推文历史。

### 支持开发

脚本免费提供。如果它帮你节省了时间，可以[自愿赞助后续维护](https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/)。赞助不会解锁额外功能，也不会影响脚本的正常使用。

- 支付宝收款码：[打开赞助页面](https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/)
- SOL（Solana Mainnet，仅接收 SOL）：`9tguPb7HzyhhhXV8W4MmVv1a2YWkzK7gUG1e3kjpJAC1`
- ETH（Ethereum Mainnet，仅接收 ETH）：`0xc91b1fAF0F82A1CC4EC2Eb9882EDA79a946Ae6D3`
- BTC（Bitcoin Mainnet，仅接收 BTC）：`bc1qlvzc7aymxtvxsfagd8uu2yr9f484d7l9hm939j`

转账前请确认网络和地址。链上转账通常无法撤销。

## English

Review your X/Twitter following list locally: export followed accounts, check the latest publicly visible post time without X login cookies, filter by days since that post and follower count, then unfollow only confirmed accounts in controlled batches.

### Quick start

1. Install the script, sign in to X, and open your Following page.
2. Follow the built-in “How do I copy the Following cURL?” guide to export the list.
3. Probe public profiles for the latest publicly visible post time.
4. Open the dashboard, mark accounts as Keep or Remove, and send the queue.
5. Return to X and run a confirmed batch with your chosen size and delay.

Data stays in the current browser by default. The dashboard does not receive X cookies, `ct0`, Authorization headers, or the original cURL. Public profile results may still be rate-limited and do not represent a complete post history.

### Support development

The script remains free to use. If it has saved you time, you can [voluntarily support its maintenance](https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/). Contributions do not unlock features or affect normal use.

- Alipay: [open the support page](https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/)
- SOL (Solana Mainnet, SOL only): `9tguPb7HzyhhhXV8W4MmVv1a2YWkzK7gUG1e3kjpJAC1`
- ETH (Ethereum Mainnet, ETH only): `0xc91b1fAF0F82A1CC4EC2Eb9882EDA79a946Ae6D3`
- BTC (Bitcoin Mainnet, BTC only): `bc1qlvzc7aymxtvxsfagd8uu2yr9f484d7l9hm939j`

Check the network and address before transferring. On-chain transfers are generally irreversible.
