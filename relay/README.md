# 免费中转（Free Relay）— 让所有请求走 Vercel / Cloudflare 转发

本目录提供两个可独立部署的转发 worker（与 9router 内置 relay 池使用同一套
`x-relay-target` / `x-relay-path` 协议），用于把上游请求（例如 NVIDIA NIM）
通过 Cloudflare / Vercel 的免费边缘网络转发到官方 API。

| 文件 | 用途 |
|---|---|
| `cloudflare-worker.js` + `wrangler.toml` | Cloudflare Worker（免费 10 万请求/天） |
| `api/relay.js` + `vercel.json` | Vercel Edge Function（Hobby 免费计划） |

## 为什么能降延迟 / 什么情况下有用

- 9router 只需连接到离你最近的 Cloudflare / Vercel 边缘节点，剩下的一段走
  Cloudflare / Vercel 的骨干网到 NVIDIA（`integrate.api.nvidia.com`），
  某些线路下比直连更稳更快。
- NVIDIA 的直连偶发 200s+ 挂起（上游问题，issue #4248），换出口线路有时能避开。
- 注意：如果本地到 workers.dev / vercel.app 的线路本身被墙或很慢，
  中转反而更差。大陆网络下 `*.workers.dev` / `*.vercel.app` 普遍不可直连，
  **需要给 worker 绑定一个自定义域名**（Cloudflare 免费计划支持，域名 DNS 托管在
  Cloudflare 即可；Settings → Domains & Routes → Add Custom Domain）。

## 部署方式一：Cloudflare Worker（推荐）

```bash
cd relay
npx wrangler login      # 浏览器授权一次
npx wrangler deploy     # 输出 https://nvidia-relay.<你的子域>.workers.dev
```

（无 Node 环境时也可以在 Cloudflare Dashboard → Workers → Create Worker，
把 `cloudflare-worker.js` 的内容粘贴进去。）

建议在 `wrangler.toml` 里取消注释 `ALLOWED_TARGETS`，把转发目标锁定为
`https://integrate.api.nvidia.com`，防止别人把你的 worker 当开放代理用。

## 部署方式二：Vercel Edge Function

```bash
cd relay
npx vercel login
npx vercel --prod       # 输出 https://<project>.vercel.app
```

或者在 9router 面板 → Proxy Pools → Vercel Relay 里填 Vercel Token 一键部署
（内置功能，效果相同）。

环境变量（可选）：`ALLOWED_TARGETS`，含义同上（Vercel Dashboard → Settings →
Environment Variables）。

## 在 9router 中接入

1. 面板 → **Proxy Pools** → Add Proxy Pool：
   - Name: `nvidia-cf-relay`
   - Proxy URL: 部署得到的 worker 地址
   - Type: `cloudflare`（Vercel 则选 `vercel`）
2. 让**所有**请求都走它（二开新增的"默认池"功能）：把该池的
   **Default Pool** 开关打开。之后任何没有单独绑定代理池的连接（包括 NVIDIA、
   以及所有免费/付费 provider）都会自动经过这个中转。
   - 不想走默认池的连接：在该连接的代理设置里选择别的池或 `__none__` 显式退出。
3. 单独给 NVIDIA 走中转（不想全局）：编辑 NVIDIA 连接 → 代理池选择该池。
4. 保存后发一条消息验证；请求日志里会出现
   `PROXY ... vercel-relay=https://...` 的行。

## NVIDIA 免费额度

- 在 <https://build.nvidia.com> 注册（免费），于
  <https://build.nvidia.com/settings/api-keys> 创建 API Key。
- 把 Key 配到 9router 的 NVIDIA NIM 连接即可；可用模型以面板内列表为准，
  也可以在连接设置里拉取 `https://integrate.api.nvidia.com/v1/models` 的实时列表。

## 故障排查

- 返回 `{"error":"Missing x-relay-target header"}`：说明直接访问了 worker 根路径，
  正常现象（浏览器打开会看到这条）。
- 返回 403 `Target not allowed`：请求目标不在 `ALLOWED_TARGETS` 里。
- 返回 502 `Relay fetch failed`：worker 到上游失败，多为 NVIDIA 侧问题，
  与本地网络无关。
- 9router 日志里 `PROXY ... pool=... vercel-relay=...` 出现但请求 4xx：
  上游（NVIDIA）拒绝了请求本身，与中转无关。
