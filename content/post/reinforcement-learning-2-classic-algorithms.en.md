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

![Dynamic programming, Monte Carlo, and temporal difference learning](/img/posts/reinforcement-learning-series/dp-mc-td.png)

### 2.1 Dynamic programming

Dynamic programming requires the complete transition and reward model and computes expectations over all successor states. It is exact in small known MDPs, but rarely available at real-world scale.

### 2.2 Monte Carlo

Monte Carlo methods wait until an episode finishes, compute the realized return $G_t$, and average across sampled episodes:

$$
V(s)\leftarrow V(s)+\alpha(G_t-V(s))
$$

The target is grounded in an actual return and requires no bootstrapping. The cost is high variance and the need to wait for termination.

### 2.3 Temporal difference learning

TD learning updates after one step using the current estimate of the next state:

$$
V(S_t)\leftarrow V(S_t)+\alpha
\left[R_{t+1}+\gamma V(S_{t+1})-V(S_t)\right]
$$

The term in brackets is the TD error:

$$
\delta_t=R_{t+1}+\gamma V(S_{t+1})-V(S_t)
$$

Bootstrapping introduces bias, but enables online, lower-variance updates.

## 3. Q-Learning

Q-Learning is a model-free, off-policy TD control algorithm:

$$
Q(S_t,A_t)\leftarrow Q(S_t,A_t)+\alpha
\left[R_{t+1}+\gamma\max_aQ(S_{t+1},a)-Q(S_t,A_t)\right]
$$

![One-step Q-Learning update](/img/posts/reinforcement-learning-series/q-learning-update.png)

The behavior policy may explore, while the update target assumes the best next action. Sarsa instead uses the action actually selected by the behavior policy:

$$
Q(S_t,A_t)\leftarrow Q(S_t,A_t)+\alpha
\left[R_{t+1}+\gamma Q(S_{t+1},A_{t+1})-Q(S_t,A_t)\right]
$$

This makes Sarsa sensitive to exploration risk, while Q-Learning targets the greedy policy independently of the behavior policy.

## 4. DQN: replacing the Q-table with a network

Large or continuous state spaces cannot be represented by a table. DQN approximates action values with $Q(s,a;\theta)$:

$$
y=r+\gamma\max_{a'}Q(s',a';\theta^-)
$$

$$
L(\theta)=\mathbb{E}_{(s,a,r,s')\sim D}
\left[(y-Q(s,a;\theta))^2\right]
$$

![DQN predicts action values from high-dimensional state input](/img/posts/reinforcement-learning-series/dqn.png)

Two engineering choices stabilize training:

1. **Experience replay** randomly samples stored transitions to break temporal correlation and reuse data.
2. **A target network** with slower parameters $\theta^-$ prevents the prediction and target from moving together at every step.

## 5. Policy gradients

Policy-based methods directly parameterize $\pi_\theta(a\mid s)$ and maximize expected return:

$$
J(\theta)=\mathbb{E}_{\tau\sim\pi_\theta}[G(\tau)]
$$

The policy gradient is:

$$
\nabla_\theta J(\theta)=\mathbb{E}
\left[\nabla_\theta\log\pi_\theta(A_t\mid S_t)G_t\right]
$$

Actions in high-return trajectories become more likely. Direct returns, however, create high-variance estimates, motivating a learned baseline.

## 6. Actor-Critic

Actor-Critic combines a policy and a value estimator:

- The **Actor** $\pi_\theta(a\mid s)$ chooses actions.
- The **Critic** $V_\phi(s)$ or $Q_\phi(s,a)$ evaluates them.

![The Actor selects actions while the Critic supplies learning signals](/img/posts/reinforcement-learning-series/actor-critic.png)

The advantage function measures performance relative to the state's baseline:

$$
A(s,a)=Q(s,a)-V(s)
$$

The Actor update becomes:

$$
\nabla_\theta J(\theta)\approx
\mathbb{E}\left[
\nabla_\theta\log\pi_\theta(a_t\mid s_t)\hat A_t
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

![A CartPole actor maps four state features to two action logits](/img/posts/reinforcement-learning-series/actor-network.png)

## 7. PPO: constrain policy updates

PPO asks how far a policy may move while reusing the same rollout. Define the probability ratio:

$$
r_t(\theta)=
\frac{\pi_\theta(a_t\mid s_t)}
{\pi_{\theta_{old}}(a_t\mid s_t)}
$$

The clipped objective is:

$$
L^{CLIP}(\theta)=\mathbb{E}_t\left[
\min\left(
r_t(\theta)\hat A_t,
\operatorname{clip}(r_t(\theta),1-\epsilon,1+\epsilon)\hat A_t
\right)
\right]
$$

![PPO clipping prevents excessively large policy updates](/img/posts/reinforcement-learning-series/ppo-clipping.png)

Clipping removes the incentive for probability ratios to move too far from one. A typical loop collects rollouts, estimates returns and advantages, updates Actor and Critic for several mini-batch epochs, then refreshes the old-policy snapshot.

GAE trades bias and variance through $\lambda$:

$$
\hat A_t^{GAE(\gamma,\lambda)}=
\sum_{l=0}^{\infty}(\gamma\lambda)^l\delta_{t+l}
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
