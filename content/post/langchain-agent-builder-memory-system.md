---
title: "LangChain Agent Builder 的记忆系统"
date: 2026-02-21
slug: "langchain-agent-builder-memory-system"
description: "梳理 Agent Builder 如何用文件表示记忆、通过自然语言反馈更新行为，以及 AGENTS.md、Skills、虚拟文件系统、glob 与 grep 各自解决什么问题。"
categories: [AI Agents]
tags: [AI Agents, Agent Memory, LangChain, Deep Agents, AGENTS.md, Skills, Context Engineering]
toc: true
---

一个会议助手第一次把摘要写成大段文字，你纠正它：“以后用列表。”下一次整理另一场会议，它仍然沿用这个要求，而不需要重新提醒。

这类记忆不只是保存“聊过什么”，还会改变“以后怎样工作”。LangChain 在 Agent Builder 中采用的方式，是把指令、技能和知识表示为文件，让反馈能够变成下次运行时仍然可用的规则。

<!--more-->

本文根据 LangChain 的 [How we built Agent Builder’s memory system](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system) 整理。原文发布于 **2026 年 2 月 21 日**；文中的产品状态与未来计划均按当时的描述展开。文件示例用于解释机制，不是 Agent Builder 的完整内部配置。

## 1. 为什么先为重复任务做记忆？

通用聊天助手可能上一轮讨论旅行，下一轮处理代码，两次任务之间未必有很多可复用的经验。专门整理会议、处理邮件或筛选候选人的 Agent，面对的却经常是同一种工作。

对重复任务而言，一次纠正很可能在下一次仍然有效。如果每次会议都要重新说明摘要格式、每次处理客户资料都要重新强调脱敏，用户承担的就不只是交代任务，还包括反复修正同样的问题。

记忆在这里要完成的，是把一次交互中的有效反馈变成持续可用的工作约定。它不需要先成为一个了解用户全部生活的系统，也能在一个具体流程里产生价值。

## 2. 记住事实，与记住做法，是不同的事

原文借用 CoALA 的分类，区分三类长期记忆：

- **Semantic Memory，语义记忆**：事实与知识，例如某个客户属于哪个行业。
- **Procedural Memory，程序性记忆**：怎样完成任务、遵循哪些规则，例如输出摘要前先区分决定与讨论。
- **Episodic Memory，情景记忆**：过去具体发生过什么，例如某次任务的交互与执行经过。

![原文中的记忆类型示意：程序性、语义与情景长期记忆及其与工作记忆的关系](/img/posts/langchain-agent-builder-memory/coala-memory.png)

图源：[LangChain 原文](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)。图中上方的三类长期记忆，对应这里讨论的程序性、语义与情景记忆。

“客户的名称是什么”和“客户会议需要隐藏哪些信息”，用途并不相同。前者帮助理解对象，后者影响执行方式；某次会议的完整对话，则又不同于从对话中提炼出来的规则。

因此，给所有历史记录建立一个搜索入口，还不等于已经形成了行为记忆。系统还需要知道：哪些内容只是当时发生的事，哪些值得在以后继续使用。关于这几类记忆的关系，也可以结合 [Agent Memory Architectures](/post/cs329z-agent-memory-architectures/) 阅读。

## 3. 为什么把记忆表示为文件？

文件提供了一种模型和人都比较容易理解的组织方式：列出目录、查找内容、读取相关文件，再修改其中的一段文字。不必为每一种知识都设计一种新的专用操作。

下面是一种便于理解的目录示意：

```text
agent-memory/
├── AGENTS.md                 核心职责与通用行为要求
├── skills/
│   └── meeting-summary/
│       └── SKILL.md          会议整理的专门流程
├── subagents/                子 Agent 的定义
├── tools.json                可用工具的配置
└── knowledge/
    └── customer-notes.md     客户与业务资料
```

这些文件不是同一种信息的不同名字：

| 载体 | 主要回答的问题 |
| --- | --- |
| `AGENTS.md` | 这个 Agent 总体要做什么、遵循什么要求？ |
| `SKILL.md` 及其支持文件 | 遇到某项具体任务，应怎样处理？ |
| 子 Agent 定义 | 哪部分工作交给另一个执行者？ |
| `tools.json` | 哪些外部工具可以使用？ |
| 其他知识文件 | 完成任务需要参考哪些事实与材料？ |

[AGENTS.md](https://agents.md/) 本身是提供上下文与指令的 Markdown 约定。[Agent Skills](https://agentskills.io/home) 则把任务说明、脚本、参考资料等组织成可复用的能力包。它们能够承载不同种类的知识，不能只根据文件名认定所有内容都属于同一类记忆。

![LangChain 原文将不同记忆映射为指令、技能、知识与对话文件的示意图](/img/posts/langchain-agent-builder-memory/memory-filesystem.png)

图源：[LangChain 原文](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)。这是原文的概念映射：图中写的是 `mcp.json`，但正文说明实际采用自定义 `tools.json` 来选择 MCP 工具子集；图中的情景记忆文件也属于当时的规划，并非已经上线。

### 看到的是文件，底层可以是数据库

原文中的文件实际保存在 **Postgres**，再通过虚拟文件系统提供给 Agent。模型操作的是路径和文本，后端负责把操作转换成存储的读写。

```text
Agent
  │ 列目录、搜索、读取、编辑
  ▼
文件系统接口：路径与文件内容
  │ 后端负责存取
  ▼
Postgres 中的持久化数据
```

文件形式解决的是交互与组织方式，数据库解决的是持久化。两者并不冲突。[Deep Agents 的 backend 文档](https://docs.langchain.com/oss/python/deepagents/backends)也区分了线程内状态、本地文件与可跨会话使用的存储后端。

这一区分很重要：**能写文件，不等于文件一定能跨会话保留。** 如果底层只有当前线程的临时状态，下一段独立会话仍然可能读不到它。

原文还展示了一个内部使用的 LinkedIn 招聘 Agent：主指令、搜索子 Agent、工具配置与不同岗位的招聘要求，都可以在同一个文件视图中查看和维护。

![Agent Builder 中招聘 Agent 的实际记忆文件界面，包含主指令、子 Agent、工具配置与岗位资料](/img/posts/langchain-agent-builder-memory/recruiter-memory-files.png)

图源：[LangChain 原文](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)。这是产品实例截图，与上面的示意目录不同。

## 4. 一次纠正，怎样变成下一次的行为？

可以把原文的会议助手例子拆成两件事：当前回答需要调整，未来的规则也需要调整。

第一次，助手输出段落式摘要。用户希望以后改用列表，于是工作说明中保存一条持续的格式要求。例如：

```markdown
# 摘要要求

- 使用要点列表组织摘要。
```

下一次任务不能只依靠模型“自己想起来”，而要让保存的规则重新进入可用上下文。随后，用户又要求把行动项集中放在末尾，就可以继续合并成：

```markdown
# 摘要要求

- 使用要点列表组织摘要。
- 在末尾单独整理行动项。
```

这里发生的不是重新训练模型，而是更新了模型后续运行时能够读取的外部规则。[Deep Agents 的记忆文档](https://docs.langchain.com/oss/python/deepagents/memory)将这个过程拆为指定记忆路径、加载记忆，以及在权限允许时编辑记忆。

完整链路因此包含：识别值得保留的反馈、生成修改、经过必要的校验与批准、持久化，以及后续读取。少了最后一步，即使磁盘或数据库里已经存了规则，也不一定影响下一次回答。

## 5. 怎么知道该改 AGENTS.md，而不是别的文件？

不是文件名自带判断能力，而是系统先约定文件职责，再让模型根据这些职责选择位置。

“以后摘要使用列表”影响这个助手持续的输出方式，因而适合放进通用行为要求；一套复杂的会议处理流程，可以放进对应 skill；客户的产品资料，则更适合放进知识文件。

如果一个系统采用下面这样的分工，模型才有依据做选择：

```text
通用行为要求 → AGENTS.md
任务专门方法 → 对应的 skill
事实与业务材料 → 相应知识文件
仅本次有效的信息 → 当前任务上下文
```

这是一种解释机制的分工示意，不是原文公开的系统提示词。原文并没有披露完整提示词，也不能据此断言内部存在一条固定的关键词判断规则。

同样，“这次只保留三项”不应自动等同于“以后永远只保留三项”。选文件之前，还需要判断反馈是临时要求，还是持续规则。

`AGENTS.md` 也不是唯一可能的名字。当前 Deep Agents 文档同样展示了使用 `preferences.md` 的方式。真正起作用的是**约定放在哪里、怎样更新、以后怎样加载**，而不只是文件名称。

## 6. glob 与 grep 怎样配合找记忆？

它们解决两个不同的问题：

- **glob 按文件名和路径找文件。** 例如查找所有 Markdown 文件。
- **grep 在文件内容中找文字。** 例如查找哪些文件提到摘要规则。

以一种常见的匹配写法为例：

```text
AGENTS.md        找这个特定文件
skills/*/SKILL.md 找 skills 下一级目录中的技能说明
**/*.md          递归匹配 Markdown 文件，具体支持以工具为准
```

找到文件后，还可以按内容搜索：

```bash
grep -n "摘要" AGENTS.md
```

上面是命令行示例，不是 Agent Builder 工具调用的固定语法。实际过程可以是先缩小文件范围，再定位相关段落，最后读取上下文，而不是把所有文件一次性塞进模型。

关键词搜索也有边界。文件写的是“脱敏”，用户问的是“隐藏个人信息”，字面匹配就可能漏掉关联。语义搜索有机会改善这类召回，但仍然不能代替对内容与适用范围的判断。

## 7. 为什么文件式记忆仍然不好做？

### 判断记不记、记到哪里，需要清楚的指令

模型可能漏记重要反馈，也可能把临时要求记成长期偏好；还可能让 `AGENTS.md` 越来越大，把本该独立的任务说明都堆在一起。文件工具只提供操作能力，不会自动提供正确的记忆策略。

Skills 的按需加载提供了一种组织方式：先知道有哪些能力，相关时再读详细说明。这样可以把通用规则与专门流程分开，而不要求每次都加载全部内容。[Skills 文档](https://docs.langchain.com/oss/python/deepagents/skills)

### 改完不代表文件可用

Markdown 说明比较自由，工具配置和 skill 元数据却有格式要求。生成了文件，不等于生成了有效配置。

原文因此强调校验：不满足格式要求时，把错误返回给模型修正，而不是把无效文件当成一次成功的记忆更新。能保存是一层，能被后续系统正确读取又是一层。

### 添加个案，不等于总结出规则

下面是一个自拟的邮件助手例子：连续遇到几个推销邮件发送者后，记忆可能变成一个不断增长的名单。但用户真正想表达的，也许是“不处理未经邀请的推销邮件”。

前者记住了对象，后者概括了适用条件。整理记忆不能只追求写入数量，还需要合并重复内容、处理冲突，并在证据足够时提炼规则。反过来，也不能把一次个案过度推广成永久禁令。

### 能修改记忆，不等于可以随意修改

原文描述的默认方式，是记忆编辑需要人工批准。这能降低把不可信内容写成长期指令的风险。

网页、邮件或工具结果可以是待处理的数据，却不能因为出现了命令式语句，就自动成为用户授权。读取资料的权限、修改偏好的权限，以及改变工具配置的权限，也不应被当成同一回事。当前记忆文档对只读政策、可写偏好和作用域有进一步说明。

## 8. 这怎样改善 Agent 的构建体验？

### 无代码，不必再学一套陌生规则

有些无代码工具只是把编程换成节点、分支、变量映射和平台专用表达式。任务复杂后，用户仍然要掌握一套特殊的描述语言，也就是 DSL。

文件方式则更接近写工作说明。用户把“摘要使用列表”“行动项放在末尾”表达出来，系统负责让这些要求参与执行。工具连接仍然需要配置，底层框架仍然承担计划与执行，并不是一份 Markdown 就能自动实现任意业务。

这里的可扩展性，主要指说明、能力与知识更容易拆分和维护，而不是自动获得更高吞吐量。

### 构建过程变成试用、反馈与修正

很多行为只有运行后才能看见。用户起初未必能预先写好所有规则，却很容易指出某次输出哪里不合适。

有了记忆，反馈除了修正当前结果，还能在确认适用范围后更新后续规则。构建 Agent 不再只是一次性填完配置，而是通过使用逐步完善工作说明。这里的“更新自己”，主要指更新外部指令与记忆，并非修改基础模型权重。

### 文件更便于迁移，但迁移仍有条件

Markdown 和 JSON 易于查看、导出和版本管理，采用共同约定也更容易在不同运行框架之间复用。

但复制文件不等于复制了整个 Agent：目标环境还需要支持相应格式，提供工具连接、身份验证、权限和加载机制。可迁移的是表达方式与材料，实际运行能力仍要由目标环境接上。

## 9. 原文当时还计划补什么？

原文的路线图包括以下方向，不能直接视为已经完成的功能：

| 方向 | 要补上的能力 |
| --- | --- |
| 情景记忆 | 不只保留提炼后的规则，也能查回过去的具体经过 |
| 后台整理 | 离开当前任务后，汇总多次会话、合并经验 |
| 显式记忆入口 | 用户可以主动要求回顾并保存重要内容 |
| 语义搜索 | 不完全依赖文件名或关键词匹配 |
| 更多作用域 | 区分 Agent、用户和组织层面的记忆 |

这些方向分别对应“保存什么、什么时候整理、怎样找到、对谁生效”。文件系统只是统一的入口，完整的记忆能力仍然需要这些机制共同工作。

![实时路径在回复用户前更新记忆，后台方式将记忆整理放到独立流程](/img/posts/langchain-agent-builder-memory/hot-path-memory.png)

图源：[LangChain 原文](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)。左侧是在任务过程中更新记忆，右侧是把整理放到独立后台流程。图中的“30 minutes later”是时序示意，不是固定运行频率；后台整理在原文发布时仍属于未来方向。

## 10. 把整套机制连起来

Agent Builder 的方案可以概括为：用文件组织规则与知识，用可持久化的后端保存，再通过加载、搜索和编辑让它们参与任务。

它的关键不只是“把记忆放到 `AGENTS.md`”，而是让反馈经过判断与确认之后，成为下一次可以正确找到并应用的规则。文件保存了内容，提示词和运行框架决定这些内容怎样进入行动。

## 来源与延伸阅读

- [LangChain：How we built Agent Builder’s memory system](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)
- [Deep Agents：Memory](https://docs.langchain.com/oss/python/deepagents/memory)、[Backends](https://docs.langchain.com/oss/python/deepagents/backends)、[Skills](https://docs.langchain.com/oss/python/deepagents/skills)
- [AGENTS.md](https://agents.md/) · [Agent Skills](https://agentskills.io/home)
- [CoALA：Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)
- 站内文章：[Agent Memory Architectures](/post/cs329z-agent-memory-architectures/) · [Context Management Patterns](/post/cs329z-context-management-patterns/)
