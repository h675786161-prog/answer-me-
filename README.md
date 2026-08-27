# 💢 Answer Me

> 你们几个谁他妈先回我。

一个给 SillyTavern 用的多 Connection Profile 并行抢答扩展。

## 当前版本

`0.1.0-beta.1`

这是第一轮实机测试版，优先把核心赛马逻辑跑通，再补全自动重试与更细的异常判定。

## 当前规则

1. 正常使用 SillyTavern 发送消息。
2. Answer Me 读取当前酒馆已经组装好的 prompt。
3. 当前酒馆请求照常进行，同时对你勾选的其他 Connection Profiles 发起并行请求。
4. 第一条完整正常回复成为赢家。
5. 赢家出现时：
   - 已经吐出正文 token 的请求：不杀，允许继续生成；完成后收进 Swipe。
   - 仍然一个正文 token 都没吐的请求：立即 Abort。
6. reasoning / 思维链不算“开口”，只有正文 text 才算。
7. 如果并行站先完成：
   - 当前酒馆请求尚未吐正文：直接停止当前请求，并把并行站答案写成主回复。
   - 当前酒馆已经开始吐正文：允许它继续，完成后把并行赢家调整为主回复，当前酒馆答案降为 Swipe。

## 密钥处理

Answer Me 不要求你重新填写 API Key。

它读取 SillyTavern Connection Manager 已保存的 Connection Profiles，并通过酒馆自己的 `ConnectionManagerRequestService` 发起请求。扩展设置只保存 Profile ID，不保存或显示明文密钥。

## 安装

在 SillyTavern 的第三方扩展安装处使用本仓库地址安装。

安装后建议：

1. 先确认 SillyTavern 的 Connection Manager 里已经保存好多个站点配置。
2. 打开扩展设置里的 **💢 Answer Me**。
3. 勾选想参加赛马的 Connection Profiles。
4. 开启 **启用赛马**。
5. 先用一条普通消息测试，不要一上来就狠狠干 10 个站。

## 状态含义

- 🏆 抢答成功：本轮赢家。
- 🟢 已经开口：已出现正文 token，赢家产生后也允许继续吐完。
- ⚫ 零正文 token：仍然处于冷暴力观察期。
- 💥 冷暴力，已扇死：赢家出现后仍未吐正文，已 Abort。
- ❌ 请求失败：429、连接错误、API 报错等。

## 下一步

- 全军覆没后接入「💢你他妈倒是回我啊」自动重试子模块。
- 更稳的 Swipe metadata / reasoning 保存。
- 失败站点退避与重试策略。
- 更详细的站点耗时统计与胜率。
- 实机验证 Gemini / 自定义 OpenAI 兼容公益站 / 流式与非流式组合。

## 注意

这是 beta。多路异步生成会碰到不同站点的流式实现差异，首次实机测试请保留浏览器控制台日志，方便定位哪个站不按套路出牌。
