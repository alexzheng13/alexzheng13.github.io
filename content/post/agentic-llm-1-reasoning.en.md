---
title: "Agentic LLM Reasoning (I): From Chain of Thought to Search, Reflection, and RLVR"
date: 2026-09-29 09:00:00 +0200
slug: "agentic-llm-1-reasoning"
description: "A structured guide to Agentic LLM reasoning, from in-context learning, Chain of Thought, and Self-Consistency to PAL, Tree of Thoughts, self-reflection, RAG, RLVR, and GRPO."
categories: [AI Agents]
tags: [Agentic LLM, Reasoning, Chain of Thought, Tree of Thoughts, Self-Reflection, RLVR, GRPO]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

A model that can answer a question is not necessarily able to complete a task.

A conventional chatbot receives a prompt and returns a response. An agent must decide what to do next in a changing environment, act, inspect the result, and choose whether to continue, backtrack, or try another path. That transition begins with **reasoning**.

A complete agent system needs at least three capabilities:

1. **Reasoning**: analyze state, decompose problems, compare paths, and form decisions.
2. **Action**: call tools and translate decisions into external operations.
3. **Interaction**: observe outcomes, exchange information with the environment or other agents, and revise the strategy.

This is the **first article in the Agentic Large Language Models series**. Rather than listing reasoning terms in isolation, it follows one question: **when one generation or one reasoning path is unreliable, what can the system add?** Part II covers Action, followed by Interaction in Part III.

<!--more-->

> **Series**: **(I) Reasoning** · [(II) Action](/en/post/agentic-llm-2-action/) · (III) Interaction (coming next)

## 1. First define the boundary: what is an Agentic LLM?

An Agentic LLM can be defined as:

> An agent that receives natural-language or multimodal input from its environment, reasons to make decisions, and takes autonomous actions that affect the environment in pursuit of a goal.

A conventional chatbot often follows:

```text
Prompt → LLM → Response
```

An Agentic LLM operates in a loop:

```text
Goal + Environment State
          ↓
       Reason
          ↓
        Action
          ↓
   Environment Feedback
          └────────→ next reasoning cycle
```

Agent capability therefore depends on more than the base model. It also depends on reasoning strategies, tools, external memory, state management, environmental feedback, and the harness surrounding the model.

### 1.1 From training a model to using it

A modern LLM typically passes through the following stages:

| Stage | Purpose |
| --- | --- |
| General corpus acquisition | Build a large unlabeled dataset |
| Pretraining | Learn language, knowledge, and patterns through self-supervision |
| Supervised fine-tuning | Adapt to tasks with labeled instruction–answer data |
| Instruction tuning | Improve natural-language instruction following |
| Preference alignment | Align behavior through RLHF, DPO, RLVR, or related methods |
| Training and deployment optimization | Reduce cost with LoRA, mixed precision, or distillation |
| Inference | Solve tasks through prompts, context, tools, and decoding strategies |

The first six stages primarily alter model parameters. Much of agentic reasoning happens in the final stage: **without necessarily changing the weights, a system gives the model more intermediate computation, candidate paths, feedback, and external machinery.**

Reasoning is therefore not only about what happens “inside” one model call. It also includes how an external algorithm organizes calls, preserves state, and uses verification results.

![A taxonomy of reasoning methods in Agentic LLMs, from step-by-step prompting and ensembles to search, self-reflection, and reinforcement learning](/img/posts/agentic-llm-1-reasoning/reasoning-methods-taxonomy.webp)

*The taxonomy spans step-by-step prompting, ensembles, search, self-reflection, retrieval, and reinforcement learning. The rest of the article follows this progression.*

## 2. Why a model may “know” but still fail to “do”

Consider a typical GSM8K problem:

> Romeo bakes four trays containing two dozen cookies each. If the cookies are shared equally among sixteen people, how many does each person receive?

A person writes:

```text
4 × 2 × 12 ÷ 16 = 6
```

Yet GPT-3 175B achieved only about 15% accuracy on GSM8K when the benchmark was introduced. The model may know arithmetic and understand every word while still failing to organize a reliable multi-step calculation.

A direct autoregressive answer implicitly requires the model to retrieve facts, identify variables, order operations, execute each step, and prevent early errors from propagating. Reasoning methods turn this hidden process into a longer, more controllable computational path.

From a probabilistic perspective, direct generation still follows the autoregressive factorization:

<div class="math-display">
\[
p_{\theta}(y\mid x)=\prod_{t=1}^{T}p_{\theta}\!\left(y_t\mid x,y_{1:t-1}\right)
\]
</div>

Reasoning methods do not replace this basic generation rule. They add intermediate steps, alternative paths, verification results, or observations to the condition on which later tokens are generated.

## 3. Show examples before asking: in-context learning

In-context learning (ICL) places examples and a query together in the context window. The model does not update its parameters; it infers the task pattern from the current prompt.

### Zero-shot

```text
Solve the following problem and provide the answer.
```

### Few-shot

```text
Question A → Answer A
Question B → Answer B
Question C → ?
```

Few-shot examples do more than specify formatting. They steer the model toward relevant knowledge and a suitable solution pattern. Ordinary ICL, however, can still compress the process into one forward generation. The natural next step is to include intermediate steps in the output itself.

![The input-output differences among few-shot prompting, few-shot CoT, zero-shot CoT, and program-aided language models](/img/posts/agentic-llm-1-reasoning/cot-prompting-methods.webp)

*The same problem enters a different computational path depending on whether the prompt contains examples, reasoning traces, or executable code.*

## 4. Make the process visible: Chain of Thought

[Chain-of-Thought Prompting](https://arxiv.org/abs/2201.11903) asks the model to generate a sequence of intermediate reasoning steps rather than only the final answer:

```text
Question
   ↓
Thought 1 → Thought 2 → Thought 3
   ↓
Final Answer
```

Few-shot CoT demonstrates complete reasoning traces. Zero-shot CoT can be elicited with a phrase such as “Let’s think step by step.” In the original work, an example GSM8K result improved from roughly 16% to 47%.

One intuition is that every intermediate token re-enters the context for subsequent prediction. The model obtains more serial computation and gradually narrows the probability space around the final answer.

CoT creates a new problem as well: **longer chains provide more opportunities for error accumulation.** A wrong early assumption can produce a coherent but incorrect conclusion.

![Standard prompting produces a wrong direct answer, while a Chain-of-Thought prompt reaches the correct answer through intermediate steps](/img/posts/agentic-llm-1-reasoning/standard-vs-chain-of-thought.webp)

*Direct prompting encourages an answer guess; a CoT demonstration teaches the model to calculate before concluding.*

## 5. Do not trust the first path: verification and voting

### 5.1 Self-verification

Self-verification treats the conclusion as a condition and checks it against the original problem:

```text
Original: 5 apples, then receive 3 more
               ↓
        Candidates: 8 / 9
               ↓
Backward checks: 8 - 5 = 3; 9 - 5 = 4
               ↓
          Select 8
```

The same LLM may act as generator and verifier, or a separate evaluator can be used. The important move is not merely “think again,” but changing the form of the problem so that mistakes encounter a new constraint.

### 5.2 Self-consistency

[Self-Consistency](https://arxiv.org/abs/2203.11171) samples diverse reasoning paths and aggregates their final answers:

```text
             ┌─ Reasoning Path A ─→ 42
Question ────┼─ Reasoning Path B ─→ 42
             ├─ Reasoning Path C ─→ 37
             └─ Reasoning Path D ─→ 42
                              ↓
                     Majority Vote: 42
```

Complex problems often admit multiple valid paths to the same correct answer, while mistakes tend to diverge. Majority voting reduces the impact of one unlucky sample.

The paper reported a 17.9 percentage-point improvement over CoT on GSM8K and gains on several arithmetic and commonsense benchmarks. The tradeoff is inference cost: twenty sampled paths consume far more tokens and latency than a single generation.

If $r_i$ is the $i$-th reasoning trajectory and $a(r_i)$ is its extracted final answer, majority voting can be written as:

<div class="math-display">
\[
\hat{a}=\underset{a}{\operatorname{arg\,max}}\sum_{i=1}^{N}\mathbf{1}\!\left[a(r_i)=a\right]
\]
</div>

![Self-Consistency applies majority voting to the final answers of multiple Chain-of-Thought trajectories](/img/posts/agentic-llm-1-reasoning/self-consistency.webp)

*Correct paths tend to converge on one answer, while errors are more likely to scatter. Self-Consistency exploits that difference.*

Reasoning quality is therefore not solely a property of model weights; it can also be purchased with **inference-time compute**.

## 6. Let programs execute precisely: PAL, interpreters, and debuggers

Natural language is flexible but ambiguous and unreliable for exact execution. A practical division of labor lets the LLM understand and decompose a problem while an interpreter executes it.

### 6.1 Program-Aided Language Models

[PAL](https://arxiv.org/abs/2211.10435) translates a natural-language problem into an executable program and delegates evaluation to a runtime:

```text
Natural-language Problem
          ↓ LLM
Executable Program
          ↓ Interpreter
Verified Result
```

The model is good at mapping a problem into program structure; Python is good at exact variables, loops, and state. PAL with Codex reported about 72% accuracy on GSM8K and outperformed larger models using natural-language CoT on multiple symbolic tasks.

The division of labor can be summarized as a model generating a program $g_{\theta}(x)$ and an executor producing the final answer:

<div class="math-display">
\[
\hat{y}=\operatorname{Exec}\!\left(g_{\theta}(x)\right)
\]
</div>

![Program-Aided Language Models generate Python with an LLM and use an interpreter to execute it and return the answer](/img/posts/agentic-llm-1-reasoning/program-aided-language-models.webp)

*The LLM translates intent into a program; the interpreter performs the unambiguous execution.*

### 6.2 Interpreters, debuggers, and self-debugging

Execution errors, failed tests, and runtime output can be returned to the model:

```text
Generate → Execute → Observe Error → Explain → Repair → Execute Again
```

[Self-Debugging](https://arxiv.org/abs/2304.05128) shows that an LLM can identify mistakes by inspecting execution results and explaining its own code. Ground truth now comes from compilers, interpreters, and tests rather than from the model's confidence.

This also addresses the **knowing–doing gap**: a model may describe the correct algorithm while failing to maintain every state transition in tokens. Letting a conventional program execute the algorithm is often more accurate and cheaper than simulating execution through language.

![The same Blocks World problem represented in formal PDDL and in natural language](/img/posts/agentic-llm-1-reasoning/pddl-vs-natural-language.webp)

*Natural language is easier to read, while PDDL and other formal languages represent states, actions, and constraints more precisely.*

## 7. From one chain to a backtrackable search tree

CoT follows a single path. Search-based methods generate several candidates at each step and create a backtrackable state space.

### 7.1 Tree of Thoughts

[Tree of Thoughts (ToT)](https://arxiv.org/abs/2305.10601) treats intermediate thoughts as search nodes:

```text
                         Thought A1 ──→ ...
                       ↗
Problem ─→ Thought A ──→ Thought A2 ──→ ...
       └→ Thought B ──→ Thought B1 ──→ ...
                       ↘
                         Thought B2 ──→ ...
```

The system performs three operations:

1. **Generate** candidate thoughts from a state.
2. **Evaluate** how promising each candidate is.
3. **Search** with BFS, DFS, or another policy.

BFS can be summarized as:

```text
Generate k candidates → Evaluate → Keep top-b → Repeat
```

DFS follows one branch and backtracks when it fails or reaches a boundary.

If $s_t$ denotes the search state at step $t$ and $z_t$ is a candidate thought, ToT can be summarized as generating new states, scoring them, and retaining the best $b$:

<div class="math-display">
\[
s_{t+1}=f(s_t,z_t),\qquad
S_{t+1}=\operatorname{TopB}_{b}\left\{V_{\theta}(s_{t+1})\right\}
\]
</div>

![Structural comparison of direct input-output, Chain of Thought, Self-Consistency, and Tree of Thoughts](/img/posts/agentic-llm-1-reasoning/reasoning-structures.webp)

*CoT expands one chain, Self-Consistency samples independent chains, and ToT branches, scores, and prunes intermediate states.*

![Breadth-first and depth-first search algorithms for Tree of Thoughts](/img/posts/agentic-llm-1-reasoning/tree-of-thoughts-algorithms.webp)

*BFS keeps promising states at each depth; DFS follows one branch and backtracks after failure.*

![The Tree of Thoughts prompt structure for proposing, evaluating, and selecting branches in Game of 24](/img/posts/agentic-llm-1-reasoning/tree-of-thoughts-game24.webp)

*In Game of 24, the model both proposes candidate steps and evaluates which intermediate results deserve more search.*

ToT exposes paths, supports rollback, and makes constraints easy to add. Its expansion policy is usually fixed by humans: branching factor, retained candidates, and stopping rules are configured in advance. Learned policies can dynamically choose where to search next, at the price of training and debugging complexity.

## 8. Failure is not the end: self-reflection and reusable experience

When an LLM is called separately as actor, critic, or evaluator—and feedback is used to construct the next prompt—the overall system performs engineering-style self-reflection.

This is usually not mysterious introspection inside one call. It is an **external control algorithm repeatedly invoking the model, saving trajectories, and restructuring context**.

![The agent-environment reinforcement learning loop with state, action, and reward feedback](/img/posts/agentic-llm-1-reasoning/agent-environment-loop.webp)

*An action changes the environment; the resulting state and reward become input to the next decision.*

### 8.1 Self-Refine

[Self-Refine](https://arxiv.org/abs/2303.17651) uses a simple loop:

```text
Initial Output → Feedback → Refined Output → Feedback → ...
```

The same model can generate, critique, and revise without changing its weights. The method works best when quality criteria can be expressed in language.

![Self-Refine improves an output through repeated feedback and refinement](/img/posts/agentic-llm-1-reasoning/self-refine.webp)

*Self-Refine improves an output through a generate-feedback-revise loop without updating model weights.*

### 8.2 ReAct: the bridge from reasoning to action

[ReAct](https://arxiv.org/abs/2210.03629) interleaves thoughts, actions, and observations:

```text
Thought → Action → Observation → Thought → Action → ...
```

CoT can only continue from the model's current context. ReAct can retrieve evidence, call a tool, or query an environment and incorporate the observation into the next reasoning step. This grounding helps reduce hallucinations from purely linguistic reasoning.

ReAct crosses the boundary between Reasoning and Action, making it the starting point for the next article in this series.

![The ReAct thought-action-observation loop among the LLM, tools, and environment](/img/posts/agentic-llm-1-reasoning/react-loop.webp)

*ReAct writes external observations back into the reasoning trace instead of relying only on parametric knowledge.*

### 8.3 Reflexion: extracting reusable experience from a trajectory

[Reflexion](https://arxiv.org/abs/2303.11366) adds three roles around a ReAct-like agent:

- **Actor** generates reasoning, actions, and a trajectory.
- **Evaluator** determines success and provides feedback.
- **Reflector** compresses failure into a reusable natural-language lesson.

```text
Actor trajectory
      ↓
Evaluator score / feedback
      ↓
Reflector creates a lesson
      ↓
Store in memory
      ↓
Actor tries again
```

Short-term memory stores the current reasoning and action trace. Long-term memory stores reusable reflections across attempts.

```text
Evaluator: The attempt failed because it used outdated information.
Reflector: Verify time-sensitive facts with an external source.
Long-term Memory: Retain this lesson for future attempts.
```

The relationship is easy to remember:

> ReAct = Think → Act → Observe  
> Reflexion = ReAct → Evaluate → Reflect → Remember → Try Again

![Reflexion combines an actor, evaluator, self-reflection, short-term trajectory, and long-term experience](/img/posts/agentic-llm-1-reasoning/reflexion-architecture.webp)

*The actor attempts the task, the evaluator judges it, and the reflector compresses failure into a reusable lesson.*

![How Reflexion maps onto the reinforcement learning agent-environment structure](/img/posts/agentic-llm-1-reasoning/reflexion-close-up.webp)

*Reflexion separates the current trajectory from experience retained across attempts.*

### 8.4 Buffer of Thoughts

[Buffer of Thoughts](https://arxiv.org/abs/2406.04271) distills high-level solution structures from past tasks into thought templates stored in a meta-buffer:

```text
Solved Problems → Problem Distiller → Thought Templates → Meta-Buffer
                                                     ↓
New Problem → Retrieve Template → Instantiated Reasoning
```

Instead of solving every task from scratch, the agent accumulates reusable cognitive patterns such as “identify constraints, enumerate candidates, then verify.”

![Buffer of Thoughts distills thought templates from solved problems and retrieves them from a meta-buffer for a new task](/img/posts/agentic-llm-1-reasoning/buffer-of-thoughts.webp)

*Buffer of Thoughts stores transferable solution templates rather than every detail of every previous trace.*

### 8.5 Other prompt-improvement loops

| Method | Core idea |
| --- | --- |
| Progressive Hint Prompting | Feed the previous answer into the next prompt until the result stabilizes |
| Self-Discover | Select and compose reasoning modules suited to the current problem |
| Prompt Improvement | Rewrite the next prompt from evaluation feedback rather than updating weights |

Self-reflective systems share two challenges:

1. Multiple roles and prompts interact unpredictably and can amplify errors.
2. States, actions, observations, rewards, and reflections eventually overflow the context window.

Reflection therefore needs summarization, selective memory, context resets, and external state storage.

## 9. Reasoning also needs research: retrieval augmentation

Reasoning should not remain closed inside parametric memory. RAG connects unstructured documents, databases, and knowledge graphs:

```text
Question → Query Rewrite / Decomposition → Retrieval
                                      ↓
                         Evidence + Reasoning → Answer
```

Basic RAG retrieves once before answering. Adaptive retrieval lets the model decide when to search, what to search for, and whether the available evidence is sufficient.

The connection to self-reflection is direct: an evaluator can detect missing or stale evidence and trigger retrieval; the retrieved result becomes the next observation. Reasoning evolves into a think–retrieve–verify process.

## 10. Write successful reasoning back into the model: RLVR and GRPO

Most methods above operate at inference time without changing parameters. High-quality reasoning traces can also feed back into training.

### 10.1 RLVR

Reinforcement Learning with Verifiable Rewards uses fast, deterministic verifiers instead of a subjective reward model:

- Is the mathematical answer correct?
- Does the code pass its tests?
- Are format and constraints satisfied?
- Does a proof checker accept the proof?

```text
Prompt → Sample Reasoning + Answer → Verifier → Reward → Policy Update
```

Rewards are objective and scalable, but only some real-world tasks have cheap, reliable verification functions.

If a verifier returns reward $R(\tau)$ for trajectory $\tau$, the training objective can be summarized as:

<div class="math-display">
\[
J(\theta)=\mathbb{E}_{\tau\sim\pi_{\theta}(\cdot\mid x)}\left[R(\tau)\right]
\]
</div>

### 10.2 GRPO

Group Relative Policy Optimization samples a group of answers to the same prompt and estimates advantages from relative group scores, reducing dependence on a separate critic model. It extends the diverse sampling intuition of self-consistency into training: the system does not merely select a better answer at inference time; it increases the probability of high-reward reasoning policies.

For answer $i$ in a group, an intuitive relative-advantage estimate is:

<div class="math-display">
\[
\hat{A}_i=\frac{r_i-\operatorname{mean}(r_1,\ldots,r_G)}{\operatorname{std}(r_1,\ldots,r_G)+\varepsilon}
\]
</div>

```text
Inference-time exploration
          ↓
Verifiable outcomes
          ↓
RLVR / GRPO training
          ↓
Stronger reasoning policy
          ↓
Better inference-time exploration
```

## 11. A unified view: the model proposes; the system structures and verifies

LLMs belong to connectionist AI: knowledge and capability are distributed across neural parameters and learned from data. Search, logic, planning, interpreters, and state machines resemble symbolic AI: rules and operations are represented explicitly.

Modern agentic systems combine both:

```text
LLM (pattern recognition, language understanding, candidate generation)
                         +
Search / Planning / Memory / Tools (structure, state, verification)
```

This is often compared with System 1 and System 2:

- **Fast reasoning** directly uses learned associations.
- **Slow reasoning** introduces intermediate steps, search, planning, and tools.

```text
Fast: 17 × 6 → 102

Slow: 17 × 6
      → 10 × 6 + 7 × 6
      → 60 + 42
      → 102
```

The analogy should not be taken literally. LLMs still operate through next-token prediction. A more precise engineering description is that “slow thinking” supplies additional serial tokens, parallel candidates, external state, and verifiable feedback.

## 12. After Reasoning: Action and Interaction

The path from ordinary generation to agentic reasoning is now visible:

```text
Direct Generation
  → In-Context Learning
  → Chain of Thought
  → Verification / Self-Consistency
  → Code + Interpreter
  → Tree Search
  → Self-Reflection + Memory
  → Retrieval
  → RLVR / GRPO
```

Reasoning alone cannot change the world. A correct plan remains text if it cannot call tools; an action cannot form a loop if the system cannot observe its outcome.

The next two articles will examine:

- **[Action](/en/post/agentic-llm-2-action/)**: planning, tool use, world models, vision-language-action models, and the translation from tokens to operations.
- **Interaction**: observations, environmental feedback, multi-agent coordination, state management, and continual adaptation.

Reasoning decides what should happen next. Action determines how to do it. Interaction tells the system what happened afterward. Together, they form an Agentic Large Language Model.

## References

- [Chain-of-Thought Prompting Elicits Reasoning in Large Language Models](https://arxiv.org/abs/2201.11903)
- [Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171)
- [PAL: Program-Aided Language Models](https://arxiv.org/abs/2211.10435)
- [Teaching Large Language Models to Self-Debug](https://arxiv.org/abs/2304.05128)
- [Tree of Thoughts: Deliberate Problem Solving with Large Language Models](https://arxiv.org/abs/2305.10601)
- [Self-Refine: Iterative Refinement with Self-Feedback](https://arxiv.org/abs/2303.17651)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- [Buffer of Thoughts: Thought-Augmented Reasoning with Large Language Models](https://arxiv.org/abs/2406.04271)
- [DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models](https://arxiv.org/abs/2402.03300)
