---
title: "Harness, Loop and Graph Engineering"
date: 2026-10-31
slug: "loop-engineering"
description: "Distinguish agent harnesses, loop engineering and graph engineering through execution boundaries, feedback, shared state and conditional routing, with scheduling, Maker/Checker and autoresearch examples."
categories: [AI Agents]
tags: [Agent Harness, Loop Engineering, Graph Engineering, Long-Running Agents, Multi-Agent, Verification, autoresearch]
toc: true
---

Repairing a login failure raises three sets of engineering questions: which files can the agent access and where can it run tests; how should it continue after a failure and when should it stop; and, if investigation, implementation and review are separate, who receives the work next?

Harness engineering concerns the execution system around a model. Loop engineering concerns progress through feedback. Graph engineering concerns the connections and handoffs between working units. They overlap and often coexist; they are more useful as design perspectives than as successive replacements for one another.

<!--more-->

The main sources are WalkingLabs [Lecture 13: Loop Engineering](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-13-loop-engineering/) and [Lecture 14: Graph Engineering](https://walkinglabs.github.io/learn-harness-engineering/en/lectures/lecture-14-graph-engineering/), revision `a9342ff`, together with selected further reading. Product behavior is checked against official documentation; source revisions for autoresearch and the graph example are identified separately.

## 1. What does each perspective design?

Use one task throughout: repair a login timeout, preserve the interface and provide reproducible verification.

| Perspective | Main design object | Question for this task |
| --- | --- | --- |
| Harness engineering | The execution system around a model | How can it edit, test, record progress and stay within permissions? |
| Loop engineering | Repeated work guided by feedback | How does failure change the next attempt, and what ends the work? |
| Graph engineering | Connections and control flow between units | Who investigates, implements and reviews; where does failure go? |

There is no universally accepted hierarchy. In a broad definition, a harness includes tools, context, permissions, state and feedback, and may include loop control and multi-agent orchestration. The lectures use a foundation metaphor, with loops and graphs built on a harness. That is a useful design view, not a requirement for three disjoint software layers. [Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/)

Three questions make the distinction easier to retain:

- **Harness: under what conditions can the agent work?**
- **Loop: how does this task progress from its results?**
- **Graph: how do the working units connect and hand off?**

Prompts and context remain necessary. A prompt expresses the current request; context supplies available information. A harness connects them to tools and the environment. A loop determines whether feedback leads to another attempt. A graph determines which unit runs next and what it receives.

The same “retry after a failed test” logic can be harness control code, a loop's feedback rule and a graph's back edge. These are different scales of description, not a reason to build three services.

## 2. Harness engineering: enable work inside a project

A model can produce a test command. An external program must start the process, constrain its working directory, capture its exit status, preserve logs and return errors to the model. Connecting decisions to execution and observations is central to the harness.

For a coding task, five groups of capabilities are useful:

| Capability | Concrete artifacts | Typical failure when missing |
| --- | --- | --- |
| Instructions and context | Project rules, document index, retrieval policy | Missing conventions or excessive irrelevant history |
| Tools and permissions | File tools, shell, scoped APIs, approval entry points | Inability to act, or unauthorized action |
| Environment | Dependencies, runtime, isolated checkout, test services | Correct commands in an unreproducible environment |
| State and recovery | Candidate revision, progress, logs, handoff records | Lost progress or duplicated operations |
| Feedback and acceptance | Tests, lint, behavior checks, evidence | Confusing generated code with a resolved problem |

`AGENTS.md` or `CLAUDE.md` is an instruction entry point, not the entire system. “Test before publishing” influences behavior. Enforcing it requires a tool boundary, validation endpoint or CI gate. A written rule does not enforce itself.

Nor is a harness restricted to a single run. State storage, recovery, context reconstruction and independent checking can all support work across sessions. Assigning every long-running concern exclusively to loop engineering would miss that overlap.

Improve the harness from observed failures: was the requirement unclear, an error invisible, a dependency missing, or an acceptance result attached to the wrong revision? Add the relevant feedback or constraint and compare equivalent tasks. More components are not automatically better; reassess their value when models change.

## 3. Loop engineering: progress through feedback

In an ordinary interaction, a person asks for work, the agent changes something and reports back, then waits. Inside that interaction, the agent may already perform many model–tool–observation cycles. But deciding what happens after the turn, checking completion and restarting work can still fall to the person.

There are two layers here: **a ReAct loop advances immediate execution; a workflow-level loop also decides when to start, what to work on next, how to accept the result and when to stop.** The outer process can use one agent or several roles.

A goal-driven workflow is a useful starting point. In a Codex build that supports Goals, an objective might look like this:

```text
/goal Fix the failing login tests while preserving the existing API.
Verify with the project's typecheck, lint, login unit tests and end-to-end login flow.
Do not change database migrations, merge or deploy. Stop and report missing credentials.
```

Compared with “change this function,” this establishes a completion contract. The objective remains active, and the next action depends on new evidence. Failures lead to repairs; missing evidence leads to further checks. Success, a budget limit or a blocker requiring human input ends the work. Command availability depends on the host and version: `/goal` is not a universal implementation contract. [Official Codex Goals guide](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)

The lecture describes four steps toward this working style:

1. **Direct every step.** The person specifies actions, checks results and supplies the next instruction.
2. **Put several steps in one prompt.** Analysis, implementation and tests run together, but drift still needs intervention.
3. **Continue from feedback.** The agent selects further actions, but may declare success prematurely.
4. **Ground completion in evidence.** Tests, evaluation programs or an independent checker participate in acceptance; the implementer's assurance is insufficient.

This is a useful progression of responsibilities, not a precise release history for every product. Addy Osmani's discussion of loop engineering likewise moves attention from individual prompts to the system that schedules and checks the work. [Original article](https://addyosmani.com/blog/loop-engineering/)

A minimal working loop must answer three questions: **what state should be reached, what evidence establishes it, and when should execution continue or stop?** “Keep going” addresses very little of that contract.

### Goals, timers and events: why does the loop run again?

Loops have different triggers. A trigger determines when execution becomes possible; a completion rule determines how far it should go. These can be combined.

| Mode | Trigger | End of the current run | Example |
| --- | --- | --- | --- |
| Interactive | The next human instruction | Request handled or interrupted | Investigating an unclear problem |
| Goal-driven | A persistent objective needs further work | Success, budget, cancellation or a genuine blocker | Repairing failing tests |
| Time-driven | A scheduled check becomes due | The current check or work segment finishes | Checking deployment status periodically |
| Event-driven | An external event arrives | Event handled, deferred or handed off | Investigating a CI failure |

`/goal` primarily expresses a continuing objective; `/loop` primarily expresses repeated triggering. For example, Claude Code's session-scoped scheduler can accept:

```text
/loop 15m Check whether this deployment has finished. Report success or failure once; stay quiet when nothing changes.
```

**A timer does not imply amnesia.** It might return to the same session or launch a fresh run. A fresh run can still recover progress from external state. Conversely, repeatedly waking the same session does not guarantee useful progress.

The choice also depends on execution location and continuity: return to this chat, start an independent local task, or run remotely? The Automations section below separates these layers.

A task can both check every fifteen minutes and stop once a deployment succeeds. The dangerous case is repeated triggering without state, deduplication or stopping rules: a new attempt starts while the old one is running, or a successful deployment keeps generating notifications.

## 4. Putting loops to work

In a manual workflow, a person discovers work, chooses an action and checks its result. An automated loop assigns those activities to an explicit process. The person remains responsible for objectives, authorization, exceptions and final review.

![An automated work loop: trigger, recover state, select work, implement, verify, persist and deliver; bounded retries and human decisions form explicit exits](/img/posts/loop-engineering/work-loop.svg)

*Adapted from the lecture's work-loop and morning-triage diagrams. External state supports every iteration; it is not merely a final log entry.*

The lecture identifies six composable building blocks. They are a toolbox, not six mandatory services for every task.

### Automations: opportunities to run

Work needs a rule for advancing without someone repeatedly typing “continue.” A current run can proceed directly from its objective and verification results. Timers, webhooks and CI events become useful when work must wait for a later check or an external change. **A loop does not necessarily need a timer; it needs a rule for continuing automatically.**

Claude Code and Codex expose different entry points. The comparison below separates **local Codex automation from ChatGPT's web capabilities**, rather than treating them as one execution environment. Names and boundaries were checked against official documentation on 2026-10-31.

| Layer | Claude Code | Codex / ChatGPT |
| --- | --- | --- |
| In-session | `/loop` | Thread automation |
| Local schedule | Desktop local tasks | Standalone local automation |
| Cloud schedule | Cloud scheduled tasks, formerly Routines | ChatGPT web scheduled tasks |
| Events | Cloud API / GitHub triggers | ChatGPT web event tasks; or CI invoking the CLI |
| Self-managed | GitHub Actions / cron | `codex exec` + cron / CI |

#### In-session follow-up: return to the same piece of work

Think of thread automation as setting an alarm for an existing chat. When it rings, the agent returns with that chat's context. If the work concerns PR #42, each check need not begin by explaining the PR, the previous observation and which results have already been reported.

```text
Now: query PR #42; CI is running → wait
Next wakeup: continue this chat; query again → unchanged → no repeated notification
Later wakeup: CI has failed → inspect logs; act within authorization or notify
```

This serves a similar purpose to Claude Code's `/loop`; it does not mean a model keeps thinking throughout the wait. **Context records what was known previously. Current facts still need to be queried.** Remembering a launched command does not establish that its process is still alive.

“Close it and everything is lost” is too absolute. Claude Code can restore some unexpired tasks when a session resumes, but that does not execute them in the cloud while the session is inactive. Likewise, a local Codex thread's history alone cannot keep its execution environment available. [Claude Code session scheduling](https://code.claude.com/docs/en/scheduled-tasks)

#### Local and cloud: where the work runs

An independent local task suits recurring project checks or daily reports without tying them to this chat. Its objective, method and progress should be recoverable from configuration, project files or another persistent store. Claude Code Desktop's local scheduled tasks start new sessions and require the machine and app to run. [Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)

Cloud tasks remove the dependency on an always-on local machine. Claude Code's Cloud scheduled tasks, formerly Routines, support schedules, API calls and GitHub events. ChatGPT web also provides remote scheduled tasks, but cannot directly read a local directory. A local Codex scheduler's machine requirement therefore does not establish that OpenAI has no cloud scheduling. [Claude Code cloud tasks](https://code.claude.com/docs/en/routines), [official OpenAI scheduling documentation](https://learn.chatgpt.com/docs/automations)

#### Events and self-managed scheduling: let changes arrive

Polling asks “has CI finished?” periodically. An event trigger wakes the workflow when CI changes. ChatGPT's Gmail, Slack and GitHub event tasks are currently web and mobile capabilities; installing a plugin does not give local Codex desktop automations the same triggers. [OpenAI event-trigger documentation](https://learn.chatgpt.com/docs/automations#trigger-tasks-from-app-events)

For a custom runtime or trigger, cron or CI can invoke `codex exec`. The scheduler decides when to start; the CLI performs a run. Retries, concurrency control, deduplication, timeouts, result storage and authorization remain responsibilities of the surrounding workflow. [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)

At every layer, a trigger only offers an opportunity to run. Check whether useful work exists, whether the event was already handled and whether a previous run is still active. An unchanged poll can do nothing. A blocker requiring a person should name the missing decision rather than repeat “still waiting” on every wakeup.

### Worktrees: isolated file changes

Concurrent agents editing one checkout can overwrite each other. Git worktrees provide separate checkouts, usually on separate branches, where tasks can change and test files independently.

This does not isolate every resource. Worktrees can still compete for a port, test database, cloud resource or pull request, and their changes can conflict during integration. Useful parallelism depends on environment isolation and review capacity, not just the number of available agents.

### Skills: reusable working methods

A skill can contain instructions, scripts, references and output contracts for a class of work. An issue-triage skill might define categories, duplicate checks and the evidence required before attempting a fix.

It reduces the need to explain the method in every run. Current task progress belongs in a state record; repeatedly adding transient results to `SKILL.md` mixes two different responsibilities.

### Connectors: access to real systems

Connectors let the loop inspect issues, query CI, use test services and write back results within authorization. MCP is one common interface, not a requirement for every connector.

Reading information and changing external systems require separate authority. Permission to inspect a CI failure does not grant permission to change deployment configuration. Permission to prepare a fix does not automatically include merging, publishing or messaging other people.

### Sub-agents: separate production from judgment

A common arrangement uses an Explorer to investigate, a Maker to implement and a Checker to verify. Small tasks can skip a dedicated Explorer and use deterministic checks from one main agent; specialized review is added when its benefits justify the cost.

The value lies in independent observations and reduced commitment to the implementer's explanation. Several agents reading the same summary and repeating the same reasoning may add little independent evidence.

### External state: recoverable progress

The next iteration needs the objective, completed work, current baseline, verification results, blockers and next action. Files, task systems and databases can all hold that information; concurrency, queries and audit requirements determine the appropriate store.

After compaction, session replacement or a restart, recovery should not depend solely on what the model happens to remember. Records should resolve to sources such as commits, command outputs, issues and artifacts. **Skills hold the method; external state records where this instance of the work has reached.**

### A complete example: morning issue triage

The building blocks can form a concrete workflow: inspect new repository issues each morning, attempt small fixes and place reviewable results in front of a person.

First bound the work. Otherwise “look through issues” can expand indefinitely. This example adapts the lecture's goal template:

```markdown
# Goal
Triage the latest 10 issues in the target repository.

# Allowed work
- Inspect existing labels, ownership and records to avoid duplicate handling.
- Propose categories; apply labels only when authorized.
- Attempt one small fix in an isolated branch, expected to be verifiable within 10 minutes.
- After acceptance, create a draft PR if authorized, or leave local changes for review.

# Acceptance
- Record a reproduction before the fix; the same case passes afterward.
- Pass typecheck, lint and applicable tests; verify end-to-end behavior when necessary.
- Deliver the tested revision, commands, results and remaining risks.

# Boundaries and stopping rules
- Do not merge, deploy, change production data or credentials, or weaken CI security.
- Finish when all 10 issues have explicit dispositions.
- At most 20 iterations; escalate after 3 iterations without new useful evidence.
- Stop blocked work when it requires broader authority, changed requirements or external input.
```

When the timer fires, the system reads issues and saved state and excludes already handled events. It selects a bounded task and prepares an isolated environment. The Maker implements and performs basic checks, then hands an exact revision to the Checker. Failure feeds a bounded repair cycle. Accepted work moves to delivery and state writeback.

A state record needs more than “fixed.” It should preserve facts that another run can check:

```yaml
goal: "Triage the latest 10 issues"
iteration: 3
status: needs_review
task:
  issue: "#42"
  branch: "fix/login-timeout"
  revision: "<tested-commit>"
verification:
  reproduction: "<fixture-and-command>"
  test_result: passed
  evidence: "<log-or-artifact-reference>"
decision:
  accepted: false
  reason: "Waiting for independent review"
next_action: "Review the tested revision; do not repeat implementation"
```

`test_result: passed` records a test outcome; `accepted: false` records incomplete independent acceptance. Those should not collapse into one “done” flag. A later run must also check that the recorded revision is still the relevant candidate.

Crash recovery matters. If a PR was created but the process exited before recording its URL, the next run should discover that existing PR rather than create another. Persistent state and deduplication of external effects become essential when a demonstration turns into a long-running system.

### Maker/Checker separation needs a real acceptance boundary

The lecture emphasizes separating the Generator from the Evaluator because an implementer can interpret results through the lens of its own design. A checker should begin with requirements and observable behavior, not assume that the implementation summary is correct.

The roles can use a compact protocol:

```text
Maker
1. Read the objective, boundaries and state; identify this iteration's hypothesis.
2. Implement within scope and run basic checks.
3. Deliver an exact revision, changes, commands, outcomes and known risks.
4. Request validation rather than claiming final acceptance.

Checker
1. Review that revision against original requirements, not the Maker's assurance.
2. Reproduce critical paths, independently run applicable tests and inspect edge cases.
3. Give a location, trigger, evidence and severity for each finding.
4. Do not invent problems. Report missing verification as missing, not as a pass.
```

Different models are an option; separate contexts using the same model are another. Independent tasks, observations and acceptance evidence matter more than a promise that different models cannot share mistakes. For checks with explicit expected results, scripts and real environment tests are usually stronger than another request for an opinion.

Anthropic's long-running application experiment separates implementation and QA, with the Evaluator operating the actual application through a browser. The existing [Planner–Generator–Evaluator article](/en/post/anthropic-agent-evolution-3-planner-generator-evaluator/) covers that structure. [Original experiment](https://www.anthropic.com/research/harness-design-long-running-apps)

#### Who can mark a feature passing?

“Run tests before changing the status” in `CLAUDE.md` or `AGENTS.md` is a behavioral rule. If the agent can arbitrarily edit the status file, it can still bypass that rule.

A stronger design exposes a harness-controlled validation entry point. This is process pseudocode, not a runnable controller:

```python
def request_validation(feature_id, candidate_revision):
    contract = registry.load_contract(feature_id)
    candidate = workspace.pin_revision(candidate_revision)

    # Run the registered checks against the pinned candidate
    report = verifier.run(contract, candidate)
    evidence_store.save(report)

    if report.satisfies(contract) and workspace.still_matches(candidate):
        state_store.transition(feature_id, to="passing", evidence=report.id)
    else:
        state_store.record_failure(feature_id, evidence=report.id)

    return report
```

Tool or storage boundaries must actually protect state writes, and the Maker must not be able to weaken the acceptance contract just to pass. Evidence must bind to the candidate: testing revision A cannot qualify revision B after further changes.

Even then, passing means satisfying the registered checks, not proving the absence of all unknown defects. Acceptance criteria need maintenance, and subjective quality or high-risk actions may still require human judgment.

### autoresearch: a repeatable experiment ratchet

Karpathy's autoresearch demonstrates a different loop. An agent changes a training program, runs an experiment under a fixed budget and uses validation results to keep or discard the candidate.

This discussion follows [source revision `228791f`](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117). Three files define the main boundaries:

| File | Responsibility | Change boundary during experiments |
| --- | --- | --- |
| `prepare.py` | Data, tokenizer, time budget and evaluation utilities | Fixed infrastructure; not modified by the experiment agent |
| `train.py` | Model, optimizer, hyperparameters and training loop | The agent's main search space |
| `program.md` | Objective, working rules, output format and selection policy | Human-authored research method |

The design separates the search space from its evaluation rules. The agent can change a learning rate or architecture, but not improve its score by rewriting the evaluator. Natural-language instructions live in `program.md`; execution still requires the coding agent, tools and training environment. Markdown does not run itself.

#### What stays fixed, and what improves?

`prepare.py` defines `TIME_BUDGET = 300`. The main metric is `val_bpb`, validation bits per byte, where lower is better. Wall-clock budgeting limits elapsed time counted toward training, not a fixed step count. On the same machine, a candidate taking 0.5 seconds per step can complete roughly 600 steps in 300 seconds; one taking a second can complete about 300. The comparison concerns quality within a time budget, not just quality per step.

This revision skips the initial steps when accumulating training time to avoid initial compilation overhead, stops at a step boundary after reaching the budget, and evaluates afterward. Total experiment time therefore exceeds five minutes. A short-budget winner is not necessarily the winner after much longer training. [Training timer source](https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/train.py#L538-L624)

Keeping hardware, data, evaluation and training budget fixed helps compare candidates without letting one win merely by training longer. It does not make results on different hardware directly comparable. Small improvements also deserve checks for noise and repeatability.

The instructions consider simplicity too: a substantially simpler candidate with similar performance can be worth retaining. The ratchet selects a better working baseline under fixed evaluation rules; not every decision is a mechanical requirement for a strictly lower floating-point number.

#### The nine-step cycle

![The autoresearch ratchet reads constraints and the baseline, proposes a hypothesis, edits and snapshots a candidate, trains, evaluates and records it, then keeps or discards before continuing](/img/posts/loop-engineering/research-ratchet.svg)

The lecture's cycle can be expanded into nine steps:

1. Read `program.md` for boundaries and evaluation rules.
2. Inspect the code, Git baseline and previous experiments.
3. Form a testable hypothesis.
4. Modify `train.py`.
5. Save an identifiable candidate revision.
6. Train under the prescribed budget.
7. Inspect metrics, resource use and failures; record the experiment.
8. Keep a candidate that meets the selection rules, or discard it and restore a usable baseline.
9. Continue from the updated baseline and accumulated history.

The ratchet prevents arbitrary replacement of an accepted baseline by a worse candidate. It does not guarantee successful exploration every time or a global optimum. Discarding must affect only the isolated experiment's own changes, not unrelated work in a shared dirty checkout.

#### More than a lower score

Outputs include retained code revisions, an experiment table and run logs. `program.md` specifies five columns for `results.tsv`. This is a format example, not data from a run performed for this article:

```text
commit   val_bpb   memory_gb   status    description
a1b2c3d  0.997900  44.0        keep      baseline
b2c3d4e  0.993200  44.2        keep      increase learning rate
c3d4e5f  1.005000  44.0        discard   change activation
d4e5f6g  0.000000  0.0         crash     double width; out of memory
```

The real file is tab-separated. Zero in a `crash` row is a prescribed failure placeholder, not a score better than every successful experiment. Readers must inspect `status` as well as the number.

Git history retains accepted candidates; the experiment table must preserve failures too, or later iterations can repeat disproven ideas. An agent's summary does not replace original run evidence. Reviewing or transferring a result can still require code and logs.

One result cited by the lecture comes from nanochat. Its [autoresearch round 1 leaderboard commit](https://github.com/karpathy/nanochat/commit/f06860494848db080c9a80a0ffa83203b042056b) reports reducing time to the GPT-2 comparison target from 2.02 hours to 1.80 hours, roughly 10.9%. This is a report for that project and configuration, not a universal improvement from adding a loop, and not a reproduction performed here.

The original autoresearch protocol encourages continued experimentation after setup confirmation until a person interrupts it. Practical use should add total time, cost and compute limits. A bounded training run does not bound the overall research campaign.

## 5. Graph engineering: make collaboration executable

Maker/Checker already has the outline of a graph: implementation goes to verification, failure returns to implementation and success reaches delivery. A simple controller is enough when this is the only path.

A harder question is why a test failed. Is the implementation wrong, or was the requirement misunderstood? Should missing information send work back to research? Can two investigations run concurrently, and when should their results join? Which outcomes require approval? Repeated handoffs become difficult to diagnose when every boundary depends on one agent's improvised next step.

Graph engineering makes those relationships explicit. This is an **execution and collaboration graph**, not a knowledge graph of entities. Node count is not agent count.

### Four components

**Nodes** perform work. A node can be ordinary code, one model call, a tool, a complete agent or a human decision step. A complete agent node may contain its own edit–test–repair loop.

**Edges** describe allowed handoffs: research to implementation, failed verification back to implementation, missing information back to research. Fan-out and fan-in describe parallel work and its join.

**State** holds the facts needed at boundaries: requirements, source evidence, candidate revisions, test reports, review decisions and budgets. Shared state does not require broadcasting every conversation to every node.

**Routing** selects the next step from that state. It may use deterministic code or a model's classification. Even when a model diagnoses a failure, code can constrain allowed destinations, permissions and budget checks. [LangGraph Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)

![A login-repair graph connecting research, implementation, independent verification, human review and delivery, with failure-specific back edges, versioned state and a supporting harness](/img/posts/loop-engineering/agent-work-graph.svg)

*Adapted from Lecture 14's development graph, adding revision-bound evidence, budget exits and human review. Agent nodes may retain local loops; the harness supplies execution and state capabilities. This example requires approval before delivery.*

### Define the handoff state first

Before drawing arrows, specify what each node receives and produces. An example snapshot is:

```yaml
run_id: login-timeout-42
requirements: "Fix the timeout without changing the public API"
evidence_refs: ["issue:42", "logs:reproduction-1"]
candidate_revision: candidate-3
verification_revision: candidate-3
review: fail
attempts: 3
max_attempts: 5
requires_approval: true
```

`candidate_revision` identifies the code; `verification_revision` identifies what the report checked. They must match before the report can qualify the candidate. A real system should use an exact commit or immutable artifact ID; `candidate-3` is a readable placeholder.

Fields also need ownership and merge rules. A requirements owner maintains the contract, the implementation node produces candidates and the verifier produces reports. Parallel research findings can merge using stable IDs and deduplication. Two code revisions cannot be integrated by simply appending them. If a counter uses additive updates, return an increment rather than adding the accumulated total again. **A shared schema is not an access-control system: write authority still needs enforcement.**

The implementer needs current requirements, relevant files and previous failure evidence. The reviewer needs the original acceptance contract, candidate revision and tools, not the implementer's entire transcript. Fresh context can reduce commitment to a particular solution, but must not remove facts needed for verification.

### Nodes and back edges

| Node | Inputs and work | Output and handoff |
| --- | --- | --- |
| `research` | Inspect the issue, reproduction logs and documents | Sourced requirements and hypotheses for implementation |
| `implement` | Edit in an isolated environment; test and retry locally | Candidate revision and change record for verification |
| `verify` | Independently inspect the same revision against requirements | Pass, implementation failure or a need for more research |
| `human_review` | Review risk or missing authorization | Approve, reject or request changes |
| `deliver` | Check acceptance and authority | Save deliverables; publication or merging requires explicit authority |

Local loops handle attempts inside a responsibility. The graph handles handoffs between responsibilities. An implementation node might repair syntax within its local budget; contradictory requirements should route back to research instead of causing endless code changes.

This routing function demonstrates the distinction. It does not implement nodes, persistence or tool permissions and is not a complete graph engine:

```python
def route_after_verify(state):
    if state["verification_revision"] != state["candidate_revision"]:
        return "verify"

    verdict = state["review"]
    if verdict == "pass":
        return "human_review" if state["requires_approval"] else "deliver"

    if state["attempts"] >= state["max_attempts"]:
        return "blocked"
    if verdict == "needs_research":
        return "research"
    if verdict == "fail":
        return "implement"
    return "human_review"
```

Different failures now have different destinations, and an unknown verdict cannot silently pass. The runner also needs global time, node-execution and cost limits: re-verifying stale reports, for example, need not increment the implementation counter. Drawing a human node is not an approval system. The runner must actually pause, and tools must not bypass that boundary.

### Checkpoints and recovery: state is only part of the problem

Recovery requires the run's state, completed work, next step and artifact references, not just a model summary. A stable run ID distinguishes task instances. A conversation ID, graph thread ID and business task ID may be associated, but are not inherently identical.

External side effects still need care. If a PR was created just before a checkpoint write failed, replaying the step can create another PR. Use idempotency keys, discovery of existing results or transactional handoffs. Checkpointing alone does not make an external operation execute exactly once.

Lecture 14's [LangGraph skeleton](https://github.com/walkinglabs/learn-harness-engineering/blob/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/zh/lectures/lecture-14-graph-engineering/code/maker_checker_graph.py) illustrates `StateGraph`, nodes, conditional edges and `thread_id`, but is not yet a reliable coding system:

- `call_model()` is unimplemented. The placeholder test checks whether code contains `def test`; it does not execute tests.
- `attempts` is not incremented. The router distinguishes `fail` from everything else, so an unknown result also reaches `merge`.
- `merge` prints a message. `MemorySaver` stores checkpoints in RAM, not on disk for recovery after process restarts.

Persistent recovery needs a durable checkpointer plus tested replay and side-effect handling. Official documentation distinguishes in-memory savers from SQLite and PostgreSQL backends. [Persistence documentation](https://docs.langchain.com/oss/python/langgraph/persistence)

### Graphs and workflows: do not reinvent the history

Workflow systems already support branches, parallelism, state, approvals and dynamic tasks. Describing all traditional workflows as fixed functions that always take an identical path would incorrectly assign their existing capabilities to graph engineering.

The useful distinction is **which decisions belong to code, which to a model and which to a person**. Anthropic distinguishes prescribed workflows from model-directed control; either can be represented as a graph, and one graph can mix them. [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)

A graph therefore does not require an agent in every box, and need not be a DAG. A verification back edge already creates a cycle. At a coarser level, an entire agent can be one node with a feedback self-loop. Its relationship to a loop depends on abstraction, not an either–or choice.

LangChain's further reading also cautions against fixing every exploratory step in advance: tasks with known structure benefit from explicit paths, while open-ended research may suit a flexible core loop. Excessive predefined handoffs can obstruct exploration. [3 Years of Graph Engineering with LangGraph](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph)

## 6. Who can change a goal or veto a result?

Connected nodes show where work travels. Long-running systems also need relationships between objectives and their evaluation.

**Metric gaming.** Suppose a support agent optimizes closed-ticket count. It may close tickets faster while users repeatedly return. A coding agent might delete tests to produce a green check. Separate optimization metrics from acceptance and protective measures; the executor must not freely weaken the evaluator for a better score.

**Unreviewed objectives.** If a system pursues a benchmark without checking its relevance to real requirements, extra retries only make it more effective at the wrong objective. Assign ownership of goals, acceptance contracts and changes to them.

**Conflicting loops.** One unit optimizes response speed, another investigation depth. Two individually successful repairs can break a shared interface. Integration checks, resource ownership, priorities and veto paths complement local acceptance.

Eigent's further reading adds measurement decay: logs and scoring drift until internal reports validate one another without touching real outcomes. Its anchors are independent checks on the optimized process, such as held-out tests, real-scenario regressions and human sampling. [Graph Engineering for AI Agents](https://www.eigent.ai/blog/graph-engineering-ai-agents)

For the login repair, make authority explicit:

- A requirements owner can approve acceptance changes; the implementation node cannot relax them itself.
- A verifier can reject a candidate with revision-bound reproduction evidence.
- Integration checks can veto locally passing changes.
- Budget and permission controllers can suspend work without the model's consent.

A graph can express these mechanisms; a well-designed loop can implement them too. **Graph structure improves auditability, but does not automatically remove Goodhart effects, bias or mistaken objectives.** Fresh reviewers can share incorrect assumptions. Evidence and acceptance must improve alongside separation.

Prefect emphasizes comparable, reproducible run structure. iii.dev redirects attention to the runtime substrate and the durable state, observations and reusable capabilities that survive a session. These views are compatible: make handoffs explicit and give them an inspectable, recoverable implementation. [Loops vs. Graphs](https://www.prefect.io/blog/loops-vs-graphs), [Loops, Graphs, and the Layer That Matters](https://iii.dev/blog/loops-graphs-and-the-layer-that-matters/)

## 7. Costs shared by loops and graphs

### Verification debt: production outpaces checking

A change looks reasonable, so the next iteration builds on it. A fault discovered much later can span several commits.

Bind reproductions, regressions and acceptance results to revisions. Count effectively verified changes, untested paths and failures incorrectly recorded as success, not just generated code.

### Comprehension rot: the code outgrows the team's mental model

Automated loops can produce changes faster than maintainers can understand the new dependencies, design choices and failure boundaries. Reading a generated summary alone does not maintain that understanding.

Keep changes reviewable, record important decisions, use critical workflows directly and inspect risky diffs. Documentation supports understanding; it does not replace it.

### Cognitive surrender: outsourcing the judgment too

When a loop runs smoothly, its conclusion can begin to feel equivalent to a sound judgment. Whether a feature is worth building, whether a benchmark reflects user experience and whether a risk is acceptable may lie outside automated acceptance.

Agreement between Maker and Checker does not establish that the original objective was sensible. Someone must remain able to question the goal, change the evaluator or stop an unproductive direction.

### Token and runtime costs: paying for history again

Suppose each iteration adds about `k` tokens and every request resubmits the complete history. Input at iteration `i` is roughly `i × k`, making total input over `N` iterations approximately `k × N(N+1)/2`. The near-quadratic growth depends on both accumulation and repeated full-history processing; it is not inherent in every agent system.

Compaction, external state, selective reads and reuse of stable material can reduce repetition. Actual billing also depends on caching, model choice, output length and tool use, so this expression is not an invoice estimator. Independent checking, worktree setup, environment startup and retries also consume time and money.

The useful measure is total cost per accepted outcome, including tools, retries and human review—not only the price of one generation.

### Orchestration tax: growing the review queue

Parallel nodes add more than model cost: decomposition, handoffs, integration conflicts and final review consume attention. If every change needs one person's understanding and approval, extra workers may just lengthen the queue. This is the orchestration tax described by Addy Osmani. [Original article](https://addyosmani.com/blog/orchestration-tax/)

Limit work in progress, batch reviews by module, automate mechanical checks and set concurrency from measured review throughput rather than how many agents the interface permits.

## 8. When do you need a harness, loop or graph?

Diagnose the difficulty before choosing a framework:

| Current difficulty | First intervention |
| --- | --- |
| Missing project context, unusable tools or absent verification | Improve harness context, environment and feedback |
| Individual runs work, but a person must push each next step | Define goals, feedback, state and stops to form a loop |
| Recurring confusion between research, implementation and review | Specify nodes, state contracts and conditional edges |
| A fixed sequence needs no open-ended judgment | A script or ordinary workflow may suffice |
| Exploration follows paths that are hard to predict | Retain a flexible loop; fix essential acceptance and permission boundaries |

The signal for explicit graph design is not simply many steps. It is meaningful branching, backtracking, parallel joins, independent review or recovery boundaries. A linear pipeline can also be represented as a graph, but that does not justify another engine. Coordination and review costs must be smaller than the collaboration benefit.

The lecture's starting sequence is to pick repeated work, define a goal and stopping rules, separate making from checking, persist progress and add a trigger. Order matters: make one iteration verifiable before automating repetition. Otherwise automation repeats the same mistake faster.

Capabilities can be added gradually:

| Level | Added capability | First question to resolve |
| --- | --- | --- |
| Goal Runner | Continue toward one objective | What proves completion, and what stops the run? |
| Scheduled Task | Start work on a schedule | Is the environment available, and can wakeups duplicate work? |
| Maker / Checker | Separate implementation and verification | Is review independent and tied to the candidate revision? |
| Self-Feeding Loop | Select work from external state | Where do priority, scope and authority come from? |
| Multiple Loops | Run several workflows concurrently | How are ownership, shared resources, state writes and review capacity coordinated? |

This is a capability ladder, not a ranking every team must climb. A low-frequency, single-task loop that reliably saves human effort may be more useful than an elaborate fleet.

Three small experiments are enough to begin:

1. Complete the same bounded task manually and through a loop with stopping conditions; compare quality and interventions.
2. Add a Checker and record valid findings alongside its extra cost.
3. Run three iterations, replacing the session between some of them; check recovery from external state and duplicate effects.

Track interventions, valid findings, false positives, acceptance results, retries and total cost. Running unattended for a long time is not itself evidence of usefulness. A better signal is **less human pushing for the same accepted outcome, without weakening quality or boundaries.**

Re-evaluate the structure as models change. Test which checks remain necessary and which handoffs have become overhead by removing components individually and comparing results. More agents and more instructions are not, by themselves, guarantees of reliability.

Return to the login task: the harness enables bounded edits, tests and state recording; the loop turns feedback into another attempt; the graph specifies the protocol between investigation, implementation, verification and approval. Larger tasks often use all three. Smaller tasks need not add components merely to claim all three labels.

### References and templates

- WalkingLabs: [Lecture 13 and templates](https://github.com/walkinglabs/learn-harness-engineering/tree/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/en/lectures/lecture-13-loop-engineering), [Lecture 14 and graph skeleton](https://github.com/walkinglabs/learn-harness-engineering/tree/a9342ff471f2c0e60be0c08b9f4a7c502df4e442/docs/en/lectures/lecture-14-graph-engineering). Explanations and diagrams are reorganized, examples adapted, and authority, revision binding and implementation limits added. Original lectures and templates: Copyright (c) 2025 WalkingLab, used under the [MIT License](/downloads/loop-engineering/LICENSE-WalkingLab.txt).
- [Addy Osmani: Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/) · [The Orchestration Tax](https://addyosmani.com/blog/orchestration-tax/)
- [Addy Osmani: Loop Engineering](https://addyosmani.com/blog/loop-engineering/)
- [Simon Willison: Designing Agentic Loops](https://simonw.substack.com/p/designing-agentic-loops), on designing around objectives, tools and observable results.
- [LangChain: 3 Years of Graph Engineering with LangGraph](https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph) · [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) · [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Prefect: Loops vs. Graphs](https://www.prefect.io/blog/loops-vs-graphs) · [Eigent: Graph Engineering for AI Agents](https://www.eigent.ai/blog/graph-engineering-ai-agents) · [iii.dev: Loops, Graphs, and the Layer That Matters](https://iii.dev/blog/loops-graphs-and-the-layer-that-matters/)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI: Using Goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) · [Automations](https://learn.chatgpt.com/docs/automations)
- [Claude Code: Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks) · [Goals](https://code.claude.com/docs/en/goal)
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps)
- [autoresearch: README and program.md at revision 228791f](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117)
- Related: [Context Reset and Structured Handoff](/en/post/anthropic-agent-evolution-2-context-reset-and-handoff/) · [Memvid: A Single-File Memory System for AI](/en/post/memvid-memory-architecture/)
