# 本次定义的本机桥接协议

此协议是本项目定义的应用协议（沿用上一版原型，字段未变）；实际实现见 `bridge/server.mjs`（服务端）和 `src/engine/session.js`（浏览器端）。

HTTP 与 WebSocket 同源。服务只监听 127.0.0.1，运行时确定端口；WebSocket 路径为 `/terminal`。HTTP Host 和 WebSocket Origin 必须等于服务实际地址。连接成功只表示 WebSocket 建立，必须完成访问口令、主机密钥确认、SSH 认证及 PTY 创建后才能标记 SSH 已连接。

## 浏览器到桥接

| 消息 | 数据 |
|---|---|
| JSON `connect` | `token`、`host`、`port`、`username`、`cols`、`rows`，以及 `password` 或 `privateKey` 和可选 `passphrase` |
| JSON `verify` | `accept: boolean`，仅用于当前待确认的真实主机公钥 |
| 二进制帧 | 原始终端输入字节，无本地回显；通过 xterm onData/onBinary 传入 |
| JSON `resize` | `cols`、`rows`、`width`、`height`；服务调用 setWindow(rows, cols, height, width) |
| JSON `ack` | `bytes`：已被 xterm write 回调确认解析的输出字节数 |

## 桥接到浏览器

| 消息 | 数据 |
|---|---|
| JSON `hostkey` | `fingerprint`：实际原始主机公钥的 SHA256 OpenSSH 风格指纹 |
| JSON `connected` | SSH 已完成认证且交互 PTY 已创建 |
| 二进制帧 | 原始 SSH stdout/stderr，直接传给 xterm.write |
| JSON `input_ack` | `bytes`：SSH channel.write 回调已接受的输入字节数 |
| JSON `error` | `message`：错误信息 |
| JSON `closed` | `message`：关闭原因 |

输出未确认字节达到 256 KiB 时暂停 SSH 可读流，回落到 64 KiB 以下恢复；累计上限 4 MiB。浏览器单批输入 16 KiB，在途窗口 64 KiB，本地输入总队列上限 1 MiB；服务单帧输入上限 64 KiB，待写入输入累计上限 256 KiB。达到限制会报错或关闭，不承诺无限缓存。

同一会话的主机公钥在首次确认后固定，rekey 继续与该 Buffer 比较。关闭时释放 SSH/PTY/定时器；浏览器使用连接实例和版本计数隔离旧回调，先清空 xterm 写队列再重置模式并建立下一会话。

凭证不写入 localStorage、服务日志或在线演示服务。Node 和浏览器仍会在认证时短暂持有值；当前实现不宣称能对 JavaScript 内存做密码学级清除。
