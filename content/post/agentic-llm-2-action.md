---
title: "Agentic LLM（二）：Action——从多模态感知到 VLA 与世界模型"
date: 2026-10-05 19:30:00 +0200
slug: "agentic-llm-2-action"
description: "Agentic LLM 系列第二篇：从 VLM 的视觉理解出发，解释 VLA 如何把语言、视觉与机器人动作连接起来，并进一步讨论 Model-Based RL、World Model 与可预测的 Agent 行动。"
categories: [AI Agents]
tags: [Agentic LLM, Action, VLM, VLA, World Model, Robotics, Model-Based RL]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

推理给出了“下一步应该做什么”，但只有当这个决定被翻译成一次 API 调用、一次鼠标点击，或者机器人的一段运动时，Agent 才真正开始影响环境。

这也是 **Action** 与普通文本生成的根本区别：文本答错了可以重新生成，动作却可能改变状态、消耗资源，甚至产生不可逆的结果。Agent 因此不能只会“想”，还要理解环境允许哪些动作、预测动作的后果，并根据新的观察继续决策。

本文是 **Agentic Large Language Models 系列的第二篇**。上一篇讨论了 [Reasoning：从 Chain of Thought 到搜索、反思与 RLVR](/post/agentic-llm-1-reasoning/)；这一篇沿着下面这条主线展开：

```text
看见环境（VLM）
      ↓
把意图映射为动作（VLA）
      ↓
预测动作之后会发生什么（World Model）
      ↓
在真实执行前规划、比较与修正
```

<!--more-->

> **系列导航**：[（一）Reasoning](/post/agentic-llm-1-reasoning/) · **（二）Action** · （三）Interaction（待续）

## 1. Action 不只是“输出一个动词”

在 Chatbot 中，模型输出的 Token 本身就是最终结果；在 Agent 中，Token 往往只是某个执行系统的输入。

```text
Chatbot:  Prompt → Tokens

Agent:    Goal → Reasoning → Action → Environment
                    ↑                     ↓
                    └──── Observation ────┘
```

若 `o_t` 表示时刻 `t` 的观察，`g` 表示用户目标，`h_t` 表示此前的行动历史，那么策略可以写成：

<div class="math-display">
\[
a_t \sim \pi_{\theta}\!\left(a\mid o_{\le t}, g, h_t\right)
\]
</div>

环境接收动作后产生新的状态、观察和奖励：

<div class="math-display">
\[
s_{t+1},\,o_{t+1},\,r_t \sim P\!\left(\cdot\mid s_t,a_t\right)
\]
</div>

这里的 `a_t` 可以属于完全不同的动作空间：

| 场景 | 动作表示 | 执行者 |
| --- | --- | --- |
| Tool Agent | JSON、函数名与参数 | API / Tool Runtime |
| Computer-use Agent | 鼠标、键盘、GUI 坐标 | 浏览器或操作系统 |
| Code Agent | Patch、Shell Command、测试指令 | Sandbox / Terminal |
| Embodied Agent | 速度、位姿、关节或轨迹 | Robot Controller |

本篇重点放在最能体现“从理解到物理行动”这条链路的 **Vision-Language Model（VLM）**、**Vision-Language-Action Model（VLA）** 与 **World Model**。工具调用和软件环境中的 Action 会在后续 Interaction 文章里，与 Observation、状态管理和权限系统一起展开。

![Agentic LLM Action 方法的分类：从多模态模型、机器人行动到 Tool Use 与 Software Agent](/img/posts/agentic-llm-2-action/action-taxonomy.webp)

*Action 横跨机器人、工具、软件助手和世界模型。它们共享同一问题：如何把模型输出变成受约束、可执行并且可以验证的操作。*

## 2. VLM：先让 Agent 看懂环境

纯语言模型只能处理已经被转写成 Token 的世界。现实环境却首先以图像、视频、声音和传感器状态出现。VLM 的作用，是把视觉信息映射到语言模型能够使用的表示空间。

一个典型 VLM 包含四部分：

1. **Vision Encoder**：用 CNN 或 Vision Transformer 把图像编码成视觉特征；
2. **Text Encoder / Tokenizer**：处理问题、指令和历史文本；
3. **Multimodal Projector**：把视觉特征投影到语言模型的 Embedding Space；
4. **Text Decoder**：在视觉 Token 与文本 Token 的共同条件下生成答案。

![典型 VLM 架构：视觉特征经过 Multimodal Projector 后，与文本 Token 一起输入 Text Decoder](/img/posts/agentic-llm-2-action/vlm-architecture.webp)

*以 LLaVA 一类结构为例，Projector 不需要把图像变成一句 Caption，而是把视觉特征直接对齐到语言模型可消费的 Token 表示。*

若视觉编码器输出 `z_v`，投影层为 `W_p`，文本 Embedding 为 `z_x`，则进入语言模型的序列可以简写为：

<div class="math-display">
\[
z=\left[W_p z_v\,;\,z_x\right],\qquad
p(y\mid I,x)=\prod_{t=1}^{T}p\!\left(y_t\mid z,y_{<t}\right)
\]
</div>

### 2.1 VLM 会什么？

VLM 的常见任务包括：

- **Visual Question Answering**：根据图像回答问题；
- **Image Captioning**：生成从简短描述到细粒度长描述的 Caption；
- **Detection / Grounding / Segmentation**：把语言概念定位到图像区域；
- **Text-to-Image Generation**：根据文字生成或编辑图像；
- **Multimodal Retrieval**：用文字搜索图像，或用图像搜索相关内容。

评测也从“图里有什么”逐渐走向文化、场景和细节理解。传统 VQA 与 Captioning 常使用 MS-COCO、NoCaps、MSR-VTT、VATEX；更细粒度的 Caption 评测包括 DetailCaps、VDC、CapArena；MMMU 则用跨学科题目衡量多模态理解与推理。笔记中列出的 MOSAIC、GLOBAL-RG、CultureVQA、FoodieQA 与 MaRVL，进一步关注多文化、多语言与地域知识。

### 2.2 四种常见训练路线

| 路线 | 代表方法 | 模型学到什么 |
| --- | --- | --- |
| Contrastive Learning | CLIP | 拉近匹配图文的表示，推远不匹配图文 |
| Masked Modeling | FLAVA | 从被遮挡的文本或图像区域恢复信息 |
| Generative Modeling | Diffusion Model | 从噪声与条件逐步生成图像 |
| Projector + LLM | LLaVA | 把预训练视觉编码器接到 LLM，并做视觉指令微调 |

![Stable Diffusion 中视觉与文本条件如何进入生成网络](/img/posts/agentic-llm-2-action/stable-diffusion-architecture.webp)

*生成式 VLM 关注“根据条件产生视觉内容”；用于 Agent Action 的 VLM 更关注“从视觉内容中得到可用于决策的状态表示”。两者都处理多模态信息，但输出目标不同。*

## 3. 从 VLM 到 VLA：看懂不等于会行动

VLM 可以回答“桌上哪个杯子是红色的”，却不一定知道机器人应该如何靠近、抓取并放下它。原因是 VLM 主要学习图像与语言之间的对应，而 Action 还需要：

- 理解物体的三维位置、可达性与 Affordance；
- 处理连续时间、控制频率和动作历史；
- 遵守机器人本体的关节、速度和安全约束；
- 在物体移动或执行失败后重新观察并修正。

VLA 把视觉、语言与动作放进同一个策略中。训练样本不再只是图文对，而是带有观察与动作的轨迹：

<div class="math-display">
\[
\tau=\left(o_1,\ell,a_1,o_2,a_2,\ldots,o_T,a_T\right)
\]
</div>

其中 `ℓ` 是语言指令，`o_t` 可以包含相机画面与机器人状态，`a_t` 是第 `t` 步动作。策略学习的是：

<div class="math-display">
\[
\pi_{\theta}(a_t\mid o_{\le t},\ell,a_{<t})
\]
</div>

RT-2 把离散化的机器人动作写成文本 Token，使预训练 VLM 可以用原有的自回归目标共同学习语言答案与机器人控制；但并非所有 VLA 都必须“把动作写成文字”。对于高频、连续控制，π₀ 等模型会直接生成连续 Action Chunk，并用 Flow Matching 学习动作分布。

因此，VLA 的共同点不是输出格式，而是：**把视觉语义知识与可执行策略接到同一个闭环中。**

## 4. 四种代表性 VLA 路线

### 4.1 Mobility VLA：把语义导航拆成两层

[Mobility VLA](https://arxiv.org/abs/2407.07775) 处理 Multimodal Instruction Navigation with demonstration Tours（MINT）：用户既可以给语言指令，也可以用示范视频提供环境先验。

它没有让一个大模型直接输出每一步电机控制，而是采用分层架构：

1. 高层 Long-context VLM 阅读示范视频和用户指令，找出目标 Frame；
2. 低层策略在预先构建的 Topological Graph 上定位和规划；
3. 导航控制器在每个时间步生成机器人动作。

![Mobility VLA：Long-context VLM 负责目标理解，Topological Graph 与低层策略负责导航](/img/posts/agentic-llm-2-action/mobility-vla.webp)

*这个设计把 VLM 擅长的语义理解与传统导航擅长的定位、寻路分开，降低了端到端控制的难度。*

### 4.2 LM-Nav：组合预训练模型，不做额外微调

[LM-Nav](https://arxiv.org/abs/2207.04429) 说明 Action 不一定要训练一个全新的端到端模型。它组合了三个已有模块：

- LLM 从自然语言指令中提取 Landmarks；
- VLM 把这些 Landmarks Ground 到视觉路线中；
- Visual Navigation Model 执行局部导航。

![LM-Nav：LLM 提取地标，VLM 将地标与视觉路线对齐，VNM 执行导航](/img/posts/agentic-llm-2-action/lm-nav.webp)

*LM-Nav 不需要语言标注的机器人轨迹，也不需要额外微调。优势是模块可复用，代价是上游 Grounding 错误会传递给后续导航。*

### 4.3 RT-2：把机器人动作也当作 Token

[RT-2](https://arxiv.org/abs/2307.15818) 的关键不是单独训练一个机器人策略，而是把 Internet-scale Vision-Language 任务与机器人轨迹共同微调：

```text
Web-scale VQA / Caption Data ─┐
                              ├─→ VLM → Action Tokens → Robot Control
Robot Observation + Action ───┘
```

![RT-2：互联网视觉语言数据与机器人轨迹共同训练，动作 Token 再被解码为闭环控制](/img/posts/agentic-llm-2-action/rt-2.webp)

*动作被编码进与文本相同的输出词表后，模型可以把 Web 预训练获得的物体概念和语义关系迁移到机器人控制。*

这种做法的意义在于迁移：机器人数据规模远小于 Web 图文数据，而 VLM 已经从 Web 中学到了物体、属性和常识。共同训练让模型有机会把“知道能量饮料适合疲惫的人”转化为“在桌面上选择并抓取能量饮料”。

### 4.4 π₀：用 Flow Matching 生成连续动作

[π₀](https://arxiv.org/abs/2410.24164) 在预训练 VLM 之上增加 Action Expert，并使用来自多种机器人形态的数据学习通用控制。它不把所有低层动作离散成文本 Token，而是用 Flow Matching 生成连续 Action Chunk，更适合灵巧操作与高维控制。

| 系统 | 高层语义来源 | 动作产生方式 | 主要特点 |
| --- | --- | --- | --- |
| Mobility VLA | Long-context VLM | Topological Graph + 低层策略 | 分层导航，语义与控制解耦 |
| LM-Nav | GPT-3 + CLIP | 预训练 Visual Navigation Model | 模块组合，无额外微调 |
| RT-2 | Web-scale VLM | 离散 Action Token | 端到端共同微调，迁移 Web 知识 |
| π₀ | 预训练 VLM | Flow Matching 连续 Action Chunk | 跨机器人形态、灵巧操作 |

## 5. VLA 是怎样学会行动的？

一个实用的 VLA 训练流程通常包含三层数据：

```text
Internet Image–Text Data
          ↓
视觉语义预训练：物体、属性、关系、常识
          ↓
Robot Trajectories: (observation, instruction, action)
          ↓
行为克隆 / Action Prediction / Co-fine-tuning
          ↓
真实或模拟环境中的微调、强化学习与安全约束
```

其中最常见的基础目标是 Behavior Cloning：最大化示范动作在当前观察和指令下的概率。

<div class="math-display">
\[
\mathcal{L}_{\text{BC}}(\theta)
=-\sum_{t=1}^{T}\log \pi_{\theta}
\!\left(a_t\mid o_{\le t},\ell,a_{<t}\right)
\]
</div>

把 `(state, action, reward)` 序列交给 Transformer 并不是 VLA 独有的做法。[Decision Transformer](https://arxiv.org/abs/2106.01345) 早已把 Offline RL 表述为条件序列建模：给定期望 Return、历史 State 与 Action，预测下一步 Action。VLA 在此基础上加入了原始视觉、自然语言和机器人本体状态，并继承 VLM 的大规模语义知识。

真正困难的部分也由此显现：

1. **Robot Data 昂贵**：Web 上有海量图文，却没有同等规模的高质量控制轨迹；
2. **Embodiment 不同**：同一动作在不同机械臂、相机和夹爪上参数不同；
3. **Distribution Shift**：光照、位置或物体稍变，动作误差就可能积累；
4. **Long-horizon Credit Assignment**：最终失败可能源自几十步前的一次抓取偏差；
5. **Safety**：真实机器人不能像文本模型一样无限试错。

## 6. World Model：在行动之前先预测后果

只根据当前画面直接输出动作是一种 Reactive Policy。它可以工作，但不容易回答一个更重要的问题：

> 如果执行这个动作，接下来可能发生什么？

World Model 试图学习环境的 Transition 与 Reward。若真实环境的动态与奖励函数分别为 `T` 和 `R`，学习到的局部近似模型可以写成：

<div class="math-display">
\[
\hat{s}_{t+1}=\hat{T}_{\phi}(s_t,a_t),\qquad
\hat{r}_t=\hat{R}_{\phi}(s_t,a_t)
\]
</div>

有了这个模型，Agent 可以在内部 Rollout 多个候选动作，不必每次都在昂贵或危险的真实环境中尝试：

<div class="math-display">
\[
a_t^{*}=\underset{a_t}{\operatorname{arg\,max}}
\;\mathbb{E}_{\hat{T}_{\phi}}
\left[\sum_{k=0}^{H-1}\gamma^k\hat{r}_{t+k}\right]
\]
</div>

![Model-Based RL：Agent 用真实环境数据改进局部 World Model，再利用模型训练或规划策略](/img/posts/agentic-llm-2-action/model-based-rl.webp)

*真实环境提供 Ground Truth，但采样昂贵；局部模型采样便宜，却会有 Model Error。Model-Based RL 的核心是在两者之间取得平衡。*

### 6.1 Model-Based RL 与 Model-Free RL

| 方法 | 学什么 | 优势 | 风险 |
| --- | --- | --- | --- |
| Model-Free RL | 直接学习 Policy 或 Value | 避免显式建模错误 | 真实交互样本需求大 |
| Model-Based RL | 学习 Dynamics / Reward，再规划或训练 Policy | 更高 Sample Efficiency，可先模拟后执行 | 多步 Rollout 会放大模型误差 |

Model-Based RL 也把现代 Agent 与经典 Planning 重新连接起来。Tree Search、Graph Search 和 Symbolic Planner 负责显式比较路径；神经网络则负责感知、状态压缩和近似 Dynamics。

JEPA 提供了另一种思路：不强求在 Pixel Space 精确生成下一帧，而是在 Latent Space 预测未来表示。对于规划而言，“杯子会向右移动、桌面仍可达”往往比生成每个像素更重要。

## 7. Agentic World Model 的两个方向

LLM 与 Model-Based RL 的结合可以从两个相反方向理解。

### 7.1 LLM4MBRL：让 LLM 充当 World Model

预训练 LLM 已经包含大量关于网页、游戏规则、常识和物理关系的知识。系统可以要求它预测候选动作的后果，再用 Tree Search 或 Model Predictive Control 选择动作。

[WebDreamer](https://arxiv.org/abs/2411.06559) 就用 LLM “想象”网页操作的可能结果：与其直接在真实网站上尝试不可逆的购买动作，不如先比较“点击这个按钮之后会发生什么”。这是一种 **Model-based speculative planning**。

[WorldGPT](https://arxiv.org/abs/2404.18202) 则从多模态状态序列中学习跨模态状态转移，试图把 LLM 扩展为可预测视觉、视频与音频变化的通用 World Model。

### 7.2 MBRL4LLM：通过环境交互训练可适应的模型

另一条路线不把预训练 LLM 当成静态模拟器，而是让模型在环境反馈中持续修正自己的 Transition 假设。

[WorldCoder](https://arxiv.org/abs/2402.12275) 让 Agent 写出一个 Python 程序来表示世界规则。新观察与程序预测不一致时，Agent 修改代码；Planner 再使用这个可执行模型寻找高回报路径。世界知识因此不只存在于 Prompt 中，而成为可检查、可执行、可更新的显式模型。

可以把两条路线概括为：

| 方向 | World Model 从哪里来 | 如何改进 |
| --- | --- | --- |
| LLM4MBRL | 主要来自预训练模型的已有知识 | Prompt、Search、外部 Memory 与 Planning Harness |
| MBRL4LLM | 从环境轨迹学习或重建 Dynamics | Fine-tuning、RL、程序修正与持续交互 |

前者启动快，但可能自信地模拟错误；后者更能适应具体环境，却需要高质量交互数据与稳定的更新机制。

## 8. 统一比较：LLM、VLM、Decision Transformer、VLA 与 World Model

这些名词经常同时出现，但它们解决的是不同接口问题。

| 模型 | 主要输入 | 主要输出 | 核心目标 |
| --- | --- | --- | --- |
| LLM | 文本 Token | 文本 Token | 建模语言、知识与推理模式 |
| VLM | 图像 / 视频 + 文本 | 文本或视觉内容 | 连接视觉语义与语言 |
| Decision Transformer | Return + State + Action History | 下一步 Action | 把 Offline RL 表述为条件序列建模 |
| VLA | 视觉 + 指令 + Robot State | Robot Action / Action Chunk | 把语义理解连接到可执行控制 |
| World Model | State + Candidate Action | Future State + Reward / Outcome | 在执行前预测环境变化 |

它们不是互斥的。一个现代 Embodied Agent 可能同时使用：

```text
VLM：理解当前场景
  ↓
LLM / Planner：拆解目标并提出候选动作
  ↓
World Model：模拟候选动作的后果
  ↓
VLA / Controller：把选中的动作变成连续控制
  ↓
Environment：返回新观察
```

## 9. 从 Demo 到可部署系统，还缺什么？

Action Model 的论文 Demo 往往展示“模型成功完成任务”；工程系统还必须处理失败、权限和不确定性。

### 9.1 Grounding 与可执行性

语言计划可能合理，却引用了不存在的物体、不可达的位置或当前机器人没有的能力。Action Space 必须由环境真实暴露，而不是由模型自由想象。

### 9.2 不确定性与恢复策略

系统不能只输出动作，还需要知道何时应该停下来重新观察、请求确认或回退。闭环成功率往往取决于 Recovery，而不是单步准确率。

### 9.3 权限与安全边界

“能够生成动作”不等于“被授权执行动作”。高风险系统应区分：

<div class="math-display">
\[
\text{Can Propose} \;\neq\; \text{Can Execute} \;\neq\; \text{Can Execute Without Approval}
\]
</div>

### 9.4 端到端指标

VQA 准确率高不代表机器人任务成功。Action 系统最终需要用 Task Success、Completion Time、Intervention Rate、Safety Violation、Recovery Success 和真实成本来评估。

## 10. 总结：Action 是一条从语义到后果的链

Action 不是在模型输出末尾加一个 Function Call。它要求系统依次解决四个问题：

1. **Perception**：环境中有什么？
2. **Grounding**：语言目标对应哪些对象、位置和约束？
3. **Control**：如何把目标变成可执行动作？
4. **Prediction**：动作之后可能发生什么，失败后如何恢复？

VLM 让 Agent 看见并理解环境；VLA 把视觉与语言映射为行动；World Model 则让 Agent 在执行前比较可能的未来。三者结合后，Reasoning 才能越过文本边界，成为真正改变环境的能力。

下一篇会继续讨论 **Interaction**：Action 执行后，Agent 如何读取 Observation、管理不断变化的状态、与人或其他 Agent 协作，并在长任务中形成稳定闭环。

## 参考资料

- [Visual Instruction Tuning (LLaVA)](https://arxiv.org/abs/2304.08485)
- [LM-Nav: Robotic Navigation with Large Pre-Trained Models of Language, Vision, and Action](https://arxiv.org/abs/2207.04429)
- [RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818)
- [Mobility VLA: Multimodal Instruction Navigation with Long-Context VLMs and Topological Graphs](https://arxiv.org/abs/2407.07775)
- [π₀: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164)
- [Decision Transformer: Reinforcement Learning via Sequence Modeling](https://arxiv.org/abs/2106.01345)
- [Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture](https://arxiv.org/abs/2301.08243)
- [WorldGPT: Empowering LLM as Multimodal World Model](https://arxiv.org/abs/2404.18202)
- [WebDreamer: Model-Based Planning for Web Agents](https://arxiv.org/abs/2411.06559)
- [WorldCoder, a Model-Based LLM Agent](https://arxiv.org/abs/2402.12275)
