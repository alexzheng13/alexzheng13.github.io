---
title: "Reinforcement Learning II: From Q-Learning and DQN to Actor-Critic and PPO"
date: 2026-08-26 09:00:00 +0200
slug: "reinforcement-learning-2-classic-algorithms"
description: "A continuous path through dynamic programming, Monte Carlo, temporal difference learning, Q-Learning, DQN, policy gradients, Actor-Critic, and PPO."
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, Q-Learning, DQN, Actor-Critic, PPO, Temporal Difference]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

[Part I](/en/post/reinforcement-learning-1-foundations/) established MDPs, value functions, and Bellman equations. Now the practical question is: **when the environment is unknown, states cannot be enumerated, and policies are neural networks, how do we actually learn values or policies?**

The progression is continuous. Dynamic programming assumes a model. Monte Carlo uses complete trajectories. Temporal difference learning updates before an episode ends. Q-Learning targets optimal action values. DQN scales Q-functions to high-dimensional inputs. Actor-Critic and PPO optimize policies while controlling unstable updates.

<!--more-->

> **Series**: [I. Foundations](/en/post/reinforcement-learning-1-foundations/) · **II. From Q-Learning to PPO** · [III. Exploration, sampling, and data](/en/post/reinforcement-learning-3-exploration-and-data/) · IV. RLHF (planned) · V. DPO and GRPO (planned) · VI. Agentic RL (planned)

## 1. Model-based and model-free learning

Model-based methods know or learn how the environment transitions and can plan through predicted outcomes. Model-free methods learn values or policies directly from experience without explicitly modeling the transition dynamics.

This distinction is orthogonal to value-based versus policy-based learning: a method can be model-free and value-based, or model-free and policy-based.

## 2. DP, MC, and TD: three ways to estimate value

### 2.1 Dynamic programming

Dynamic programming requires the complete transition and reward model and computes expectations over all successor states. It is exact in small known MDPs, but rarely available at real-world scale.

One policy-evaluation update is:

$$
V&#95;{k+1}(s)\leftarrow\sum&#95;{a}\pi(a\mid s)
\left[R(s,a)+\gamma\sum&#95;{s^{\prime}}P(s^{\prime}\mid s,a)V&#95;{k}(s^{\prime})\right]
$$

The three approaches differ in the information used for their targets:

| Method | Needs an environment model? | Update time | Learning target |
| --- | --- | --- | --- |
| DP | Yes | State-space sweeps | Expectation over all successors |
| MC | No | End of an episode | Complete return $G&#95;{t}$ |
| TD | No | Every step | $R&#95;{t+1}+\gamma V(S&#95;{t+1})$ |

### 2.2 Monte Carlo

Monte Carlo methods wait until an episode finishes, compute the realized return $G&#95;{t}$, and average across sampled episodes:

$$
V(s)\leftarrow V(s)+\alpha(G&#95;{t}-V(s))
$$

The target is grounded in an actual return and requires no bootstrapping. The cost is high variance and the need to wait for termination.

### 2.3 Temporal difference learning

TD learning updates after one step using the current estimate of the next state:

$$
V(S&#95;{t})\leftarrow V(S&#95;{t})+\alpha
\left[R&#95;{t+1}+\gamma V(S&#95;{t+1})-V(S&#95;{t})\right]
$$

The term in brackets is the TD error:

$$
\delta&#95;{t}=R&#95;{t+1}+\gamma V(S&#95;{t+1})-V(S&#95;{t})
$$

Bootstrapping introduces bias, but enables online, lower-variance updates.

## 3. Q-Learning

Q-Learning is a model-free, off-policy TD control algorithm:

$$
Q(S&#95;{t},A&#95;{t})\leftarrow Q(S&#95;{t},A&#95;{t})+\alpha
\left[R&#95;{t+1}+\gamma\max&#95;{a}Q(S&#95;{t+1},a)-Q(S&#95;{t},A&#95;{t})\right]
$$

The bracketed quantity is the Q-Learning TD error. It combines immediate reward, the largest next-state Q-value, and the current estimate. Repeated samples move the table toward the fixed point of the Bellman optimality equation.

The behavior policy may explore, while the update target assumes the best next action. Sarsa instead uses the action actually selected by the behavior policy:

$$
Q(S&#95;{t},A&#95;{t})\leftarrow Q(S&#95;{t},A&#95;{t})+\alpha
\left[R&#95;{t+1}+\gamma Q(S&#95;{t+1},A&#95;{t+1})-Q(S&#95;{t},A&#95;{t})\right]
$$

This makes Sarsa sensitive to exploration risk, while Q-Learning targets the greedy policy independently of the behavior policy.

## 4. DQN: replacing the Q-table with a network

Large or continuous state spaces cannot be represented by a table. DQN approximates action values with $Q(s,a;\theta)$:

$$
Q(s,a;\theta)\approx Q^{\star}(s,a)
$$

The 2013 DQN work brought deep function approximation directly into Q-Learning: the network receives a state and predicts a value for every discrete action. “Deep” describes the Q-function approximator, not a different learning target.

$$
y=r+\gamma\max&#95;{a^{\prime}}Q(s^{\prime},a^{\prime};\theta^-)
$$

$$
L(\theta)=\mathbb{E}&#95;{(s,a,r,s^{\prime})\sim D}
\left[(y-Q(s,a;\theta))^2\right]
$$

Two engineering choices stabilize training:

1. **Experience replay** randomly samples stored transitions to break temporal correlation and reuse data.
2. **A target network** with slower parameters $\theta^-$ prevents the prediction and target from moving together at every step.

## 5. Policy gradients

Policy-based methods directly parameterize $\pi&#95;{\theta}(a\mid s)$ and maximize expected return:

$$
J(\theta)=\mathbb{E}&#95;{\tau\sim\pi&#95;{\theta}}[G(\tau)]
$$

The policy gradient is:

$$
\nabla&#95;{\theta} J(\theta)=\mathbb{E}
\left[\nabla&#95;{\theta}\log\pi&#95;{\theta}(A&#95;{t}\mid S&#95;{t})G&#95;{t}\right]
$$

Actions in high-return trajectories become more likely. Direct returns, however, create high-variance estimates, motivating a learned baseline.

## 6. Actor-Critic

Actor-Critic combines a policy and a value estimator:

- The **Actor** $\pi&#95;{\theta}(a\mid s)$ chooses actions.
- The **Critic** $V&#95;{\phi}(s)$ or $Q&#95;{\phi}(s,a)$ evaluates them.

![The Actor selects actions while the Critic supplies learning signals](/img/posts/reinforcement-learning-series/actor-critic.en.jpg)

The advantage function measures performance relative to the state's baseline:

$$
A(s,a)=Q(s,a)-V(s)
$$

The Actor update becomes:

$$
\nabla&#95;{\theta} J(\theta)\approx
\mathbb{E}\left[
\nabla&#95;{\theta}\log\pi&#95;{\theta}(a&#95;{t}\mid s&#95;{t})\hat A&#95;{t}
\right]
$$

A small CartPole implementation can expose both outputs:

```python
class ActorCritic(nn.Module):
    def __init__(self, obs_dim=4, act_dim=2, hidden=64):
        super().__init__()
        self.actor = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
            nn.Linear(hidden, act_dim),
        )
        self.critic = nn.Sequential(
            nn.Linear(obs_dim, hidden), nn.Tanh(),
            nn.Linear(hidden, hidden), nn.Tanh(),
            nn.Linear(hidden, 1),
        )

    def forward(self, state):
        return self.actor(state), self.critic(state).squeeze(-1)
```

![A CartPole actor maps four state features to two action logits](/img/posts/reinforcement-learning-series/actor-network.en.jpg)

## 7. PPO: constrain policy updates

PPO asks how far a policy may move while reusing the same rollout. Define the probability ratio:

$$
r&#95;{t}(\theta)=
\frac{\pi&#95;{\theta}(a&#95;{t}\mid s&#95;{t})}
{\pi&#95;{\theta&#95;{old}}(a&#95;{t}\mid s&#95;{t})}
$$

The clipped objective is:

$$
L^{CLIP}(\theta)=\mathbb{E}&#95;{t}\left[
\min\left(
r&#95;{t}(\theta)\hat A&#95;{t},
\operatorname{clip}(r&#95;{t}(\theta),1-\epsilon,1+\epsilon)\hat A&#95;{t}
\right)
\right]
$$

Here $\hat A&#95;{t}$ is the estimated advantage and $\epsilon$ is the clipping width, commonly around $0.1$ to $0.2$. Clipping removes the incentive for probability ratios to move too far from one. A typical loop collects rollouts, estimates returns and advantages, updates Actor and Critic for several mini-batch epochs, then refreshes the old-policy snapshot.

GAE trades bias and variance through $\lambda$:

$$
\hat A&#95;{t}^{GAE(\gamma,\lambda)}=
\sum&#95;{l=0}^{\infty}(\gamma\lambda)^l\delta&#95;{t+l}
$$

The full objective usually combines policy loss, value loss, and an entropy bonus.

## 8. What each method solves

| Method | Learns | Central mechanism | Main limitation |
| --- | --- | --- | --- |
| MC | State/action value | Full realized return | Waits for termination; high variance |
| TD | State value | One-step bootstrap | Biased target |
| Q-Learning | Optimal Q-values | Max next-state Q | Tabular state space |
| DQN | Neural Q-function | Replay + target network | Moving data and targets |
| Policy gradient | Parameterized policy | Expected return | High variance |
| Actor-Critic | Policy + value | Advantage estimate | Coupled errors |
| PPO | Constrained policy | Clipped objective | On-policy sample cost |

These algorithms are not a simple replacement chain. The right method depends on action type, sampling cost, available data, and whether interaction is possible. Part III focuses on exactly those data questions.
