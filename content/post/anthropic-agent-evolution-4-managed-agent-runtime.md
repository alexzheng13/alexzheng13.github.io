---
title: "Anthropic Agent 演进（四）：Managed Agent Runtime"
date: 2026-09-12 21:05:45 +0200
slug: "anthropic-agent-evolution-4-managed-agent-runtime"
categories: [AI Agents]
tags: [Anthropic Agent 演进, Managed Agents, Agent Runtime, Sandbox, Session, Codex]
toc: true
---

前几代 Harness 关注的是模型怎样持续工作、怎样提高质量。走向托管服务后，问题变成了系统工程：Session 如何持久化？Harness 崩溃后怎样恢复？Sandbox 如何替换？怎样连接客户自己的 VPC？凭据如何不暴露给模型生成的代码？

Anthropic Managed Agents 的核心答案是：**把 Brain、Hands 和 Session 解耦为稳定接口。**

<!--more-->

> **系列导航**：[（一）从 Workflow 到 Agent](/post/anthropic-agent-evolution-1-from-workflows-to-agents/) · [（二）Context Reset 与 Structured Handoff](/post/anthropic-agent-evolution-2-context-reset-and-handoff/) · [（三）Planner–Generator–Evaluator](/post/anthropic-agent-evolution-3-planner-generator-evaluator/) · **（四）Managed Agent Runtime**

## 1. Agent Runtime 的四个组件

Managed Agent 可以拆成四部分：

- **Session**：关于任务发生过什么的只追加事件日志；
- **Harness**：调用模型、组织 Context、路由 Tool Call 的 Agent Loop；
- **Sandbox**：运行命令、编辑文件和执行不可信代码的环境；
- **Tools / Resources**：MCP、外部服务和业务能力。

![Managed Agent 的 Session、Harness、Sandbox 与工具](/img/posts/anthropic-agent-evolution/managed-agent-components.webp)

这四者的生命周期不应该绑死。Session 需要持久，Harness 和 Sandbox 则应该可以失败、重启和替换。

## 2. 为什么“一切放进一个容器”会失败？

最直接的实现是让 Session、Harness 和 Sandbox 共处一个容器。文件操作简单，也没有服务边界，但容器很快变成一只不能丢失的 “Pet”：

- 容器死亡会带走 Session；
- 无响应时必须进入包含用户数据的容器排障；
- Harness 假定资源和代码都与自己同处一地；
- 客户自有 VPC 或自托管执行环境很难接入；
- 生成代码与凭据共处，扩大 Prompt Injection 的影响范围。

真正可扩展的系统应该把容器当作 “Cattle”：坏了就替换，而不是抢救。

## 3. Decouple the Brain from the Hands

Anthropic 把 Claude + Harness 视为 Brain，把 Sandbox 与工具视为 Hands，把事件日志视为独立 Session：

- Harness 通过统一的 `execute(name, input) → string` 调用执行环境；
- Sandbox 失败时，Harness 把错误作为工具结果交给模型，并可重新 Provision；
- Harness 失败时，新实例通过 `wake(sessionId)` 和 Session Log 恢复；
- Session 持续接收事件，因此不依赖某个 Harness 进程存活。

这种解耦同时带来扩展性和性能收益：不需要 Sandbox 的 Session 可以直接开始推理；只有第一次调用执行工具时才 Provision 环境。Anthropic 报告该结构使 p50 Time-to-First-Token 约降低 60%，p95 降低超过 90%。

## 4. Session 不等于 Context Window

这是整套架构最关键的概念：

> **Session 是可恢复的完整事件历史；Context Window 是某一次模型调用选择看到的有限视图。**

Compaction、Trimming 和 Memory 都在决定“下一次 Context 保留什么”，而这种选择可能不可逆。如果原始事件只存在于 Context 中，被压缩或删除后就无法重新检查。

Managed Agents 把完整事件流持久化在 Session 中，再由 Harness 调用 `getEvents()` 选择切片、重放附近事件或做新的 Context Engineering。于是：

- **Session 负责可恢复性**；
- **Harness 负责上下文策略**；
- **Context Window 只负责当前推理。**

Memory Store 也可以看作持久状态的一种，但它不是完整事件日志的替代品。Memory 保存 Agent 主动提炼的知识；Session 保留未来可能重新解释的原始事实。

## 5. 安全边界：凭据不能进入 Sandbox

如果生成代码与访问令牌处在同一个环境中，Prompt Injection 只需要诱导 Agent 读取环境变量。结构性修复不是“要求模型不要读”，而是让凭据在物理架构上不可达：

- 仓库令牌仅在初始化时绑定到特定资源；
- OAuth Token 存在 Sandbox 外部的 Vault；
- MCP 调用经过专用 Proxy，由 Proxy 取凭据并访问外部服务；
- Harness 和生成代码都不直接看到凭据。

能力提升会让依赖“模型应该不会做什么”的安全假设越来越脆弱，因此权限必须落到系统边界上。

## 6. 与 Codex Agents API 架构对照

OpenAI Agents API 也把托管 Harness 与执行环境分开，并根据任务需要提供三种 Environment 模式。

### 6.1 No Environment

只使用 Function Tools 或远程 MCP，不需要文件和 Shell 时，可以不创建 Sandbox。

![Codex Agents API：无执行环境](/img/posts/anthropic-agent-evolution/codex-no-environment.webp)

### 6.2 OpenAI-hosted Environment

需要运行代码、编辑文件或生成 Artifact 时，由 OpenAI 管理 Sandbox。应用负责发任务和处理事件，Harness 直接把内置工具调用路由到托管环境。

![Codex Agents API：OpenAI 托管执行环境](/img/posts/anthropic-agent-evolution/codex-hosted-environment.webp)

### 6.3 Self-hosted Environment

应用创建 Session 后获得 `environment_id` 与 `remote_url`，自行启动 VM、容器或 Kubernetes Pod，并让 Executor 主动连接。Harness 仍在云端管理 Agent Loop，Shell 和文件工具则在客户环境中执行。

![Codex Agents API：自托管环境的生命周期](/img/posts/anthropic-agent-evolution/codex-self-hosted-flow.webp)

这个模式与 “Brain / Hands 分离”高度相似：Application 管理计算资源和生命周期，Agents API 管理 Session 与 Harness，Executor 负责在 Sandbox 内完成命令并回传结果。

## 7. 两套架构的共同方向

| 关注点 | Anthropic Managed Agents | OpenAI Agents API / Codex |
| --- | --- | --- |
| 持久任务状态 | Session Event Log | Session + Event Stream |
| Agent Loop | Managed Harness | Managed Codex Harness |
| 执行环境 | 可替换 Sandbox | None / Hosted / Self-hosted |
| 外部工具 | MCP Proxy / Resources | Function Tools / MCP |
| 恢复 | 从 Session 重建 Harness | 订阅事件并重连 Executor |
| 安全 | 凭据在 Sandbox 外 | Harness、Application 与 Sandbox 分工 |

它们共同说明：Agent Runtime 正在从“一个模型加一组工具”演进成类似操作系统的抽象层。稳定接口负责隔离变化，模型、Harness 策略和执行基础设施可以独立升级。

## 8. 这条演进路径真正改变了什么？

回顾整个系列：

1. **Workflow → Agent**：把动态决策交给模型；
2. **Context Reset + Handoff**：把长期状态移到模型之外；
3. **Generator + Evaluator**：把自我评价变成外部验证；
4. **Managed Runtime**：把 Session、Harness、Sandbox 解耦成可恢复服务。

模型能力增强不会让 Harness 消失，而会改变 Harness 的职责。过期脚手架应被删除，但状态、验证、安全和恢复这些系统问题不会因为模型更聪明而自动消失。

## 参考资料

- [Anthropic: Scaling Managed Agents—Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)
- [Claude Platform: Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [OpenAI Agents API: Architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture)
