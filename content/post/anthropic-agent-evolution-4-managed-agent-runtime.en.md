---
title: "Anthropic Agent Evolution IV: Managed Agent Runtime"
date: 2026-09-12 21:05:45 +0200
slug: "anthropic-agent-evolution-4-managed-agent-runtime"
categories: [AI Agents]
tags: [Anthropic Agent Evolution, Managed Agents, Agent Runtime, Sandbox, Session, Codex]
toc: true
---

Earlier harnesses focused on how a model could continue work and improve quality. A managed service introduces system questions: how is a session persisted, how does work recover after a harness crash, how can sandboxes be replaced, how do customer VPCs connect, and how are credentials kept away from model-generated code?

Anthropic Managed Agents answers by **decoupling the brain, hands, and session behind stable interfaces.**

<!--more-->

> **Series**: [I. From Workflows to Agents](/en/post/anthropic-agent-evolution-1-from-workflows-to-agents/) · [II. Context Reset and Structured Handoff](/en/post/anthropic-agent-evolution-2-context-reset-and-handoff/) · [III. Planner–Generator–Evaluator](/en/post/anthropic-agent-evolution-3-planner-generator-evaluator/) · **IV. Managed Agent Runtime**

## 1. Four Components of an Agent Runtime

A managed agent can be decomposed into:

- **Session**: an append-only event log of what happened;
- **Harness**: the loop that calls the model, organizes context, and routes tool calls;
- **Sandbox**: the environment for commands, files, and untrusted generated code;
- **Tools / resources**: MCP servers, external services, and business capabilities.

![Session, harness, sandbox, and tools in a managed agent](/img/posts/anthropic-agent-evolution/managed-agent-components.webp)

Their lifecycles should not be coupled. The session must be durable; harnesses and sandboxes should be replaceable after failure.

## 2. Why Does the Single-Container Design Fail?

Putting the session, harness, and sandbox in one container is initially convenient, but that container becomes a “pet” that cannot be lost:

- container failure destroys the session;
- debugging requires entering a container that may contain user data;
- the harness assumes resources live beside it;
- customer VPC and self-hosted execution become difficult;
- generated code shares an environment with credentials, increasing prompt-injection impact.

A scalable system treats containers as cattle: replace a failed instance instead of nursing it back to health.

## 3. Decouple the Brain From the Hands

Anthropic treats Claude plus its harness as the brain, sandboxes and tools as the hands, and the event log as a separate session:

- the harness calls execution through `execute(name, input) → string`;
- sandbox failure becomes a tool error and a new sandbox can be provisioned;
- after harness failure, a new instance can `wake(sessionId)` and recover from the log;
- the session continues receiving events independently of any harness process.

The split improves both scalability and latency. Sessions that do not yet need compute can start inference immediately and provision a sandbox only on the first execution call. Anthropic reports roughly 60% lower p50 time-to-first-token and more than 90% lower p95.

## 4. A Session Is Not a Context Window

This is the architecture's most important distinction:

> **A session is the recoverable event history; a context window is the limited view selected for one model call.**

Compaction, trimming, and memory all decide what the next context retains. Those decisions can be irreversible if the original events existed only inside the context.

Managed Agents persist the full event stream, then let the harness call `getEvents()` to select slices, rewind around an important moment, or apply new context-engineering transformations.

- **The session owns recoverability.**
- **The harness owns context policy.**
- **The context window owns only current reasoning.**

A memory store is valuable durable state, but it is not a replacement for the event log. Memory contains knowledge the agent chose to extract; the session preserves raw facts that a future harness may reinterpret.

## 5. Security Boundary: Credentials Must Stay Outside the Sandbox

If generated code shares an environment with access tokens, a prompt injection only needs to persuade the agent to read environment variables. The structural solution is not asking the model to behave; it is making credentials unreachable:

- repository tokens are bound to a resource during initialization;
- OAuth tokens live in a vault outside the sandbox;
- MCP calls pass through a proxy that retrieves credentials and invokes services;
- neither the harness nor generated code directly sees those credentials.

As models improve, security assumptions based on what the model supposedly cannot do become increasingly fragile. Permissions must be enforced by architecture.

## 6. Comparison With the Codex Agents API

OpenAI's Agents API similarly separates the managed harness from execution and offers three environment modes.

### 6.1 No Environment

When an agent only needs function tools or remote MCP and no shell or files, it can run without a sandbox.

![Codex Agents API without an execution environment](/img/posts/anthropic-agent-evolution/codex-no-environment.webp)

### 6.2 OpenAI-Hosted Environment

When code, files, or artifacts are required, OpenAI manages the sandbox. The application sends work and consumes events while the harness routes built-in tool calls to the hosted environment.

![Codex Agents API with an OpenAI-hosted environment](/img/posts/anthropic-agent-evolution/codex-hosted-environment.webp)

### 6.3 Self-Hosted Environment

The application creates a session, receives an `environment_id` and `remote_url`, starts a VM, container, or Kubernetes pod, and connects an executor outbound. The cloud harness still manages the agent loop while shell and file tools execute in the customer's sandbox.

![Lifecycle of a Codex self-hosted environment](/img/posts/anthropic-agent-evolution/codex-self-hosted-flow.webp)

This closely resembles the brain/hands split: the application owns compute lifecycle, the Agents API owns the session and harness, and the executor runs commands inside the sandbox.

## 7. The Shared Direction

| Concern | Anthropic Managed Agents | OpenAI Agents API / Codex |
| --- | --- | --- |
| Durable task state | Session event log | Session + event stream |
| Agent loop | Managed harness | Managed Codex harness |
| Execution | Replaceable sandbox | None / hosted / self-hosted |
| External tools | MCP proxy / resources | Function tools / MCP |
| Recovery | Rebuild harness from session | Reconnect executor and event stream |
| Security | Credentials outside sandbox | Responsibilities split across harness, app, and sandbox |

Agent runtimes are evolving from “a model with tools” into an operating-system-like abstraction. Stable interfaces isolate change so models, harness strategies, and execution infrastructure can evolve independently.

## 8. What Changed Across the Series?

1. **Workflow → agent** moved dynamic decisions into the model.
2. **Context reset + handoff** moved long-term state outside the model.
3. **Generator + evaluator** moved judgment into external verification.
4. **Managed runtime** turned sessions, harnesses, and sandboxes into recoverable services.

Stronger models do not eliminate harnesses; they change what harnesses should do. Obsolete scaffolding should be removed, but state, verification, security, and recovery remain system problems rather than intelligence problems.

## Sources

- [Anthropic: Scaling Managed Agents—Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)
- [Claude Platform: Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory)
- [OpenAI Agents API: Architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture)
