---
title: "Anthropic Agent Evolution I: From Workflows to Agents"
date: 2026-09-12 21:08:45 +0200
slug: "anthropic-agent-evolution-1-from-workflows-to-agents"
categories: [AI Agents]
tags: [Anthropic Agent Evolution, AI Agents, Agent Harness, Workflow, ACI]
toc: true
---

“Agent” is often used as a broad label for any system that calls tools or takes multiple steps. Anthropic's engineering work offers a more useful distinction: **a workflow follows code paths defined in advance; an agent lets the model dynamically choose its process from environmental feedback.**

This first article in the “Anthropic Agent Evolution” series establishes the vocabulary: augmented LLMs, fixed workflows, autonomous agents, and the harness that surrounds the model.

<!--more-->

> **Series**: **I. From Workflows to Agents** · [II. Context Reset and Structured Handoff](/en/post/anthropic-agent-evolution-2-context-reset-and-handoff/) · [III. Planner–Generator–Evaluator](/en/post/anthropic-agent-evolution-3-planner-generator-evaluator/) · [IV. Managed Agent Runtime](/en/post/anthropic-agent-evolution-4-managed-agent-runtime/)

## 1. The Starting Point: The Augmented LLM

The most basic agentic system is not a multi-agent team. It is an LLM with external capabilities:

- **Retrieval** finds information outside model parameters.
- **Tools** execute searches, code, APIs, or business actions.
- **Memory** persists state beyond the current turn.

![An augmented LLM interacting with retrieval, tools, and memory](/img/posts/anthropic-agent-evolution/augmented-llm.png)

The important question is not merely whether tools exist, but whether their interfaces are usable by a model. An API that is comfortable for humans may still be difficult for an LLM. A good Agent–Computer Interface (ACI) needs explicit parameter names, boundaries, examples, useful errors, and structures that make mistakes difficult.

Anthropic's advice is intentionally conservative: begin with the simplest call that works and add agentic components only when evaluation shows a measurable improvement. Complexity creates latency, cost, and additional failure modes.

## 2. Workflows: Encode Known Paths in Software

When a task can be decomposed ahead of time, a workflow is usually more predictable than an autonomous agent.

### 2.1 Prompt Chaining

Prompt chaining turns a task into sequential steps and can place gates between them. It fits tasks such as drafting an outline, checking it, and only then writing the document.

![Prompt chaining with an intermediate gate](/img/posts/anthropic-agent-evolution/prompt-chaining.png)

### 2.2 Routing

Routing classifies the input and selects a specialized model or prompt. Typical uses include customer-support triage, difficulty tiers, and cost-aware model selection.

![Routing an input to a specialized path](/img/posts/anthropic-agent-evolution/routing.png)

### 2.3 Parallelization

Parallelization either splits independent concerns or runs multiple attempts and aggregates them. The former improves latency; the latter improves confidence.

![Parallel LLM calls followed by aggregation](/img/posts/anthropic-agent-evolution/parallelization.png)

### 2.4 Orchestrator–Workers

When the subtasks cannot be known in advance, an orchestrator decomposes work dynamically, delegates to workers, and synthesizes their results. Its defining feature is that **the model determines the task topology at runtime**.

![An orchestrator dynamically delegating work](/img/posts/anthropic-agent-evolution/orchestrator-workers.png)

### 2.5 Evaluator–Optimizer

One model generates while another evaluates and returns feedback until the result is accepted. This is the conceptual precursor to the later Planner–Generator–Evaluator harness.

![The evaluator–optimizer feedback loop](/img/posts/anthropic-agent-evolution/evaluator-optimizer.png)

## 3. Agents: Let the Model Direct the Process

An agent is appropriate when a fixed path cannot be hard-coded. It repeatedly:

1. interprets the goal and current state;
2. selects a tool or action;
3. receives ground truth from the environment;
4. revises its plan;
5. stops on completion, a blocker, or a defined limit.

![An autonomous agent acting on and receiving feedback from its environment](/img/posts/anthropic-agent-evolution/autonomous-agent.png)

Autonomy does not mean unbounded execution. Reliable agents still require budgets, iteration limits, permission boundaries, human checkpoints, and explicit completion criteria.

For coding agents, the verifier is not the model's claim that the code looks correct. It is the compiler, tests, browser behavior, and the actual repository state.

![High-level flow of a coding agent](/img/posts/anthropic-agent-evolution/coding-agent-flow.png)

## 4. Why Does the Model Need a Harness?

A bare agent can finish a short task, but long-running work exposes four system problems:

- **Finite context**: logs and failed attempts bury the information that matters now.
- **Continuity**: a new context or session does not automatically know prior state.
- **Self-evaluation bias**: generators systematically overrate their own work.
- **Runtime reliability**: tools, sandboxes, networks, and the harness itself can fail.

A harness is the engineering system around the model. It persists plans and checkpoints, selects relevant context, coordinates tools and subagents, validates results through external evidence, and recovers work after failure.

In short: **the model supplies reasoning; the harness supplies the institution that lets reasoning continue reliably.**

## 5. A Practical Complexity Ladder

| Task characteristic | Prefer |
| --- | --- |
| A single call is reliable | Prompt + retrieval |
| Steps are fixed and known | Prompt chaining / routing |
| Independent concerns or multiple perspectives | Parallelization |
| Subtasks emerge dynamically | Orchestrator–workers |
| Clear criteria support iterative improvement | Evaluator–optimizer |
| The path is open-ended and environment-driven | Agent + harness |

The goal is not to maximize agency. **Move up the ladder only when a simpler system falls short and evaluation proves that the added complexity pays for itself.**

The next article addresses the first hard problem in long-running work: how does an agent continue after its context window is exhausted?

## Sources

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
