# Weixin Clawbot Protocol SDK

一个不依赖 OpenClaw 的轻量级 Weixin ClawBot 协议 SDK。

项目目标不是复刻 OpenClaw 宿主，而是把官方插件和实际抓到的协议行为中可独立使用的能力，整理成一个更轻量、可嵌入、可测试的 SDK，并提供一个文件状态驱动的示例应用。

## 1. 定位与功能

本项目定位：

- 作为一个轻量级 WeChat ClawBot 协议 SDK
- 参考官方 `@tencent-weixin/openclaw-weixin` 的协议能力面进行封装
- 不依赖 OpenClaw 运行时
- 适合独立脚本、服务、机器人、网关适配层直接集成

当前 SDK 已支持：

- 扫码登录
- 拉取消息 `getupdates`
- 发送文本消息 `sendmessage`
- 获取上传地址 `getuploadurl`
- 获取配置 `getconfig`
- 发送输入状态 `sendtyping`
- 启停通知 `notifystart` / `notifystop`
- 较完整的消息和媒体协议类型定义

当前项目还包含一个示例应用，用来演示：

- 登录后如何保存账号信息
- 如何维护最近一次可用的 `toUserId`
- 如何维护最近一次可用的 `context_token`
- 如何维护 `get_updates_buf`
- 如何实现“发送前先拉新消息，有则更新，无则复用”的发送策略

## 2. 微信接口与流程分析

这个项目基于微信 `ilink / ClawBot` 协议进行工作，核心接口包括：

- `ilink/bot/get_bot_qrcode`
- `ilink/bot/get_qrcode_status`
- `ilink/bot/getupdates`
- `ilink/bot/sendmessage`
- `ilink/bot/getuploadurl`
- `ilink/bot/getconfig`
- `ilink/bot/sendtyping`
- `ilink/bot/msg/notifystart`
- `ilink/bot/msg/notifystop`

### 登录流程

登录分两步：

1. 请求二维码
   调 `get_bot_qrcode` 获取 `qrcode` 和二维码内容
2. 轮询扫码状态
   调 `get_qrcode_status` 直到确认成功

确认成功后会得到：

- `botToken`
- `accountId` / `ilink_bot_id`
- `userId` / `ilink_user_id`
- `baseUrl`

这些信息解决的是：

- 我是谁
- 我后续如何鉴权调用协议接口

### 收发消息流程

真正的收发消息依赖三类信息：

- bot 身份
  即 `from_user_id = accountId`
- 对端用户身份
  来自入站消息中的 `from_user_id`
- 会话上下文
  来自入站消息中的 `context_token`

典型流程是：

1. 先调用 `getupdates`
2. 从最新入站消息中取：
   - `from_user_id`
   - `context_token`
   - `message_id`
   - `item_list`
3. 发送消息时：
   - `from_user_id` 用 bot 的 `accountId`
   - `to_user_id` 用最新入站消息里的 `from_user_id`
   - `context_token` 原样回传

也就是说：

- 扫码登录只解决 bot 身份，不直接决定发给谁
- `to_user_id` 和 `context_token` 通常来自最近一次真实会话
- 这更接近“会话型回复协议”，而不是“任意目标自由推送协议”

### `context_token` 的实际规则

本项目在真实账号上做过验证，得到这几个结论：

- 新消息不会立刻让旧 `context_token` 失效
- 同一用户短时间内可能存在多个仍然可用的 `context_token`
- 已验证规则：`context_token` 在发消息后有效期为 24 小时

所以实践上应采用：

- 优先使用最新入站消息对应的 `context_token`
- 没有新消息时，在 24 小时窗口内复用本地保存的旧 `context_token`

### `get_updates_buf` 的作用

`get_updates_buf` 不是用户标识，而是增量拉取游标。

作用是：

- 首次调用时没有它，就从当前状态开始拉
- 后续调用时带上它，就表示“从上次位置继续拉”

因此一个稳定的接入方通常会持久化：

- `get_updates_buf`
- 最近可用的 `toUserId`
- 最近可用的 `context_token`

## 3. 结构与示例

项目现在按三层组织：

```text
src/
├── index.ts
├── sdk/
│   ├── auth.ts
│   ├── client.ts
│   ├── index.ts
│   ├── messages.ts
│   └── types.ts
├── shared/
│   ├── constants.ts
│   └── store.ts
└── example/
    ├── account-store.ts
    ├── cli.ts
    ├── config.ts
    ├── conversation-state-store.ts
    └── session-target-resolver.ts
```

### SDK 层

`src/sdk/` 提供协议封装：

- `ClawbotClient`
- `startQrLogin()`
- `waitForQrScan()`
- `buildSendTextRequest()`
- `sendTextMessage()`
- 一整套协议类型

对外统一从：

- [src/index.ts](C:/Users/weich/Desktop/weixinmessage/src/index.ts)

导出。

### Shared 层

`src/shared/` 只放基础文件能力：

- 默认数据目录
- JSON 读写

这层不包含任何“应该发给谁”的业务逻辑。

### Example 层

`src/example/` 是示例应用，不是 SDK 的一部分。

它演示一个最小实用策略：

1. 登录后把账号落盘
2. 发送前先调用 `getupdates`
3. 如果有新消息：
   更新本地 `toUserId/context_token/get_updates_buf`
4. 如果没有新消息：
   复用本地保存的上次会话状态
5. 再调用 `sendmessage`

默认数据落盘位置：

```text
%USERPROFILE%\\.weixinmessage\\
├── accounts\\
│   └── <bot-account-id>.json
└── state\\
    └── conversation.json
```

其中：

- `accounts/<bot-account-id>.json`
  保存扫码登录得到的账号信息
- `state/conversation.json`
  保存最近一次可用的 `toUserId`、`context_token`、`get_updates_buf` 和最近消息元数据

## 安装

```bash
npm install
```

## 示例应用用法

先扫码登录：

```bash
node dist/src/example/cli.js setup
```

然后发送：

```bash
npm run send
```

也可以显式指定目标和文本：

```bash
node dist/src/example/cli.js --to <user-id> --context <context-token> --text hello
```

## 开发

```bash
npm run build
npm test
```
