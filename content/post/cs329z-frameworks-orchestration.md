---
title: "CS 329Z：Frameworks & Orchestration——从 Agent Harness 到可靠执行与可观测性"
date: 2026-10-09 09:00:00 +0200
slug: "cs329z-frameworks-orchestration"
description: "基于 Stanford CS 329Z Lecture 5，梳理 DSPy、LangGraph、Agent Harness、OpenHands、Pi Agent、OpenClaw、Meta-Harness、Temporal、MLflow、LangSmith、Langfuse 与 Shepherd 在 Agent 系统中的职责边界。"
categories: [AI Agents]
tags: [AI Agents, Agent Harness, Orchestration, LangGraph, DSPy, Temporal, Observability, Meta-Harness]
toc: true
---

一个模型能调用工具，并不等于我们已经拥有一个可以上线的 Agent。

真正的 Agent 系统还需要回答一系列工程问题：状态保存在哪里？失败后从哪一步恢复？上下文怎样重建？工具权限如何控制？长任务由谁调度？每一步如何追踪？系统变慢、变贵或答错时，又该怎样定位原因？

这些问题横跨不同层次，常被笼统地塞进“Agent Framework”这个词里。更清晰的理解方式是把系统拆开：

```text
模型与数据
    ↓
LLM Program / Workflow        决定调用逻辑
    ↓
Agent Harness                 提供工具、记忆、上下文与执行环境
    ↓
Durable Orchestration         让长任务能重试、恢复并跑到底
    ↓
Telemetry + Evals             让系统可观察、可比较、可改进
```

本文根据我的 **Stanford CS 329Z: Engineering AI Agents** 笔记中 Lecture 5 的内容整理。重点不是教你押注某个框架，而是建立一张架构地图：每一层解决什么问题，什么时候值得引入，以及为什么同一个模型放进不同 Harness，最终能力可能差很多。

<!--more-->

> **同课程笔记**：[从 RAG 到 Agentic RAG：检索、重排与闭环决策](/post/cs329z-rag-agentic-retrieval/)

## 1. AI 系统的三个支柱

在讨论框架之前，先把完整 AI 系统抽象为三个支柱：

1. **Data**：训练数据、Rollout、Demonstration、Human Feedback，以及运行时检索到的内容；
2. **System or Model**：语言模型、Compound AI System、Workflow 或 Agentic System；
3. **Evaluation + Metric**：Pass Rate、Exact Match、LLM Judge、成本、延迟、安全性与稳定性。

![AI 系统的三个支柱：数据、系统或模型、评测与指标](/img/posts/cs329z-frameworks-orchestration/three-pillars.webp)

这张图的重要之处在于：**模型只是系统的一部分，系统也只有放进评测闭环后才有可比较的意义。**

如果只换模型、不固定数据和任务，无法判断提升来自哪里；如果只搭工作流、不记录成本和失败轨迹，也很难知道系统是否真的变好。框架选择最终必须回到同一组真实任务与指标上。

## 2. Framework Landscape：先分层，再选工具

Lecture 5 将 Agent 技术栈分成几层：最底层是模型接口，中间是 Workflow 或 Compound AI System，再往上是拥有控制流自主权的 Agent；可靠性与可观测性则横跨整个系统。

![AI Agent 的 Framework Landscape：模型、工作流、Agent、可靠性与可观测性](/img/posts/cs329z-frameworks-orchestration/framework-landscape.webp)

可以把常见工具放进下面这张职责表：

| 工具或类别 | 主要职责 | 它在回答的问题 | 典型用途 |
| --- | --- | --- | --- |
| Model API | 提供推理能力 | “用哪个模型生成或判断？” | OpenAI、Anthropic、LiteLLM 等接口 |
| DSPy | 优化 LLM Program | “怎样让这组模块和 Prompt 表现更好？” | RAG、QA、Reasoning、Few-shot 选择、Prompt Optimization |
| LangGraph | 编排状态和控制流 | “Agent 下一步做什么，状态怎样流转？” | 分支、循环、Tool Use、Human-in-the-loop、Multi-agent |
| Agent Harness | 提供实际运行环境 | “模型能看到什么、能做什么、怎样持续工作？” | 编码 Agent、Computer-use Agent、长期个人助手 |
| Temporal | Durable Execution | “任务跑很久、崩溃或超时后怎样继续？” | Retry、Timeout、异步任务、Crash Recovery |
| MLflow / LangSmith / Langfuse | Telemetry 与实验管理 | “这次运行发生了什么，为什么变慢或失败？” | Trace、成本、延迟、数据集、评测、生产监控 |

这里最容易犯的错误，是让一个框架承担所有职责。例如，LangGraph 可以表达循环和状态转换，但这不自动等于跨进程崩溃恢复；Temporal 能保证工作流可靠执行，却不会替你设计 Agent 的上下文与工具；Langfuse 能记录 Trace，也不会自动改善任务成功率。

## 3. DSPy、LangGraph 与 Temporal 解决的是不同问题

### 3.1 DSPy：优化 LLM Program，而不是手调每一句 Prompt

DSPy 把一次 LLM 调用视为带输入输出签名的模块，再根据训练样例与评价指标优化 Prompt、Few-shot Demonstrations 或模块组合。

它关注的核心是：

```text
固定任务与指标
      ↓
尝试不同 Prompt / Examples / Program 配置
      ↓
找到表现更好的 LLM Program
```

因此，DSPy 更接近“编译和优化 LLM Program”，而不是负责长任务的生命周期。

### 3.2 LangGraph：把 Agent 表达为有状态图

LangGraph 适合把 Agent 写成节点、边、条件分支和循环：

```text
User Request
     ↓
Planner ──→ Tool Executor ──→ Evaluator
   ↑               │               │
   └──── revise ───┴── retry ──────┘
```

状态可以随着图流转，节点可以由模型、工具或人工审批执行。它主要解决的是**应用层控制逻辑**：什么时候调用工具、什么时候循环、什么时候等待用户、什么时候结束。

### 3.3 Temporal：确保已经设计好的流程可靠跑完

Temporal 关心的不是模型该怎样推理，而是执行层可靠性：Activity 失败如何重试，Worker 重启后如何恢复，长时间等待如何保持状态，以及一个持续数小时甚至数天的 Workflow 怎样继续运行。

最简洁的区分是：

> LangGraph 主要描述“下一步做什么”；Temporal 主要保证“无论中间发生什么，这个流程都能从正确的位置继续”。

两者可以组合，而不是只能二选一。

## 4. 什么是 Agent Harness？

Agent Harness 是包在模型外面的运行系统。它决定模型能使用哪些工具、记住哪些历史、如何构建上下文、如何与环境交互，以及在成功、失败或卡住时如何结束。

![Agent Harness 的组成：Planning、Memory、LLM Core、Tools、Actions 与 Environment](/img/posts/cs329z-frameworks-orchestration/agent-harness-anatomy.webp)

一个典型 Harness 至少包含：

- **Planning & Reasoning**：任务分解、下一步决策与反思；
- **Memory**：会话历史、工作记忆与长期记忆；
- **Context Management**：选择哪些文件、工具结果和历史发送给模型；
- **Tools**：读取、编辑、Shell、检索、浏览器或业务 API；
- **Execution Environment**：终端、沙箱、桌面系统、数据库或真实设备；
- **Control & Safety**：权限、审批、预算、停止规则与回滚能力。

一个好的 Harness 不是工具越多越好，而是在四个目标之间找到平衡：

```text
Task Success  ↔  Cost  ↔  Latency  ↔  User Control
```

这个平衡没有统一答案。自动补全代码与修改生产数据库，即使使用同一个模型，也应该拥有完全不同的工具、权限和审批策略。

## 5. 三种 Harness 哲学：OpenHands、Pi Agent 与 OpenClaw

Lecture 5 用三个系统展示 Harness 设计空间。它们不是单纯的功能多少之争，而是对状态、工具、自治程度和用户控制做出了不同选择。

### 5.1 OpenHands：事件历史与持久终端

OpenHands 的思路更像完整的软件工程运行环境：

- 每一步保存为事件，磁盘上一条事件对应一个 JSON 记录；
- 每次调用模型时，根据事件重新构建消息；
- 用持久化的 `tmux` Session 保存终端状态，所以工作目录、环境变量和 Virtualenv 可以跨命令延续；
- 检测重复行动与重复结果，连续卡住时主动停止，例如同一动作与结果重复四次。

事件日志使执行过程更容易重放和调试；持久终端则让 Agent 操作的环境连续存在。但更完整的环境也意味着更多状态和安全边界需要管理。

### 5.2 Pi Agent：极简工具与树状历史

Pi Agent 走的是极简路线：

- 只保留 `read`、`write`、`edit` 和 `bash` 四个基础工具；
- System Prompt 控制在 1,000 Tokens 以内；
- 不额外提供权限系统，进程继承启动它的权限；
- 历史不是只能向前追加的列表，而是一棵可以回到旧节点并建立分支的树；
- 有意不加入 Plan Mode 与 Sub-agent Tool。

这种设计相信，少量通用原语也能组合出复杂能力。优点是系统简单、上下文开销小；代价是隔离和授权必须由外部运行环境负责。

### 5.3 OpenClaw：长期在线的个人 Agent

OpenClaw 更强调长期存在和主动运行：

- 通过 Heartbeat 定期唤醒，例如每 30 分钟执行一轮；没有事情时返回 `NO_REPLY`；
- 使用一个长期运行的 Gateway 统一拥有聊天渠道；
- 将 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`USER.md` 与 `MEMORY.md` 注入上下文，构建 Agent 的身份与用户关系；
- 通过夜间后台任务读取当天笔记，把值得保留的内容整理进长期记忆。

与一次性编码任务相比，这类 Agent 更关心生命周期、身份连续性、主动触发和记忆整理。

| 设计维度 | OpenHands | Pi Agent | OpenClaw |
| --- | --- | --- | --- |
| 核心场景 | 软件工程任务 | 极简编码 Agent | 长期个人助手 |
| 状态表示 | Event Log | 树状会话历史 | 长期 Gateway + Markdown 记忆 |
| 执行环境 | 持久终端 | 四个基础工具 | 多聊天渠道与定时任务 |
| 主要取舍 | 可重建、可调试，但系统较重 | 简单、Token 少，但依赖外部权限 | 主动与连续，但生命周期管理更复杂 |

## 6. 同一个模型，换 Harness 就可能换一种能力

模型评测常把模型名称当作唯一自变量，但 Agent 的表现还取决于 Prompt、工具定义、上下文选择、终端状态、错误恢复和停止规则。

Lecture 5 展示的 Terminal-Bench 2 对比中，同一个模型分别放入 Pi、Codex 和 Claude Code 等 Harness 后，成功率和每次 Rollout 成本都出现明显差异。

![同一模型在不同 Agent Harness 下的成本与成功率差异](/img/posts/cs329z-frameworks-orchestration/harness-performance.webp)

这带来两个直接结论：

1. “某模型的 Agent 能力”通常不是纯模型属性，而是 **Model × Harness × Environment** 的联合结果；
2. 更换 Harness 后，原来的模型排名可能变化，所以不能只拿模型榜单代替系统评测。

## 7. Meta-Harness：让系统自动搜索 Harness 设计

既然 Harness 包含大量人工选择——工具集合、Prompt、Context Policy、停止策略——那么这些选择本身也可以被搜索和优化。

Meta-Harness 的基本循环是：

1. 读取候选系统源码、执行轨迹与已有评价；
2. 提出新的 Harness 代码或配置；
3. 将新 Harness 与 LLM 组合，在任务集上运行；
4. 保存代码、Reasoning Trace、Evaluation Score 和日志；
5. 根据结果继续提出下一轮候选。

![Meta-Harness 自动提出、执行和评测 Harness 的搜索循环](/img/posts/cs329z-frameworks-orchestration/meta-harness-loop.webp)

笔记中的实验结果显示，在所展示的任务与设置下，Meta-Harness 能以较少轮次找到优于若干人工默认方案的配置；Terminal-Bench 2 图中，搜索得到的 Harness 也超过了对比的手工配置。

![Meta-Harness 的搜索过程与 Terminal-Bench 2 对比结果](/img/posts/cs329z-frameworks-orchestration/meta-harness-results.webp)

这里真正值得关注的不是某个单一分数，而是设计范式的变化：过去由工程师手工调整的 Agent Scaffold，开始成为可以被自动生成、执行和评测的搜索空间。

但 Meta-Harness 也会放大评测集偏差。若任务集不能代表真实用户，自动搜索只会更快地过拟合错误目标。

## 8. 为什么 Agent 需要 Durable Orchestration？

Agent 能持续处理的任务越来越长。运行几分钟时罕见的网络抖动、进程崩溃、API 限流和人工等待，在持续数小时后都会变成常态。

Temporal 将执行拆成两类对象：

- **Activity**：真正产生外部效果的执行单元，可能失败，可以重试；
- **Workflow**：连接 Activity 的控制逻辑，其历史与状态被持久化。

![Temporal 的执行模型：Client、Task Queue、Workflow Worker、Activity Worker 与持久化状态](/img/posts/cs329z-frameworks-orchestration/temporal-execution-model.webp)

在图中的执行模型里，Client 提交任务；Server 维护 Workflow Queue、Activity Queue 与 Execution History；Workflow Worker 决定下一步，Activity Worker 执行外部操作。Worker 短暂消失时，系统仍可根据历史恢复，而不是从 Prompt 第一行重新开始。

对 Agent 而言，Durable Execution 特别适合：

- 需要等待人工审批的操作；
- 跨多个外部 API 的长任务；
- 有 Retry、Timeout 与 Backoff 的工具调用；
- 定时唤醒或持续数天的研究与监控任务；
- 进程重启后必须保留进度的业务流程。

需要注意，重试不是无条件重复。发送邮件、支付、创建工单等有副作用的 Activity，必须设计幂等键或明确的补偿动作，否则“可靠重试”反而可能制造重复操作。

## 9. Telemetry：没有 Trace，就没有可调试的 Agent

传统请求通常只有输入、响应和一段日志；Agent 一次运行可能包含几十次模型调用、工具调用、检索、分支和重试。仅保存最终答案，几乎无法回答：

- 是模型推理错了，还是工具返回错了？
- 成本为什么突然增加？
- 哪一步开始偏离目标？
- 同一任务为什么上次成功、这次失败？

Lecture 5 中几类工具的侧重点如下：

| 工具 | 更关注什么 | 适合记录的内容 |
| --- | --- | --- |
| MLflow | 实验、模型与评测生命周期 | 参数、模型版本、数据集、Metrics、Prompt/Agent Runs |
| LangSmith | LangChain / LangGraph 开发生命周期 | Trace、Dataset、Evaluation、线上监控 |
| Langfuse | LLM 应用可观测性 | Trace、Token 成本、延迟、用户反馈、Dashboard；支持自托管 |

真正有用的 Trace 不只是按时间排列日志，而应该能关联：用户目标、模型输入输出、工具参数与返回、状态变更、错误、重试、成本、延迟、最终评测结果和版本信息。

换句话说，Telemetry 不是上线后再补的 Dashboard，而是 Agent 架构的一部分。

## 10. Shepherd：让执行结果可检查、可逆转

有些 Agent 任务会修改代码、文件或工作区。若每一步都直接永久写入真实环境，即使有完整日志，也可能已经来不及恢复。

[Shepherd](https://github.com/shepherd-agents/shepherd) 提供的是更接近 Runtime Substrate 的思路：把 Agent 执行过程保存成 **durable、inspectable、reversible** 的 Execution Trace，并把工作区结果留给用户审核。

用户可以在真正应用前选择：

- `accept / apply`：接受并应用；
- `reject / discard`：拒绝并丢弃；
- `rollback`：回到之前状态；
- 修改后重新执行。

这里的关键是把“Agent 已经计算出一个结果”与“结果已经永久改变环境”分开。对于代码修改、基础设施配置和高风险业务操作，可逆性与监督能力往往比再提高一点单次成功率更重要。

## 11. 用 Evals 决定架构，而不是追逐框架热度

框架选择必须由评测支撑。至少需要同时观察：

- **任务质量**：准确率、Pass Rate、最终环境状态；
- **可靠性**：重复运行一致性、失败恢复率、卡死率；
- **效率**：Token、API、计算成本与端到端延迟；
- **安全性**：权限越界、错误副作用、Prompt Injection 与敏感信息泄露；
- **用户控制**：需要多少次确认，是否可以中断、审核和回滚。

如果构建的是某个特定领域 Agent，只追逐 SWE-bench 等通用榜单并不够。更重要的是从真实用户任务中建立自定义数据集：包括常见路径、边界条件、外部服务失败、信息不足和需要拒绝执行的案例。

一个实用的选型顺序是：

1. 先用最小工具集合和真实任务集建立 Baseline；
2. 如果 Prompt 与示例不稳定，再考虑 DSPy 一类优化层；
3. 如果出现分支、循环与人工审批，再引入状态图编排；
4. 如果任务跨进程、跨小时并必须恢复，再增加 Durable Workflow；
5. 从第一天记录 Trace、成本、版本和评价结果；
6. 只有在固定评测集上带来收益时，才保留新的框架层。

## 结语：模型是引擎，Harness 决定它怎样工作

Lecture 5 最重要的启发，是把 Agent 能力从“模型名称”中拆出来：

```text
Model       提供推理与生成能力
Workflow    表达任务逻辑
Harness     定义工具、上下文、记忆和执行环境
Orchestrator 保证长任务可靠推进
Telemetry   让每一步可观察、可调试
Evals       决定系统是否真的变好
```

Agent 工程不只是让模型偶尔完成一次任务，而是让整个系统可以反复运行、被观察、从失败中恢复、接受评测并持续改进。

当任务从一次模型调用变成几十步、几小时甚至长期在线的过程时，真正决定产品质量的，往往不再只是模型，而是围绕模型搭建的 Harness 与运行基础设施。
