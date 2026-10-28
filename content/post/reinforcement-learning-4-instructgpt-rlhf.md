---
title: "强化学习（四）：InstructGPT 风格的 RLHF"
date: 2026-10-28
slug: "reinforcement-learning-4-instructgpt-rlhf"
description: "沿着 SFT、Reward Model、PPO 三阶段理解 RLHF，并逐段阅读 Hands-On Modern RL v0.2.1 的三个 Python 脚本，解释 loss mask、偏好损失、KL、优势与教学实现的边界，附完整代码下载。"
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, RLHF, InstructGPT, SFT, Reward Model, PPO, PyTorch]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

预训练语言模型通过预测下一个 token 学习文本中的规律。要把它训练成能回答问题、遵循指令的助手，还需要示范回答和偏好数据。

InstructGPT 的训练分为三个阶段：先用 SFT 学习示范回答，再训练 Reward Model 评价回答，最后用 PPO 根据奖励更新策略。

三个阶段的实现可以对照 [`chapter08_rlhf`](https://github.com/walkinglabs/hands-on-modern-rl/tree/main/code/chapter08_rlhf) 中的 Python 文件阅读，完整代码见文末。

<!--more-->

> **系列前文**：[（一）基础、MDP 与贝尔曼方程](/post/reinforcement-learning-1-foundations/) · [（二）从 Q-Learning 到 PPO](/post/reinforcement-learning-2-classic-algorithms/) · [（三）探索、采样与数据](/post/reinforcement-learning-3-exploration-and-data/)。本文是第四篇，DPO、GRPO 和 Agentic RL 留待后续展开。

**代码版本**：[Hands-On Modern RL v0.2.1](https://github.com/walkinglabs/hands-on-modern-rl/releases/tag/v0.2.1)，commit `051b2ff0210c718091692d37ee26d08613ad0be8`。示例基于 Qwen2.5-0.5B-Instruct，PPO 部分采用了简化实现。

![SFT、Reward Model 与 PPO 三阶段流程，以及冻结参考模型和评估的关系](/img/posts/instructgpt-rlhf/three-stages.en.svg)

*SFT 模型用于初始化 Actor 和冻结的 Reference；训练好的 RM 为 PPO 提供奖励。方法来源：[InstructGPT](https://openai.com/index/instruction-following/)。*

## 1. 三阶段的数据与产物

| 阶段 | 数据长什么样 | 学习什么 | 主要产物 |
| --- | --- | --- | --- |
| SFT | 用户输入 + 示范回答 | 提高示范回答的生成概率 | 能按指令回答的策略起点 |
| Reward Model | 同一个问题 + chosen / rejected | 给更受偏好的回答更高分 | 标量奖励模型 |
| PPO | 问题 + 当前策略自己生成的回答 | 提高高奖励行为的概率，并控制偏离 | 更新后的策略模型 |

同一个问题可以出现在不同训练阶段，但监督信息不同。SFT 要知道“理想回答是什么”；RM 要知道“这两个回答哪个更好”；PPO rollout 时通常只需要问题，回答由当前 Actor 生成。

例如，让模型解释 PPO：SFT 给出一段人工示范；RM 比较一段准确解释与一段空泛解释；PPO 则对模型新生成的解释打分，再更新模型。**PPO 不需要逐 token 的标准答案，但需要可信的奖励信号。**

实现这三阶段的入口是：

```text
sft_pipeline.py
  → output/sft_results/sft_model

reward_model_training.py
  → output/rm_results/value_head.pt

rlhf_ppo_train.py
  → output/ppo_results/aligned_model
```

## 2. Step 1：SFT，用示范教模型怎样回答

### 从“合理续写”到“完成用户任务”

预训练模型的基本任务是：给定前面的文本，预测下一个 token。输入“请解释什么是强化学习”，模型可能开始解释，也可能继续列出“请解释什么是监督学习”“请解释什么是无监督学习”。后一种续写在某些文本分布里也很合理。

SFT（Supervised Fine-Tuning）用经过选择的指令与示范回答，让训练集中呈现的行为更接近我们需要的助手行为。例如：

```json
{
  "messages": [
    {"role": "system", "content": "你是一个清晰、诚实、简洁的强化学习助教。"},
    {"role": "user", "content": "请解释什么是价值函数。"},
    {"role": "assistant", "content": "价值函数估计从某个状态开始，按某个策略行动能够获得的期望累积回报。"}
  ],
  "source": "human_written",
  "quality": "verified"
}
```

这里的 `source`、`quality` 是数据管理字段，不是语言模型必须生成的回答内容。

### SFT loss 到底在优化什么？

给定问题 `x` 和示范回答 `y`，回答部分的负对数似然是：

<div class="math-display">
\[
L_{\mathrm{SFT}}(\theta)
=-\sum_{t=1}^{T}\log\pi_\theta(y_t\mid x,y_{\lt t}).
\]
</div>

其中，`θ` 是模型参数；`y_t` 是示范回答的第 `t` 个 token；`y_<t` 是它前面的**正确示范 token**；`T` 是回答长度。`log` 为自然对数，前面的负号把“提高正确 token 的概率”变为“最小化损失”。实际训练通常还会在有效 token 或 batch 上取平均。

如果下一 token 应当是“巴黎”，模型却只给它 0.1 的概率，这一项损失约为 2.303；概率提高到 0.8，损失就降到约 0.223。反向传播会推动模型在类似上下文中提高正确 token 的概率。

这也是 Teacher Forcing：训练时给模型看示范的前缀，而不是让它每步都接着自己的错误回答往下写。目标依然是 next-token prediction，只是数据与需要监督的位置发生了变化。

### 源码：先构造数据，再应用 Chat Template

[`sft_pipeline.py`](https://github.com/walkinglabs/hands-on-modern-rl/blob/051b2ff0210c718091692d37ee26d08613ad0be8/code/chapter08_rlhf/sft_pipeline.py) 的 `generate_sft_data()` 返回手写的 instruction-response 列表，覆盖数学、写作、编程和知识问答。名字和打印信息提到 Self-Instruct 风格，但代码**没有调用另一个模型自动生成数据**。

列表包含 **14 条**样本，打印的分类计数多算了一条。这组小数据用于演示训练流程。

`format_sft_dataset()` 的关键部分是：

```python
messages = [
    {"role": "user", "content": pair["instruction"]},
    {"role": "assistant", "content": pair["response"]},
]
text = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=False,
)
formatted_texts.append(text)
```

Chat Template 负责把角色和内容转换成模型认识的分隔格式。训练样本已经包含 assistant 回答，因此这里不需要额外追加一个等待生成的 assistant 开头。推理时只有用户问题，才使用 `add_generation_prompt=True`。

随后传入的是 `Dataset.from_dict({"text": formatted_texts})`：一列完整的对话字符串。

### 源码：训练配置与一个容易忽略的 mask

训练由 `SFTTrainer` 执行：

```python
sft_config = SFTConfig(
    output_dir="./output/sft_results",
    per_device_train_batch_size=2,
    learning_rate=2e-5,
    num_train_epochs=2,
    max_length=512,
    logging_steps=1,
    save_strategy="epoch",
    report_to="none",
    fp16=False,
)

trainer = SFTTrainer(
    model=model,
    args=sft_config,
    train_dataset=train_dataset,
    processing_class=tokenizer,
)
train_result = trainer.train()
```

加载的 **Qwen/Qwen2.5-0.5B-Instruct** 已经经过指令训练，这里是在它的基础上继续微调。

源码把整个对话放进 `text`，没有构造回答 mask。按 TRL 0.24.0 的默认行为，system、user 和 assistant 文本都会参与语言建模损失；上面的公式则只计算回答部分。Chat Template 负责格式，不负责划定哪些 token 参与 loss。

要实现回答部分监督，常见办法是把输入与回答分开，或显式构造 labels，将非回答位置设为 `-100`。概念上可以写成：

```python
# 解释性示意：假设 prompt 与完整序列的 token 边界已正确对齐。
labels = input_ids.clone()
labels[:prompt_length] = -100
labels[attention_mask == 0] = -100
```

`-100` 是这里用于忽略损失的位置，不是 token id，也不是让模型看不到输入。模型仍能关注 prompt，只是不需要学习生成它。

TRL 0.24.0 支持 conversational 数据的 `assistant_only_loss=True`，需要配合能返回 assistant mask 的模板使用。采用这种方式时，也要把现有 `text` 数据改为对应的对话结构。详见 [SFT 文档](https://huggingface.co/docs/trl/v0.24.0/en/sft_trainer)。

SFT 完成后保存模型和 tokenizer。接下来用偏好对训练 RM，让它学习回答之间的优劣。

## 3. Step 2：Reward Model，用比较教裁判怎样打分

### 偏好数据不要求一个唯一正确答案

“准确、有帮助、清楚”很难写成完整规则，但比较两个回答通常更容易。偏好样本可以写成：

```json
{
  "prompt": "请解释 PPO 中的 KL 惩罚。",
  "chosen": "KL 惩罚限制策略偏离参考模型太远，减少为了追求奖励而产生的失控变化。",
  "rejected": "KL 惩罚就是一个数学公式，PPO 会用它，所以很重要。",
  "labeler": "human_or_judge",
  "rubric": ["accuracy", "helpfulness", "clarity"]
}
```

Reward Model 输入完整的“问题 + 回答”，输出一个实数 `r_φ(x,y)`，其中 `φ` 是奖励模型参数。它不必生成一段解释，而是学习让 chosen 的分数高于 rejected。

### 从分差到偏好概率，再到 loss

把更受偏好的回答记为 `y_w`，另一个记为 `y_l`，定义分差：

<div class="math-display">
\[
m=r_\phi(x,y_w)-r_\phi(x,y_l).
\]
</div>

用 Bradley–Terry 形式把它转成偏好概率：

<div class="math-display">
\[
P_\phi(y_w\succ y_l\mid x)=\sigma(m),
\qquad \sigma(m)=\frac{1}{1+e^{-m}}.
\]
</div>

标签已经告诉我们人类选择了 `y_w`，所以希望这个选择的概率越大越好。取负对数得到：

<div class="math-display">
\[
L_{\mathrm{RM}}(\phi)
=-\log\sigma\!\left(r_\phi(x,y_w)-r_\phi(x,y_l)\right).
\]
</div>

当分差为 `2`，预测偏好概率约为 0.881，loss 约为 0.127；分差为 `0`，概率为 0.5，loss 约为 0.693；分差为 `-2`，排序反了，loss 约为 2.127。

**排序反了，惩罚大；chosen 领先，损失小。** 这不意味着 chosen 在所有方面都绝对正确，只表示它是这条比较数据里的优选项。

### 源码：最后一个有效 token 接一个标量 head

[`reward_model_training.py`](https://github.com/walkinglabs/hands-on-modern-rl/blob/051b2ff0210c718091692d37ee26d08613ad0be8/code/chapter08_rlhf/reward_model_training.py) 为 chosen 和 rejected 分别拼接同一个 prompt，再编码为最长 256 token 的序列。

`RewardModel` 在语言模型上增加 `nn.Linear(hidden_size, 1)`。关键前向计算如下，省略了注释：

```python
outputs = self.base_model(
    input_ids=input_ids,
    attention_mask=attention_mask,
    output_hidden_states=True,
)
last_hidden = outputs.hidden_states[-1]
sequence_lengths = attention_mask.sum(dim=1) - 1
batch_size = input_ids.shape[0]
last_token_hidden = last_hidden[
    torch.arange(batch_size), sequence_lengths
]
reward = self.value_head(last_token_hidden).squeeze(-1)
```

形状沿着 `input_ids: [B,L] → last_hidden: [B,L,H] → last_token_hidden: [B,H] → reward: [B]` 变化。最后一个有效位置已经能关注前面的完整序列，因此可以作为评分的输入表示。

`attention_mask.sum()-1` 这种索引写法依赖**右侧 padding**。改成左侧 padding 后，它不再表示最后一个有效位置；长回答也可能被 256 token 的截断切掉尾部。评分到底看到了哪些内容，需要一起检查。

这里的 `value_head` 输出回答的奖励分数；PPO 中的 Critic 则估计未来回报，两者的训练目标不同。

训练循环的核心只有几行：

```python
r_chosen = model(chosen_ids, chosen_mask)
r_rejected = model(rejected_ids, rejected_mask)
loss = -torch.log(torch.sigmoid(r_chosen - r_rejected)).mean()

optimizer.zero_grad()
loss.backward()
optimizer.step()
```

这项损失也可以写成数值上更稳定的 `-F.logsigmoid(r_chosen - r_rejected).mean()`。

### accuracy 和 margin 要一起看，但分差不是绝对质量

源码通过 `r_chosen > r_rejected` 计算排序准确率。实际生成的是 **19 对数据**，划分后为 16 对训练、3 对测试，而不是注释写的 20 对、4 对测试。测试集只有三对时，准确率每次变化就是约 33.3 个百分点，不能据此推断稳健泛化。

margin 能帮助发现信号是否塌缩，但也不是越大越好。成对损失只约束相对分差，不提供天然的绝对分数标尺；整体平移分数不改变排序，缩放分数却会影响后续 RL 的奖励尺度。需要一起看 held-out 排序、分差分布、回答长度偏差和人工样本。

尤其不要把“礼貌、长、带编号”直接当成“正确、有帮助”。如果偏好数据总让长回答获胜，RM 很可能把长度当捷径，PPO 又会进一步放大这个偏差。

### 代码衔接：为什么只保存 head 还不够？

RM 的优化器接收 `reward_model.parameters()`，骨干没有被冻结，因此骨干和评分头都会更新。但保存时只写了：

```python
torch.save(
    reward_model.value_head.state_dict(),
    os.path.join(save_dir, "value_head.pt"),
)
```

PPO 脚本随后加载原始 Qwen 骨干，再接这个已训练 head，**并没有恢复训练后的完整 RM**。head 所接收的表示已经变了，分数不能被当成原 RM 的连续输出。

加载完整 RM 需要同时恢复训练后的骨干、评分头、tokenizer 和配置，并检查固定样本在保存前后的分数是否一致。如果选择只保存 head，就应在训练开始时冻结骨干，只更新评分头。

## 4. Step 3：PPO，让模型根据奖励练习

### 把语言生成看成序列决策

对一个问题 `x`，模型逐 token 生成回答。此时：

| RL 要素 | 语言生成中的对应物 |
| --- | --- |
| 状态 | 问题 + 已生成回答前缀 |
| 动作 | 下一个 token |
| 策略 | 语言模型的 next-token 概率分布 |
| 状态转移 | 把新 token 追加到前缀 |
| episode | 从开始生成到 EOS 或长度上限 |
| 任务奖励 | RM 对完整问题与回答的评分 |

RM 通常在完整回答结束后才给一个分数。Credit Assignment 的难点也就出现了：低分到底是因为开头答错，还是后半段跑偏？Critic 与优势估计帮助把回报变成更稳定的 token 级更新信号，而不是直接把一个分数不加区别地乘到整段文本上。

### 四个角色，只有两个需要更新

| 角色 | 做什么 | 是否更新 |
| --- | --- | --- |
| Actor | 生成回答，学习提高奖励 | 是 |
| Reference | 冻结的 SFT 策略，限制长期偏离 | 否 |
| Reward Model | 评价完整回答 | 通常在这轮 PPO 中冻结 |
| Critic | 预测当前前缀的未来回报，辅助优势估计 | 是 |

这四个角色可以共享部分模型结构。RM 负责给回答打分，Critic 负责预测当前前缀的未来回报，提供优势估计所需的基线。

### 为什么奖励里还要扣掉 KL？

如果只最大化 RM 分数，Actor 可能学会讨好裁判，例如重复堆砌长段落，让回答看起来完整，却没有解决问题。

更准确的序列级目标是：

<div class="math-display">
\[
\begin{aligned}
J(\theta)&=\mathbb E_{x}\Bigl[
\mathbb E_{y\sim\pi_\theta(\cdot\mid x)}r_\phi(x,y)\\
&\qquad-\beta D_{\mathrm{KL}}\!\left(
\pi_\theta(\cdot\mid x)\,\|\,\pi_{\mathrm{ref}}(\cdot\mid x)
\right)\Bigr].
\end{aligned}
\]
</div>

`π_θ` 是当前 Actor；`π_ref` 是冻结 Reference；点号 `·` 表示所有可能回答；`β` 控制惩罚强度。`φ` 是 RM 的参数，`θ` 是 Actor 的参数。

KL 衡量给定同一个问题时，Actor 与 Reference 对各种可能回答分配的概率有多大差异。

从当前策略采样一个回答后，可以用下面的 sampled score 估计这个目标中的奖励：

<div class="math-display">
\[
\widetilde R(x,y)=r_\phi(x,y)
-\beta\log\frac{\pi_\theta(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}.
\]
</div>

在当前策略下取期望，log-ratio 对应序列 KL。单个样本的 log-ratio 可以为负，**不能把每个样本的值都当成非负的完整 KL**。

实际 rollout 往往由暂时固定的 `π_old` 生成，此时可按 token 构造奖励：

<div class="math-display">
\[
\begin{aligned}
k_t&=\log\frac{\pi_{\mathrm{old}}(y_t\mid s_t)}
{\pi_{\mathrm{ref}}(y_t\mid s_t)},\\
\widetilde r_t&=-\beta k_t
+\mathbf 1_{t=T}\,r_\phi(x,y).
\end{aligned}
\]
</div>

也就是每一步承担偏离 Reference 的代价，最后一个有效回答 token 再接上整段 RM 奖励。还有其他等价或近似实现，但必须确认 KL 真正通过奖励塑形或可微损失影响更新，而不是只出现在日志里。

### Critic 和 Advantage：比预期好多少？

Critic 的 `V_ψ(s_t)` 估计从当前前缀继续生成的预期回报。如果实际回报超过预期，优势为正；低于预期，优势为负。一个常见的 GAE 写法是：

<div class="math-display">
\[
\begin{aligned}
\delta_t&=\widetilde r_t+\gamma V_\psi(s_{t+1})-V_\psi(s_t),\\
\widehat A_t&=\sum_{l=0}^{T-t}(\gamma\lambda)^l\delta_{t+l}.
\end{aligned}
\]
</div>

终止状态的 value 通常设为零；若是长度截断，是否 bootstrap 则要按任务定义处理。`γ` 是折扣，`λ` 控制偏差与方差的取舍。优势告诉 Actor“这一步比当前预期更好还是更差”，Critic 则另有 value 回归损失，不能只计算优势却不训练 value。

### PPO clip 与 Reference KL 约束的不是同一件事

PPO 用新策略与**采样时的旧策略**计算比例：

<div class="math-display">
\[
\rho_t(\theta)=
\frac{\pi_\theta(y_t\mid s_t)}{\pi_{\mathrm{old}}(y_t\mid s_t)}.
\]
</div>

然后最大化裁剪目标：

<div class="math-display">
\[
\begin{aligned}
L_{\mathrm{clip}}(\theta)=\mathbb E_t\Bigl[\min\bigl(&
\rho_t(\theta)\widehat A_t,\\
&\operatorname{clip}(\rho_t(\theta),1-\epsilon,1+\epsilon)
\widehat A_t\bigr)\Bigr].
\end{aligned}
\]
</div>

优势为正时，希望提高对应动作的概率，但过大的提升不再带来额外收益；优势为负时，希望降低概率，也限制单次压低的幅度。这不是硬性保证所有概率比都留在区间内，而是改变优化目标，让过激更新不再占便宜。

**Old policy 是每轮 rollout 的采样快照，Reference 是较长期固定的 SFT 锚点。** clip 控制这一轮改多少，Reference KL 控制相对起点偏离多少，不能把两者写成同一个分母。PPO 的多轮 minibatch 更新机制可对照 [PPO 论文](https://arxiv.org/abs/1707.06347)。

## 5. 阅读 PPO 源码：生成、评分、更新之间发生了什么

### Actor 与 Reference 的初始化

[`rlhf_ppo_train.py`](https://github.com/walkinglabs/hands-on-modern-rl/blob/051b2ff0210c718091692d37ee26d08613ad0be8/code/chapter08_rlhf/rlhf_ppo_train.py) 先尝试读取 SFT 保存路径；找不到时，直接回退到原始 Qwen Instruct checkpoint。

```python
reference_model = copy.deepcopy(policy_model)
reference_model.eval()
for param in reference_model.parameters():
    param.requires_grad = False
```

Reference 是 Actor 的冻结副本。这里的 `PPOTrainer` 是脚本自己定义的类，与 TRL 的同名类无关。

### 奖励可能来自规则，也可能是混合分数

找不到 `value_head.pt` 时，`SimpleRewardModel` 使用长度、列表、代码块、礼貌用语等规则打分。有 head 时，则重新加载 Qwen 骨干，并使用：

```python
return 0.5 * reward + 0.5 * rule_score
```

这意味着这里的 reward 不一定是纯人类偏好 RM。两种分数的尺度也未必可比，系数各为 0.5 不代表影响就各占一半。

规则分数同样可能被钻空子：无关回答加上“好的”“以下”和代码围栏，也可能得分更高。检查输出格式不等于检查语义正确，reward 上升也不自动意味着更有帮助。

### 优势：这里没有 Critic，也没有 GAE

源码的做法是：

```python
rewards_tensor = torch.tensor(batch_rewards, dtype=torch.float32)
advantages = rewards_tensor - rewards_tensor.mean()
advantages = advantages / (advantages.std() + 1e-8)
```

这是把一批回答的奖励中心化、标准化，每个回答得到一个标量优势。batch 内是不同问题，因此问题难度与奖励尺度可能被混在一起；它不是按前缀训练的 value baseline，也不是同一问题多个候选的 GRPO 组内比较。

因此，同一段回答的所有生成位置共用这个标量，而标准 Actor-Critic PPO 会根据各位置的状态估计 token 级优势。

### log probability：取平均之后，比例的含义变了

`compute_log_probs()` 先把 logits 与下一个真实 token 对齐：

```python
shift_logits = logits[:, :-1, :]
shift_labels = input_ids[:, 1:]
log_probs = F.log_softmax(shift_logits, dim=-1)
token_log_probs = log_probs.gather(
    2, shift_labels.unsqueeze(-1)
).squeeze(-1)

shift_mask = attention_mask[:, 1:]
token_log_probs = token_log_probs * shift_mask
return token_log_probs.sum(dim=-1) / shift_mask.sum(dim=-1)
```

前半段做了 causal LM 常见的 shift 和 gather；最后返回的是**有效 token 的平均 log probability**。而传入的序列包含 prompt 与 response，mask 只去掉 padding，没有去掉 prompt。

完整回答的 log probability 应当对**回答 token**求和；标准 token-level PPO 则保留每个回答 token 的 log probability 和 response mask。这份代码先混合 prompt、取均值，再指数化做 ratio，得到的不是标准 token 概率比，也不是回答联合概率比。

代码已经拿到了 `input_len`，但没有用它构造 response mask。若 prompt 长度为 `P`，shift 后第 `P-1` 个位置才预测第一个 response token；修正时还要避免差一位错误。

### clip 写出来了，但没有多轮复用 rollout

源码保存更新前策略的 log probability，再计算：

```python
ratio = torch.exp(new_log_prob - old_log_p)
surr1 = ratio * advantage
surr2 = torch.clamp(
    ratio, 1.0 - self.clip_range, 1.0 + self.clip_range
) * advantage
policy_loss = -torch.min(surr1, surr2)
```

`old_log_p` 来自更新前的 Actor。文件类注释把分母写成了 `π_ref`，与这里的实现不符。

每批 rollout 只做一次 `optimizer.step()`。在前向确定且更新前参数相同的情况下，新旧概率比起始为 1，这次梯度可以非零，但 clip 并没有机会限制同批数据上的后续大步更新。若 dropout 等使前向有噪声，ratio 的差异也不等于策略已经发生了有效更新。

此外，生成使用 temperature 和 top-p，后续算概率却直接使用未经同样变换的 logits，采样分布与用于 ratio 的分布并不严格一致。它适合展示循环结构，不适合用于验证 PPO clipping 的实际效果。

### KL 没有参与梯度计算

`compute_kl_divergence()` 在 `torch.no_grad()` 内计算各前缀上的词表 KL，最后 `return kl_div.item()`，转成 Python 浮点数。

训练时又把这些浮点数相加：

```python
avg_kl = sum(batch_kl) / len(batch_kl)
kl_penalty = self.kl_coef * avg_kl
total_loss = avg_policy_loss + kl_penalty
total_loss.backward()
```

**日志里的 total loss 含有 KL，但梯度里没有 KL。** 加一个与参数计算图脱离的常数，不会改变 `avg_policy_loss` 对参数的导数；而源码的 advantages 里也没有扣 KL，所以这里并不存在另一条奖励塑形路径来补上约束。

有两种常见的正确思路：

- 在 rollout 时，把采样的 Reference log-ratio 放进 token reward，再据此计算 return 与 advantage。奖励本身可以 detach，因为它随后作为策略梯度的权重。
- 在训练损失里加入可微 KL 项，保留 Actor 计算图，只冻结 Reference。应只在定义好的回答位置上归约，并明确优化的是哪个 KL 估计。

第二种方式的 KL 项可以这样计算：

```python
policy_logp = F.log_softmax(policy_logits, dim=-1)
with torch.no_grad():
    ref_logp = F.log_softmax(ref_logits, dim=-1)

kl_per_token = (
    policy_logp.exp() * (policy_logp - ref_logp)
).sum(dim=-1)
kl_loss = (kl_per_token * response_mask).sum() / response_mask.sum()
loss = policy_loss + beta * kl_loss
```

两个 logits 需要按“预测下一个回答 token”的位置对齐，`response_mask` 排除 prompt 与 padding，且至少包含一个有效回答 token。这段代码只计算可微 KL；旧策略快照、value loss、优势估计和 minibatch 更新仍由训练循环处理。

## 6. 怎样知道三阶段真的带来了改进？

不能只看 reward 曲线。RM 是偏好的代理，Actor 可能越来越会利用代理漏洞，却越来越偏离用户需要。

至少保留三层评估：固定任务集检查指令遵循、代码、简单推理与事实问答；盲测比较 SFT 与 RLHF 回答的偏好胜率；人工抽检高分样本是否真的解决问题。

| 检查项 | 希望确认什么 | 值得警惕的现象 |
| --- | --- | --- |
| SFT loss 与留出集 | 示范是否学到了、是否过拟合 | train loss 下降，留出表现变差 |
| RM accuracy 与 margin | 能否给没见过的回答正确排序 | 只偏爱长文、礼貌措辞或固定模板 |
| Reference KL | 偏离初始策略的速度是否合理 | KL 很快升高；或记录了却没实际约束 |
| 回答长度与重复率 | reward 是否被表面特征带高 | 越答越长、重复、泛泛而谈 |
| 偏好胜率与原有能力 | 是否更符合偏好且没有明显退化 | reward 上升，盲测或代码测试反而下降 |

原脚本记录了训练前后样例、RM 测试结果和 reward / KL / length 曲线；能力回归与偏好盲测需要另行准备数据。

反馈来源也会影响目标本身：

| 来源 | 适合做什么 | 需要注意什么 |
| --- | --- | --- |
| 人类标注 | 高质量示范、偏好校准与最终评估 | 成本与标注一致性 |
| AI Judge / RLAIF | 扩充比较数据、加快迭代 | Judge 的系统性偏差会被放大 |
| 规则验证 | 数学答案、代码测试、格式约束 | 检查器覆盖不全也可能被利用 |
| 线上反馈 | 发现真实需求与失败案例 | 点赞、复制等行为有噪声，不能直接当真值 |

人类偏好、AI 评分和规则奖励对应不同的训练信号。这个例子中，偏好数据是预先写好的比较对，PPO 阶段还混入了规则分数。

## 7. 代码文件、运行顺序与版本记录

**[下载完整代码包](/downloads/instructgpt-rlhf/chapter08-rlhf-v0.2.1.zip)**

附件保留 v0.2.1 原始代码。正文补充了 loss mask、稳定损失和可微 KL 的写法。

原依赖锁定 `transformers==4.57.3`、`trl==0.24.0`、`datasets==4.4.1`、`accelerate==1.10.1`，PyTorch 只要求 `>=2.0.0`；最后两个脚本还导入了未列入 requirements 的 `matplotlib`。在代码目录创建隔离环境后，运行顺序如下：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install matplotlib

python sft_pipeline.py
python reward_model_training.py
python rlhf_ppo_train.py
```

### 来源与许可

- [Hands-On Modern RL v0.2.1 源码](https://github.com/walkinglabs/hands-on-modern-rl/tree/051b2ff0210c718091692d37ee26d08613ad0be8/code/chapter08_rlhf)，WalkingLabs / Sanbu。源码与改编讲解按 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 提供；讲解补充了实现分析和改进示例，代码附件保持原样。
- [Training language models to follow instructions with human feedback](https://arxiv.org/abs/2203.02155)，InstructGPT 方法来源。
- [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347)，PPO 方法来源。
- [TRL 0.24.0 SFTTrainer 文档](https://huggingface.co/docs/trl/v0.24.0/en/sft_trainer)，用于核对数据格式与 loss mask 行为。
