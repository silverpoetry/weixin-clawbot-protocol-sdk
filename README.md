# Weixin Message Sender

基于 [WeChatCodex](https://github.com/DrDavidDa/WeChatCodex/tree/main) 的原理，先扫码绑定微信拿到 `ClawBot` 凭据，再调用 `ilink / ClawBot` 协议接口，把文本消息发送给指定微信目标。

当前项目现在做三件事：

- 扫码登录微信并保存绑定账号
- 每次发送前拉取新消息，自动确定应该回复给谁
- 没有新消息时复用上次成功会话，发送 `helloworld`

## 原理

参考仓库的核心发送路径是：

- 使用 `Bearer` token 访问 `https://ilinkai.weixin.qq.com/ilink/bot/sendmessage`
- 请求头包含 `AuthorizationType: ilink_bot_token` 和 `X-WECHAT-UIN`
- 请求体包含 `from_user_id`、`to_user_id`、`context_token`、`message_type` 和 `TEXT item`

本项目保留最小必要链路：

- `setup`: 调 `get_bot_qrcode` 和 `get_qrcode_status` 完成扫码绑定
- `send`: 先调 `getupdates` 刷新目标会话，再调 `sendmessage` 发送文本消息

不包含守护进程、消息轮询、多轮会话等额外能力。

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env`，可选填写：

- `WECHAT_BASE_URL`: 默认 `https://ilinkai.weixin.qq.com`
- `WECHAT_TO_USER_ID`: 默认 `clawbot`
- `WECHAT_CONTEXT_TOKEN`: 可为空
- `WECHAT_MESSAGE_DATA_DIR`: 账号保存目录，默认是用户主目录下 `.weixinmessage`

不需要手工填写 token。

先执行扫码绑定：

```bash
node dist/src/cli.js setup
```

## 发送

扫码成功后，默认发送 `helloworld`：

```bash
npm run send
```

自定义目标和文本：

```bash
node dist/src/cli.js --to clawbot --text helloworld
```

默认自动发送逻辑：

- 发送前先调用 `getupdates`
- 如果有新的入站消息，就把最新消息的 `from_user_id` 和 `context_token` 保存为当前目标
- 如果没有新消息，就复用本地保存的上次目标和 `context_token`

## 信息保存在哪里

默认保存在：

```text
%USERPROFILE%\\.weixinmessage\\
├── accounts\\
│   └── <bot-account-id>.json
└── state\\
    └── conversation.json
```

其中：

- `accounts/<bot-account-id>.json`
  保存扫码登录得到的 `botToken`、`accountId`、`userId`、`baseUrl`
- `state/conversation.json`
  保存上次可用的 `toUserId`、`contextToken`、最近消息文本、最近消息时间、`get_updates_buf`

## 测试

```bash
npm test
```
