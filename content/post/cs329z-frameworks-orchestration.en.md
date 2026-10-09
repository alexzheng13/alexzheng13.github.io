---
title: "CS 329Z: Frameworks & Orchestration — From Agent Harnesses to Durable Execution"
date: 2026-10-09 09:00:00 +0200
slug: "cs329z-frameworks-orchestration"
description: "A structured guide to Stanford CS 329Z Lecture 5: DSPy, LangGraph, agent harnesses, OpenHands, Pi Agent, OpenClaw, Meta-Harness, Temporal, observability, Shepherd, and system-level evals."
categories: [AI Agents]
tags: [AI Agents, Agent Harness, Orchestration, LangGraph, DSPy, Temporal, Observability, Meta-Harness]
toc: true
---

A model that can call tools is not yet a production-ready agent.

An agent system must also answer a long list of engineering questions. Where is state stored? Where does a failed run resume? How is context reconstructed? Who controls tool permissions? What schedules a long-running task? How is every step traced? When the system becomes slower, more expensive, or less accurate, how do we find the cause?

These concerns are often compressed into the vague label “agent framework.” A clearer approach is to separate the stack into layers:

```text
Models and data
      ↓
LLM program / workflow         defines application logic
      ↓
Agent harness                  provides tools, memory, context, and execution
      ↓
Durable orchestration          survives retries, waits, and process failures
      ↓
Telemetry + evals              makes the system observable and improvable
```

This article reorganizes Lecture 5 from my **Stanford CS 329Z: Engineering AI Agents** notes. The goal is not to promote one framework. It is to build an architectural map: what each layer solves, when it becomes necessary, and why the same model can behave very differently inside different harnesses.

<!--more-->

> **Related course note**: [From RAG to Agentic RAG: Retrieval, Reranking, and Closed-Loop Decisions](/en/post/cs329z-rag-agentic-retrieval/)

## 1. The three pillars of an AI system

Before discussing frameworks, it helps to reduce a complete AI system to three pillars:

1. **Data**: training data, rollouts, demonstrations, human feedback, and runtime retrieval;
2. **System or model**: a language model, compound AI system, workflow, or agentic system;
3. **Evaluation + metric**: pass rate, exact match, LLM judges, cost, latency, safety, and consistency.

![The three pillars of an AI system: data, system or model, and evaluation plus metrics](/img/posts/cs329z-frameworks-orchestration/three-pillars.webp)

The important implication is that **a model is only one component, and a system is meaningful only when placed inside an evaluation loop**.

If the model changes while tasks and data also change, it is impossible to attribute an improvement. If a workflow is built without recording cost and failure trajectories, it is equally hard to know whether it actually became better. Framework decisions must eventually be compared on the same representative tasks and metrics.

## 2. The framework landscape: separate layers before choosing tools

Lecture 5 divides the agent stack into several layers. Model interfaces sit at the bottom. Workflows and compound AI systems add program logic. Agents give the model more control over execution. Reliability and observability cut across the entire stack.

![The AI-agent framework landscape across models, workflows, agents, reliability, and observability](/img/posts/cs329z-frameworks-orchestration/framework-landscape.webp)

The common tools can be mapped to responsibilities rather than placed in one undifferentiated list:

| Tool or category | Primary responsibility | Question it answers | Typical uses |
| --- | --- | --- | --- |
| Model API | Supply inference | “Which model should generate or judge?” | OpenAI, Anthropic, LiteLLM, and similar interfaces |
| DSPy | Optimize an LLM program | “How can these modules and prompts perform better?” | RAG, QA, reasoning, few-shot selection, prompt optimization |
| LangGraph | Orchestrate state and control flow | “What happens next, and how does state move?” | Branches, loops, tool use, human-in-the-loop, multi-agent systems |
| Agent harness | Provide the operating environment | “What can the model see and do, and how does it keep working?” | Coding agents, computer-use agents, persistent assistants |
| Temporal | Durable execution | “How does a long task survive failure, restart, or timeout?” | Retries, timeouts, asynchronous tasks, crash recovery |
| MLflow / LangSmith / Langfuse | Telemetry and experiment management | “What happened in this run, and why did it slow down or fail?” | Traces, cost, latency, datasets, evaluation, production monitoring |

A frequent mistake is asking one framework to own every responsibility. LangGraph can express loops and state transitions, but this does not automatically provide cross-process crash recovery. Temporal can execute a workflow reliably, but it does not design the agent's context and tools. Langfuse can record a trace, but it does not automatically improve task success.

## 3. DSPy, LangGraph, and Temporal solve different problems

### 3.1 DSPy: optimize the LLM program instead of hand-tuning every prompt

DSPy treats LLM calls as modules with input and output signatures. Given examples and an evaluation metric, it can optimize prompts, few-shot demonstrations, or program configurations.

Its central loop looks like this:

```text
Fixed tasks and metric
        ↓
Try prompt / example / program configurations
        ↓
Select a better-performing LLM program
```

DSPy is therefore closer to compiling and optimizing an LLM program than managing the lifecycle of a long-running job.

### 3.2 LangGraph: represent the agent as a stateful graph

LangGraph is useful when an agent naturally forms nodes, edges, conditional branches, and loops:

```text
User request
     ↓
Planner ──→ Tool executor ──→ Evaluator
   ↑               │               │
   └──── revise ───┴── retry ──────┘
```

State travels through the graph, and a node may be a model call, a tool, or a human approval step. LangGraph primarily solves **application-level control flow**: when to call a tool, loop, ask the user, or stop.

### 3.3 Temporal: make an already-designed process finish reliably

Temporal is concerned with execution reliability rather than model reasoning: how an activity is retried, how execution resumes after a worker restarts, how state survives a long wait, and how a workflow running for hours or days continues from the correct point.

The shortest distinction is:

> LangGraph primarily describes what should happen next. Temporal primarily ensures that the process can continue from the correct state when something goes wrong.

They can be combined rather than treated as mutually exclusive alternatives.

## 4. What is an agent harness?

An agent harness is the operating system around the model. It determines which tools are available, what history is remembered, how context is assembled, how the environment is manipulated, and how a run terminates when it succeeds, fails, or becomes stuck.

![Anatomy of an agent harness: planning, memory, LLM core, tools, actions, and the environment](/img/posts/cs329z-frameworks-orchestration/agent-harness-anatomy.webp)

A typical harness contains at least:

- **Planning and reasoning** for decomposition, next-step selection, and reflection;
- **Memory** for conversation history, working state, and long-term knowledge;
- **Context management** for selecting files, tool results, and prior events;
- **Tools** such as read, edit, shell, retrieval, browser, or business APIs;
- **Execution environment** such as a terminal, sandbox, desktop, database, or physical device;
- **Control and safety** through permissions, approvals, budgets, stopping rules, and rollback.

A good harness is not the one with the most tools. It balances four competing goals:

```text
Task success  ↔  Cost  ↔  Latency  ↔  User control
```

There is no universal optimum. Code completion and production-database modification require entirely different permission and approval policies even if they use the same model.

## 5. Three harness philosophies: OpenHands, Pi Agent, and OpenClaw

Lecture 5 uses three systems to illustrate the harness design space. They differ not merely in feature count but in their choices around state, tools, autonomy, and user control.

### 5.1 OpenHands: event history and a persistent terminal

OpenHands resembles a complete software-engineering environment:

- Every step is stored as an event, with one JSON record per event on disk.
- Messages sent to the model are reconstructed from the event history on each step.
- A persistent `tmux` session preserves the terminal state, including the working directory, environment variables, and virtual environments.
- A stuck detector terminates runs after repeated identical actions and results—for example, four repetitions.

The event log improves reconstruction and debugging, while the persistent terminal gives the agent a continuous environment. The cost is more state and a larger security boundary to manage.

### 5.2 Pi Agent: a tiny tool surface and branching history

Pi Agent deliberately chooses minimalism:

- Only four primitive tools: `read`, `write`, `edit`, and `bash`;
- A system prompt under 1,000 tokens;
- No separate permission system—the process inherits the permissions with which it was launched;
- History stored as a tree, allowing the user to return to an earlier message and branch;
- No plan mode and no sub-agent tool by design.

The premise is that a few general primitives can compose into complex behavior. This keeps the system and context small, but isolation and authorization must be supplied by the surrounding runtime.

### 5.3 OpenClaw: a long-lived personal agent

OpenClaw emphasizes persistence and proactive operation:

- A heartbeat wakes the agent on a schedule, such as every 30 minutes; it returns `NO_REPLY` when there is nothing to report.
- One long-lived gateway owns the chat channels.
- `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and `MEMORY.md` are placed into context to define identity and the relationship with the user.
- A nightly background job reviews the day's notes and consolidates durable information into long-term memory.

Compared with a one-shot coding task, this design cares more about lifecycle, identity continuity, proactive triggers, and memory consolidation.

| Design dimension | OpenHands | Pi Agent | OpenClaw |
| --- | --- | --- | --- |
| Core use case | Software-engineering tasks | Minimal coding agent | Persistent personal assistant |
| State representation | Event log | Branching conversation tree | Long-lived gateway plus Markdown memory |
| Execution environment | Persistent terminal | Four primitive tools | Chat channels and scheduled runs |
| Main tradeoff | Reconstructable and debuggable, but heavier | Simple and token-efficient, but relies on external permissions | Proactive and continuous, but lifecycle management is harder |

## 6. The same model can become a different agent under a different harness

Model evaluations often treat the model name as the only independent variable. Agent performance also depends on prompts, tool schemas, context selection, terminal persistence, error recovery, and stopping rules.

The Terminal-Bench 2 comparison shown in Lecture 5 places the same models in harnesses such as Pi, Codex, and Claude Code. Both success rate and rollout cost change materially across harnesses.

![Cost and success-rate differences when the same model is placed inside different agent harnesses](/img/posts/cs329z-frameworks-orchestration/harness-performance.webp)

Two conclusions follow:

1. “Agent ability” is rarely a pure model property; it is the joint result of **model × harness × environment**.
2. Changing the harness can change model rankings, so a model leaderboard cannot replace a system evaluation.

## 7. Meta-Harness: search the harness design space automatically

A harness contains many hand-designed choices: tool sets, prompts, context policies, and stopping strategies. These choices can themselves become an optimization space.

The Meta-Harness loop works as follows:

1. Read candidate source code, prior traces, and evaluation results.
2. Propose new harness code or configuration.
3. Combine the harness with an LLM and run evaluation tasks.
4. Store code, reasoning traces, scores, and logs.
5. Use the results to propose the next candidate.

![The Meta-Harness loop proposes, executes, and evaluates new harnesses](/img/posts/cs329z-frameworks-orchestration/meta-harness-loop.webp)

In the experiments shown in the notes, Meta-Harness finds configurations that outperform several hand-written defaults within a small number of evaluations. The Terminal-Bench 2 chart also shows the searched harness outperforming the displayed manual baselines under that setup.

![Meta-Harness search progress and Terminal-Bench 2 evaluation results](/img/posts/cs329z-frameworks-orchestration/meta-harness-results.webp)

The lasting idea is not one particular score. It is the shift in design method: agent scaffolds that engineers once tuned manually are becoming code and configuration spaces that can be generated, executed, and evaluated automatically.

Meta-Harness also amplifies evaluation bias. If the task set does not represent real users, automated search will simply overfit the wrong objective faster.

## 8. Why agents need durable orchestration

Agents can now work on increasingly long tasks. Network errors, process crashes, API limits, and waits for human input may be rare over a few minutes but become inevitable over several hours.

Temporal separates execution into two important concepts:

- An **Activity** is a unit that performs real external work. It may fail and be retried.
- A **Workflow** connects activities, while its history and state are persisted.

![Temporal's execution model with client, task queues, workflow workers, activity workers, and persisted history](/img/posts/cs329z-frameworks-orchestration/temporal-execution-model.webp)

In the diagram, a client submits work; the server maintains workflow and activity queues plus execution history; workflow workers determine the next step, and activity workers perform external actions. A temporary worker failure does not require the system to start again from the first line of the prompt.

Durable execution is especially useful for:

- operations that wait for human approval;
- long jobs spanning several external APIs;
- tool calls with retries, timeouts, and backoff;
- scheduled research or monitoring that runs for days;
- business processes that must retain progress through process restarts.

Retries cannot mean unconditional repetition. Side-effecting activities such as sending email, making a payment, or opening a ticket need idempotency keys or explicit compensating actions. Otherwise, “reliable retry” can create duplicate effects.

## 9. Telemetry: without a trace, an agent cannot be debugged

A conventional request may have one input, one response, and a short log. An agent run can contain dozens of model calls, tool calls, retrievals, branches, and retries. Saving only the final answer makes several questions almost impossible to answer:

- Did the model reason incorrectly, or did the tool return bad data?
- Why did cost suddenly increase?
- At which step did the run diverge from the goal?
- Why did the same task succeed yesterday and fail today?

The tools discussed in Lecture 5 have different emphases:

| Tool | Primary focus | Typical records |
| --- | --- | --- |
| MLflow | Experiment and model lifecycle | Parameters, model versions, datasets, metrics, prompt and agent runs |
| LangSmith | LangChain and LangGraph development lifecycle | Traces, datasets, evaluations, production monitoring |
| Langfuse | LLM application observability | Traces, token cost, latency, user feedback, dashboards; self-hosting support |

A useful trace is not merely a chronological log. It connects the user goal, model inputs and outputs, tool parameters and results, state transitions, errors, retries, cost, latency, final evaluation, and version metadata.

Telemetry is therefore not a dashboard to bolt on after launch. It is part of the agent architecture.

## 10. Shepherd: make execution inspectable and reversible

Some agents modify source code, files, or a working environment. If every step permanently changes the real environment, even a perfect log may arrive too late.

[Shepherd](https://github.com/shepherd-agents/shepherd) takes a runtime-substrate approach. It records agent work as a **durable, inspectable, and reversible** execution trace and preserves workspace outputs for review.

Before applying the result, the user can choose to:

- `accept / apply`;
- `reject / discard`;
- `rollback`;
- modify the result and run again.

The key separation is between “the agent computed a result” and “the result permanently changed the environment.” For code changes, infrastructure configuration, and high-risk business operations, reversibility and supervision may matter more than another small gain in single-run success.

## 11. Let evals choose the architecture, not framework popularity

Framework choices need evaluation support. At minimum, an agent system should track:

- **Task quality**: accuracy, pass rate, and final environment state;
- **Reliability**: repeated-run consistency, recovery rate, and stuck-run frequency;
- **Efficiency**: token, API, and compute cost plus end-to-end latency;
- **Safety**: permission violations, harmful side effects, prompt injection, and sensitive-data exposure;
- **User control**: approval burden, interruptibility, review, and rollback.

For a domain-specific agent, chasing a general benchmark such as SWE-bench is not enough. A more useful dataset comes from real user tasks and includes common paths, edge cases, external-service failures, missing information, and cases that should be refused.

A practical adoption order is:

1. Establish a baseline with a minimal tool set and representative tasks.
2. Add an optimization layer such as DSPy when prompts and examples are unstable.
3. Introduce state-graph orchestration when branches, loops, and human approval appear.
4. Add a durable workflow when jobs cross processes or hours and must recover.
5. Record traces, cost, versions, and evaluation results from the beginning.
6. Keep a new framework layer only when it improves the fixed evaluation set.

## Conclusion: the model is the engine; the harness determines how it works

The most important lesson from Lecture 5 is to separate agent capability from the model name:

```text
Model          supplies reasoning and generation
Workflow       expresses task logic
Harness        defines tools, context, memory, and environment
Orchestrator   keeps long-running work progressing reliably
Telemetry      makes every step observable and debuggable
Evals          decide whether the system actually improved
```

Agent engineering is not about making a model complete a task once. It is about making the whole system repeatable, observable, recoverable, evaluable, and continuously improvable.

Once a task grows from one model call into dozens of steps, several hours, or a persistent service, product quality is determined not only by the model but by the harness and runtime infrastructure built around it.
