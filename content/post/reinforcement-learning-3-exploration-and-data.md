---
title: "强化学习（三）：探索与利用、策略采样和数据来源"
date: 2026-08-27 09:00:00 +0200
slug: "reinforcement-learning-3-exploration-and-data"
description: "从 epsilon-greedy、UCB、Thompson Sampling 到 on-policy、off-policy、online 与 offline，理解强化学习如何获得真正有用的数据。"
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, Exploration, Exploitation, UCB, Thompson Sampling, Offline RL]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

强化学习不只是“拿到数据以后怎样更新参数”，它还必须决定：**下一条训练数据应该从哪里来？**

如果一直选择当前最好的动作，早期误判可能永远无法纠正；如果不断随机探索，又会浪费大量行动机会。进一步地，训练数据可能来自当前策略、历史策略、人类、专家或一个固定数据集。算法能否安全使用这些数据，取决于策略分布是否匹配。

本文把这两组问题放在一起：先讨论探索与利用，再区分 on-policy、off-policy、online、offline，最后说明奖励设计为什么会把我们带到 RLHF、DPO、GRPO 与 Agentic RL。

<!--more-->

> **系列导航**：[（一）基础、MDP 与贝尔曼方程](/post/reinforcement-learning-1-foundations/) · [（二）从 Q-Learning 到 PPO](/post/reinforcement-learning-2-classic-algorithms/) · **（三）探索、采样与数据** · （四）RLHF（待续） · （五）DPO 与 GRPO（待续） · （六）Agentic RL（待续）

## 1. 探索与利用为什么不可避免？

- **Exploitation（利用）**：选择当前估计最好的动作，使用已有知识获得奖励；
- **Exploration（探索）**：尝试仍不确定的动作，用短期成本换取新信息。

![探索获取信息，利用把已有信息转化为奖励](/img/posts/reinforcement-learning-series/exploration-exploitation.png)

以选餐厅为例：每天去已经确认好吃的店，收益稳定，却可能永远错过更好的选择；每天都去新店，则会频繁踩雷。困难在于智能体一开始并不知道真实期望，只能一边行动、一边估计。

多臂老虎机中，动作 $a$ 的真实期望奖励为 $\mu_a$。如果每轮都知道最优动作 $a^*$，就能获得 $\mu_{a^*}$。实际选择 $A_t$ 带来的累计遗憾是：

$$
\operatorname{Regret}(T)=
T\mu_{a^*}-\sum_{t=1}^{T}\mu_{A_t}
$$

![探索策略希望在有限轮数内压低累计遗憾](/img/posts/reinforcement-learning-series/regret.png)

好的探索策略不是让每一步都最高分，而是让长期 Regret 增长得尽可能慢。

## 2. $\epsilon$-greedy：简单、稳定、但很粗糙

$\epsilon$-greedy 以概率 $1-\epsilon$ 选择当前估计最好的动作，以概率 $\epsilon$ 随机选择：

$$
A_t=
\begin{cases}
\arg\max_a \hat\mu_a, & \text{with probability }1-\epsilon\\
\text{random action}, & \text{with probability }\epsilon
\end{cases}
$$

![epsilon-greedy 在随机探索与贪心利用之间切换](/img/posts/reinforcement-learning-series/epsilon-greedy.png)

```python
import numpy as np


class EpsilonGreedy:
    def __init__(self, n_arms, epsilon=0.1):
        self.n_arms = n_arms
        self.epsilon = epsilon
        self.q = np.zeros(n_arms)
        self.n = np.zeros(n_arms)

    def select(self):
        if np.random.random() < self.epsilon:
            return np.random.randint(self.n_arms)
        return int(np.argmax(self.q))

    def update(self, arm, reward):
        self.n[arm] += 1
        self.q[arm] += (reward - self.q[arm]) / self.n[arm]
```

均值采用增量更新：

$$
\hat\mu_a\leftarrow \hat\mu_a+
\frac{r-\hat\mu_a}{N_a}
$$

这样不需要保存所有历史奖励。

### 2.1 让探索随时间衰减

训练早期经验少，应该多探索；后期估计稳定后，持续大量随机动作只会降低收益。因此常让 $\epsilon$ 随时间衰减：

```python
class DecayingEpsilonGreedy(EpsilonGreedy):
    def __init__(self, n_arms, start=1.0, end=0.01, decay=0.995):
        super().__init__(n_arms, epsilon=start)
        self.end = end
        self.decay = decay

    def select(self):
        arm = super().select()
        self.epsilon = max(self.end, self.epsilon * self.decay)
        return arm
```

固定衰减日程的问题是：它只根据时间减少探索，不关心智能体究竟还不确定什么。

## 3. UCB：优先尝试“不确定但可能很好”的动作

$\epsilon$-greedy 进入探索分支后会在所有动作中随机选择，甚至反复尝试已经明显很差的动作。UCB（Upper Confidence Bound）把平均奖励与不确定性奖金相加：

$$
A_t=\arg\max_a
\left[
\hat\mu_a+c\sqrt{\frac{\ln t}{N_a}}
\right]
$$

尝试次数 $N_a$ 越少，探索奖金越大；尝试越多，决策越依赖真实均值。

```python
class UCB:
    def __init__(self, n_arms, c=2.0):
        self.c = c
        self.counts = np.zeros(n_arms)
        self.values = np.zeros(n_arms)

    def select(self):
        untried = np.flatnonzero(self.counts == 0)
        if len(untried):
            return int(np.random.choice(untried))

        t = self.counts.sum()
        bonus = self.c * np.sqrt(np.log(t) / self.counts)
        return int(np.argmax(self.values + bonus))

    def update(self, arm, reward):
        self.counts[arm] += 1
        n = self.counts[arm]
        self.values[arm] += (reward - self.values[arm]) / n
```

UCB 体现了“面对不确定性保持乐观”：如果一个动作数据太少，就暂时按它可能达到置信区间上界来考虑。

## 4. Thompson Sampling：对可能的世界进行采样

Thompson Sampling 为每个动作维护参数的后验分布。每一轮从各动作的后验中采样一次，再选择采样值最大的动作。

对 Bernoulli 奖励，可以用 Beta 分布作为共轭先验：

```python
class ThompsonSampling:
    def __init__(self, n_arms):
        self.alpha = np.ones(n_arms)
        self.beta = np.ones(n_arms)

    def select(self):
        samples = np.random.beta(self.alpha, self.beta)
        return int(np.argmax(samples))

    def update(self, arm, reward):
        if reward == 1:
            self.alpha[arm] += 1
        else:
            self.beta[arm] += 1
```

数据少的动作分布更宽，仍有机会抽到高值；数据多的动作分布更窄，选择逐渐稳定。与 UCB 的确定性上界相比，Thompson Sampling 是一种概率匹配：一个动作成为最优动作的概率越高，它被选择的概率也越高。

## 5. On-policy 与 Off-policy：数据是谁产生的？

探索策略回答“下一步做什么”，而策略采样还要回答“产生训练数据的策略，是否就是正在优化的策略”。

- **On-policy（同策略）**：训练数据来自当前正在优化的策略；
- **Off-policy（异策略）**：训练数据可以来自旧策略、其他策略、人类或专家。

PPO 和 Sarsa 是典型 on-policy 方法；Q-Learning、DQN、SAC 属于 off-policy。DPO 使用固定偏好数据，也可以从数据关系上理解为离线、异策略学习，但它的目标并不是传统环境交互式 RL。

为什么这一区分重要？因为一个策略生成的数据不一定能无偏估计另一个策略的目标。分布差异越大，重要性采样的方差越高，模型也越容易在没见过的动作上产生错误高估。

## 6. Online 与 Offline：训练时还能否继续交互？

- **Online（在线）**：训练过程中智能体继续与环境交互，数据集不断增长；
- **Offline（离线）**：训练前数据已经固定，过程中不能向环境索取新样本。

两组概念可以组合成四种数据形态：

| 数据形态 | 含义 | 典型算法或场景 | 主要风险 |
| --- | --- | --- | --- |
| Online + On-policy | 用当前策略的新数据更新当前策略 | REINFORCE、Sarsa、PPO、GRPO | 采样昂贵、数据复用率低 |
| Online + Off-policy | 继续交互，并反复使用历史数据 | Q-Learning、DQN、SAC、TD3 | 新旧策略的分布差异 |
| Offline + Off-policy | 只从固定历史数据学习 | CQL、IQL、固定数据上的偏好优化 | 对数据外动作盲目高估 |
| Offline + On-policy | 固定数据仍代表当前策略 | 固定策略评估等边界情况 | 策略一更新，数据就过时 |

Online 不等于 on-policy，offline 也不等于 off-policy。前者描述是否继续收集数据，后者描述行为策略和目标策略是否相同。

## 7. 数据来源决定算法的能力边界

数据不只是输入，它规定了模型能学到什么：

- 当前策略的 rollout 最贴近优化目标，但昂贵且相关性强；
- Replay Buffer 提高样本复用率，但需要控制分布偏移；
- 专家演示能快速建立可用行为，却覆盖不了模型自己犯错后进入的状态；
- 固定离线数据安全、便宜、可复现，但无法主动补足盲区；
- 人类偏好可以表达难以写成规则的目标，却昂贵、主观且可能不一致；
- 可验证奖励适合数学和代码，却只覆盖能够自动判断对错的任务。

这也是为什么“换一个 loss”通常不足以解决强化学习问题。采样分布、奖励质量、环境接口与评估协议共同决定训练结果。

## 8. 奖励设计：当指标成为目标

Goodhart 定律提醒我们：

> 当一个指标成为优化目标，它就不再是一个好指标。

RL 会极其认真地优化我们给出的数字，却不会自动理解这个数字背后的意图。一个不完整的奖励函数可能让机器人用奇怪姿势完成动作，也可能让语言模型通过更长、更迎合、更模板化的回答骗取高分。

因此奖励至少要接受三种检查：

1. **Coverage**：它是否覆盖了真正关心的行为，而不只是容易测量的部分？
2. **Robustness**：模型是否可以找到规则漏洞获得高分？
3. **Generalization**：奖励在训练分布外是否仍代表真实目标？

## 9. 从环境奖励走向大模型后训练

传统控制任务的奖励往往能由环境直接计算；语言模型的“回答是否有帮助、诚实、安全”却很难写成程序。人类通常更容易比较两个回答，而不是给出完整评分规则，于是出现了从偏好中学习奖励的 RLHF。

当任务转向数学、代码等可自动验证领域，又可以直接使用规则或测试结果作为奖励，形成 RLVR 与 GRPO 等路线。Agentic RL 则进一步把动作从“生成下一个 token”扩展为调用工具、操作环境并完成长程任务。

后续文章会分别展开：

- **RLHF**：SFT、Reward Model、PPO 与评估闭环；
- **DPO 与 GRPO**：偏好优化与可验证推理训练的不同假设；
- **Agentic RL**：如何定义状态、动作、轨迹、信用分配和长程奖励。

这几章仍在继续整理。与其把未完成的段落混入本文，不如先保留清晰边界：前三篇解决“经典 RL 怎样定义问题、学习价值或策略、获得数据”；后续再专门回答“这些思想怎样进入大模型和 Agent”。
