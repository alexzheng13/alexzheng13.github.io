---
title: "Harness、Loop 与 Graph Engineering"
date: 2026-10-31
slug: "loop-engineering"
description: "区分 Agent Harness、Loop Engineering 与 Graph Engineering：从工具和权限、目标与反馈，到节点、共享状态和条件路由。结合调度、Maker/Checker、autoresearch 与开发任务图，理解它们如何配合、何时需要以及各自的成本。"
categories: [AI Agents]
tags: [Agent Harness, Loop Engineering, Graph Engineering, Long-Running Agents, Multi-Agent, Verification, autoresearch]
toc: true
---

一个 Agent 要修复登录问题，至少有三组工程问题：它能读取哪些文件、在哪里运行测试；测试失败后怎样继续、什么时候停止；如果研究、实现和审查分开，又由谁接手、失败该退回哪里。

Harness 关心模型周围的运行系统，Loop Engineering 关心任务怎样沿着反馈持续推进，Graph Engineering 关心工作单元之间怎样交接和协作。它们有重叠，也经常出现在同一个系统里；理解区别，比把它们排成一条“新概念取代旧概念”的时间线更有用。

<!--more-->

资料主线为 WalkingLabs [第十三讲：Loop Engineering](https://walkinglabs.github.io/learn-harness-engineering/zh/lectures/lecture-13-loop-engineering/)与[第十四讲：Graph Engineering](https://walkinglabs.github.io/learn-harness-engineering/zh/lectures/lecture-14-graph-engineering/)，对照讲义版本 `a9342ff` 及其参考阅读。产品行为结合官方文档核对；autoresearch 与图示代码另给出源码位置。

## 1. 三者分别在设计什么？

先用同一个任务对照，而不是先记三个定义。任务是“修复登录超时，保持接口兼容，并提供可复现的验证结果”。

| 概念 | 主要设计对象 | 在这个任务里要回答什么？ |
| --- | --- | --- |
| Harness Engineering | 模型周围的执行系统 | 怎样读写代码、运行测试、记录状态和限制权限？ |
| Loop Engineering | 围绕目标反复工作的反馈过程 | 失败后怎么调整，什么证据算完成，何时停止？ |
| Graph Engineering | 工作单元之间的连接与控制流 | 谁先研究、谁实现、谁审查，失败回到哪里？ |

Harness 的范围并没有统一到每个人都认可的分层标准。广义上，它包括工具执行、上下文、权限、状态、反馈，也可以包含循环控制与多 Agent 编排。讲义把 Harness 当作地基，把 Loop 和 Graph 放在其上；这是一种便于设计的视角，不代表三者是互不重叠的软件层。[Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/)

因此，可以从三个问题记住它们：

- **Harness：这个 Agent 在什么条件下工作？**
- **Loop：这件事怎样根据结果继续推进？**
- **Graph：这些工作单元怎样连接和交接？**

Prompt 与 Context 也没有消失。Prompt 表达本轮要求；Context 提供本轮可用的信息。Harness 负责把它们与工具和环境接起来，Loop 决定反馈之后是否再运行，Graph 决定接下来运行哪个单元、把什么信息交给它。

同一段“测试失败后重试”的代码，可以同时是 Harness 的控制逻辑、Loop 的反馈规则，以及 Graph 上的一条回退边。区别在观察尺度，而不在于必须为三个名字建立三个服务。

## 2. Harness Engineering：让模型能够在项目里工作

模型可以生成一条测试命令，但真正启动进程、限定工作目录、捕获退出码、保存日志并把错误交回模型，需要外部程序。这个承接模型决定、执行动作和返回反馈的系统，就是 Harness 的核心工作。

以代码修复为例，可以把需要的能力分成五组：

| 能力 | 具体产物 | 缺失时容易发生什么？ |
| --- | --- | --- |
| 指令与上下文 | 项目规则、文档索引、按需读取策略 | 不知道约定，或被无关历史淹没 |
| 工具与权限 | 文件工具、Shell、受控 API、审批入口 | 想做却做不了，或越权执行 |
| 运行环境 | 依赖、运行时、隔离目录、测试服务 | 命令正确，但环境不可复现 |
| 状态与恢复 | 候选版本、进度、日志、交接记录 | 换会话后丢失进展，重复操作 |
| 反馈与验收 | 测试、lint、行为检查、证据记录 | 把“生成了代码”当成“修好了” |

`AGENTS.md` 或 `CLAUDE.md` 只是其中的指令入口。写明“提交前跑测试”可以影响行为；若要保证未经验证不能发布，还需要工具权限、验证入口或 CI 门控。规则文档不能代替执行约束。

Harness 也不只服务于“一次运行”。状态存储、恢复、上下文重建、独立检查者，都可能支持跨会话工作。把 Harness 简化成 Prompt 文件，或者说它只负责单轮、长程问题全属于 Loop，都会漏掉重要部分。

改进 Harness 可以从失败记录倒推：失败是因为需求没说清、工具报错没被观察、环境缺依赖，还是验收结果没有绑定当前版本？先补对应的反馈或约束，再比较相同任务上的结果。组件不是越多越好；更换模型后，也应重新检查哪些约束仍有价值。

## 3. Loop Engineering：让目标沿着反馈持续推进

一个普通的交互过程是：提出问题，Agent 做出修改，返回结果，再等待下一条消息。Agent 内部可能已经执行了很多轮“调用模型—运行工具—读取结果”，但任务结束后的继续、检查和重新安排，仍然由人负责。

这里要分清两个层次：**ReAct loop 推进眼前的执行步骤；工作流层面的 loop 还要决定什么时候启动、接下来处理什么、如何验收，以及何时停止。** 一个外层循环可以调用一个 Agent，也可以安排多个角色。

最容易理解的入口是目标驱动模式。以支持 Goals 的 Codex 为例，可以给出这样的目标：

```text
/goal 修复登录模块的失败测试，保持现有接口兼容。
以项目的类型检查、lint、登录单测和端到端登录流程为验收依据。
不修改数据库迁移，不合并分支，不部署；需要新凭据时停止并说明缺项。
```

它与“先改这个函数”相比，多出来的是一份完成契约：目标持续有效，下一步根据刚获得的证据决定。实现有问题就修复，证据不足就补验证，达标、预算耗尽或遇到需要人处理的阻塞时结束。具体命令的可用性取决于宿主和版本，不能把 `/goal` 这个名字当成统一实现。[Codex Goals 官方说明](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)

讲义把这种工作方式的形成概括为四步：

1. **逐条指挥**：人指定每一步，也负责检查和接续。
2. **一次写多步**：把分析、实现、测试写进长提示词，但中途偏离仍需要人修正。
3. **按反馈继续**：Agent 能根据工具结果重新选择动作，却可能过早认定已经完成。
4. **把完成判断落实到证据**：测试、评测脚本或独立检查者参与收口，不能只凭实现者的一句“做好了”。

这不是所有产品的严格历史顺序，而是控制责任逐步从即时提示转向可重复执行的规则。Addy Osmani 用 Loop Engineering 来讨论的，也是这种从手动推动转向系统调度的变化。[原文](https://addyosmani.com/blog/loop-engineering/)

一个能工作的最小闭环，至少要回答三件事：**要达到什么状态，用什么证据判断，什么情况下继续或停止。** “一直做下去”只回答了其中很小的一部分。

### 目标、定时与事件：循环为什么会再次运行？

Loop 不只有一种。触发方式决定什么时候执行；完成条件决定执行到哪里，两者可以组合。

| 模式 | 什么时候运行 | 本轮何时结束 | 例子 |
| --- | --- | --- | --- |
| 交互式 | 人发来下一条指令 | 当前请求已处理或被中断 | 排查一个还不明确的问题 |
| 目标驱动 | 一个持续有效的目标需要继续推进 | 达标、预算上限、取消或真实阻塞 | 修复一组失败测试 |
| 时间驱动 | 到了约定的检查时间 | 完成本次检查或工作片段 | 每隔一段时间检查部署状态 |
| 事件驱动 | 收到新的外部事件 | 事件被处理、延期或转交 | CI 失败后定位原因 |

`/goal` 主要表达持续目标，`/loop` 主要表达重复触发。例如 Claude Code 的会话内调度可以这样使用：

```text
/loop 15m 检查本次部署是否完成；成功或失败时报告一次，未变化则保持安静。
```

但**定时触发不等于每次都失忆**。它可能回到同一会话，也可能启动新运行；即使启动新运行，只要读取外部状态，也能接续上次工作。反过来，在同一会话里反复执行，也不保证任务一定有进展。

具体选择还要看运行位置与会话是否延续：是回到当前聊天、本地新开一次任务，还是交给云端执行？下面 Automations 一节按这几个层级展开。

一个任务可以同时具有“每 15 分钟检查一次”和“部署成功后停止”两个条件。真正危险的是重复启动却没有状态、去重和停止规则：前一轮还没结束，下一轮又开始修同一个问题；部署早已成功，巡检却仍不断通知用户。

## 4. 把 Loop 落到实际工作里

在手动模式中，人负责发现工作、选择下一步、检查结果。进入自动循环后，这些动作被交给一套明确的流程，人主要负责目标、授权、例外和最终审阅。

![自动循环从触发、读取状态、选择工作、实现和检查，推进到保存结果；失败按预算重试，需要判断时交给人](/img/posts/loop-engineering/work-loop.svg)

*根据讲义中的循环与 morning triage 流程重绘。外部状态支撑每一轮，不只是流程最后的日志。*

讲义列出了六个可组合的部分。它们是工具箱，不是每个任务都必须集齐的架构清单。

### Automations：提供触发，而不代替任务判断

要让工作不依赖人反复输入“继续”，系统就要知道何时推进下一轮。当前运行可以根据目标和验证结果直接继续；需要隔一段时间再检查，或等待外部变化时，则交给定时器、Webhook、CI 事件等触发器。**Loop 不一定需要定时器，但需要一套自动接续的规则。**

Claude Code 与 Codex 的入口不完全相同，可以按用途做下面的对照。这里把 OpenAI 一侧的 **Codex 本地能力与 ChatGPT 网页端能力分开标明**，不把它们视为同一个运行环境。产品名称和边界按 2026-10-31 的官方文档核对。

| 层级 | Claude Code | Codex / ChatGPT |
| --- | --- | --- |
| 会话内跟进 | `/loop` | 对话线程自动化 |
| 本地定时 | Desktop 本地任务 | 独立自动化（本地） |
| 云端定时 | Cloud scheduled tasks（原 Routines） | ChatGPT 网页端定时任务 |
| 事件触发 | 云端 API / GitHub 触发器 | ChatGPT 网页端事件任务；或 CI 调用 CLI |
| 完全自建 | GitHub Actions / cron | `codex exec` + cron / CI |

#### 会话内跟进：回来继续看同一件事

Thread automation 可以理解成给当前聊天设一个闹钟：到点后回到这个线程，沿用已有上下文继续检查。比如已经开始跟进 PR #42，就不必每轮重新解释关注哪个 PR、上次看到什么、哪些结果已经通知过。

```text
本轮：查询 PR #42，CI 仍在运行 → 等待
下次唤醒：接着这个聊天，重新查询 → 没有变化 → 不重复通知
再次唤醒：查询发现 CI 失败 → 读取日志，按授权处理或通知
```

它在用途上接近 Claude Code 的 `/loop`，不是一个模型在等待期间一直思考。**聊天上下文保存的是之前知道的情况，当前状态仍要重新查询。** 记得启动过某个命令，也不等于那个进程现在还活着。

会话依赖也不能简单写成“关了就没了”。Claude Code 目前支持在恢复会话时恢复部分未过期任务，但会话未运行时不会因此自动在云端执行；Codex 本地线程的后续工作同样不能只靠聊天记录保证运行环境持续可用。[Claude Code 会话调度](https://code.claude.com/docs/en/scheduled-tasks)

#### 本地与云端：运行在哪里，比入口叫什么更重要

独立本地任务适合每天检查项目、生成日报等周期性工作，不必依附当前聊天。每次运行需要的目标、方法和状态应能从任务配置、项目文件或其他持久存储恢复。Claude Code Desktop 的本地定时任务会创建新会话；本地工作需要机器和应用运行。[Desktop 定时任务](https://code.claude.com/docs/en/desktop-scheduled-tasks)

云端任务适合不依赖本机的工作。Claude Code 的 Cloud scheduled tasks（原称 Routines）可以按时间、API 调用或 GitHub 事件启动。ChatGPT 网页端也提供远端定时任务，但它不能直接读取本机目录。因此，“Codex 本地自动化需要电脑开着”不能扩大成“OpenAI 没有云端调度”。[Claude Code 云端任务](https://code.claude.com/docs/en/routines)、[OpenAI 官方定时任务说明](https://learn.chatgpt.com/docs/automations)

#### 事件与自建调度：让变化主动到达

轮询是每隔一段时间去问“CI 好了吗”；事件触发则是 CI 状态变化后主动唤醒工作流。ChatGPT 的 Gmail、Slack、GitHub 事件任务目前属于网页端和移动端能力，不能因为安装了插件，就认为 Codex 桌面本地自动化已经具备相同触发器。[OpenAI 事件触发说明](https://learn.chatgpt.com/docs/automations#trigger-tasks-from-app-events)

需要自定义运行环境或触发逻辑时，可以让 cron 或 CI 调用 `codex exec`。这里 cron / CI 负责“何时启动”，CLI 负责执行一轮任务；重试、并发去重、超时、结果存储和授权仍由外层工作流管理。[Codex 非交互运行](https://learn.chatgpt.com/docs/non-interactive-mode)

不论选哪一层，触发器只提供运行机会。系统仍要检查是否有新工作、事件是否已处理、上一轮是否仍在运行。轮询没有发现变化时可以不动作；需要人处理的阻塞应该带上具体问题，而不是每次唤醒都重复发送“仍在等待”。

### Worktrees：隔离文件修改

多个 Agent 在同一个目录里同时编辑文件，很容易互相覆盖。Git worktree 可以为并行任务提供独立 checkout，使它们在各自分支上修改和验证。

它隔离的是工作目录，不是所有资源。不同 worktree 仍可能争抢同一个端口、测试数据库、云资源或 PR；合并时也可能出现文本和语义冲突。并行度因此不仅取决于能开多少 Agent，还取决于环境隔离和审阅能力。

### Skills：让项目方法可以复用

Skill 可以保存处理某类任务的方法、脚本、参考资料和输出约定。例如 issue triage skill 规定怎样分类、如何判断重复问题、用什么证据决定是否值得修复。

它减少的是每一轮重新解释工作方法的成本。当前任务进展仍然应保存在状态记录里，不能把每次运行的临时结果不断塞进 `SKILL.md`。

### Connectors：把工作接到真实系统

连接器让循环能够读取 issue、查询 CI、访问测试服务，并在授权范围内写回结果。MCP 是一种常见接口，但不是所有连接器都必须基于 MCP。

读外部信息和修改外部系统要分开授权。“可以查看 CI 失败”不自动意味着“可以改部署配置”；“允许生成修复”也不自动包含合并、发布或向其他人发送消息。

### Sub-agents：拆开实现与判断

一个常见分工是 Explorer 定位问题，Maker 实现，Checker 验证。小任务可以省掉 Explorer，由同一个主 Agent 调用确定性检查；较复杂任务再引入独立审查角色。

分工的价值在于减少同一上下文里的自我说服，并引入不同观察路径。多开几个 Agent，却只让它们阅读同一份实现说明、重复同一套判断，未必能增加多少独立证据。

### External State：保存跨轮次可恢复的信息

下一轮需要知道目标、已完成工作、当前基线、验证结果、阻塞和下一步。文件、任务系统或数据库都可以承载这些信息，选择取决于并发、查询和审计需求。

上下文压缩、Session 更换或进程重启后，不能只依赖模型还记得什么。状态应该能够回到具体来源，例如 commit、测试输出、issue 与产物位置。**Skill 保存工作方法，外部状态保存这次工作走到了哪里。**

### 一个完整例子：早晨的 Issue Triage

把六个部分放在一起，可以得到一个很具体的工作流：每天检查仓库里新增的问题，对可处理项尝试修复，最后把需要审阅的结果交给人。

先明确范围，避免“扫一遍 issue”变成无限扩展的项目。下面是基于讲义模板调整的目标示例：

```markdown
# Goal
检查目标仓库最新的 10 个 issue。

# 允许的工作
- 已有标签、负责人或处理记录的 issue 先读取现状，避免重复处理。
- 对未分类项提出分类；仅在已获授权时写入标签。
- 在独立分支中尝试一个预计 10 分钟内可验证的小修复。
- 通过验收后，按授权创建草稿 PR 或留下本地改动供审阅。

# 验收
- 修复前有复现证据，修复后同一用例通过。
- 类型检查、lint 和相关测试通过；必要时验证端到端路径。
- 交付包含改动版本、验证命令、结果和剩余风险。

# 边界与停止条件
- 不合并、不部署，不修改生产数据、凭据或 CI 安全策略。
- 本批 10 个 issue 已有明确处理结果时结束。
- 最多 20 轮；连续 3 轮没有新的有效证据时转交人工。
- 需要扩大权限、改变需求或依赖外部输入时停止受阻工作。
```

定时器唤醒后，系统先读取 issue 与已保存状态，排除已处理事件。选中一个小任务后，为它准备隔离环境；Maker 实现并完成基础检查，再把确切版本交给 Checker。失败反馈进入有限的修复循环，通过后才进入交付与状态写回。

状态不能只写“修好了”。至少留下下一轮能核对的事实：

```yaml
goal: "Triage the latest 10 issues"
iteration: 3
status: needs_review
task:
  issue: "#42"
  branch: "fix/login-timeout"
  revision: "<tested-commit>"
verification:
  reproduction: "<fixture-and-command>"
  test_result: passed
  evidence: "<log-or-artifact-reference>"
decision:
  accepted: false
  reason: "Waiting for independent review"
next_action: "Review the tested revision; do not repeat implementation"
```

这里的 `test_result: passed` 只表达测试结果，`accepted: false` 表达尚未完成独立验收，两者不能混成一个“全部完成”状态。下一轮启动时，要先确认记录指向的版本仍然是当前版本。

这个例子还要求处理崩溃恢复：如果 PR 已创建，但状态写回前进程退出，恢复时应先查询已有 PR，不能因为本地记录缺失就再开一个。持久化状态与外部操作的去重，是循环从演示走向长期运行时绕不开的部分。

### Maker / Checker 分离，要落实到验收入口

讲义强调 Generator/Evaluator 分离，因为实现者很容易沿着自己的方案解释结果，忽略未覆盖的路径。独立检查者应该从需求和可观察行为出发，而不是只读实现者的总结。

例如，Maker 和 Checker 可以使用下面两份简化协议：

```text
Maker
1. 读取目标、边界和当前状态，说明本轮要验证的假设。
2. 在允许范围内修改，运行基础检查。
3. 交付确切版本、变更清单、命令与结果、已知风险。
4. 提交验证请求，不自行宣布最终验收通过。

Checker
1. 根据原始要求审查该版本，不默认接受 Maker 的结论。
2. 复现关键路径，独立运行适用的测试并检查边界情况。
3. 每个问题给出位置、触发条件、证据和严重程度。
4. 无证据不编造问题；无法验证时写明缺项，不能冒充通过。
```

可以使用不同模型，也可以使用同一模型的独立上下文。关键是任务、观察和验收依据的独立性；模型不同并不保证错误不相关。对于有明确预期的检查，脚本和真实环境测试通常比再问一次“你觉得对吗”更有约束力。

Anthropic 的长程应用实验就是把实现和 QA 分开，让 Evaluator 通过浏览器实际操作应用，而不只检查截图或听取 Generator 的自述。已有的[Planner–Generator–Evaluator 文章](/post/anthropic-agent-evolution-3-planner-generator-evaluator/)介绍了这一结构。[实验原文](https://www.anthropic.com/research/harness-design-long-running-apps)

#### 谁能把状态改成 passing？

“不要直接改状态，先运行测试”写进 `CLAUDE.md` 或 `AGENTS.md`，属于行为规则。若 Agent 仍然拥有任意改写状态文件的工具权限，它技术上仍可以绕过规则。

更强的实现是让 Harness 提供受控验证入口。下面是流程伪代码，不是可直接运行的控制器：

```python
def request_validation(feature_id, candidate_revision):
    contract = registry.load_contract(feature_id)
    candidate = workspace.pin_revision(candidate_revision)

    # 使用登记的验收程序，在固定候选版本上运行
    report = verifier.run(contract, candidate)
    evidence_store.save(report)

    if report.satisfies(contract) and workspace.still_matches(candidate):
        state_store.transition(feature_id, to="passing", evidence=report.id)
    else:
        state_store.record_failure(feature_id, evidence=report.id)

    return report
```

这要求状态写入确实受工具或存储边界约束，验证契约也不能由 Maker 为了通过测试而随意改掉。验收要绑定同一候选版本：不能测试完 A，改成 B 后仍沿用 A 的通过结果。

即便如此，通过也只意味着满足登记的检查，并不证明系统没有任何未知问题。验收标准本身仍需要维护，主观体验和高风险行为也可能需要人来判断。

### autoresearch：把实验组织成可重复的棘轮

Karpathy 的 autoresearch 展示了另一种循环：Agent 不断修改一个训练程序，以固定预算运行实验，再根据验证指标保留或放弃候选。

这里对照的是[源码版本 `228791f`](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117)。主线由三个文件构成：

| 文件 | 职责 | 实验中的修改边界 |
| --- | --- | --- |
| `prepare.py` | 数据、tokenizer、时间预算与评估工具 | 固定基础设施，不由实验 Agent 修改 |
| `train.py` | 模型、优化器、超参数和训练过程 | Agent 的主要实验对象 |
| `program.md` | 目标、工作规则、结果格式、保留与放弃策略 | 由人定义和迭代的方法 |

这种分工把搜索空间与评价规则分开。Agent 可以改学习率或模型结构，却不能通过修改评估函数来制造更好的成绩。自然语言方法写在 `program.md` 中，执行仍依赖 coding Agent、工具和训练环境；Markdown 本身不会自动运行。

#### 固定什么，优化什么？

训练时间预算由 `prepare.py` 中的 `TIME_BUDGET = 300` 定义，主要指标是验证集的 `val_bpb`，即每字节的编码位数，越低越好。“墙钟预算”限制的是计入训练阶段的实际经过时间，不是固定步数：同一机器上，每步 0.5 秒的方案在 300 秒里约能完成 600 步，每步 1 秒的方案约能完成 300 步。这是在比较相同时间内的效果，而不仅是每一步的效果。

这个版本会跳过开头若干步的计时，以避开初始编译等开销；达到预算后在训练步边界退出，验证也在训练之后进行。因此，一轮实验的总耗时会超过 5 分钟。这是在短预算下筛选方案，不保证短跑的优胜者在长时间训练中仍然领先。[训练计时源码](https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/train.py#L538-L624)

在同一硬件、数据和评估设置下，固定训练预算有利于比较不同候选，而不是让某个候选单纯靠训练更久获胜。但不同硬件上的结果不能因此直接横比；小幅改善也需要留意随机波动和重复试验。

源码还要求考虑复杂度：指标相当但代码明显更简单，也可能值得保留。因而它更像“在固定评估下筛选更好的当前基线”，不应把所有决策机械地等同于某个浮点数严格下降。

#### 九步循环

![autoresearch 从读取约束和当前基线开始，提出假设、修改、保存候选、训练、评估、记录，然后保留或放弃并进入下一轮](/img/posts/loop-engineering/research-ratchet.svg)

把讲义中的棘轮过程展开，可以得到九步：

1. 读取 `program.md`，明确本轮能改什么、怎样评估。
2. 读取当前代码、Git 基线和历史实验记录。
3. 提出一个可检验的修改假设。
4. 修改 `train.py`。
5. 保存候选版本，能够追溯这次试验到底改了什么。
6. 运行训练，在规定预算下取得结果。
7. 检查指标、资源使用和失败原因，并写入实验记录。
8. 改善符合规则则保留；不合适则放弃候选、恢复可用基线。
9. 以更新后的基线和历史记录开始下一轮。

“棘轮”强调接受的基线不会随意被更差候选替换；它不保证每一次探索都成功，也不意味着从此找到了全局最优解。放弃候选时应只处理隔离实验环境中的自有改动，不能把这种策略直接搬到有他人未提交工作的目录。

#### 输出不只是一个更低的分数

实验会留下保留的代码版本、逐次实验表和运行日志。`program.md` 规定的 `results.tsv` 实际包含五列，下面是它的格式示例，不是本文运行得到的数据：

```text
commit   val_bpb   memory_gb   status    description
a1b2c3d  0.997900  44.0        keep      baseline
b2c3d4e  0.993200  44.2        keep      increase learning rate
c3d4e5f  1.005000  44.0        discard   change activation
d4e5f6g  0.000000  0.0         crash     double width; out of memory
```

真实文件使用制表符分隔。`crash` 行中的零是规定的失败占位值，不是优于所有成功实验的指标；读取结果时必须同时看 `status`。

代码历史保留接受的候选，实验表还要保留失败尝试，否则下一轮很容易重新探索已经证伪的方向。原始运行输出也不能仅凭 Agent 的一句总结替代；需要核对或迁移方案时，仍要查看代码和日志。

讲义引用的一个结果来自 nanochat：[autoresearch round 1 的提交](https://github.com/karpathy/nanochat/commit/f06860494848db080c9a80a0ffa83203b042056b)报告，达到 GPT-2 对标水平的训练时间从 2.02 小时降至 1.80 小时，约减少 10.9%。这是对应项目和配置下的报告，不是任意仓库装上 loop 后都能获得的提升，也不是本文复现实验。

autoresearch 的原始协议鼓励在得到启动确认后持续试验，直到人中断。用于实际工作时仍应另设总时间、费用和计算资源预算；单次训练有上限，不意味着整个实验活动已经有上限。

## 5. Graph Engineering：把协作路径写成可执行结构

前面的 Maker / Checker 已经有了图的雏形：实现后交给验证，失败返回实现，通过后交付。若只需要这一条路径，一个简单控制循环就够了。

复杂一点的问题是：测试失败，究竟是代码没改对，还是最初理解错了需求？缺少资料时是否应该退回研究？两个研究任务能否并行，什么时候汇总？哪些结论需要人审批？当这些交接反复出现，把它们全部留给一个 Agent 临场决定，就很难定位错误发生在哪个边界。

Graph Engineering 把这些关系显式化。这里的图是**执行与协作图**，不是存储实体关系的知识图谱；节点数量也不等于 Agent 数量。

### 四个组成部分

**节点（Node）**承担工作。节点可以是一段程序、一次模型调用、一个工具、一个完整 Agent，或等待人工判断的步骤。完整 Agent 节点内部还可以有自己的“写代码—测试—修复”循环。

**边（Edge）**表达允许的交接：研究完成后进入实现，验证失败后回到实现，信息不足时退回研究。并行 fan-out 和汇总 fan-in 也属于这种关系。

**状态（State）**保存交接所需的事实：原始需求、证据来源、候选版本、测试报告、审查结论、预算。共享状态不等于把所有聊天记录广播给所有节点。

**路由（Routing）**根据状态决定下一步。它可以是确定性代码，也可以使用模型的分类结果；即使用模型判断失败类型，允许去哪些节点、是否耗尽预算、是否具备权限，仍可由代码限制。[LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)

![登录问题修复图：研究、实现、独立验证、人工审阅与交付；根据失败类型回退，各节点通过版本化状态交接，底层 Harness 提供工具、权限、日志与恢复](/img/posts/loop-engineering/agent-work-graph.svg)

*按第十四讲的开发图重绘，补入候选版本、预算出口与人工审阅。每个 Agent 节点可以保留局部 Loop，整张图由 Harness 的执行与状态能力支撑。*

### 从登录修复任务定义状态

与其直接画箭头，不如先说明每个节点接收什么、产生什么。下面是一个交接快照示例：

```yaml
run_id: login-timeout-42
requirements: "Fix the timeout without changing the public API"
evidence_refs: ["issue:42", "logs:reproduction-1"]
candidate_revision: candidate-3
verification_revision: candidate-3
review: fail
attempts: 3
max_attempts: 5
requires_approval: true
```

`candidate_revision` 标识代码候选，`verification_revision` 标识报告检查的版本，二者相同才有资格使用这份报告。实际系统宜采用确切 commit 或不可变产物 ID；这里的 `candidate-3` 只是便于阅读的示例。

字段还需要写入和合并规则。需求由需求负责人维护，实现节点产生候选，验证节点产生报告；并行研究结果可以按稳定 ID 去重合并，但两个不同版本的代码不能“追加在一起”就算整合完成。计数器若采用增量合并，节点应返回本次增量，而不是把累计值再次相加。**共享 schema 也不是权限系统，谁能改什么仍要由执行层约束。**

实现者只需要当前需求、相关文件和上次失败证据；审查者需要原始验收契约、候选版本与工具访问，不必继承实现者的全部对话。独立上下文可以减少对实现方案的先入为主，但不能让审查者失去验收所需的事实。

### 节点与回退边怎样配合？

| 节点 | 接收与工作 | 输出与交接 |
| --- | --- | --- |
| `research` | 读 issue、复现日志和相关文档 | 有来源的需求与假设，交给实现 |
| `implement` | 在隔离环境里修改，局部测试与重试 | 候选版本和变更记录，交给验证 |
| `verify` | 独立检查同一版本与原始要求 | 通过、实现失败或需要重新研究 |
| `human_review` | 审阅高风险或待授权的结果 | 批准、拒绝或要求修改 |
| `deliver` | 检查验收与授权状态 | 保存交付产物；发布或合并另需明确授权 |

局部 Loop 处理节点内部的试错；Graph 处理职责之间的交接。例如实现节点可以在局部预算内修语法错误，但发现需求矛盾时，应走边退回研究，而不是无限修改代码。

下面的路由函数展示这种分工。它不包含节点实现、持久化或工具权限，不是一份完整的图引擎：

```python
def route_after_verify(state):
    if state["verification_revision"] != state["candidate_revision"]:
        return "verify"

    verdict = state["review"]
    if verdict == "pass":
        return "human_review" if state["requires_approval"] else "deliver"

    if state["attempts"] >= state["max_attempts"]:
        return "blocked"
    if verdict == "needs_research":
        return "research"
    if verdict == "fail":
        return "implement"
    return "human_review"
```

同样是失败，有些应退回实现，有些应重新研究；未知结论不能默认通过。全局运行器还要限制总时间、节点执行次数和费用，覆盖“报告过期→重新验证”这类不增加实现次数的循环。图里写了人工节点，也不代表已经实现审批：运行器必须真的暂停，相关工具也不能绕过它。

### Checkpoint 与恢复：保存状态还不够

需要恢复时，保存的是运行实例的状态、已完成节点、下一步与产物引用，而不是单纯一份模型总结。运行 ID 应稳定地区分不同任务；模型聊天 ID、图运行 ID 和项目中的业务任务 ID 可以关联，但不是天然相同的东西。

持久化后还要考虑外部副作用。若“创建 PR”已成功，进程却在写 checkpoint 前退出，恢复重试仍可能再创建一次。需要幂等键、查询已有结果或事务式交接；checkpoint 本身不会把外部操作变成恰好一次。

第十四讲的 [LangGraph 骨架源码](https://github.com/walkinglabs/learn-harness-engineering/blob/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/zh/lectures/lecture-14-graph-engineering/code/maker_checker_graph.py)适合看清 `StateGraph`、节点、条件边和 `thread_id` 的连接，但还不能当成可靠的代码修复器：

- `call_model()` 尚未实现；测试以代码中是否出现 `def test` 占位，并未真正运行测试。
- `attempts` 没有实际递增；路由只区分 `fail` 与其他值，未知结论也会走向 `merge`。
- `merge` 只是打印消息；`MemorySaver` 保存的是内存检查点，不是进程重启后的磁盘恢复。

要实现后者，需要持久化 checkpointer，并核对恢复路径和副作用。LangGraph 官方文档也明确区分内存 saver 与 SQLite、PostgreSQL 等持久化后端。[持久化说明](https://docs.langchain.com/oss/python/langgraph/persistence)

### Graph 与 Workflow：别把旧能力说成新发明

工作流早就可以有条件分支、并行、状态、审批和动态任务。不能把它概括成“固定函数、同样输入永远走同样路径”，再把所有灵活性归给 Graph Engineering。

在这里，更有用的区别是：**流程中哪些决定交给代码，哪些交给模型，哪些保留给人。** Anthropic 的工作流与 Agent 区分强调预先规定的控制流和模型主导的动态控制；两者都可以表示成图，也可以在一张图里混用。[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)

所以 Graph 不等于“每个框都是一个 Agent”，也不一定是 DAG。验证失败的回退边已经构成环；若把整个带反馈的 Agent 抽象成一个节点，又可以画成带自环的单节点图。它与 Loop 的关系取决于抽象粒度，而不是二选一。

LangChain 的参考阅读也提醒：适合明确建模的任务可以约束路径，开放式研究则可能更适合灵活的核心循环。把每一次探索都预先画死，可能增加不必要的交接。[3 Years of Graph Engineering with LangGraph](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph)

## 6. 图还要说明谁能改目标、谁能否决

把节点连起来，只说明了工作流向。长期运行后，还会出现目标和评价之间的问题。

**指标失真。** 假设客服 Agent 只优化关闭工单数，它可能更快关闭问题，却让用户反复回来。代码 Agent 也可能通过删测试获得绿色结果。需要把优化指标与真实验收、保护指标分开，不能让执行者为了得分自由改评价方式。

**目标无人复核。** 如果整个系统只追逐既定 benchmark 分数，却没有检查它是否对应实际需求，更多重试只会更有效地追逐错误方向。目标、验收契约与变更审批需要明确负责人。

**循环相互冲突。** 一个节点追求更快响应，另一个追求更完整研究；两个修复任务分别通过，却改坏同一公共接口。除了局部检查，还需要集成验证、资源归属、优先级与否决路径。

参考阅读 Eigent 还增加了“测量退化”：日志或评分规则逐渐失真，内部报告互相验证，却没有重新接触真实结果。它提出的 anchors，可以理解成独立于被优化过程的核对来源，例如保留测试集、真实场景回归和人工抽查。[Graph Engineering for AI Agents](https://www.eigent.ai/blog/graph-engineering-ai-agents)

沿用登录修复的例子，关系应该说清楚：

- 需求负责人可以批准修改验收要求，实施节点不能自行放宽。
- 验证者可以拒绝候选，但拒绝要带版本与复现证据。
- 集成检查可以否决局部通过的变更。
- 预算与权限控制器可以暂停工作，不需要等待模型同意。

这些机制可以用 Graph 表达，也可以在一个设计良好的 Loop 里实现。**图让关系更容易审计，并不自动消除 Goodhart、偏见或目标错误。** 把审查者换成新上下文仍然可能共享错误假设，必须同时改善证据与验收。

Prefect 的阅读材料强调可比较、可复现的运行结构；iii.dev 则把注意力拉回运行底座：拓扑之外，系统留下的状态、可观察记录和可复用能力才决定它是否经得起长期使用。这两种视角并不冲突：要把交接画清楚，也要让图真正运行在可检查、可恢复的系统上。[Loops vs. Graphs](https://www.prefect.io/blog/loops-vs-graphs)、[Loops, Graphs, and the Layer That Matters](https://iii.dev/blog/loops-graphs-and-the-layer-that-matters/)

## 7. 循环与图都会累积的成本

### 验证负债：产出比检查快

一轮修改“看起来没问题”，下一轮就在这个基线上继续做。等到后面出现故障，问题可能已经跨越多个提交。

要把复现、回归检查和验收结果绑定到具体版本。不能只统计生成了多少代码，还要统计有多少变更经过了有效验证、哪些路径仍未覆盖，以及多少失败被误记成成功。

### 理解衰退：代码增长快于团队的心智模型

自动循环可以很快生成大批变更，但维护者未必理解新的依赖关系、设计理由和故障边界。只读一份 AI 总结，不足以维持对系统的掌握。

保持变更可审阅，记录重要决策，亲自使用关键路径，抽查有风险的 diff。文档用于帮助理解，不是代替理解。

### 认知投降：把判断也一并交出去

循环运行顺利之后，人很容易把“系统给了结论”当成“问题已经被正确判断”。但是需求是否值得做、一个性能指标是否代表用户体验、某项风险是否可以接受，往往不在自动验收的范围里。

Maker 和 Checker 都通过，不代表原始目标就合理。需要有人能够质疑目标、调整评价方法，或停止一条已经不值得继续的路线。

### Token 与运行开销：每一轮都可能重新支付历史成本

假设每轮新增约 `k` 个 token，而且每一轮都重新提交全部历史，那么第 `i` 轮的输入约为 `i × k`，`N` 轮累计输入约为 `k × N(N+1)/2`。近似二次增长来自“逐轮增长＋反复全量处理”这两个前提，不是所有 Agent 系统都天然如此。

上下文压缩、外部状态、按需读取和复用稳定内容，可以减少重复输入。实际费用还受缓存、模型、输出长度和工具开销影响，不能只拿这个近似式推算账单。独立 Checker、worktree 准备、环境启动和失败重试也都有时间与费用成本。

应当观察的是每个被验收成果的总成本，包括模型、工具、重试和人工审阅，而不仅是单次生成的价格。

### 编排税：更多产出可能只扩大审阅队列

并行节点增加以后，要付出的不只是模型费用，还有任务切分、上下文交接、冲突处理和最终审阅。若所有变更最终都等一个人理解和批准，增加 Worker 可能只是让等待队列更长。这是 Addy Osmani 所说的 orchestration tax。[原文](https://addyosmani.com/blog/orchestration-tax/)

可以限制同时在途的变更数，对相同模块批量审阅，把可机械判断的检查交给程序，并根据实际审阅吞吐设置并行度。Agent 数量不应只由界面能开多少决定。

## 8. 什么时候用 Harness、Loop 或 Graph？

先判断当前的困难属于哪里，而不是先挑框架：

| 当前困难 | 优先处理 |
| --- | --- |
| 不知道项目约定、无法运行工具、验证缺失 | 补 Harness 的上下文、环境和反馈 |
| 单轮能做好，但每次都要人推动下一步 | 设计目标、反馈、状态和停止条件，形成 Loop |
| 研究、实现、验证之间反复交接不清 | 显式设计节点、状态契约和条件边 |
| 固定几步就能完成，没有开放式判断 | 普通脚本或工作流可能已经足够 |
| 开放式探索，路径事先很难确定 | 保留灵活循环，只固定关键验收与权限边界 |

需要 Graph 的信号不是“步骤多”，而是分支、回退、并行汇总、独立审查或恢复边界值得单独建模。线性流水线也可以表示成图，但表示得出来不代表需要额外的图引擎。协作节省的时间，要能覆盖协调和审阅成本。

讲义给出的起步路线是选一个重复任务，定义目标与停止条件，分开制作和检查，保存状态，再加入定时触发。顺序很重要：先让单轮可验证，再让它重复运行；否则自动化只是更快地重复同一个错误。

可以从下面五个层级逐步扩展：

| 层级 | 增加的能力 | 首先需要回答的问题 |
| --- | --- | --- |
| Goal Runner | 围绕一个目标持续推进 | 怎样证明完成，何时停止？ |
| Scheduled Task | 到时间自动执行 | 运行环境是否可用，重复唤醒会不会重做？ |
| Maker / Checker | 实现与验证分工 | 验收是否独立，证据是否绑定当前版本？ |
| Self-Feeding Loop | 从外部状态选择下一项工作 | 优先级、范围和授权从哪里来？ |
| Multiple Loops | 多条循环并行协作 | 工作归属、共享资源、状态写入和审阅容量怎样协调？ |

这是一条能力阶梯，不是成熟团队必须追求的等级榜。一个低频、单任务的循环，如果稳定节省人工时间，可能比复杂的 Agent 集群更合适。

第一次试用可以只做三个小实验：

1. 同一个小任务，先手动推进，再用有停止条件的循环完成，比较质量与人工介入次数。
2. 在相同任务上加入 Checker，记录它发现的有效问题，以及增加的成本。
3. 连续跑三轮，并在中间更换会话，检查能否根据外部状态恢复，是否重复已完成操作。

至少记录人工介入次数、有效问题数、误报、验收结果、重试和总成本。“无人值守运行了很久”不等于系统有效；更好的信号是**在质量和边界保持的前提下，完成同样工作需要更少的人来推动。**

模型能力变化后，也要重新评估循环结构。哪些检查仍然必要，哪些交接已经成了额外负担，可以通过逐项移除和对照验证判断，而不是把更多 Agent、更多提示词当成可靠性的保证。

最后用同一个登录修复任务收束：Harness 让修改、测试与状态记录可以在边界内执行；Loop 让失败反馈带来下一次尝试；Graph 把研究、实现、验证与审批的关系固定成可检查的协议。任务做大时三者往往同时存在，任务小时也不必为了凑齐三个名字而增加组件。

### 参考资料与模板

- WalkingLabs：[第十三讲及模板](https://github.com/walkinglabs/learn-harness-engineering/tree/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/zh/lectures/lecture-13-loop-engineering)、[第十四讲与图示骨架](https://github.com/walkinglabs/learn-harness-engineering/tree/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/zh/lectures/lecture-14-graph-engineering)。本文重组讲解与流程图，调整示例，补充权限、版本绑定及源码限制。讲义及模板 Copyright (c) 2025 WalkingLab，按 [MIT 许可证](/downloads/loop-engineering/LICENSE-WalkingLab.txt)使用。
- [Addy Osmani：Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/) · [The Orchestration Tax](https://addyosmani.com/blog/orchestration-tax/)
- [Addy Osmani：Loop Engineering](https://addyosmani.com/blog/loop-engineering/)
- [Simon Willison：Designing Agentic Loops](https://simonw.substack.com/p/designing-agentic-loops)，从目标、工具和可观察结果出发设计循环。
- [LangChain：3 Years of Graph Engineering with LangGraph](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph) · [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) · [持久化](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Prefect：Loops vs. Graphs](https://www.prefect.io/blog/loops-vs-graphs) · [Eigent：Graph Engineering for AI Agents](https://www.eigent.ai/blog/graph-engineering-ai-agents) · [iii.dev：Loops, Graphs, and the Layer That Matters](https://iii.dev/blog/loops-graphs-and-the-layer-that-matters/)
- [Anthropic：Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI：Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) · [自动化](https://learn.chatgpt.com/docs/automations)
- [Claude Code：Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks) · [Goals](https://code.claude.com/docs/en/goal)
- [Anthropic：Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps)
- [autoresearch：README 与 program.md，版本 228791f](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117)
- 关联阅读：[Context Reset 与 Structured Handoff](/post/anthropic-agent-evolution-2-context-reset-and-handoff/) · [Memvid：单文件 AI 记忆系统](/post/memvid-memory-architecture/)
