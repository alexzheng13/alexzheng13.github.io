---
title: "CS 329Z: Agent Memory Architectures"
date: 2026-10-14 21:42:43 +0200
slug: "cs329z-agent-memory-architectures"
description: "Stanford CS329Z Lecture 7 on working, episodic, semantic, and procedural memory; architectures from Voyager and MemGPT to Generative Agents and Mem0; and four benchmarks for evaluating agent memory."
categories: [AI Agents]
tags: [AI Agents, Agent Memory, Memory, Context Engineering, MemGPT, Mem0, Evaluation]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

An assistant can give an excellent answer in one conversation, then ask you to explain your preferences, project, and completed work all over again in the next. It may reason well without connecting that ability to an ongoing history.

Agent memory addresses this discontinuity: **turning past interactions into information that can be retrieved, updated, and used correctly in later actions.**

The previous article, [Context Management Patterns](/en/post/cs329z-context-management-patterns/), examined what should enter each model call. This article asks what happens after information leaves the window: what gets stored, when it is written and retrieved, and how to establish whether memory improves later tasks.

```text
Experience: conversations, tool calls, environment feedback
                         ↓
Distillation: facts, preferences, lessons, skills, task state
                         ↓
Storage and maintenance: tiers, links, updates, forgetting
                         ↓
Retrieve → Working context → Next action
    ↑                            ↓
    └──────── New feedback ──────┘
```

This article follows **Stanford CS 329Z Lecture 7: Agent Memory Architectures**, moving from motivation and memory types through architectures, evaluation, and open problems. Engineering examples and implementation suggestions are my additions; experimental claims refer to their stated setups.

<!--more-->

> **Related course articles**: [Context Management Patterns](/en/post/cs329z-context-management-patterns/) · [Frameworks & Orchestration](/en/post/cs329z-frameworks-orchestration/) · [From RAG to Agentic RAG](/en/post/cs329z-rag-agentic-retrieval/)

## 1. What does an agent lose without memory?

The lecture identifies three losses:

- **Procedure**: the user must teach the same task again.
- **Knowledge**: important facts, rules, and preferences disappear between sessions.
- **Progress**: a long-running agent forgets completed work, early goals, or user instructions.

Memory can support personalization, learning from experience, and stateful work across conversations.

Consider “continue editing the research proposal.” A useful assistant needs the document, unresolved questions, accepted edits, and active constraints. Remembering only that the user is writing a proposal is insufficient.

Memory quality should therefore appear in the next task: less repeated explanation, fewer repeated mistakes, and better retention of unfinished commitments.

## 2. Four memory types: current state, experience, facts, and skills

The lecture draws on CoALA, Cognitive Architectures for Language Agents, to distinguish memory by content and use.

![CoALA connects working memory with procedural, semantic, and episodic memory](/img/posts/cs329z-agent-memory/coala.webp)

*Lecture slide 16; original figure credited to CoALA.*

| Type | Main contents | Example | Use |
| --- | --- | --- | --- |
| Working | Currently available state and information | Goal, recent tool results, relevant code | Directly available to the current model call |
| Episodic | Specific past experiences | Conversation, failed test, task trajectory | Recover events and their evidence |
| Semantic | Facts and knowledge | Preferences, project rules, environment properties | Answer questions or constrain decisions |
| Procedural | How to perform tasks | Skill code, workflow, debugging method | Guide or execute later actions |

One experience can produce several memories. A failed deployment can remain as a raw log, yield a fact about configuration compatibility, and inspire a deployment checklist. These serve episodic, semantic, and procedural roles.

### Parametric versus contextual memory is a separate axis

Model weights already contain knowledge and behavioral patterns, which fine-tuning can change. External facts, skill files, and conversation records must instead be read into context before they affect the current generation.

This is compatible with the earlier taxonomy: similar knowledge can live in parameters or external storage.

The lecture marks episodic memory as not applicable on the parametric side. The useful interpretation is that **model weights cannot replace a personal event archive with precise, traceable records of particular interactions**. This does not claim that models never memorize training examples; it distinguishes historical records from general parametric knowledge.

## 3. Architecture begins with What, When, and How

Before choosing files, a database, or a graph, answer three questions.

### What should be stored and retrieved?

User facts, preferences, successful trajectories, failure lessons, and conversation progress have different requirements. Should raw evidence accompany a distilled conclusion? Does a temporary hypothesis have enough support to become long-term knowledge?

### When should reads and writes happen?

Memory operations can be agent-triggered, scheduled in the background, or driven by session boundaries, tool events, and other conditions.

Immediate writes make information available sooner but add latency. Background consolidation permits more extensive merging and checking, but must handle overlapping old and new state.

### How should information be stored and found?

| Storage | Strength | Main design work |
| --- | --- | --- |
| Filesystem | Readable, editable, hierarchical; accessible through listing, search, and read tools | Naming, indexing, concurrent edits, duplication |
| Database | Filters for user, time, source, and other metadata; lexical and vector retrieval | Schema, query quality, update consistency |
| Knowledge graph | Explicit entities and relations | Extraction errors, entity resolution, relation maintenance |

Vector search helps with semantic similarity, BM25 with exact terms, and structured databases such as SQLite with metadata queries. They can be combined, following the retrieval tradeoffs discussed in the RAG article.

Storage solves only part of the problem. Files without a reading strategy become an archive that nobody can navigate. A vector store without updates can repeatedly return obsolete preferences.

## 4. Pattern one: learn procedures and skills from experience

This family turns useful past behavior into reusable procedural memory, reducing the need to explore the same task again.

### Voyager: store successful behavior as executable code

[Voyager](https://arxiv.org/abs/2305.16291) combines an automatic curriculum, feedback-driven code refinement, and a skill library in Minecraft. Skills contain code and descriptions, enabling retrieval, execution, and composition in later tasks.

![Voyager indexes executable skills through their descriptions](/img/posts/cs329z-agent-memory/voyager-skills.webp)

*Lecture slide 32.*

Mining, smelting, and crafting can become reusable units. More complex tasks compose those units. The lecture's ablation example shows the skill library helping the system craft diamond tools in the displayed experiment, while the configuration without it did not reach that goal.

This learning happens through external code and retrieval; it does not require updating the base model's weights.

### AWM: induce repeatable workflows from trajectories

[Agent Workflow Memory](https://arxiv.org/abs/2409.07429) extracts recurring routines from task trajectories and provides relevant workflows to guide subsequent actions.

![AWM collects trajectories, evaluates them, and induces reusable workflows](/img/posts/cs329z-agent-memory/awm.webp)

*Lecture slide 35.*

Examples include navigating a product category or editing a field and saving the result. A reusable workflow abstracts away product names and user IDs while retaining the operation structure.

### Skill files: package methods for on-demand use

Procedures can also live in instruction files, examples, and scripts. Progressive disclosure exposes a short capability description first and loads detailed instructions when needed.

The shared limitation is environmental change. A website, API, permission, or business policy can invalidate a previously successful procedure. Skills need applicability conditions, versions, and validation as well as a success history.

## 5. Pattern two: connect limited context to tiered memory

A hierarchy keeps a small active state in context while placing larger histories and knowledge outside it, accessible through tools.

### MemGPT: let the model participate in memory management

MemGPT gives the model memory operations. The lecture diagram places system instructions, writable working context, and a FIFO message queue inside the finite window, with recall and archival storage outside it.

![MemGPT's finite context, message queue, recall storage, and archival storage](/img/posts/cs329z-agent-memory/memgpt.webp)

*Lecture slide 44; original figure credited to MemGPT.*

The parts serve different roles:

- **Working context** holds active facts, preferences, and state that can be written or replaced.
- **Recall storage** retains past interactions for content or date lookup.
- **Archival storage** holds larger information collections for retrieval.

There is no need to search working memory already present in context. The challenge is deciding when to bring external information in and what to replace when it arrives.

### MemoryOS: add a middle tier and long-term personal memory

[MemoryOS](https://arxiv.org/abs/2506.06326) separates short-term, mid-term, and long-term personal memory, with processes for storage, updating, retrieval, and generation.

![MemoryOS updates and retrieves across short-, mid-, and long-term personal memory](/img/posts/cs329z-agent-memory/memoryos.webp)

*Lecture slide 49.*

The middle tier organizes recent interactions, while the long-term tier retains more stable information. A temporary remark need not instantly become a permanent user attribute, and recent conversations can retain structure after leaving the active window.

The cost is management complexity: what should be promoted, demoted, merged, or expired? Rich external memory is of little help if the current task cannot retrieve the right evidence.

## 6. Pattern three: reflect on experience to form reusable conclusions

Raw trajectories record what happened. Reflection attempts to identify what can be learned from it.

### Reflexion: preserve improvements derived from feedback

The lecture revisits Reflexion: an actor attempts a task, an evaluator provides feedback, and self-reflection converts shortcomings into language-based lessons for later attempts.

A useful lesson from a failing test specifies the missed condition and the next check. “Be more careful” does not. This connects to [reflection in the Reasoning article](/en/post/agentic-llm-1-reasoning/), with the focus now on retention and reuse.

### Generative Agents: memory streams, retrieval, planning, and reflection

Generative Agents write observations into a memory stream, retrieve information relevant to the current situation, and use it for action, planning, and higher-level reflection.

![Generative Agents connect perception, a memory stream, retrieval, action, planning, and reflection](/img/posts/cs329z-agent-memory/generative-agents.webp)

*Lecture slide 54.*

The lecture's retrieval example combines **recency, importance, and relevance**: how recent a memory is, how much it matters, and how closely it relates to the question.

![A retrieval example combines recency, importance, and relevance](/img/posts/cs329z-agent-memory/memory-retrieval-score.webp)

*Lecture slide 55.*

The weighted selection can be understood through this illustrative expression; normalization and weights depend on the implementation:

<div class="math-display">
\[
S(m,q)=\alpha R_{\mathrm{recency}}(m)
+\beta I(m)+\gamma R_{\mathrm{relevance}}(m,q)
\]
</div>

Semantic similarity alone may miss recently changed facts. Time alone may neglect an enduring commitment. Multiple signals help select what should enter the working context.

Reflection adds abstraction and the possibility of unsupported inference. Observing two vegetarian meals does not establish that a user permanently avoids meat. Reflective conclusions should retain evidence and uncertainty.

## 7. Pattern four: maintain, update, and forget

As a system runs longer, the challenge shifts from writing records to keeping them useful: deduplication, conflict resolution, index updates, links, and invalidation of obsolete information.

### Sleep-time compute: process context between requests

[Sleep-time Compute](https://arxiv.org/abs/2504.13171) processes known context before a query arrives, preparing potentially useful information to reduce immediate work later.

![Sleep-time compute moves some context processing ahead of the user's query](/img/posts/cs329z-agent-memory/sleep-time-compute.webp)

*Lecture slide 58.*

The lecture places it under maintenance. It need not happen at night: the principle is to move suitable preparation out of the user's waiting path. Benefits depend on how predictable future queries are and whether preparation can be reused enough to amortize its cost.

### A-Mem: actively organize the memory itself

[A-Mem](https://arxiv.org/abs/2502.12110) constructs notes with descriptions, keywords, and tags, identifies connections to existing memories, and can update prior representations when new information arrives.

![A-Mem's note construction, link generation, memory evolution, and retrieval](/img/posts/cs329z-agent-memory/a-mem.webp)

*Lecture slide 62.*

Writing a record becomes part of organizing a knowledge network. Generated descriptions and links can also be wrong, which makes access to the original evidence essential.

### Mem0: assign explicit update actions to new information

The lecture's Mem0 pipeline extracts candidate memories, retrieves related records, detects conflicts, and chooses an update:

```text
ADD      Introduce a new fact
UPDATE   Change an existing representation
DELETE   Remove a record that should no longer be retained
NOOP     Leave the current memory unchanged
```

![Mem0 extracts facts, detects conflicts, and updates memory](/img/posts/cs329z-agent-memory/mem0.webp)

*Lecture slide 64.*

“Tuesday used to work; Thursday works now” should not become two undated preferences that both look current. The system needs to distinguish historical state from active state.

Here, `DELETE` is an algorithmic memory action. It does not by itself establish deletion from backups, caches, and logs; product-level deletion requires its own handling.

## 8. How the four architecture patterns fit together

These patterns address different concerns and can coexist:

| Pattern | Stored contents | Typical write trigger | Benefit | Tradeoff |
| --- | --- | --- | --- | --- |
| Learn procedures | Code, workflows, skills | Useful trajectories or offline induction | Less repeated exploration | Procedures become stale |
| Tiered hierarchy | Active information and external detail | New information or context pressure | Larger effective memory | Reliable scheduling and retrieval are required |
| Reflective consolidation | Lessons and higher-level conclusions | Feedback or accumulated observations | Better reuse and transfer | Unsupported inferences |
| Maintenance | Updated facts, links, and indexes | New evidence, insertion, or background processing | Fresh, organized memory | Compute cost and possible information loss |

A research assistant might preserve task trajectories, maintain active progress in working memory, extract workflows from successful research, and update project facts in the background. Experience shapes memory, memory affects action, and new outcomes revise the memory.

## 9. Evaluation: from recalling an answer to completing a task

The lecture proposes four criteria: **realistic, long-context, challenging, and verifiable**. Sources and queries should resemble actual work, history should be sufficiently long, tasks should reveal differences, and success should have clear evidence.

| Benchmark | Memory source | Main ability | Interpretation limit |
| --- | --- | --- | --- |
| LoCoMo | Long simulated conversations | Cross-session facts, temporal relations, multi-hop questions | Conversation recall differs from agent task completion |
| PersonaMem | Simulated user–assistant interactions | Evolving profiles and preferences | Choosing a response differs from acting on preferences |
| LongMemEval-V2 | Historical web-agent trajectories | Environment state, workflows, gotchas, premise awareness | Reader models and compute budgets affect results |
| MemoryArena | Interdependent multi-session tasks | Use earlier experience in subsequent actions | Planning, tools, and execution also affect success |

### LoCoMo: retrieval and correct use are separate

LoCoMo includes question answering and event summarization over long conversations. The lecture compares retrieval units and emphasizes that receiving relevant memory does not guarantee a correct answer.

![LoCoMo's questions, event summaries, and multimodal tasks over long conversations](/img/posts/cs329z-agent-memory/locomo.webp)

*Lecture slide 71.*

Distinguish failure to retrieve evidence from failure to interpret or reason over retrieved evidence. Improving recall alone cannot resolve both.

### PersonaMem: track changing preferences

PersonaMem emphasizes evolving user profiles. A user may change a food preference across sessions; the assistant should respond to the current state rather than repeat an obsolete recommendation.

![PersonaMem tracks preference updates and applies them in new situations](/img/posts/cs329z-agent-memory/personamem.webp)

*Lecture slide 76.*

This exposes systems that remember the past without updating the present. Selecting the correct candidate response still differs from using preferences in an open-ended task.

### LongMemEval-V2: turn environment experience into colleague-like knowledge

This benchmark asks whether a memory system can accumulate useful knowledge from web-agent trajectories: static state, dynamic changes, workflows, environment gotchas, and premise awareness.

The lecture's figure contains 451 questions in multiple-choice, short-answer, and free-form formats, so the benchmark should not be described as exclusively multiple-choice. Histories contain hundreds of trajectories; the paper reports up to approximately 115 million tokens.

![LongMemEval-V2 source environments, question categories, and answer formats](/img/posts/cs329z-agent-memory/longmemeval-types.webp)

*Lecture slide 83.*

The lecture compares RAG-based gathering with filesystem exploration by a coding agent.

![LongMemEval-V2 accuracy and latency comparison using different models across configurations](/img/posts/cs329z-agent-memory/longmemeval-results.webp)

*Lecture slide 85.*

The filesystem approach performs better in the displayed setup, but the models differ too. Stronger reasoning and more active tool exploration can both contribute. **This figure alone does not establish that filesystems inherently outperform vector retrieval.** For deployment decisions, compare complete systems on fixed tasks, models, and budgets.

### MemoryArena: experience must improve later action

MemoryArena joins memory, agents, and environments in multi-session tasks. Earlier observations, feedback, and preferences become conditions for later subtasks.

![MemoryArena's multi-session memory–agent–environment loop](/img/posts/cs329z-agent-memory/memoryarena.webp)

*Lecture slide 88.*

A group travel-planning task might gather preferences first, then introduce budget or itinerary changes. The system must use memory to revise a plan and satisfy verifiable constraints.

Some memory controllers perform poorly in the lecture's results, indicating substantial headroom. Yet task completion also depends on tools, planning, and reasoning. Not every failure can be attributed to memory.

## 10. Three unresolved problems

### What should be remembered or forgotten?

Future relevance is unknown when a memory is created. Retaining everything raises retrieval, context, and maintenance cost. Aggressive forgetting can erase evidence or unfinished commitments.

A statement might be a stable preference, temporary emotion, quotation, or joke. Looking like a fact is not enough to justify long-term storage.

### Trust, privacy, and user control

Procedural memories influence future action and therefore create an attack surface. Malicious content stored as a reusable procedure can affect later sessions.

![Memory poisoning can influence later behavior through contaminated procedural memories](/img/posts/cs329z-agent-memory/memory-poisoning.webp)

*Lecture slide 98.*

Retrieval does not grant a memory higher instruction authority. Users also need visibility into stored information and its source, along with correction and deletion controls.

### Retrieved memory can still be misused

Over-personalization is a common example: an assistant reads a preference and unnecessarily bends an unrelated answer around it.

Better retrieval and training can help, but the system must also decide whether the task requires personal information at all. **Using memory well includes knowing when to leave it unused.**

## 11. A practical memory record

The following is my engineering addition, turning the concepts into an explicit record:

```yaml
id: pref-0042
type: semantic
scope: user
content: User prefers Thursday meetings this semester
source: conversation-2026-10-14-message-18
observed_at: 2026-10-14
valid_during: Current semester
status: active
supersedes: pref-0017
evidence: User explicitly said Tuesday no longer works
```

The record includes provenance, validity, status, and replacement history as well as content. Retrieval can filter candidates by authorization, relevance, and time, recover supporting evidence, and supply it to the answer or action module.

A complete lifecycle could be:

```text
Store the interaction
    → Extract candidate facts and lessons
    → Compare with existing memory
    → Add, update, or leave unchanged
    → Preserve provenance and temporal relationships
    → Retrieve for the current task
    → Check applicability before reasoning or acting
    → Revise or invalidate after new feedback
```

Evaluation should cover the entire chain: correct extraction, state updates, retrieval, appropriate use, and the resulting task outcome.

My central lesson is that a persistent assistant must retain experience and revise its interpretation of that experience. Reliable memory emerges from the coordination of storage, retrieval, updates, and action.

## Sources and further reading

The main source is **CS329Z Lecture 7: Agent Memory Architectures**, credited to Diyi Yang, Michael Ryan, and John Yang. Figures were rendered from the supplied PDF and retain their original source credits. The article date follows the PDF creation timestamp. Architecture and experimental descriptions refer to the lecture's setups rather than all later versions of the projects.

- [CoALA](https://arxiv.org/abs/2309.02427) · [Voyager](https://arxiv.org/abs/2305.16291) · [Agent Workflow Memory](https://arxiv.org/abs/2409.07429)
- [MemGPT](https://arxiv.org/abs/2310.08560) · [MemoryOS](https://arxiv.org/abs/2506.06326)
- [Reflexion](https://arxiv.org/abs/2303.11366) · [Generative Agents](https://arxiv.org/abs/2304.03442)
- [Sleep-time Compute](https://arxiv.org/abs/2504.13171) · [A-Mem](https://arxiv.org/abs/2502.12110) · [Mem0](https://arxiv.org/abs/2504.19413)
- [LoCoMo](https://aclanthology.org/2024.acl-long.747/) · [PersonaMem](https://arxiv.org/abs/2504.14225) · [LongMemEval-V2](https://arxiv.org/abs/2605.12493) · [MemoryArena](https://arxiv.org/abs/2602.16313)
