---
title: "CS 329Z：Context Management Patterns"
date: 2026-10-12 22:25:07 +0200
slug: "cs329z-context-management-patterns"
description: "整理 Stanford CS329Z Lecture 6 的上下文管理章节：Persistent Event Log、Memory Offloading、Compaction、Observation Masking、Context Isolation 与 Progressive Disclosure，并解释它们如何组合支撑长任务。"
categories: [AI Agents]
tags: [AI Agents, Context Engineering, Context Management, Agent Harness, Memory, Compaction, Observation Masking]
toc: true
---

一个编码 Agent 刚开始修 Bug 时，往往很清楚目标：找到原因、修改代码、运行测试。几十轮之后，上下文里却堆满了搜索结果、文件片段、终端日志和已经放弃的方案。用户最初提出的约束仍在历史里，但下一次决策未必还能正确利用它们。

长任务需要持续积累信息，也需要主动整理信息。**Context Management 决定每次调用模型时，哪些内容进入上下文、哪些保存到外部，以及哪些细节暂时隐藏。**

Stanford CS 329Z Lecture 6 把这件事归纳为五种模式：

```text
Persistent Event Log   保存完整事件，按需重建输入
Memory Offloading     将知识移到记忆或文件
Compaction            用摘要替换较长的历史
Observation Masking   隐藏旧工具输出，保留行动线索
Context Isolation     为子任务建立独立上下文
```

本文围绕这五种模式展开，并用同一个修 Bug 场景说明它们怎样组合。内容以讲义的 Context Management 章节为主；文中的任务摘要模板、组合流程与评测建议是我的工程化整理。

<!--more-->

> **同课程文章**：[Frameworks & Orchestration：从 Agent Harness 到可靠执行与可观测性](/post/cs329z-frameworks-orchestration/) · [从 RAG 到 Agentic RAG](/post/cs329z-rag-agentic-retrieval/)

## 1. 两个原则：保持专注，保留连续性

讲义先给出两个原则：**Focus the Context** 与 **Preserve Continuity**。这两个目标需要同时满足。

### 保持专注：只带入当前任务真正需要的信息

模型能够接收更长的 Context Window，意味着可输入的容量增加了；实际任务中的信息筛选工作仍然存在。

一次工具调用可能返回几千行测试日志，但下一步决策可能只需要失败的测试名、异常位置和一段堆栈。历史越长，这类冗余内容越容易遮住重要信息，也会增加处理成本。

对修 Bug 的 Agent 来说，当前窗口应该优先保留：用户目标、有效约束、相关代码、最新测试结果，以及尚未解决的问题。

### 保留连续性：压缩之后还能接着工作

如果只保留最近几轮，Agent 可能忘记“不能修改公共 API”，也可能再次尝试已经失败的修复。

因此，整理上下文时要保留的不只是事实，还包括任务状态：

- 用户希望完成什么，以及最近追加的要求；
- 哪些约束仍然有效；
- 已经完成和验证了哪些步骤；
- 哪些方案被排除，依据是什么；
- 哪些事项未完成，下一步应该检查什么。

一个合格的压缩结果，应让接手任务的模型无需重新探索就能继续推进。

### 连续性与 KV Cache 是两个层面

讲义也提到尽量保留 KV Cache。这里需要区分**语义连续性**与**计算复用**。

语义连续性由目标、约束和进度信息来维持。常见自回归推理中的 KV Cache，则依赖可复用的 Token 前缀及其计算条件。重写前面的历史，通常会使后续部分无法直接沿用旧缓存；保留稳定前缀、向后追加，更有利于缓存复用。

Compaction 可能减少后续输入长度，同时付出摘要调用和部分重新 Prefill 的成本。选择触发时机时，要一起考虑上下文质量与端到端开销。

## 2. Persistent Event Log：历史完整保存，模型输入按需构建

Persistent Event Log 的思路，是把 Agent 的执行过程记录为持续追加的事件流，再从事件中构建每次模型调用的输入。

```text
User Message / Agent Action / Tool Result
                     ↓
             Append-only Event Log
                     ↓
        Select → Mask → Summarize → Format
                     ↓
                Next LLM Input
```

讲义以 OpenHands 为例：系统保留发生过的事件，即使模型输入需要调整，原始历史仍可以保持不变。每次调用模型时，都从 Event Log 重建上下文；外部观察者也可以通过事件监听运行状态。

![OpenHands 的 Event Stream：用户界面、Agent、事件历史与执行环境之间的关系](/img/posts/cs329z-context-management/event-log.webp)

*讲义第 62 页；原图来源为 OpenHands 论文。*

在修 Bug 的场景里，完整日志可以保存第一次测试输出、修改 Patch、第二次测试结果。模型当前只看到最新失败和必要的行动记录；需要复查时，再定位原始事件。

这样做使审计、调试与上下文裁剪可以同时成立。不过，**事件可回放不代表外部操作可以安全重做**。重建模型输入与重新发送邮件、修改数据库是两回事；后者仍需要幂等或恢复机制。

## 3. Memory Offloading：把知识放到窗口之外

Memory Offloading 将值得保留的信息写入外部记忆或文件，让当前上下文可以删去相应内容。以后需要时，再通过检索或工具读回来。

讲义用 MemGPT 展示这种分层记忆思路：有限的上下文承担当前工作，外部存储承担长期信息，通过读写把两者连接起来。[MemGPT 论文](https://arxiv.org/abs/2310.08560)将其描述为受操作系统分层内存启发的 Virtual Context Management。

![MemGPT 示例：将信息写入记忆，在后续对话中按需召回](/img/posts/cs329z-context-management/memory-offloading.webp)

*讲义第 64 页。*

在工程上，我会区分三种外部状态：

| 类型 | 保存什么 | 生命周期 |
| --- | --- | --- |
| Task State | 任务目标、当前步骤、已验证结果、待办事项 | 当前任务 |
| Scratchpad / 工作笔记 | 排查记录、候选方案、证据路径 | 当前会话或项目 |
| Long-term Memory | 经确认的用户偏好、长期有效的知识 | 跨会话 |

例如，测试日志可以保存在文件里，窗口中只保留失败摘要与路径。已经定位的调用链可以写入工作笔记。单次测试失败则不适合直接成为长期记忆，因为代码和环境还可能变化。

外置之后，要保留足够的索引信息。只有“之前见过一个错误”很难召回；记录测试名、文件位置、时间、版本与证据路径，才有机会找回正确内容。

**写入外部存储只是第一步，还要验证后续任务能否正确读取。** 对仍然生效的关键约束，也不能因为“已经存盘”就从当前窗口里全部移除。

## 4. Compaction：把历史压缩成可继续执行的状态

Compaction 使用 LLM 将此前的 Reasoning、Action 和 Observation 压缩成较短描述，再与近期轨迹一起作为新上下文。

![Compaction：将较早的行动轨迹压缩成 Summary，保留近期完整交互](/img/posts/cs329z-context-management/compaction.webp)

*讲义第 65 页。*

它适合处理历史中有用信息分散、重复内容较多的情况。但摘要质量不能只用压缩率衡量。“讨论过登录问题，已经进行修复”虽然很短，却不足以支持继续工作。

下面是我会给修 Bug 任务使用的结构化摘要示例：

```yaml
goal: 修复登录后偶发的 session 丢失
constraints:
  - 不修改公共 API
  - 保持现有 cookie 行为
verified:
  - 已复现并发请求覆盖 session 的问题
  - 已修改 session_store.py 的更新逻辑
rejected:
  - 单纯增加重试不能消除并发覆盖
pending:
  - 运行并发回归测试
  - 检查 cookie 兼容性
evidence:
  - logs/session-race.txt
next_step: 先运行并发测试，再检查完整测试集
```

摘要应明确区分“已经验证”与“仍是假设”。否则，一次不确定推测经过压缩后，可能变成后续模型确信的事实。

讲义进一步提出，Compaction 本身也可以是 Agentic 的：整理过程可以读取外部记录、补查证据，再生成交接状态。这样能减少遗漏，但会增加调用与调度成本，需要评测收益。

## 5. Observation Masking：先处理最占空间的旧工具输出

Agent 的长上下文里，Observation 往往比 Action 更占空间。一次 `read`、搜索或测试可能返回大量文本，而发起它的工具参数只有几行。

讲义引用的 Raw Agent 分布图中，Observation 占 83.9%，Action 占 6.5%，Reasoning 占 9.6%。这是该实验设置的统计，并非所有 Agent 的固定比例。

![Raw Agent 的 Token 分布：Observation 占据主要部分](/img/posts/cs329z-context-management/token-distribution.webp)

*讲义第 66 页；来源为 The Complexity Trap。*

Observation Masking 利用这个特点：保留早期的行动线索与工具调用结构，把旧输出替换成标记或截断版本，同时保留近期观察。

```text
Action: 读取 session_store.py
Observation: [旧输出已隐藏；可从事件记录或文件重读]

Action: 运行并发回归测试
Observation: [旧日志已隐藏；完整结果保存在 logs/session-race.txt]

Action: 运行最新回归测试
Observation: 保留当前完整输出
```

![Observation Masking 与 LLM Summary：前者遮蔽旧观察，后者概括历史轨迹](/img/posts/cs329z-context-management/observation-masking.webp)

*讲义第 67 页。*

### 它与 Compaction 的差别

Masking 主要执行“隐藏或截断”，通常不需要额外 LLM 调用。Compaction 则通过语义总结保留信息，能够压缩更广泛的历史，但可能遗漏细节或改变含义。

Masking 同样有代价：Agent 记得自己运行过测试，却可能看不到失败原因。因此，要保留工具名、参数、调用关联、输出定位方式，以及仍然影响下一步决策的关键结果。

### 实验说明了什么？

讲义展示了 Gemini 2.5 Flash、其 Thinking 配置和 Qwen3-Coder 480B 的成本与 Solve Rate 对比。Masking 和 LLM Summary 都明显减少了实例成本，质量差异则取决于模型与设置。

![三组模型配置下，Raw Agent、Observation Masking 与 LLM Summary 的成本和解题率对比](/img/posts/cs329z-context-management/masking-evaluation.webp)

*讲义第 68 页；横轴为单实例成本，纵轴为 Solve Rate。*

对应论文 [The Complexity Trap，v3](https://arxiv.org/abs/2508.21433v3)在 SWE-agent / SWE-bench Verified 等设置中发现，简单遮蔽旧观察就能获得有竞争力的成本与表现。因此，面对大量工具日志时，Masking 值得成为先测试的基线；复杂摘要是否带来额外收益，应由任务评测决定。

## 6. Context Isolation：让子任务拥有自己的上下文

当一个任务包含几个相对独立的分支时，主 Agent 没有必要同时承载每个分支的完整探索历史。

Context Isolation 为子任务分配独立上下文，只向主流程返回需要的结论与证据。

![Context Isolation：将子任务放入独立窗口，再汇总必要结果](/img/posts/cs329z-context-management/context-isolation.webp)

*讲义第 69 页。*

例如，主 Agent 负责修复登录 Bug，一个子任务检查 Session 更新逻辑，另一个检查 Cookie 兼容性。主 Agent 接收的是定位结果、相关文件、验证情况与未解决问题。

隔离可以减少上下文串扰，也可能支持并行工作。但拆分和汇总本身有成本；如果子任务遗漏证据，主 Agent 仍然无法判断结论。一个好的返回约定至少应包含：

```text
结论 / 证据位置 / 已验证内容 / 不确定性 / 后续建议
```

上下文隔离也不等于权限隔离。两个 Agent 可以拥有不同消息历史，却仍共享文件系统和凭据；是否需要单独沙箱，是另一项架构决定。

### Progressive Disclosure：需要时再加载

讲义把 Progressive Disclosure 放在这一部分：初始化时先提供能力名称、简短说明和索引，只有当前任务需要时才加载详细指令与资料，例如 Skill Files。

![Progressive Disclosure：按需读取 Skill 文件中的详细内容](/img/posts/cs329z-context-management/progressive-disclosure.webp)

*讲义第 70 页。*

它和子 Agent 隔离相关，但机制不同：子 Agent 隔离把任务放进不同窗口；Progressive Disclosure 控制同一窗口中信息进入的时机。

对于修 Bug 的 Agent，初始输入可以只有工具说明和项目索引。开始运行测试时，再读取测试约定；涉及发布时，再加载发布流程。这能减少无关说明的常驻开销，但要求索引足够清晰，让 Agent 知道何时该读取什么。

## 7. 五种模式怎样组合？

讲义强调，这些策略彼此兼容。一个系统可以保存完整 Event Log，同时对模型输入中的旧 Observation 做 Masking；也可以先把知识写到外部，再压缩历史。

| 模式 | 主要改变什么 | 解决的问题 | 需要留意 |
| --- | --- | --- | --- |
| Event Log | 历史的存储与重建方式 | 可追溯、可重建 | 保存完整不等于输入完整 |
| Memory Offloading | 信息保存的位置 | 跨轮、跨会话保留知识 | 能否正确召回，是否过期 |
| Compaction | 历史的表达形式 | 用少量 Token 维持任务连续性 | 摘要遗漏与假设固化 |
| Observation Masking | 旧工具输出的可见性 | 减少大量历史日志 | 关键证据是否仍可恢复 |
| Context Isolation | 子任务的上下文边界 | 减少不同分支的互相干扰 | 交接质量与协调成本 |

针对前面的编码任务，一个组合流程可以是：

```text
每一步写入 Event Log
        ↓
大输出保存在文件，窗口保留关键结果与定位信息
        ↓
旧 Observation 做 Masking，近期结果完整保留
        ↓
接近预算时，将目标、约束、进度压缩成任务摘要
        ↓
独立调查交给隔离的子任务，详细规则按需加载
        ↓
按需重读证据，继续下一轮决策
```

讲义后面的 Pi 案例也展示了组合方式：Event Log 到 LLM Input 的转换、通过 Skill Files 渐进加载，以及 Compaction。这个例子说明，较少的机制也能组成完整的上下文管理方案，关键在于它们如何衔接。

## 8. 用 Write、Select、Compress、Isolate 检查设计

讲义借用 LangChain 的四类划分，把上下文管理放进更大的设计空间：

![Context Management Taxonomy：Write、Select、Compress 与 Isolate](/img/posts/cs329z-context-management/context-taxonomy.webp)

*讲义第 73 页。*

- **Write**：把信息写到任务状态、Scratchpad 或长期记忆；
- **Select**：选择当前相关的工具、知识和历史记录；
- **Compress**：总结有用内容，裁掉冗余内容；
- **Isolate**：把不同任务的信息分配到不同状态或上下文。

其中，Masking 属于裁剪式压缩，Compaction 属于摘要式压缩；Memory Offloading 连接 Write 与 Select；Progressive Disclosure 则强调按需选择信息。Event Log 是支持这些变换的历史基础设施。

这张分类图能帮助检查一个系统是否只做了“压缩”，却没有解决存储、召回或任务分工。

## 9. 怎样判断上下文管理有效？

更少的 Token 只是一个指标。我的评测重点会是：整理后，Agent 是否仍然完成同一个任务，并保留用户要求。

可以固定任务集，对比 Raw History、Masking、Compaction 和组合策略，同时记录：

| 维度 | 观察什么 |
| --- | --- |
| 任务成功率 | 修改结果与最终测试是否正确 |
| 连续性 | 是否忘记约束、重复失败方案或漏掉待办 |
| 信息恢复 | 能否定位并读回已隐藏的证据 |
| 成本与延迟 | 包括摘要调用、工具重读和重新 Prefill |
| 长程稳定性 | 多次整理之后，任务状态是否仍准确 |

测试中要刻意放入早期约束、很晚才需要的事实、较长日志，以及在中途变更的用户要求。这样才能看出系统是在有效筛选信息，还是碰巧删掉了暂时没用的内容。

对我来说，这一章最有价值的设计原则是：**完整记录保存在合适的位置，当前窗口保留足以支持下一步行动的信息。** Event Log 提供历史，外部记忆与按需读取提供容量，Compaction 和 Masking 控制输入长度，Isolation 控制任务之间的信息边界。它们组合起来，才让 Agent 有机会在长任务中持续工作。

## 来源与延伸阅读

本文主要整理自 **CS329Z Lecture 6: Agent Design Patterns and Scaffolds** 的第 55–75 页，并参考第 81 页的 Pi Context Management 案例。讲义提供者为 Diyi Yang、Michael Ryan、John Yang；本文插图由所提供 PDF 对应页面渲染，保留了讲义中的原始来源标注。文章日期沿用该 PDF 的创建时间。

- [OpenHands 论文](https://arxiv.org/abs/2407.16741)：讲义中的 Persistent Event Log 案例。
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)：分层记忆与 Memory Offloading。
- [The Complexity Trap，v3](https://arxiv.org/abs/2508.21433v3)：Observation Masking 与 LLM Summarization 的对比。
- [Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：上下文工程与长程任务。
- [LangChain：Context Engineering for Agents](https://www.langchain.com/blog/context-engineering-for-agents)：Write、Select、Compress、Isolate 分类。
