<div align="center">
  <img src="./images/9router.png?1" alt="9Router" width="600"/>

  # 9Router 二开版（9router-two-change）

  基于 [decolua/9router](https://github.com/decolua/9router) v0.5.86 的二次开发分支
  面向 **NVIDIA NIM（免费 API）+ Vercel / Cloudflare 免费中转** 的个人使用场景
</div>

---

## 🔱 与官方版的区别

本地 AI 路由网关的核心能力（一个 OpenAI 兼容端点、40+ 上游、格式转换、多账号回退、配额跟踪）与官方一致，差异如下：

| 领域 | 官方 (v0.5.86) | 本二开 (v0.5.87) |
|---|---|---|
| **默认中转池** 🆕 | 中转池（Vercel/Cloudflare/Deno）需逐个连接手动绑定 | 代理池可设为**默认池**：所有未单独绑定代理的连接（含 NVIDIA）自动走它，一条免费中转覆盖全部流量；`__none__` 显式退出 |
| **独立中转 Worker** 🆕 | 中转只能通过面板填 Token 部署 | [`relay/`](./relay) 提供可独立部署的 Cloudflare Worker + Vercel Edge Function（同一套协议），支持 `ALLOWED_TARGETS` 白名单 |
| **动态模型列表** 🆕 | NVIDIA 模型表静态写死，NIM 上下线后静默过期（#3398） | 面板与 `/v1/models` 都拉官方实时目录（带缓存、走中转出口），可直接输入任意在售模型 id |
| **中转部署体检** 🆕 | 部署后不校验，Vercel 保护未关闭时保存一个必 403 的池（#1037） | 部署后立即探测 relay 契约，失败不保存并给出诊断 |
| **中转池测试** 🆕 | 依赖 httpbin.org 往返，抖动时把健康池误判停用 | 两阶段测试（契约 + 真实出口往返），报告中转出口 IP |
| **最快账号优先** 🆕 | 账号选择只有优先顺序 / 轮询（#3072） | 新增 Fastest 策略：按近期延迟（TTFT）自动选最快账号，无样本时回退优先顺序 |
| **Combo 排序** 🆕 | 列表按创建时间固定，无法整理（#4322） | 拖拽排序并持久化 |
| **吞吐量指标** 🆕 | 用量分析无速度数据（#3761） | 新增平均生成吞吐卡片（tok/s，需开启可观测性） |
| NVIDIA thinking | `reasoning_effort:"auto"` 和枚举外等级被 NIM 400 拒绝；kimi-k3 只认 low/high/max，客户端默认值 `medium` 导致每个请求失败（#1914/#3794） | `auto` 省略字段走默认；不支持的等级就近映射（medium→high、xhigh→max） |
| NVIDIA client_metadata | Anthropic 字段透传 → NIM 400（#2311/#2610 残留） | registry 声明 `dropClientMetadata` |
| Strict Proxy | 标志在 `/v1/chat/completions` 丢失，代理挂掉后静默走真实 IP（#4007/#4333） | 端到端透传；回退日志带目标 URL |
| 连接超时 | 上游挂起 ~250s 报裸 502（#4248） | 报 504，附模型名与耗时 |
| 模型锁 | 重新授权/刷新会清掉禁用坏模型的远期 `modelLock_*`（#4250） | 只清已过期的锁 |
| Gemini / Antigravity | 以 assistant turn 结尾的对话必现 400（#4345） | 自动补全 functionResponse / "Continue." 用户轮 |
| Step 3.7 视觉 | 图像被剥离并换到非视觉兜底模型（#3590） | 保留视觉 |
| 上游 200 带错误体 | NVIDIA ResourceExhausted 时返回 HTTP 200 + `choices:null`，客户端收到"成功的空响应"（#2727） | 映射回 429/502 正确错误 |
| Windows 构建 | better-sqlite3 v12 prebuild 静默跳过，`npm run build` 失败 | 升级 v13，开箱可构建 |

**已移除（非运行时）**：`gitbook/` 文档站、多语言 README、`cli/` 托盘启动器、`.github/` CI、`captain-definition`——均可从 git 历史恢复。完整上游文档见 [官方 README](https://github.com/decolua/9router#readme)。

---

## ⚡ 快速开始

**源码运行：**

```bash
git clone https://github.com/ice-a/9router-two-change.git
cd 9router-two-change
npm install
npm run build
PORT=20128 npm run start
```

**Docker：**

```bash
docker compose up -d
```

打开 http://localhost:20128 → 连接页添加 NVIDIA（[build.nvidia.com](https://build.nvidia.com) 免费领 Key）→ API 地址 `http://localhost:20128/v1`。

---

## 🌐 全部流量走免费中转

1. 部署中转 Worker（免费）：
   - Cloudflare：`cd relay && npx wrangler deploy`
   - Vercel：`cd relay && npx vercel --prod`
2. 面板 → **Proxy Pools** → 添加 worker 地址（类型选 `cloudflare` / `vercel`）→ 打开 **Default Pool** 开关
3. 完成后所有 provider 流量自动经中转出去，无需逐个连接配置

> 大陆直连 `*.workers.dev` / `*.vercel.app` 普遍不通，需给 worker 绑定自定义域名（Cloudflare 免费计划支持），详见 [relay/README.md](./relay/README.md)。

---

## 📚 文档

- 中转部署与排查：[relay/README.md](./relay/README.md)
- 系统架构：[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- 上游完整文档：https://github.com/decolua/9router#readme

## 📄 License

MIT（继承自上游）
