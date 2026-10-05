---
title: "强化学习（二）：从 Q-Learning、DQN 到 Actor-Critic 与 PPO"
date: 2026-08-26 09:00:00 +0200
slug: "reinforcement-learning-2-classic-algorithms"
description: "沿着 DP、MC、TD 三种估计方法，理解 Q-Learning、DQN、策略梯度、Actor-Critic 与 PPO 如何逐步解决真实训练问题。"
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, Q-Learning, DQN, Actor-Critic, PPO, Temporal Difference]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

[上一篇](/post/reinforcement-learning-1-foundations/)建立了 MDP、价值函数与贝尔曼方程。接下来要回答的是：**当环境模型未知、状态无法枚举、策略又由神经网络表示时，怎样真的把价值或策略学出来？**

本文沿着一条连续的演进路径展开：动态规划需要完整模型；蒙特卡洛只依赖完整轨迹；时序差分可以边走边学；Q-Learning 学最优动作价值；DQN 用神经网络处理高维状态；Actor-Critic 与 PPO 则直接优化策略，并控制每次更新不要走得太远。

<!--more-->

> **系列导航**：[（一）基础、MDP 与贝尔曼方程](/post/reinforcement-learning-1-foundations/) · **（二）从 Q-Learning 到 PPO** · [（三）探索、采样与数据](/post/reinforcement-learning-3-exploration-and-data/) · （四）RLHF（待续） · （五）DPO 与 GRPO（待续） · （六）Agentic RL（待续）

## 1. Model-Based 与 Model-Free

先区分算法是否学习或使用环境模型。

- **Model-Based**：拥有或学习转移与奖励模型，可以在内部推演“执行这个动作后会发生什么”；
- **Model-Free**：不显式建立环境模型，直接从交互经验中学习价值函数或策略。

知道完整 $P(s'\mid s,a)$ 时，动态规划可以遍历状态并反复应用贝尔曼方程。真实世界里模型往往未知，因此 Q-Learning、DQN、PPO 等常用算法大多属于 Model-Free。

这个维度与 Value-Based / Policy-Based 不冲突：一个算法可以是 Model-Free + Value-Based，也可以是 Model-Free + Policy-Based。

## 2. DP、MC 与 TD：三种价值估计方式

![动态规划、蒙特卡洛与时序差分在信息需求和更新时机上的差异](/img/posts/reinforcement-learning-series/dp-mc-td.png)

### 2.1 动态规划：有模型，全期望

动态规划（DP）需要已知转移概率与奖励，通过遍历所有后继状态计算完整期望。它的估计偏差小，但现实中通常拿不到完整环境模型，状态空间也可能太大。

### 2.2 蒙特卡洛：无模型，等结局

蒙特卡洛（MC）不需要环境模型。它从状态 $s$ 出发跑完一个完整 Episode，再计算真实回报 $G_t$，最后用多次采样的平均值估计 $V(s)$：

$$
V(s) \leftarrow V(s) + \alpha\left(G_t-V(s)\right)
$$

优势是目标来自真实回报，不需要 bootstrap；缺点是必须等回合结束，且方差较大。对于很长或没有自然终点的任务，这种等待代价很高。

### 2.3 时序差分：边走边学

时序差分（TD）结合了 MC 的采样和 DP 的自举（bootstrapping）。它不等完整回合，而用下一状态的当前估计更新这一状态：

$$
V(S_t) \leftarrow V(S_t)+\alpha
\left[R_{t+1}+\gamma V(S_{t+1})-V(S_t)\right]
$$

括号内叫作 **TD error**：

$$
\delta_t=R_{t+1}+\gamma V(S_{t+1})-V(S_t)
$$

TD 目标含有另一个估计值，因此可能有偏差，却能在线更新、方差通常更低，也更适合持续交互。

## 3. Q-Learning：直接逼近最优动作价值

Q-Learning 是无模型、异策略（off-policy）的 TD 控制算法。它用下一状态中价值最高的动作构造目标：

$$
Q(S_t,A_t) \leftarrow Q(S_t,A_t)+\alpha
\left[
R_{t+1}+\gamma\max_aQ(S_{t+1},a)-Q(S_t,A_t)
\right]
$$

![Q-Learning 的一步更新](/img/posts/reinforcement-learning-series/q-learning-update.png)

“异策略”体现在：产生数据的行为策略可以带有探索，比如 $\epsilon$-greedy；更新目标却假设下一步会选择当前最优动作。也就是说，它可以一边探索，一边学习贪心策略。

### 3.1 Q-Learning 与 Sarsa

Sarsa 的目标使用行为策略实际选择的下一动作：

$$
Q(S_t,A_t) \leftarrow Q(S_t,A_t)+\alpha
\left[
R_{t+1}+\gamma Q(S_{t+1},A_{t+1})-Q(S_t,A_t)
\right]
$$

两者的差别不是公式中少了一个 $\max$ 那么简单：

- Q-Learning 学的是“假设以后总选最优动作”的目标策略；
- Sarsa 学的是“包含当前探索行为”的策略本身；
- 在有风险的环境中，Sarsa 往往更保守，因为它会把探索可能造成的损失计算进去。

## 4. DQN：Q 表装不下时，用神经网络逼近

表格型 Q-Learning 假设状态—动作组合可以枚举。像素输入、连续状态或巨大状态空间下，表格不再可行。DQN 用参数为 $\theta$ 的神经网络 $Q(s,a;\theta)$ 近似 Q 函数。

训练目标是：

$$
y=r+\gamma\max_{a'}Q(s',a';\theta^-)
$$

$$
L(\theta)=\mathbb{E}_{(s,a,r,s')\sim D}
\left[(y-Q(s,a;\theta))^2\right]
$$

![DQN 用神经网络从状态预测每个动作的 Q 值](/img/posts/reinforcement-learning-series/dqn.png)

DQN 能稳定训练，依赖两个关键工程设计：

1. **Experience Replay**：把交互样本存入回放缓冲区 $D$，随机采样 mini-batch，打破相邻样本的强相关性并重复利用数据；
2. **Target Network**：用较慢更新的参数 $\theta^-$ 生成目标，避免预测值和目标值同时剧烈变化。

这揭示了深度 RL 的一个基本困难：模型既在改变策略、改变采样到的数据分布，又在用自己的预测构造监督目标。缺少稳定机制时，这个反馈环很容易发散。

## 5. Policy Gradient：直接优化策略

Value-Based 方法先学习动作价值，再从价值中选动作。Policy-Based 方法直接参数化策略 $\pi_\theta(a\mid s)$，最大化期望回报：

$$
J(\theta)=\mathbb{E}_{\tau\sim\pi_\theta}[G(\tau)]
$$

策略梯度定理给出：

$$
\nabla_\theta J(\theta)=
\mathbb{E}_{\pi_\theta}
\left[\nabla_\theta\log\pi_\theta(A_t\mid S_t)G_t\right]
$$

直觉是：高回报轨迹中的动作应该更可能被选中，低回报轨迹中的动作应该被压低概率。

但直接使用回报 $G_t$ 方差很高。一次轨迹得分高，未必表示其中每个动作都好；而不同状态本身的难度也不同。于是需要一个评价者提供更稳定的基线。

## 6. Actor-Critic：一个行动，一个评价

Actor-Critic 把策略与价值两条路线放到同一个系统中：

- **Actor**：策略 $\pi_\theta(a\mid s)$，负责选择动作；
- **Critic**：价值函数 $V_\phi(s)$ 或 $Q_\phi(s,a)$，负责评价行动结果。

![Actor 根据策略行动，Critic 用价值估计指导 Actor 更新](/img/posts/reinforcement-learning-series/actor-critic.png)

最常见的优势函数是：

$$
A(s,a)=Q(s,a)-V(s)
$$

它回答的不是“这个动作能得多少分”，而是“这个动作比该状态下的平均表现好多少”。Actor 更新可以写成：

$$
\nabla_\theta J(\theta)\approx
\mathbb{E}\left[
\nabla_\theta\log\pi_\theta(a_t\mid s_t)\hat A_t
\right]
$$

在 CartPole 上，一个最小的共享接口可以写成：

```python
class ActorCritic(nn.Module):
    def __init__(self, obs_dim=4, act_dim=2, hidden=64):
        super().__init__()
        self.actor = nn.Sequential(
            nn.Linear(obs_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, act_dim),
        )
        self.critic = nn.Sequential(
            nn.Linear(obs_dim, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, 1),
        )

    def forward(self, state):
        logits = self.actor(state)
        value = self.critic(state).squeeze(-1)
        return logits, value
```

![CartPole Actor 网络：四维状态输入，两个动作分数输出](/img/posts/reinforcement-learning-series/actor-network.png)

Actor 与 Critic 相互促进，但也会相互放大误差。Critic 判断不准，Actor 就会沿错误方向更新；Actor 变化太快，Critic 面对的数据分布又会迅速过时。

## 7. PPO：限制策略更新的步幅

PPO（Proximal Policy Optimization）要解决的核心问题是：**同一批采样数据上，策略应该更新多少？**

令旧策略为 $\pi_{\theta_{old}}$，新策略为 $\pi_\theta$，重要性采样比率为：

$$
r_t(\theta)=
\frac{\pi_\theta(a_t\mid s_t)}
{\pi_{\theta_{old}}(a_t\mid s_t)}
$$

如果 $r_t$ 离 1 太远，说明新策略与收集数据时的旧策略差异过大。PPO 的 clipped objective 是：

$$
L^{CLIP}(\theta)=
\mathbb{E}_t\left[
\min\left(
r_t(\theta)\hat A_t,
\operatorname{clip}(r_t(\theta),1-\epsilon,1+\epsilon)\hat A_t
\right)
\right]
$$

![PPO 通过裁剪重要性比率限制单次更新幅度](/img/posts/reinforcement-learning-series/ppo-clipping.png)

裁剪不是阻止学习，而是让过度激进的更新失去额外收益。它以相对简单的实现，近似实现了“新策略不要离旧策略太远”的信赖域思想。

### 7.1 PPO 的训练循环

一个典型循环包括：

1. 用当前策略与环境交互，保存状态、动作、奖励、log probability 和价值估计；
2. 计算回报与优势，通常使用 GAE；
3. 固定这批 rollout，多轮 mini-batch 更新 Actor 与 Critic；
4. 更新旧策略快照，再采集下一批数据。

GAE 用参数 $\lambda$ 在偏差与方差之间折中：

$$
\hat A_t^{GAE(\gamma,\lambda)}=
\sum_{l=0}^{\infty}(\gamma\lambda)^l\delta_{t+l}
$$

实际损失通常还包含 value loss 与 entropy bonus：

$$
L = -L^{CLIP}+c_vL^{value}-c_e\mathcal{H}(\pi)
$$

熵奖励鼓励策略保留一定随机性，避免过早坍缩到单一动作。

## 8. 这些方法解决了不同层次的问题

| 方法 | 学什么 | 关键目标 | 核心限制 |
| --- | --- | --- | --- |
| MC | 状态或动作价值 | 完整回报 | 必须等 Episode 结束、方差高 |
| TD | 状态价值 | 一步 bootstrap | 目标有偏，但可在线学习 |
| Q-Learning | 最优 Q 值 | 下一状态最大 Q | 状态难以枚举 |
| DQN | 神经网络 Q 值 | Replay + Target Network | 训练分布与目标同时变化 |
| Policy Gradient | 参数化策略 | 最大化期望回报 | 方差高、更新易失控 |
| Actor-Critic | 策略 + 价值 | Advantage | 两个网络会相互影响 |
| PPO | 受约束的策略 | Clipped objective | On-policy，采样成本高 |

算法并不是简单的新旧替代关系。Q-Learning 适合离散动作和可重复采样，DQN 适合高维观测下的离散动作，PPO 则能自然处理随机策略与连续控制。下一篇会补上训练时经常被忽略的另一半：数据从哪里来、探索该怎么做，以及 on-policy、off-policy、online、offline 到底有什么区别。
