---
title: "强化学习（一）：从 CartPole 到 MDP 与贝尔曼方程"
date: 2026-08-25 09:00:00 +0200
slug: "reinforcement-learning-1-foundations"
description: "从试错学习与 CartPole 出发，系统理解状态、动作、策略、回报、MDP、价值函数、Q 函数与贝尔曼方程。"
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, MDP, Bellman Equation, CartPole, Value Function]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

强化学习最容易让人困惑的地方，是算法名字很多，但它们真正回答的始终是同一个问题：**一个智能体怎样通过与环境交互，学会做出能带来长期收益的决策？**

这组文章从最基本的问题定义开始，再逐步走向 Q-Learning、DQN、Actor-Critic、PPO、探索策略以及大模型后训练。本文是系列第一篇，先建立后续所有算法共用的语言：状态、动作、策略、回报、MDP、价值函数和贝尔曼方程。

<!--more-->

> **系列导航**：**（一）基础、MDP 与贝尔曼方程** · [（二）从 Q-Learning 到 PPO](/post/reinforcement-learning-2-classic-algorithms/) · [（三）探索、采样与数据](/post/reinforcement-learning-3-exploration-and-data/) · （四）RLHF（待续） · （五）DPO 与 GRPO（待续） · （六）Agentic RL（待续）

## 1. 强化学习到底在学什么？

强化学习是一种 **Trial-and-Error（试错学习）**。一个智能体（Agent）处在环境（Environment）中，在每个时刻观察状态或观测，据此选择动作；环境接收动作后转移到新状态，并返回一个标量奖励。智能体的目标不是让眼前这一步得分最高，而是让整个交互过程中的**累积回报最大**。

![智能体通过动作影响环境，并从新状态与奖励中继续学习](/img/posts/reinforcement-learning-series/trial-and-error.png)

一次交互可以写成：

```text
State / Observation → Agent → Action
          ↑                    ↓
          └──── Reward + Environment
```

先区分几个基础概念：

- **State（状态）**：对环境的完整描述，例如国际象棋的完整棋盘；
- **Observation（观测）**：智能体能够看到的部分信息，例如游戏角色附近的画面；
- **Action Space（动作空间）**：可执行动作的集合，可以是离散的，也可以是连续的；
- **Reward（奖励）**：环境对当前结果的即时反馈；
- **Episode（回合）**：从初始状态到终止状态的一段完整轨迹。

动作空间的类型会直接影响算法。CartPole 只有向左和向右两个离散动作；机械臂的关节角度却可能是任意实数，需要处理连续动作的算法。

## 2. 从即时奖励到累积回报

只追逐即时奖励往往会产生短视行为。强化学习真正优化的是从时刻 $t$ 开始的折扣累积回报：

$$
G_t = R_{t+1} + \gamma R_{t+2} + \gamma^2 R_{t+3} + \cdots
$$

其中折扣因子 $\gamma \in [0,1]$ 决定智能体有多重视未来：

- $\gamma$ 越小，越关注眼前奖励；
- $\gamma$ 越接近 1，越愿意为长期收益延迟满足；
- 在有终止状态的任务里，$\gamma$ 还帮助保证无限和收敛。

折扣并不只是数学技巧。现实任务中，越远的结果通常越不确定，也越难归因给当前动作。

## 3. 动作不是策略

动作是一个局部决定。比如在迷宫的某个格子选择“向右走”，它只解决眼前一步。

策略（Policy）则是一本覆盖所有可能状态的行动手册。强化学习最终想得到的不是某一步动作，而是一个从状态到动作的规则。

确定性策略直接输出动作：

$$
a = \pi(s)
$$

随机策略输出动作的概率分布：

$$
\pi(a\mid s)=\Pr(A_t=a\mid S_t=s)
$$

随机策略天然保留了探索：即使某个动作当前概率最高，其他动作仍有机会被尝试。这一点会在系列第三篇里继续展开。

## 4. CartPole：最小但完整的 RL 问题

CartPole 是强化学习最常见的入门环境。一根杆通过关节连接在小车上，智能体每步只能选择向左或向右推车，目标是尽可能长时间保持杆子竖直。

![CartPole-v1：通过控制小车左右移动使杆保持竖直](/img/posts/reinforcement-learning-series/cartpole.webp)

它看起来简单，却包含完整的强化学习结构：

| 要素 | CartPole 中的含义 |
| --- | --- |
| 状态 | 小车位置、速度，杆的角度、角速度 |
| 动作 | 向左推或向右推 |
| 奖励 | 杆仍保持竖直时每步获得正奖励 |
| 终止 | 杆倾斜过大、小车越界或达到步数上限 |
| 策略 | 根据四维状态选择左右动作 |

它还揭示了 RL 的关键难点：一次动作的好坏不能只看当下。向左推可能暂时让杆更斜，却是在为下一步恢复平衡创造空间。

## 5. 用 MDP 描述序列决策

马尔可夫决策过程（Markov Decision Process, MDP）把序列决策形式化为五元组：

$$
\mathcal{M}=(\mathcal{S},\mathcal{A},P,R,\gamma)
$$

- $\mathcal{S}$：状态空间；
- $\mathcal{A}$：动作空间；
- $P(s'\mid s,a)$：状态转移概率；
- $R(s,a,s')$：奖励函数；
- $\gamma$：折扣因子。

![MDP 中状态、动作、转移与奖励之间的关系](/img/posts/reinforcement-learning-series/mdp.png)

MDP 的核心假设是**马尔可夫性**：只要当前状态包含了预测未来所需的全部信息，更早的历史就不再提供额外信息。

$$
P(S_{t+1}\mid S_t,A_t,S_{t-1},A_{t-1},\ldots)
=P(S_{t+1}\mid S_t,A_t)
$$

这不是说历史不重要，而是说历史的重要信息已经被压缩进当前状态。若当前输入不足以做到这一点，问题更接近部分可观测 MDP（POMDP），智能体就需要记忆来补足状态。

### 5.1 已知模型与未知模型

如果转移概率 $P$ 和奖励函数已知，可以利用动态规划直接计算价值；如果不知道环境规律，就只能通过交互样本估计。

多数真实问题属于后者。智能体并不知道机器人下一步是否会失衡，也不知道一段 token 序列最终会得到怎样的偏好评价。**不知道 $P$，正是强化学习与传统确定性最优化之间的重要区别。**

## 6. 价值函数：把未来压缩成一个数

状态价值函数衡量：从状态 $s$ 出发，之后一直遵循策略 $\pi$，预期能得到多少回报：

$$
V^{\pi}(s)=\mathbb{E}_{\pi}[G_t\mid S_t=s]
$$

动作价值函数，也就是 Q 函数，进一步问：在状态 $s$ 先执行动作 $a$，之后遵循策略 $\pi$，预期回报是多少：

$$
Q^{\pi}(s,a)=\mathbb{E}_{\pi}[G_t\mid S_t=s,A_t=a]
$$

![Q 值评价状态—动作组合的长期回报](/img/posts/reinforcement-learning-series/q-value.png)

它们把复杂的未来压缩成可比较的标量。只要知道每个动作的 Q 值，智能体就可以选择价值最高的动作。

但问题随之而来：回合还没结束，未来回报尚未发生，Q 值从哪里来？答案是贝尔曼方程。

## 7. 贝尔曼方程：用下一步估计这一刻

贝尔曼方程的核心思想很直观：

> 当前价值 = 即时奖励 + 折扣后的未来价值。

对固定策略 $\pi$，状态价值的贝尔曼期望方程是：

$$
V^{\pi}(s)=
\sum_a \pi(a\mid s)
\sum_{s',r}p(s',r\mid s,a)
\left[r+\gamma V^{\pi}(s')\right]
$$

![贝尔曼期望方程把当前状态价值递归地分解到下一状态](/img/posts/reinforcement-learning-series/bellman-expectation.png)

外层求和表示按策略选择动作，内层求和表示环境可能转移到不同状态并给出不同奖励。它不是在枚举无限未来，而是把无限序列拆成“当前一步 + 下一状态的价值”。

### 7.1 从评估策略到寻找最优策略

如果目标不是评价固定策略，而是寻找最优策略，就要在每个状态选择价值最高的动作：

$$
V^*(s)=\max_a\sum_{s',r}p(s',r\mid s,a)
\left[r+\gamma V^*(s')\right]
$$

对应的 Q 值形式是：

$$
Q^*(s,a)=\mathbb{E}\left[
R_{t+1}+\gamma\max_{a'}Q^*(S_{t+1},a')
\mid S_t=s,A_t=a
\right]
$$

![Q 函数的贝尔曼最优方程](/img/posts/reinforcement-learning-series/bellman-q-optimality.png)

一旦得到 $Q^*$，最优策略就可以直接读出：

$$
\pi^*(s)=\arg\max_a Q^*(s,a)
$$

可以把它想成迷宫路口的分数牌：一开始牌子上的数不准确；每走一步，就用“这一步的奖励 + 下个路口最好的牌子”修正当前牌子。不断试错之后，数值逐渐一致，沿着最大分数走就是最优策略。

## 8. 到这里，我们有了两条路线

贝尔曼方程引出了强化学习的两条主要路线：

1. **Value-Based**：学习 $V$ 或 $Q$，再从价值中导出动作。Q-Learning 和 DQN 属于这条路线；
2. **Policy-Based**：不先给动作打分，直接优化参数化策略 $\pi_\theta(a\mid s)$。REINFORCE 和 PPO 属于这条路线。

Actor-Critic 会把两条路线结合起来：Actor 负责行动，Critic 负责评价。下一篇将从动态规划、蒙特卡洛和时序差分开始，一直走到 Q-Learning、DQN、Actor-Critic 与 PPO。
