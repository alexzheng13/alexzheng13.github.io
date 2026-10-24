---
title: "LangChain Agent Builder’s Memory System"
date: 2026-02-21
slug: "langchain-agent-builder-memory-system"
description: "How Agent Builder represents memory as files, turns feedback into future instructions, and uses AGENTS.md, skills, filesystem tools, and persistent storage."
categories: [AI Agents]
tags: [AI Agents, Agent Memory, LangChain, Deep Agents, AGENTS.md, Skills, Context Engineering]
toc: true
---

A meeting assistant writes paragraphs. You ask for lists instead. At the next meeting, it follows that preference without another reminder.

This kind of memory changes how an agent works, not merely what it can recall. Agent Builder represents instructions, capabilities, and knowledge as files so feedback can become rules available to future runs.

<!--more-->

This article draws on LangChain’s [How we built Agent Builder’s memory system](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system), published **February 21, 2026**. Product status and roadmap items refer to that account. File examples illustrate the mechanism, not the product’s complete internal configuration.

## 1. Why prioritize memory for repeated tasks?

A general assistant may switch between unrelated activities. An agent dedicated to meeting notes, email, or recruiting repeatedly encounters similar work. A correction is therefore more likely to remain useful.

Without memory, users repeatedly explain formatting, redaction, or task conventions. The useful unit to preserve is not necessarily an entire conversation: it may be a working agreement extracted from feedback.

Memory can provide value inside one workflow without first becoming a comprehensive model of the user’s life.

## 2. Remembering facts and remembering methods

The original article uses CoALA’s distinction between:

- **Semantic memory:** facts and knowledge.
- **Procedural memory:** instructions and methods that shape behavior.
- **Episodic memory:** particular past experiences and their sequence.

![The original article’s diagram of procedural, semantic, and episodic long-term memory and their relationship to working memory](/img/posts/langchain-agent-builder-memory/coala-memory.png)

Source: [LangChain’s original article](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system). The three long-term memory categories at the top correspond to the distinction discussed here.

A customer’s name, a rule for handling customer meetings, and a transcript of one meeting serve different purposes. Searching historical conversations does not by itself establish which lessons should guide future work.

For more background, see [Agent Memory Architectures](/en/post/cs329z-agent-memory-architectures/).

## 3. Why represent memory as files?

Files offer a familiar interface: list paths, find relevant material, read it, and edit a section. The system does not need a different custom operation for every category of knowledge.

An illustrative organization is:

```text
agent-memory/
├── AGENTS.md                 Core responsibilities and behavior
├── skills/
│   └── meeting-summary/
│       └── SKILL.md          Task-specific method
├── subagents/                Delegated-agent definitions
├── tools.json                Available tool configuration
└── knowledge/
    └── customer-notes.md     Business reference material
```

| Artifact | Main question it answers |
| --- | --- |
| `AGENTS.md` | What should this agent do and follow generally? |
| Skills and supporting files | How should a particular task be handled? |
| Subagent definitions | What work is delegated to another executor? |
| `tools.json` | Which external tools are available? |
| Knowledge files | Which facts and materials inform the task? |

[AGENTS.md](https://agents.md/) is a Markdown convention for agent-facing context and instructions. [Agent Skills](https://agentskills.io/home) package specialized instructions and supporting resources. Their contents can span knowledge categories; a filename alone does not determine a memory type.

![LangChain’s conceptual mapping of memory to instruction, skill, knowledge, and conversation files](/img/posts/langchain-agent-builder-memory/memory-filesystem.png)

Source: [LangChain’s original article](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system). This is the original conceptual mapping. The diagram labels tool configuration `mcp.json`, while the text describes a custom `tools.json` for selecting an MCP tool subset. Episodic conversation files were also a planned direction, not a shipped feature at publication.

### A file interface does not require disk storage

In the original design, Postgres stores the data behind a virtual filesystem. The agent works with paths and content; the backend handles persistence.

```text
Agent
  │ list, search, read, edit
  ▼
Filesystem interface: paths and content
  │ backend storage operations
  ▼
Persistent data in Postgres
```

The interface organizes interaction; the backend determines storage. [Deep Agents backends](https://docs.langchain.com/oss/python/deepagents/backends) distinguish thread-local state, local files, and durable storage.

Being able to write a file does not automatically mean another conversation can retrieve it. Persistence and access scope must be configured appropriately.

The original article also shows an internal LinkedIn recruiting agent. Its main instructions, search subagent, tool configuration, and job requirements can be inspected and maintained in a shared file view.

![The recruiting agent’s memory file interface with main instructions, a subagent, tool configuration, and job reference material](/img/posts/langchain-agent-builder-memory/recruiter-memory-files.png)

Source: [LangChain’s original article](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system). This is a product example, distinct from the illustrative directory above.

## 4. From a correction to future behavior

The meeting-assistant example involves two changes: correcting the current response and changing a rule for later runs.

An illustrative instruction after the first correction might be:

```markdown
# Summary requirements

- Organize summaries as concise lists.
```

A later request to separate follow-up work could produce:

```markdown
# Summary requirements

- Organize summaries as concise lists.
- Finish with a separate action-items section.
```

This updates external instructions, not model weights. The next run still needs to load or retrieve them. [Deep Agents memory documentation](https://docs.langchain.com/oss/python/deepagents/memory) describes specifying paths, reading memory, and optionally editing writable files.

The complete process includes identifying durable feedback, proposing changes, validation and approval where required, persistence, and later retrieval. A saved rule cannot affect a run that never sees it.

## 5. Why edit AGENTS.md rather than another file?

The system defines artifact responsibilities and guides the model to use them. A general formatting preference fits core behavior; a detailed task procedure may fit a skill; business facts belong in reference material.

One possible division is:

```text
General behavior → AGENTS.md
Specialized methods → corresponding skill
Business facts → relevant knowledge file
One-off requirements → current task context
```

This is an explanatory arrangement, not a published internal prompt. The original article does not reveal the complete prompt or establish a fixed keyword-routing algorithm.

“Only three items this time” also differs from “always use three items.” Deciding whether to persist feedback comes before selecting a file.

The filename is not magic: current documentation also shows `preferences.md`. What matters is an explicit convention for where information belongs, how it is updated, and how it is later loaded.

## 6. Finding memory with glob and grep

**Glob matches names and paths; grep searches content.** Typical path patterns include:

```text
AGENTS.md         A specific file
skills/*/SKILL.md Skill files one directory below skills
**/*.md           Recursive Markdown matching, where supported
```

After finding a file, a command-line content search could be:

```bash
grep -n "summary" AGENTS.md
```

This is a shell example, not a fixed Agent Builder tool-call syntax. An agent can narrow the file set, locate relevant passages, and then read their context instead of loading every file.

Literal matching can miss related expressions. A question about hiding personal information may not match a file using the word “redaction.” Semantic retrieval can help, but does not remove the need to check relevance and scope.

## 7. Why file-based memory remains difficult

### Deciding what to remember and where

An agent may miss durable feedback, preserve a temporary instruction, or overload its core instructions with specialized detail. File tools provide operations, not a complete memory policy.

Skills offer progressive loading: discover available capabilities first, then read detailed instructions when relevant. This separates generally applicable rules from specialized methods. [Skills documentation](https://docs.langchain.com/oss/python/deepagents/skills)

### A successful edit can still produce an invalid file

Free-form Markdown differs from structured tool configuration or skill metadata. The original article emphasizes validation and returning errors for correction rather than treating invalid output as a successful update.

Persistence and usability are separate requirements.

### Accumulating cases is not generalizing

Consider an illustrative email assistant that keeps adding individual unsolicited senders to an ignore list. The intended preference may instead concern a category of unsolicited sales messages.

Maintaining memory therefore involves consolidating duplicates, resolving conflicts, and extracting justified rules—not merely increasing the number of entries. The reverse mistake also matters: one exceptional case should not become an unjustified permanent rule.

### Write access needs boundaries

The original product account describes human approval for memory edits by default, reducing the risk of turning untrusted content into durable instructions.

A retrieved page or email is task data, not automatically user authorization. Reading knowledge, editing preferences, and changing tool configuration should not be treated as the same permission. Current memory documentation further distinguishes writable preferences, read-only policies, and access scope.

## 8. How this changes agent building

### No-code without another unfamiliar language

Some no-code platforms replace programming with nodes, branches, mappings, and proprietary expressions. Complex workflows still require learning a specialized description language—a DSL.

Files make part of configuration resemble writing a work brief. The user expresses the desired behavior; the harness supplies the execution machinery. Tool connections still need configuration, and Markdown alone does not implement an arbitrary workflow.

“Scalable” here primarily concerns organizing and maintaining growing capabilities, not automatically increasing runtime throughput.

### Build through use, feedback, and revision

Many requirements become apparent only after seeing the agent work. It can be easier to identify an unsuitable output than to specify every behavior beforehand.

Memory allows suitable feedback to improve later instructions as well as the current result. Agent building becomes an iterative process rather than a single configuration exercise. Updating the agent in this sense does not mean retraining its base model.

### Portable files still require a compatible runtime

Markdown and JSON are easy to inspect, export, and version. Shared conventions can make reuse across harnesses easier.

Copying files does not copy every operational dependency. The destination still needs compatible loading behavior, tools, authentication, and permissions. Portable representation and equivalent execution are different claims.

## 9. What the original roadmap still proposed

The article listed these as future directions, not completed features:

| Direction | Intended capability |
| --- | --- |
| Episodic memory | Retrieve particular past experiences, not only distilled rules |
| Background consolidation | Review conversations and merge lessons outside the active task |
| Explicit memory entry point | Let users deliberately request reflection and retention |
| Semantic search | Go beyond filename and literal-content matching |
| Additional scopes | Distinguish agent-, user-, and organization-level memory |

These address what is retained, when it is consolidated, how it is found, and whom it applies to. The filesystem is a common interface, not a substitute for those decisions.

![Hot-path memory updates before responding, compared with a separate background consolidation process](/img/posts/langchain-agent-builder-memory/hot-path-memory.png)

Source: [LangChain’s original article](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system). The left updates memory during the active task; the right separates consolidation into a background process. “30 minutes later” illustrates timing rather than a fixed schedule. Background consolidation remained a future direction in the original account.

## 10. Connecting the pieces

The design organizes instructions and knowledge as files, persists them through a backend, and makes them available through loading, search, and editing.

Its significance is not simply the existence of an `AGENTS.md`. Feedback must become an appropriately scoped rule that later runs can find and apply. Files preserve content; prompts and the harness determine how that content participates in action.

## Sources and further reading

- [LangChain: How we built Agent Builder’s memory system](https://www.langchain.com/blog/how-we-built-agent-builders-memory-system)
- Deep Agents: [Memory](https://docs.langchain.com/oss/python/deepagents/memory), [Backends](https://docs.langchain.com/oss/python/deepagents/backends), [Skills](https://docs.langchain.com/oss/python/deepagents/skills)
- [AGENTS.md](https://agents.md/) · [Agent Skills](https://agentskills.io/home)
- [CoALA: Cognitive Architectures for Language Agents](https://arxiv.org/abs/2309.02427)
- Related posts: [Agent Memory Architectures](/en/post/cs329z-agent-memory-architectures/) · [Context Management Patterns](/en/post/cs329z-context-management-patterns/)
