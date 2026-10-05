---
title: "Agentic LLM (II): Action — From Multimodal Perception to VLAs and World Models"
date: 2026-10-05 19:30:00 +0200
slug: "agentic-llm-2-action"
description: "Part II of the Agentic LLM series: how VLMs ground visual environments, how VLAs connect language and perception to robot control, and how world models support prediction and planning."
categories: [AI Agents]
tags: [Agentic LLM, Action, VLM, VLA, World Model, Robotics, Model-Based RL]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

Reasoning proposes what should happen next. An agent begins to affect the world only when that decision becomes an API call, a mouse click, or a robot trajectory.

That is the fundamental difference between **action** and ordinary text generation. A bad sentence can be regenerated; an action may change state, consume resources, or produce an irreversible result. An agent must therefore understand which actions are available, predict their consequences, and continue from the next observation.

This is the **second article in the Agentic Large Language Models series**. [Part I](/en/post/agentic-llm-1-reasoning/) covered reasoning from Chain of Thought and search to reflection and RLVR. This article follows a different progression:

```text
Perceive the environment (VLM)
             ↓
Map intent to action (VLA)
             ↓
Predict what follows (World Model)
             ↓
Plan, compare, and revise before execution
```

<!--more-->

> **Series**: [(I) Reasoning](/en/post/agentic-llm-1-reasoning/) · **(II) Action** · (III) Interaction (coming next)

## 1. Action is more than outputting a verb

For a chatbot, generated tokens are usually the final product. For an agent, tokens often serve as input to an execution system.

```text
Chatbot:  Prompt → Tokens

Agent:    Goal → Reasoning → Action → Environment
                    ↑                     ↓
                    └──── Observation ────┘
```

Let `o_t` be the observation at time `t`, `g` the user goal, and `h_t` the previous action history. A policy can be written as:

<div class="math-display">
\[
a_t \sim \pi_{\theta}\!\left(a\mid o_{\le t}, g, h_t\right)
\]
</div>

After receiving an action, the environment produces a new state, observation, and reward:

<div class="math-display">
\[
s_{t+1},\,o_{t+1},\,r_t \sim P\!\left(\cdot\mid s_t,a_t\right)
\]
</div>

The action `a_t` may belong to very different spaces:

| Setting | Action representation | Executor |
| --- | --- | --- |
| Tool agent | JSON, function name, parameters | API / tool runtime |
| Computer-use agent | Mouse, keyboard, GUI coordinates | Browser or operating system |
| Code agent | Patches, shell commands, test instructions | Sandbox / terminal |
| Embodied agent | Velocity, pose, joints, or trajectories | Robot controller |

This article focuses on the clearest path from understanding to physical behavior: **Vision-Language Models (VLMs)**, **Vision-Language-Action Models (VLAs)**, and **world models**. Software tools and API actions will return in the Interaction article alongside observations, state management, and permissions.

![A taxonomy of Agentic LLM action methods, covering multimodal models, robotic control, tool use, and software agents](/img/posts/agentic-llm-2-action/action-taxonomy.webp)

*Action spans robots, tools, software assistants, and world models. Each must translate model output into constrained, executable, and verifiable operations.*

## 2. VLMs: let the agent perceive its environment

A language-only model can process only the world that has already been converted into tokens. Real environments first arrive as images, video, audio, and sensor state. A VLM maps visual information into representations that a language model can use.

A typical VLM contains four parts:

1. **Vision encoder**: a CNN or Vision Transformer encodes an image into visual features.
2. **Text encoder / tokenizer**: processes questions, instructions, and text history.
3. **Multimodal projector**: maps visual features into the language model's embedding space.
4. **Text decoder**: generates output conditioned on both visual and text tokens.

![A typical VLM architecture in which a multimodal projector aligns visual features with tokens consumed by a text decoder](/img/posts/agentic-llm-2-action/vlm-architecture.webp)

*In LLaVA-style systems, the projector need not turn an image into a caption first. It aligns visual features directly with token representations the language model can consume.*

If the visual encoder produces `z_v`, the projection is `W_p`, and the text embedding is `z_x`, the language-model input can be summarized as:

<div class="math-display">
\[
z=\left[W_p z_v\,;\,z_x\right],\qquad
p(y\mid I,x)=\prod_{t=1}^{T}p\!\left(y_t\mid z,y_{<t}\right)
\]
</div>

### 2.1 What can a VLM do?

Common tasks include:

- **Visual question answering** from an image or video.
- **Image captioning**, from short summaries to detailed descriptions.
- **Detection, grounding, and segmentation** that connect language to image regions.
- **Text-to-image generation** and editing.
- **Multimodal retrieval** from text to image or image to related content.

Evaluation has expanded from object recognition to cultural, regional, and fine-grained understanding. Established VQA and captioning datasets include MS-COCO, NoCaps, MSR-VTT, and VATEX. DetailCaps, VDC, and CapArena target more detailed captions, while MMMU evaluates broad multimodal reasoning across academic disciplines. The source notes also highlight MOSAIC, GLOBAL-RG, CultureVQA, FoodieQA, and MaRVL for multilingual, regional, and culturally grounded understanding.

### 2.2 Four common training routes

| Route | Representative method | What it learns |
| --- | --- | --- |
| Contrastive learning | CLIP | Pull matched image–text pairs together and separate mismatched pairs |
| Masked modeling | FLAVA | Recover masked language or image regions |
| Generative modeling | Diffusion models | Generate images from noise and conditions |
| Projector + LLM | LLaVA | Connect a pretrained vision encoder to an LLM and apply visual instruction tuning |

![How visual and text conditions enter a Stable Diffusion generation architecture](/img/posts/agentic-llm-2-action/stable-diffusion-architecture.webp)

*Generative VLMs ask how to produce visual content from a condition. Action-oriented VLMs ask how to extract a decision-relevant state from visual content. Both are multimodal, but their output objectives differ.*

## 3. From VLM to VLA: seeing is not acting

A VLM may answer “which cup is red?” without knowing how a robot should approach, grasp, and place it. Visual-language alignment alone does not provide:

- three-dimensional position, reachability, and affordances;
- continuous-time control and action history;
- embodiment-specific joint, velocity, and safety constraints;
- recovery after an object moves or an execution attempt fails.

A VLA joins vision, language, and action in a single policy. Training examples are no longer only image–text pairs; they are trajectories containing observations and actions:

<div class="math-display">
\[
\tau=\left(o_1,\ell,a_1,o_2,a_2,\ldots,o_T,a_T\right)
\]
</div>

Here, `ℓ` is the language instruction, `o_t` may include camera images and robot state, and `a_t` is the action at step `t`. The policy learns:

<div class="math-display">
\[
\pi_{\theta}(a_t\mid o_{\le t},\ell,a_{<t})
\]
</div>

RT-2 represents discretized robot actions as text tokens, allowing a pretrained VLM to learn language answers and robot control through the same autoregressive objective. Not every VLA must “write an action as text,” however. For high-frequency continuous control, models such as π₀ directly generate continuous action chunks and learn their distribution with flow matching.

The common property is not the output encoding. It is the **connection between visual-semantic knowledge and an executable closed-loop policy**.

## 4. Four representative VLA designs

### 4.1 Mobility VLA: separate semantic navigation into two levels

[Mobility VLA](https://arxiv.org/abs/2407.07775) addresses Multimodal Instruction Navigation with demonstration Tours (MINT). A user can provide both natural-language instructions and a demonstration video as prior knowledge about the environment.

Instead of asking one large model to emit every motor command, the system uses a hierarchy:

1. A long-context VLM reads the tour and instruction to identify a goal frame.
2. A low-level policy localizes and plans over a pre-built topological graph.
3. A navigation controller generates robot actions at each time step.

![Mobility VLA uses a long-context VLM for goal understanding and a topological graph with a low-level policy for navigation](/img/posts/agentic-llm-2-action/mobility-vla.webp)

*The design separates semantic understanding, where a VLM is strong, from localization and path following, where conventional navigation machinery is more reliable.*

### 4.2 LM-Nav: compose pretrained models without further fine-tuning

[LM-Nav](https://arxiv.org/abs/2207.04429) shows that action does not always require a newly trained end-to-end model. It composes three existing modules:

- an LLM extracts landmarks from a natural-language instruction;
- a VLM grounds those landmarks in a visual route;
- a visual navigation model executes local navigation.

![LM-Nav uses an LLM to extract landmarks, a VLM to align them with a route, and a VNM to execute navigation](/img/posts/agentic-llm-2-action/lm-nav.webp)

*LM-Nav requires neither language-annotated robot trajectories nor task-specific fine-tuning. Its modules are reusable, although upstream grounding errors can propagate into navigation.*

### 4.3 RT-2: represent robot actions as tokens

The central move in [RT-2](https://arxiv.org/abs/2307.15818) is to co-fine-tune Internet-scale vision-language tasks and robot trajectories rather than training a robot policy in isolation:

```text
Web-scale VQA / caption data ─┐
                              ├─→ VLM → Action tokens → Robot control
Robot observation + action ───┘
```

![RT-2 jointly trains on Internet vision-language data and robot trajectories, then decodes action tokens into closed-loop control](/img/posts/agentic-llm-2-action/rt-2.webp)

*Encoding actions in the text output vocabulary lets the model transfer object concepts and semantic relationships learned from the web into robot control.*

The transfer is the important part. Robot trajectories are scarce compared with web image–text data, while a VLM already understands many objects, attributes, and commonsense relationships. Co-training gives the model a chance to turn “an energy drink is useful when someone is tired” into “select and grasp the energy drink on the table.”

### 4.4 π₀: generate continuous actions with flow matching

[π₀](https://arxiv.org/abs/2410.24164) adds an action expert to a pretrained VLM and trains across data from multiple robot embodiments. Instead of discretizing all low-level control into text tokens, it uses flow matching to generate continuous action chunks, which is better suited to dexterous, high-dimensional control.

| System | High-level semantics | Action generation | Distinguishing idea |
| --- | --- | --- | --- |
| Mobility VLA | Long-context VLM | Topological graph + low-level policy | Hierarchical navigation |
| LM-Nav | GPT-3 + CLIP | Pretrained visual navigation model | Modular composition, no extra fine-tuning |
| RT-2 | Web-scale VLM | Discrete action tokens | End-to-end co-fine-tuning and web knowledge transfer |
| π₀ | Pretrained VLM | Continuous action chunks via flow matching | Cross-embodiment dexterous control |

## 5. How does a VLA learn to act?

A practical training pipeline usually combines three layers of data:

```text
Internet image–text data
          ↓
Visual-semantic pretraining: objects, attributes, relations, knowledge
          ↓
Robot trajectories: (observation, instruction, action)
          ↓
Behavior cloning / action prediction / co-fine-tuning
          ↓
Simulation or real-world adaptation, reinforcement learning, safety constraints
```

The most common base objective is behavior cloning: maximize the likelihood of a demonstrated action under the current observation and instruction.

<div class="math-display">
\[
\mathcal{L}_{\text{BC}}(\theta)
=-\sum_{t=1}^{T}\log \pi_{\theta}
\!\left(a_t\mid o_{\le t},\ell,a_{<t}\right)
\]
</div>

Transformers over `(state, action, reward)` sequences predate VLAs. [Decision Transformer](https://arxiv.org/abs/2106.01345) casts offline RL as conditional sequence modeling: given a desired return and a history of states and actions, predict the next action. A VLA adds raw vision, natural-language instructions, and embodiment state while inheriting semantic knowledge from a VLM.

That combination exposes the difficult parts:

1. **Robot data are expensive.** The web offers vast image–text corpora but nothing comparable in high-quality control trajectories.
2. **Embodiments differ.** The same intention maps to different parameters across arms, cameras, and grippers.
3. **Distribution shift compounds.** Small changes in lighting, position, or objects can accumulate into control error.
4. **Long-horizon credit assignment is hard.** A failure may originate in a grasp error dozens of steps earlier.
5. **Safety constrains exploration.** A physical robot cannot retry as freely as a text model.

## 6. World models: predict consequences before acting

A policy that maps the current image directly to an action is reactive. It can work, but it cannot explicitly answer a crucial question:

> What is likely to happen if I take this action?

A world model learns transition and reward dynamics. If the real dynamics and reward functions are `T` and `R`, a learned local approximation estimates:

<div class="math-display">
\[
\hat{s}_{t+1}=\hat{T}_{\phi}(s_t,a_t),\qquad
\hat{r}_t=\hat{R}_{\phi}(s_t,a_t)
\]
</div>

The agent can now roll out candidate actions internally rather than testing every possibility in an expensive or dangerous environment:

<div class="math-display">
\[
a_t^{*}=\underset{a_t}{\operatorname{arg\,max}}
\;\mathbb{E}_{\hat{T}_{\phi}}
\left[\sum_{k=0}^{H-1}\gamma^k\hat{r}_{t+k}\right]
\]
</div>

![Model-based reinforcement learning improves a local world model from real experience and uses the model for planning or policy learning](/img/posts/agentic-llm-2-action/model-based-rl.webp)

*The real environment provides ground truth but is expensive to sample. The local model is cheap but imperfect. Model-based RL trades off these two sources of experience.*

### 6.1 Model-based and model-free RL

| Method | What it learns | Advantage | Risk |
| --- | --- | --- | --- |
| Model-free RL | A policy or value function directly | Avoids explicit model bias | Requires more real interaction |
| Model-based RL | Dynamics and reward, then planning or policy learning | Better sample efficiency; simulate before acting | Model error compounds across long rollouts |

Model-based RL reconnects modern agents with classical planning. Tree search, graph search, and symbolic planners compare paths explicitly; neural models supply perception, state compression, and approximate dynamics.

JEPA suggests another useful distinction: the model need not reconstruct every pixel of the next frame. It can predict a future representation in latent space. For planning, “the cup will move right and remain reachable” is often more useful than a photorealistic rendering of every pixel.

## 7. Two directions for agentic world models

The relationship between LLMs and model-based RL can be read in two directions.

### 7.1 LLM4MBRL: use an LLM as a world model

Pretrained LLMs contain substantial knowledge about websites, game rules, commonsense, and physical relationships. A system can ask an LLM to predict the outcome of candidate actions, then use tree search or model-predictive control to choose among them.

[WebDreamer](https://arxiv.org/abs/2411.06559) uses an LLM to “imagine” the outcome of a web action. Instead of trying an irreversible purchase on the live website, the agent first compares what might happen after each click. This is **model-based speculative planning**.

[WorldGPT](https://arxiv.org/abs/2404.18202) learns cross-modal state transitions from multimodal sequences, extending an LLM-like core toward the prediction of changes in images, video, and audio.

### 7.2 MBRL4LLM: adapt a model through environment interaction

The opposite direction does not treat a pretrained LLM as a static simulator. It updates transition hypotheses from new environmental feedback.

[WorldCoder](https://arxiv.org/abs/2402.12275) asks an agent to write a Python program representing the rules of the world. When an observation contradicts the program, the agent edits the code; a planner then searches the executable model for a high-reward path. Knowledge about dynamics becomes explicit, inspectable, executable, and revisable rather than remaining only in a prompt.

| Direction | Source of the world model | How it improves |
| --- | --- | --- |
| LLM4MBRL | Knowledge already present in a pretrained model | Prompts, search, external memory, planning harness |
| MBRL4LLM | Dynamics learned or reconstructed from environment trajectories | Fine-tuning, RL, program repair, continual interaction |

The first direction starts quickly but may simulate confidently and incorrectly. The second adapts to a specific environment but requires reliable interaction data and stable updates.

## 8. A unified comparison: LLM, VLM, Decision Transformer, VLA, and world model

These labels often appear together, but they define different interfaces.

| Model | Main input | Main output | Primary objective |
| --- | --- | --- | --- |
| LLM | Text tokens | Text tokens | Model language, knowledge, and reasoning patterns |
| VLM | Image / video + text | Text or visual content | Connect visual semantics and language |
| Decision Transformer | Return + state + action history | Next action | Cast offline RL as conditional sequence modeling |
| VLA | Vision + instruction + robot state | Robot action / action chunk | Connect semantic understanding to executable control |
| World model | State + candidate action | Future state + reward / outcome | Predict environmental change before execution |

They are not mutually exclusive. A modern embodied agent may use all of them:

```text
VLM: understand the current scene
  ↓
LLM / planner: decompose the goal and propose actions
  ↓
World model: simulate candidate outcomes
  ↓
VLA / controller: turn the selected action into continuous control
  ↓
Environment: return a new observation
```

## 9. What is still missing between a demo and deployment?

Research demos often show an action model succeeding. A deployed system must also handle failure, permissions, and uncertainty.

### 9.1 Grounding and executability

A linguistically plausible plan may refer to a missing object, an unreachable pose, or a capability the robot does not have. The real environment must define the available action space; the model cannot invent it freely.

### 9.2 Uncertainty and recovery

The system needs more than an action. It must know when to stop, observe again, request confirmation, or roll back. Closed-loop reliability often depends more on recovery than on single-step accuracy.

### 9.3 Permissions and safety boundaries

The ability to generate an action is not authorization to execute it:

<div class="math-display">
\[
\text{Can Propose} \;\neq\; \text{Can Execute} \;\neq\; \text{Can Execute Without Approval}
\]
</div>

### 9.4 End-to-end metrics

High VQA accuracy does not imply successful robot behavior. Action systems must ultimately be judged by task success, completion time, intervention rate, safety violations, recovery success, and real operating cost.

## 10. Conclusion: action is a chain from semantics to consequences

Action is not a function call appended to the end of model output. It requires a system to answer four questions:

1. **Perception**: what is in the environment?
2. **Grounding**: which objects, locations, and constraints correspond to the goal?
3. **Control**: how does the goal become an executable operation?
4. **Prediction**: what will happen next, and how should failure be handled?

VLMs let an agent perceive and understand its environment. VLAs map vision and language into behavior. World models let the agent compare possible futures before committing to one. Together, they allow reasoning to cross the boundary from text into consequential action.

The next article will cover **Interaction**: how an agent consumes observations after acting, manages changing state, collaborates with people or other agents, and maintains a reliable loop over long-running tasks.

## References

- [Visual Instruction Tuning (LLaVA)](https://arxiv.org/abs/2304.08485)
- [LM-Nav: Robotic Navigation with Large Pre-Trained Models of Language, Vision, and Action](https://arxiv.org/abs/2207.04429)
- [RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control](https://arxiv.org/abs/2307.15818)
- [Mobility VLA: Multimodal Instruction Navigation with Long-Context VLMs and Topological Graphs](https://arxiv.org/abs/2407.07775)
- [π₀: A Vision-Language-Action Flow Model for General Robot Control](https://arxiv.org/abs/2410.24164)
- [Decision Transformer: Reinforcement Learning via Sequence Modeling](https://arxiv.org/abs/2106.01345)
- [Self-Supervised Learning from Images with a Joint-Embedding Predictive Architecture](https://arxiv.org/abs/2301.08243)
- [WorldGPT: Empowering LLM as Multimodal World Model](https://arxiv.org/abs/2404.18202)
- [WebDreamer: Model-Based Planning for Web Agents](https://arxiv.org/abs/2411.06559)
- [WorldCoder, a Model-Based LLM Agent](https://arxiv.org/abs/2402.12275)
