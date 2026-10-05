---
title: "Reinforcement Learning I: From CartPole to MDPs and Bellman Equations"
date: 2026-08-25 09:00:00 +0200
slug: "reinforcement-learning-1-foundations"
description: "A grounded introduction to trial-and-error learning, policies, returns, Markov decision processes, value functions, Q-functions, and Bellman equations."
categories: [Reinforcement Learning]
tags: [Reinforcement Learning, MDP, Bellman Equation, CartPole, Value Function]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

Reinforcement learning has many algorithms, but they all address the same question: **how can an agent learn decisions that produce high long-term reward through interaction with an environment?**

This series starts with the common language behind those algorithms, then moves toward Q-Learning, DQN, Actor-Critic, PPO, exploration, data collection, and eventually LLM post-training. This first article establishes the foundation: states, actions, policies, returns, MDPs, value functions, and Bellman equations.

<!--more-->

> **Series**: **I. Foundations, MDPs, and Bellman equations** · [II. From Q-Learning to PPO](/en/post/reinforcement-learning-2-classic-algorithms/) · [III. Exploration, sampling, and data](/en/post/reinforcement-learning-3-exploration-and-data/) · IV. RLHF (planned) · V. DPO and GRPO (planned) · VI. Agentic RL (planned)

## 1. What does reinforcement learning learn?

Reinforcement learning is trial-and-error learning. At each time step, an agent observes a state or observation, chooses an action, and receives a new state and scalar reward from the environment. The goal is not to maximize the score of the current step, but the cumulative return over the interaction.

![An agent acts on an environment and learns from the next state and reward](/img/posts/reinforcement-learning-series/trial-and-error.png)

```text
State / Observation → Agent → Action
          ↑                    ↓
          └──── Reward + Environment
```

The basic objects are:

- **State**: a complete description of the environment;
- **Observation**: the part of the environment visible to the agent;
- **Action space**: the set of available discrete or continuous actions;
- **Reward**: immediate scalar feedback;
- **Episode**: a complete trajectory from an initial to a terminal state.

## 2. Return and discounting

Optimizing immediate reward alone often creates shortsighted behavior. RL instead uses the discounted return from time $t$:

$$
G&#95;{t}=R&#95;{t+1}+\gamma R&#95;{t+2}+\gamma^2R&#95;{t+3}+\cdots
$$

The discount factor $\gamma\in[0,1]$ controls how much future rewards matter. Small values favor immediate outcomes; values near one make long-term consequences important. Discounting also reflects the growing uncertainty of distant outcomes and helps infinite sums converge.

## 3. An action is not a policy

An action is a local instruction. A policy is a rule that covers every state the agent may encounter.

A deterministic policy returns one action:

$$
a=\pi(s)
$$

A stochastic policy returns a distribution:

$$
\pi(a\mid s)=\Pr(A&#95;{t}=a\mid S&#95;{t}=s)
$$

Stochastic policies preserve exploration because non-greedy actions can still be sampled.

## 4. CartPole as a minimal RL problem

In CartPole, a pole is attached to a cart. The agent can push the cart left or right and must keep the pole upright.

![CartPole-v1: moving the cart left and right to balance the pole](/img/posts/reinforcement-learning-series/cartpole.webp)

| Component | CartPole meaning |
| --- | --- |
| State | Cart position and velocity, pole angle and angular velocity |
| Action | Push left or right |
| Reward | Positive reward for every surviving step |
| Termination | Excessive tilt, leaving bounds, or reaching the time limit |
| Policy | A mapping from the four-dimensional state to an action |

The task already exposes the core difficulty: an action that looks bad immediately may create room for a better recovery on the next step.

## 5. Markov decision processes

An MDP formalizes sequential decisions as:

$$
\mathcal{M}=(\mathcal{S},\mathcal{A},P,R,\gamma)
$$

Here $\mathcal{S}$ is the state space, $\mathcal{A}$ the action space, $P(s^{\prime}\mid s,a)$ the transition model, $R$ the reward function, and $\gamma$ the discount factor.

The transition and reward terms can be written explicitly as:

$$
P(s^{\prime}\mid s,a)=\Pr(S&#95;{t+1}=s^{\prime}\mid S&#95;{t}=s,A&#95;{t}=a)
$$

$$
R(s,a,s^{\prime})=\mathbb{E}\left[R&#95;{t+1}\mid S&#95;{t}=s,A&#95;{t}=a,S&#95;{t+1}=s^{\prime}\right]
$$

They answer two different questions: where does the environment move after an action, and how much reward does that transition produce?

The Markov property says that a complete current state contains everything needed to predict the next state:

$$
P(S&#95;{t+1}\mid S&#95;{t},A&#95;{t},S&#95;{t-1},A&#95;{t-1},\ldots)
=P(S&#95;{t+1}\mid S&#95;{t},A&#95;{t})
$$

History is not irrelevant; its relevant information must already be summarized by the current state. When an observation is insufficient, the problem is closer to a POMDP and the agent needs memory.

If $P$ and $R$ are known, dynamic programming can plan directly. In most real tasks they are unknown, so the agent must estimate values from interaction.

## 6. Value functions compress the future

The state-value function measures the expected return from state $s$ under policy $\pi$:

$$
V^\pi(s)=\mathbb{E}&#95;{\pi}[G&#95;{t}\mid S&#95;{t}=s]
$$

The action-value function asks the same question after first taking action $a$:

$$
Q^\pi(s,a)=\mathbb{E}&#95;{\pi}[G&#95;{t}\mid S&#95;{t}=s,A&#95;{t}=a]
$$

The **Q-function** and **Q-Learning** are not the same thing. $Q^\pi(s,a)$ is an action-value function; Q-Learning is a particular algorithm for estimating the optimal action-value function $Q^{\star}$.

State value is the policy-weighted average of action values:

$$
V^\pi(s)=\sum&#95;{a}\pi(a\mid s)Q^\pi(s,a)
$$

Values compress a complex future into comparable scalars. The remaining question is how to estimate a future that has not happened yet.

## 7. Bellman equations: estimate now from the next step

The Bellman idea is:

> Current value = immediate reward + discounted future value.

For a fixed policy:

$$
V^\pi(s)=\sum&#95;{a}\pi(a\mid s)
\sum&#95;{s^{\prime},r}p(s^{\prime},r\mid s,a)
\left[r+\gamma V^\pi(s^{\prime})\right]
$$

If reward depends only on $(s,a)$, the same equation has a compact form:

$$
V^\pi(s)=\sum&#95;{a}\pi(a\mid s)
\left[R(s,a)+\gamma\sum&#95;{s^{\prime}}P(s^{\prime}\mid s,a)V^\pi(s^{\prime})\right]
$$

The policy weights actions, the transition model weights successor states, and $\gamma$ controls how strongly future value affects the current estimate.

To find the optimal policy, replace averaging over actions with maximization:

$$
V^{\star}(s)=\max&#95;{a}\sum&#95;{s^{\prime},r}p(s^{\prime},r\mid s,a)
\left[r+\gamma V^{\star}(s^{\prime})\right]
$$

The Q-function form is:

$$
Q^{\star}(s,a)=\mathbb{E}\left[
R&#95;{t+1}+\gamma\max&#95;{a^{\prime}}Q^{\star}(S&#95;{t+1},a^{\prime})
\mid S&#95;{t}=s,A&#95;{t}=a
\right]
$$

The right-hand side combines immediate reward with the best achievable value after reaching the next state. The first action is fixed; optimization begins with the following action.

Once $Q^{\star}$ is known, the optimal policy follows directly:

$$
\pi^{\star}(s)=\arg\max&#95;{a}Q^{\star}(s,a)
$$

## 8. Two routes forward

Bellman equations lead to two major families:

1. **Value-based methods** learn $V$ or $Q$ and derive actions from values. Q-Learning and DQN follow this route.
2. **Policy-based methods** directly optimize a parameterized policy $\pi&#95;{\theta}(a\mid s)$. REINFORCE and PPO follow this route.

Actor-Critic combines them: the Actor chooses actions and the Critic estimates their value. The next article follows this progression from dynamic programming, Monte Carlo, and temporal difference learning to Q-Learning, DQN, Actor-Critic, and PPO.
