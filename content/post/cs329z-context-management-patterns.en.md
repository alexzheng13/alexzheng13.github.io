---
title: "CS 329Z: Context Management Patterns — Keeping Agents Focused Across Long Tasks"
date: 2026-10-12 22:25:07 +0200
slug: "cs329z-context-management-patterns"
description: "Five context management patterns from Stanford CS329Z Lecture 6: persistent event logs, memory offloading, compaction, observation masking, and context isolation, with progressive disclosure and a practical combination strategy."
categories: [AI Agents]
tags: [AI Agents, Context Engineering, Context Management, Agent Harness, Memory, Compaction, Observation Masking]
toc: true
---

A coding agent usually begins a bug fix with a clear objective: find the cause, change the code, and run tests. Dozens of turns later, its context may be full of search results, file fragments, terminal logs, and abandoned approaches. The user's original constraints still exist somewhere in history, but the next decision may no longer use them correctly.

Long tasks require information to accumulate and to be reorganized. **Context management decides what enters each model call, what stays in external storage, and what can temporarily be hidden.**

Stanford CS 329Z Lecture 6 identifies five patterns:

```text
Persistent event log   Store events and reconstruct model inputs
Memory offloading     Move knowledge into memory or files
Compaction            Replace longer histories with summaries
Observation masking   Hide old tool outputs, retain action structure
Context isolation     Give subtasks their own context
```

This article explains each pattern through the same bug-fixing example. The lecture's context management section supplies the main framework; the handoff template, combined pipeline, and evaluation suggestions are my engineering synthesis.

<!--more-->

> **Related course articles**: [Frameworks & Orchestration](/en/post/cs329z-frameworks-orchestration/) · [From RAG to Agentic RAG](/en/post/cs329z-rag-agentic-retrieval/)

## 1. Two principles: focus and continuity

The lecture begins with **Focus the Context** and **Preserve Continuity**. Both goals must be satisfied together.

### Focus: include what the current task needs

A larger context window increases input capacity. The application still needs to select the information that matters.

A test command may return thousands of log lines, while the next decision needs only the failing test, exception location, and a short stack trace. Accumulating redundant output obscures useful evidence and increases processing cost.

For the coding agent, priority should go to the user's objective, active constraints, relevant code, current test results, and unresolved issues.

### Continuity: continue working after context changes

Keeping only recent turns can erase an early instruction such as “do not change the public API.” It can also make the agent repeat a fix that already failed.

Context management therefore needs to preserve task state as well as facts:

- the original goal and subsequent user corrections;
- constraints that remain active;
- completed and verified steps;
- rejected approaches and the evidence against them;
- unfinished work and the next useful check.

A useful compressed context should let the next model invocation continue without repeating the investigation.

### Semantic continuity and KV caching are separate concerns

The lecture also mentions preserving the KV cache. There are two distinct goals here: **preserving task meaning** and **reusing computation**.

Goals, constraints, and progress preserve semantic continuity. In common autoregressive inference, KV reuse depends on an unchanged token prefix and compatible computation settings. Rewriting earlier history generally prevents direct reuse of the affected suffix; keeping a stable prefix and appending information is more cache-friendly.

Compaction can shorten future inputs while introducing a summary call and some new prefill work. Its trigger should balance context quality against total execution cost.

## 2. Persistent event logs: preserve history and construct inputs as needed

A persistent event log records execution as a sequence of appended events. Each model call receives an input constructed from that record.

```text
User message / Agent action / Tool result
                     ↓
             Append-only event log
                     ↓
        Select → Mask → Summarize → Format
                     ↓
                Next LLM input
```

The lecture uses OpenHands as an example. Events remain available as they occurred even when the model-facing input changes. The system reconstructs input for each call, and external observers can monitor events to inspect its state.

![OpenHands event stream connecting the user interface, agent, stored history, and execution environment](/img/posts/cs329z-context-management/event-log.webp)

*Lecture slide 62; original figure credited to the OpenHands paper.*

During a bug fix, the log can preserve the first failing test, each patch, and later test results. The current model input may contain only the latest failure and relevant action records. Earlier evidence remains available for inspection.

This supports auditing, debugging, and context pruning together. However, **replaying recorded history does not make external actions safe to repeat**. Reconstructing a model input is different from sending an email or updating a database again; those operations require separate recovery or idempotency mechanisms.

## 3. Memory offloading: place knowledge outside the window

Memory offloading writes useful information into memory or files so that the corresponding material can be removed from the active window. Retrieval or tools bring it back when needed.

The lecture illustrates this with MemGPT: a finite working context is connected to external storage through explicit reads and writes. The [MemGPT paper](https://arxiv.org/abs/2310.08560) describes virtual context management inspired by hierarchical memory in operating systems.

![MemGPT stores information and recalls it in a later conversation](/img/posts/cs329z-context-management/memory-offloading.webp)

*Lecture slide 64.*

In an implementation, I would distinguish three kinds of external state:

| Type | Contents | Lifetime |
| --- | --- | --- |
| Task state | Goal, current step, verified results, pending work | Current task |
| Scratchpad | Investigation notes, hypotheses, evidence locations | Session or project |
| Long-term memory | Confirmed preferences and durable knowledge | Across sessions |

For example, a full test log can live in a file while the context retains its failure summary and path. A discovered call chain can go into a scratchpad. A single failing test should not automatically become permanent knowledge: code and environments change.

Offloaded information needs a usable index. “There was an error earlier” is difficult to retrieve. A test name, file location, timestamp, version, and evidence path make recovery possible.

**Successful storage is only the first step; later tasks must be able to retrieve the right record.** Active constraints may still need to remain in the current context even when a copy exists on disk.

## 4. Compaction: turn history into a useful handoff

Compaction asks an LLM to compress earlier reasoning, actions, and observations into a shorter description. The summary and recent interactions form the next context.

![Compaction replaces older trajectory segments with a summary while retaining recent interactions](/img/posts/cs329z-context-management/compaction.webp)

*Lecture slide 65.*

This helps when useful facts are scattered across repetitive history. Compression ratio alone is insufficient, though. “Investigated login and implemented a fix” is short but does not enable the next step.

Here is a structured handoff I would use for the running example:

```yaml
goal: Fix intermittent session loss after login
constraints:
  - Do not change the public API
  - Preserve existing cookie behavior
verified:
  - Reproduced concurrent requests overwriting session state
  - Updated the write logic in session_store.py
rejected:
  - Extra retries do not eliminate the concurrent overwrite
pending:
  - Run concurrency regression tests
  - Check cookie compatibility
evidence:
  - logs/session-race.txt
next_step: Run concurrency tests, then inspect the full test suite
```

A summary should distinguish verified findings from hypotheses. Otherwise, an uncertain guess can become an apparently established fact after compaction.

The lecture also suggests making compaction itself agentic: the summarizer can inspect stored records, check evidence, and then produce a handoff. This may reduce omissions but adds calls and coordination, so its benefit needs evaluation.

## 5. Observation masking: start with the bulky tool outputs

Observations often consume more context than actions. A file read, search, or test can return a large body of text, while its tool arguments occupy only a few lines.

The lecture's raw-agent distribution shows 83.9% observation tokens, 6.5% action tokens, and 9.6% reasoning tokens. These are measurements from that experimental setup, not universal proportions.

![Token distribution in the measured raw agent: observations account for most tokens](/img/posts/cs329z-context-management/token-distribution.webp)

*Lecture slide 66; figure credited to The Complexity Trap.*

Observation masking retains earlier action structure and tool calls while replacing older outputs with placeholders or truncated content. Recent observations remain visible.

```text
Action: Read session_store.py
Observation: [Old output hidden; recover from the event log or file]

Action: Run concurrency regression tests
Observation: [Old log hidden; full output in logs/session-race.txt]

Action: Run the latest regression tests
Observation: Keep the current output in full
```

![Observation masking compared with LLM summarization](/img/posts/cs329z-context-management/observation-masking.webp)

*Lecture slide 67.*

### How it differs from compaction

Masking primarily hides or truncates material and usually requires no additional model call. Compaction performs semantic summarization: it can retain information from a wider range of history but may omit details or change meaning.

Masking has a cost too. The agent can remember running a test while losing the reason it failed. Preserve tool names, arguments, call associations, ways to recover the output, and findings still needed for the next decision.

### What the experiment shows

The lecture compares cost and solve rate for Gemini 2.5 Flash, its Thinking configuration, and Qwen3-Coder 480B. Both masking and LLM summaries substantially reduce instance cost. Quality differences depend on the model and configuration.

![Cost and solve-rate comparisons for the raw agent, observation masking, and LLM summaries](/img/posts/cs329z-context-management/masking-evaluation.webp)

*Lecture slide 68; instance cost is on the horizontal axis and solve rate on the vertical axis.*

The corresponding paper, [The Complexity Trap, v3](https://arxiv.org/abs/2508.21433v3), finds competitive efficiency and performance from simple observation masking in settings including SWE-agent on SWE-bench Verified. For applications dominated by tool logs, masking is therefore a useful baseline to test. Whether a more complex summarizer adds value should be established on the target tasks.

## 6. Context isolation: give subtasks their own working space

When a task contains relatively independent branches, the main agent does not need every branch's complete exploration history.

Context isolation gives each subtask a separate context and returns the findings and evidence the parent needs.

![Context isolation assigns subtasks to separate windows and returns selected results](/img/posts/cs329z-context-management/context-isolation.webp)

*Lecture slide 69.*

For the login bug, one subtask might investigate session updates while another checks cookie compatibility. The main agent receives locations, findings, verification status, and unresolved issues.

Isolation can reduce interference and support parallel work. Decomposition and aggregation also add cost. If the subtask drops its evidence, the parent cannot assess its conclusion. A useful return contract includes:

```text
Finding / Evidence location / Verification / Uncertainty / Next step
```

Context isolation does not imply permission isolation. Two agents with separate histories may still share files and credentials. Separate sandboxes are another architectural decision.

### Progressive disclosure: load details when they become relevant

The lecture places progressive disclosure in this section. Instead of loading every tool description and instruction at initialization, the system exposes a small capability index and loads detailed material when needed, for example through skill files.

![Progressive disclosure loads detailed skill instructions on demand](/img/posts/cs329z-context-management/progressive-disclosure.webp)

*Lecture slide 70.*

This relates to sub-agent isolation but uses a different mechanism. Sub-agents separate working contexts; progressive disclosure controls when information enters a context.

The coding agent might begin with a tool list and project index, read testing conventions when it starts validation, and load release instructions only when publishing becomes relevant. This reduces persistent irrelevant context, provided the index makes the capabilities discoverable.

## 7. How the five patterns work together

The lecture stresses that these patterns are compatible. A system can retain a complete event log while masking old observations in model inputs. It can also offload knowledge before compacting the remaining history.

| Pattern | What changes | Main benefit | Main concern |
| --- | --- | --- | --- |
| Event log | How history is stored and reconstructed | Traceability and reconstruction | Stored history need not all enter the prompt |
| Memory offloading | Where information lives | Retention across turns or sessions | Retrieval accuracy and freshness |
| Compaction | How history is represented | Continuity with fewer tokens | Omissions and hardened assumptions |
| Observation masking | Visibility of old tool outputs | Less historical log volume | Recoverability of important evidence |
| Context isolation | Context boundaries between subtasks | Less interference | Handoff quality and coordination cost |

A combined pipeline for the coding task could be:

```text
Append every step to the event log
             ↓
Store large outputs externally; retain findings and references
             ↓
Mask older observations; keep recent results visible
             ↓
Near the budget, compact goals, constraints, and progress
             ↓
Isolate independent investigations; load instructions on demand
             ↓
Recover evidence when needed and continue the next decision
```

The lecture's later Pi example also combines event-log-to-input conversion, progressive disclosure through skills, and compaction. A small set of mechanisms can form a complete design when their interfaces work together.

## 8. Check the design with Write, Select, Compress, and Isolate

The lecture uses LangChain's taxonomy to place these patterns in a broader design space:

![Context management taxonomy: write, select, compress, and isolate](/img/posts/cs329z-context-management/context-taxonomy.webp)

*Lecture slide 73.*

- **Write** stores information in task state, scratchpads, or long-term memory.
- **Select** brings relevant tools, knowledge, and historical records into the current context.
- **Compress** summarizes useful content and trims redundant material.
- **Isolate** assigns information to separate state or context boundaries.

Masking is trimming-based compression; compaction is summary-based compression. Memory offloading connects writing with later selection. Progressive disclosure emphasizes selecting information when needed. Event logs provide the historical foundation for these transformations.

The taxonomy helps expose systems that compress history but have no adequate storage, retrieval, or task decomposition strategy.

## 9. How to evaluate context management

Fewer tokens are one metric. My main question would be whether the agent still completes the same task while respecting the user's requirements.

Fix the task set and compare raw history, masking, compaction, and hybrid strategies. Record:

| Dimension | What to measure |
| --- | --- |
| Task success | Correct changes and final test results |
| Continuity | Forgotten constraints, repeated failed approaches, missing work |
| Evidence recovery | Ability to locate and reload hidden information |
| Cost and latency | Including summaries, tool rereads, and fresh prefill |
| Long-run stability | Accuracy of task state after repeated context changes |

Include early constraints, facts needed much later, large tool outputs, and mid-task user corrections. These cases reveal whether the system selects information effectively or merely removes content that happens not to matter yet.

The design principle I take from this section is to **keep complete records in appropriate storage and give the current window enough information for the next action**. Event logs supply history; memory and retrieval supply capacity; compaction and masking control input size; isolation controls information boundaries. Their combination supports sustained work on long tasks.

## Sources and further reading

The main source is **CS329Z Lecture 6: Agent Design Patterns and Scaffolds**, slides 55–75, with the Pi context-management example on slide 81. The lecture lists Diyi Yang, Michael Ryan, and John Yang. Figures were rendered from the supplied PDF pages and retain the original credits. The article date follows the PDF's creation timestamp.

- [OpenHands paper](https://arxiv.org/abs/2407.16741): the persistent event-log example.
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560): hierarchical memory and offloading.
- [The Complexity Trap, v3](https://arxiv.org/abs/2508.21433v3): observation masking compared with LLM summarization.
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): context engineering and long-running work.
- [LangChain: Context Engineering for Agents](https://www.langchain.com/blog/context-engineering-for-agents): the Write, Select, Compress, and Isolate taxonomy.
