---
title: "CS 329Z：从 RAG 到 Agentic RAG——检索、重排与闭环决策"
date: 2026-10-06 09:00:00 +0200
slug: "cs329z-rag-agentic-retrieval"
description: "基于 Stanford CS 329Z 笔记，系统梳理 RAG 的 Retriever–Reader 框架、Chunking、BM25、DPR、ColBERT、Hybrid Search、重排、评测、GraphRAG，以及 Self-RAG、CRAG 与 Search-R1。"
categories: [AI Agents]
tags: [RAG, Agentic RAG, Retrieval, BM25, DPR, ColBERT, GraphRAG, Contextual Retrieval]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

RAG 经常被概括为“从向量数据库中找几段文本，再塞进 Prompt”。这个描述没有错，但它忽略了真正困难的部分：**怎样切分知识、怎样兼顾语义与精确匹配、怎样重排、怎样判断证据是否足够，以及什么时候应该再次检索。**

从这个角度看，RAG 不是一个简单的外挂知识库，而是一条围绕证据构建的决策管线：

```text
文档 → 切分与索引 → 多路召回 → 融合与重排 → 阅读与生成
                                ↑                    ↓
                                └── 评估证据、改写查询、再次检索 ──┘
```

本文根据我的 **Stanford CS 329Z: Engineering AI Agents** 笔记中的 RAG 章节整理。前半部分讨论经典 RAG 的检索与评测，后半部分把检索放回 Agent 循环，解释为什么下一步会自然走向 **Agentic RAG**。

<!--more-->

## 1. 为什么模型还需要检索？

语言模型把大量公共知识压缩在参数里，但参数记忆并不适合承担所有知识工作：

- **知识会变化**：产品文档、价格、政策与公司数据随时可能更新；
- **私有数据不在训练集里**：内部文档、个人资料和实时业务状态无法依靠预训练获得；
- **答案需要证据**：用户不仅想知道结论，也希望检查结论来自哪里；
- **上下文有边界**：即使 Context Window 变长，也不等于模型能稳定利用其中每条信息。

检索的核心思想，是不要求模型预先记住所有事实，而是在回答问题时提供**当下最相关、最有用、可追溯的证据**。与重新训练模型相比，更新索引通常更快；与仅靠参数回答相比，返回出处也让结果更容易验证。

### 1.1 Retriever–Reader：RAG 的最小抽象

设文档集合为：

<div class="math-display">
\[
\mathcal{D}=\{D_1,D_2,\ldots,D_n\}
\]
</div>

面对查询 `Q`，Retriever 从集合中选出 `K` 个候选 Passage：

<div class="math-display">
\[
f(\mathcal{D},Q)\rightarrow \{P_1,P_2,\ldots,P_K\}
\]
</div>

Reader 再结合问题与候选证据生成答案 `A`：

<div class="math-display">
\[
g\!\left(Q,\{P_1,P_2,\ldots,P_K\}\right)\rightarrow A
\]
</div>

`K` 可以是 5，也可以先召回 100 条再重排。早期系统常用 TF-IDF、BM25 这类稀疏检索器，并配合训练过的阅读理解模型；今天的 Reader 往往直接是 LLM，但这个两阶段抽象仍然成立。

![Retriever–Reader 框架：Retriever 从文档库召回证据，Reader 结合问题生成答案](/img/posts/cs329z-rag/retriever-reader.webp)

## 2. RAG 不是一种固定架构

RAG 的变化首先来自“检索对象怎样表示”。不同 Embedding 的粒度决定了系统能够检索什么：

| 表示粒度 | 典型方法 | 一个向量代表什么 | 适合的问题 |
| --- | --- | --- | --- |
| 静态词向量 | word2vec、GloVe | 一个词类型 | 词级相似度 |
| 上下文化 Token | BERT、RoBERTa | 语境中的一个 Token | 局部语义与实体 |
| Passage 向量 | Sentence-BERT、DPR、E5 | 一个 Chunk | 大规模语义召回 |
| 多模态向量 | CLIP | 文本或图像 | 跨模态检索 |
| 图表示 | node2vec、GNN Encoder | 节点或关系 | 结构化关系查询 |

工程上也常把系统分为三种形态：

- **Naive RAG**：一次查询、一次召回、一次生成；
- **Advanced RAG**：增加查询改写、混合召回、重排、压缩与验证；
- **Modular / Agentic RAG**：模型根据任务动态选择数据源、检索方法和停止时机。

![Naive RAG、Advanced RAG 与 Modular RAG 的演进](/img/posts/cs329z-rag/rag-variants.webp)

关键变化不在于“有没有向量数据库”，而在于检索是否从固定前处理步骤，逐渐变成一个**可规划、可反馈、可重复的行动**。

## 3. Chunking：检索质量从切分开始

进入 Retriever 之前，长文档通常要先切成 Chunk。切分看似只是预处理，却直接决定召回上限。

### 3.1 固定长度切分

最常见的方法是每段 100–500 Tokens，并保留约 10%–20% 的重叠：

```text
Chunk 1: token 1   ───────── token 300
Chunk 2:                 token 271 ───────── token 570
                              └─ overlap ─┘
```

重叠可以避免一句话恰好落在边界两侧，但它不能解决根本矛盾：

- Chunk 太小，Embedding 缺少上下文，“增长 3%”不知道是谁、在哪个季度增长；
- Chunk 太大，一个向量会平均多个主题，相关细节反而被冲淡。

### 3.2 从结构切分到动态切分

更稳妥的做法是尊重文档结构：按句子、段落、标题和章节切分。还可以增加两类增强：

1. **Context-enriched Chunking**：为 Chunk 写入标题、文档来源、时间或摘要；
2. **AI Dynamic Chunking**：让模型识别语义断点，而不是机械地在固定 Token 数处切开。

这并不意味着越复杂越好。FAQ、代码文档、财报和聊天记录的结构完全不同，Chunking 应该根据数据类型和真实查询来评测，而不是只选一个全站统一的长度。

## 4. Contextual Retrieval：先补背景，再做混合检索

假设原始 Chunk 只有一句：

> The company's revenue grew by 3% over the previous quarter.

它本身没有公司名、时间和文档类型。即使句子语义完整，查询“ACME 2023 年第二季度收入增长多少”时，也可能因为缺少实体而召回失败。

Contextual Retrieval 会先为每个 Chunk 生成简短背景，例如：

> This chunk is from ACME Corp's Q2 2023 SEC filing and discusses quarterly revenue growth.

再把“背景 + 原始 Chunk”送入 Embedding 与 BM25 索引。

![原始 Chunk 与补充上下文后的 Chunk 对比](/img/posts/cs329z-rag/contextualized-chunk-example.webp)

它同时保留两类信号：

- **Embedding** 捕捉语义、改写和近义表达；
- **BM25** 捕捉公司名、年份、数字、错误码等精确词项。

![Contextual Retrieval：为 Chunk 生成背景，再分别建立语义与词法索引](/img/posts/cs329z-rag/contextual-retrieval-overview.webp)

![Contextual Retrieval 的 Hybrid Search 流程](/img/posts/cs329z-rag/contextual-retrieval-hybrid.webp)

笔记中的实验图也展示了一个重要趋势：Embedding 与 BM25 结合后，检索失败率从单独使用 Embedding 的 5.7% 降到 5.0%；加入 Chunk Context 后，进一步降到 2.9%。这些数值来自特定实验设置，不应直接外推到所有数据集，但它说明了一个更普遍的结论：**上下文增强与词法、语义信号互补，比单纯更换一个 Embedding 模型更可能带来稳定收益。**

![不同检索策略下的失败率对比](/img/posts/cs329z-rag/contextual-retrieval-failure-rate.webp)

### 4.1 Late Chunking：先理解全文，再汇聚局部

普通流程是“先切块，再分别编码”，每个 Chunk 看不到其他部分。Late Chunking 反过来：

1. 用支持长上下文的 Encoder 编码整篇文档；
2. 得到带有全文语境的 Token 表示；
3. 最后在各 Chunk 对应的 Token 区间做 Mean Pooling。

这样生成的 Chunk 向量仍适合向量检索，却带有整篇文档的上下文。

![Naive Chunking 与 Late Chunking 的区别](/img/posts/cs329z-rag/late-chunking.webp)

Contextual Retrieval 是显式地给 Chunk 加文字背景；Late Chunking 则把背景隐式编码进 Token 表示。两者解决的是同一个问题：**不要让一个局部片段在失去原文语境后独自承担检索。**

## 5. Retriever：从精确词项到语义匹配

### 5.1 BM25：精确匹配仍不可替代

BM25 会综合考虑三件事：

- 词在当前文档中出现多少次；
- 词在整个语料库中有多稀有；
- 文档长度，避免长文档仅因词更多而占优。

一个常见写法是：

<div class="math-display">
\[
\operatorname{BM25}(Q,D)=
\sum_{q_i\in Q}
\operatorname{IDF}(q_i)
\cdot
\frac{f(q_i,D)(k_1+1)}
{f(q_i,D)+k_1\left(1-b+b\frac{|D|}{\operatorname{avgdl}}\right)}
\]
</div>

其中 `f(q_i,D)` 是词频，`|D|` 是文档长度，`avgdl` 是平均文档长度。IDF 可以写成：

<div class="math-display">
\[
\operatorname{IDF}(q_i)=
\log\!\left(
\frac{N-n(q_i)+0.5}{n(q_i)+0.5}+1
\right)
\]
</div>

![BM25 的词频、文档长度与 IDF 公式](/img/posts/cs329z-rag/bm25-formula.webp)

BM25 不“理解”语义，却特别擅长产品编号、函数名、人名和错误码。对于 `ERR_CONN_RESET_1042` 这类罕见字符串，精确匹配常常比 Dense Embedding 更可靠。

### 5.2 DPR：把查询与 Passage 放到同一个向量空间

Dense Passage Retrieval（DPR）用两个 Encoder 分别编码查询与 Passage，再通过点积寻找相似向量：

<div class="math-display">
\[
s(q,p)=E_Q(q)^{\top}E_P(p)
\]
</div>

文档向量可以离线计算并建立 ANN 索引，在线只需编码 Query，再取 Top-K Passage。

![DPR 的离线 Passage 编码与在线 Query 检索流程](/img/posts/cs329z-rag/dpr-architecture.webp)

DPR 能召回没有共享关键词的语义近邻，但单个向量必须压缩整个 Passage，也容易忽略罕见字面量。

### 5.3 ColBERT：保留 Token 级证据

ColBERT 不把整段文本压成一个向量，而是分别预编码 Query 和 Document 的 Token 表示，在查询时执行 **Late Interaction**。其 MaxSim 分数可以写成：

<div class="math-display">
\[
S_{q,d}=\sum_{i\in q}\max_{j\in d}q_i^{\top}d_j
\]
</div>

对 Query 中每个 Token，它都寻找 Document 中最匹配的 Token，再把分数相加。这比 DPR 的单向量比较保留了更多局部证据，同时又不必像 Cross-Encoder 一样对整个语料库逐对计算。

## 6. Hybrid Search 与 Reranking

没有一种 Retriever 能覆盖所有查询：

- BM25 容易漏掉同义词、释义和自然语言改写；
- Dense Retriever 容易漏掉罕见实体、编号和必须逐字匹配的内容。

因此，生产系统常并行运行稀疏与稠密检索，然后融合候选列表。

### 6.1 RRF：融合名次，而不是硬凑分数

BM25 分数与向量相似度不在同一个尺度，直接相加需要调参。Reciprocal Rank Fusion（RRF）只使用每个 Retriever 给出的排名：

<div class="math-display">
\[
\operatorname{RRF}(d)=
\sum_{r\in\mathcal{R}}
\frac{1}{k+\operatorname{rank}_r(d)}
\]
</div>

`k` 是平滑常数，`rank_r(d)` 是文档 `d` 在检索器 `r` 中的名次。一个文档若在多个列表中都排得靠前，就会获得较高融合分数。它不依赖原始分数校准，也能自然扩展到多路 Retriever。

### 6.2 Cross-Encoder：让 Query 与 Passage 共同注意

Bi-Encoder 先独立编码 Query 与 Passage，适合大规模召回；Cross-Encoder 则把二者拼在一起，通过完整 Attention 输出相关性分数。

![Bi-Encoder 与 Cross-Encoder 的结构对比](/img/posts/cs329z-rag/bi-vs-cross-encoder.webp)

Cross-Encoder 通常更准确，但它不能预先缓存每个 Query–Passage 组合。因此合理的工程顺序是：

```text
BM25 / DPR       召回几百条候选
       ↓
RRF              融合多路候选
       ↓
ColBERT / Cross-Encoder   重排 Top-N
       ↓
LLM              基于少量高质量证据生成
```

| 方法 | 表示方式 | 速度 | 最擅长 | 主要限制 |
| --- | --- | --- | --- | --- |
| BM25 | 稀疏倒排索引 | 快 | 精确词项、ID、名称、代码 | 语义改写与同义词 |
| DPR | 每个 Passage 一个向量 | 快 | 大规模语义召回 | 罕见字面量、信息压缩 |
| ColBERT | 每个 Token 一个向量 | 中等 | Token 级证据与细粒度匹配 | 索引体积更大 |
| Cross-Encoder | Query–Passage 联合编码 | 慢 | 小候选集的高精度重排 | 无法直接扫描全库 |

重点不是选出“最强模型”，而是让每一层在自己最合适的计算预算内工作：**便宜的组件负责 Recall，昂贵的组件负责 Precision。**

## 7. 怎样评估 Retriever？

只看最终回答是否流畅，会把检索错误与生成错误混在一起。Retriever 应单独评测。

### 7.1 Hit@K 与 Failed@K

只要 Top-K 中出现至少一条相关 Passage，就算命中：

<div class="math-display">
\[
\operatorname{Hit@K}(q)=
\mathbb{1}\!\left[\operatorname{Rel}_q\cap\operatorname{TopK}_q\neq\varnothing\right]
\]
</div>

Failed@K 则表示 Top-K 中完全没有相关证据：

<div class="math-display">
\[
\operatorname{Failed@K}=1-\operatorname{Hit@K}
\]
</div>

### 7.2 Recall@K

如果一个问题有多条相关 Passage，Recall@K 衡量找回了其中多少：

<div class="math-display">
\[
\operatorname{Recall@K}(q)=
\frac{|\operatorname{Rel}_q\cap\operatorname{TopK}_q|}
{|\operatorname{Rel}_q|}
\]
</div>

### 7.3 MRR@K

Mean Reciprocal Rank 关心第一条相关结果出现得有多早：

<div class="math-display">
\[
\operatorname{MRR@K}=
\frac{1}{|Q|}\sum_{q\in Q}
\begin{cases}
\frac{1}{\operatorname{rank}_q}, & \operatorname{rank}_q\le K\\[4pt]
0, & \text{otherwise}
\end{cases}
\]
</div>

### 7.4 nDCG@K

当相关性不是简单的“相关 / 不相关”，而是有多个等级时，可以使用 nDCG：

<div class="math-display">
\[
\operatorname{DCG@K}=\sum_{i=1}^{K}
\frac{2^{\operatorname{rel}_i}-1}{\log_2(i+1)},
\qquad
\operatorname{nDCG@K}=\frac{\operatorname{DCG@K}}{\operatorname{IDCG@K}}
\]
</div>

![Hit、Failed、Recall、MRR 与 nDCG 等检索指标](/img/posts/cs329z-rag/retrieval-metrics.webp)

实际评测时还要按查询类型切片：精确实体、语义问法、多跳问题、时间敏感问题和权限敏感问题可能呈现完全不同的弱点。一个平均分很高的 Retriever，仍可能在最关键的业务查询上失败。

## 8. GraphRAG：当答案依赖关系与全局结构

向量检索擅长找到与 Query 相似的局部文本，但有些问题不是“哪一段最像”，而是：

- 哪些人物、组织与事件相互连接？
- 跨越许多文档的共同主题是什么？
- 某个实体所在的局部关系网发生了什么？

GraphRAG 会从文档中抽取实体与关系，建立 Knowledge Graph，再进行 Community Detection，并为不同社区生成摘要。

![GraphRAG 中由实体与关系构成的社区](/img/posts/cs329z-rag/graphrag-communities.webp)

![GraphRAG 从源文档、Text Units、实体关系到 Local 与 Global Answer 的完整流程](/img/posts/cs329z-rag/graphrag-pipeline.webp)

这样可以支持两类回答：

- **Local Answer**：从与某个实体邻近的节点、关系和原始文本出发；
- **Global Answer**：汇总多个 Community Report，回答跨文档的总体性问题。

GraphRAG 不是所有场景都需要的默认升级。它需要实体消歧、关系抽取、图更新与额外计算。只有当查询确实依赖多跳关系或全局主题时，这种结构化成本才更可能值得。

## 9. Agentic RAG：把 Retrieval 变成 Action

经典 RAG 默认每个问题都检索一次，并接受首轮结果。Agentic RAG 则让模型在循环中回答三个问题：

1. **要不要检索？** 当前知识是否足以回答？
2. **检索什么？** 怎样把任务改写为有效查询，是否需要拆成子问题？
3. **证据够不够？** 结果是否相关、可信、互相一致，是否需要再检索？

于是检索不再是固定管线中的一步，而成为策略可以选择的 Action：

<div class="math-display">
\[
a_t\in\{\text{answer},\ \text{retrieve}(q),\ \text{rewrite}(q),\ \text{verify},\ \text{stop}\}
\]
</div>

![按需检索、生成候选并批判性选择答案的流程](/img/posts/cs329z-rag/self-rag-retrieve-on-demand.webp)

### 9.1 Self-RAG：让模型反思检索与证据

Self-RAG 在生成过程中引入 Reflection Tokens，用来表示类似这样的判断：

- 是否需要检索；
- Retrieved Passage 是否相关；
- 生成内容是否被证据支持；
- 当前答案是否有用，是否需要继续检索。

它的关键不只是“检索更多”，而是把**检索决策、证据判断和生成**放进同一个可学习过程。

### 9.2 CRAG：让 Critic 决定如何处理结果

Corrective RAG（CRAG）为检索结果增加一个 Critic，先评估证据质量，再选择处理策略：

| Critic 判断 | 后续动作 |
| --- | --- |
| Correct | 直接使用高质量证据 |
| Ambiguous | 改写查询、补充检索或增加来源 |
| Incorrect | 丢弃错误结果，转向替代数据源 |

![CRAG：Critic 对检索结果进行 Correct、Ambiguous 与 Incorrect 分流](/img/posts/cs329z-rag/crag-critic.webp)

### 9.3 Search-R1：用强化学习训练搜索策略

Search-R1 把搜索视为多轮决策过程，让模型学习这样的轨迹：

```text
Think → Search → Read → Think → Search → … → Answer
```

![Search-R1：通过强化学习学习多轮思考与搜索策略](/img/posts/cs329z-rag/search-r1.webp)

这与“在 Prompt 中要求模型先搜索”不同。强化学习优化的是整条 Search Trajectory：什么时候发起查询、如何利用观察、何时继续、何时停止，最终由答案奖励反向影响策略。

## 10. RAG 的失败通常发生在哪里？

把 RAG 视为闭环系统后，失败可以分成三层。

### 10.1 Retrieval 层

- **Recall Ceiling**：第一阶段没召回，后续重排和 LLM 再强也无济于事；
- **Stale Index**：源数据更新了，Embedding 或倒排索引没有同步；
- **Permission Leak**：系统召回了用户本不应读取的文档；
- **Query Mismatch**：用户目标没有被转换成适合语料库的检索表达。

### 10.2 Reader 层

- **Lost in the Middle**：相关证据存在，却被长上下文中的其他内容淹没；
- **Distraction**：高相似但无关的 Passage 诱导模型偏离；
- **Evidence Conflict**：不同时间、不同来源的证据互相矛盾；
- **Unsupported Synthesis**：模型把多个真实片段拼成一个没有被任何来源支持的结论。

### 10.3 Agent Loop 层

- **Compounding Error**：错误查询带来错误结果，错误结果又驱动下一轮错误查询；
- **No Stopping Rule**：不断搜索却没有新增信息；
- **Prompt Injection**：Retrieved Document 中的指令被误当成系统命令；
- **Cost Explosion**：查询改写、重排和多轮搜索没有预算约束。

因此，生产系统至少需要：文档级权限过滤、来源与时间戳、引用追踪、最大搜索轮数、成本预算、证据冲突处理，以及对检索内容与系统指令之间的明确隔离。

## 11. 一条更实用的落地顺序

如果从零开始构建 RAG，我会按下面的顺序迭代：

1. 建立真实查询集与相关 Passage 标注，先明确评测方式；
2. 用结构化 Chunking + BM25 做可解释 Baseline；
3. 加入 Dense Retriever，通过 RRF 做 Hybrid Search；
4. 检查 Failed@K，再决定是否需要 Contextual Retrieval 或 Late Chunking；
5. 只对较小候选集使用 ColBERT 或 Cross-Encoder 重排；
6. 同时评测 Retriever 与最终 Answer，不把两类错误混为一谈；
7. 只有当一次检索明显不足时，再引入 Query Planning、Critic 和 Agent Loop；
8. 最后才考虑 GraphRAG 等维护成本更高的结构。

这条顺序背后的原则是：**先把可测量的单次检索做对，再把它变成 Agent 的多步行动。** 否则，Agent 只是在自动重复一个质量不稳定的 Retriever。

## 结语：RAG 的核心是证据控制

RAG 的真正价值，不是把更多 Token 放进 Context Window，而是控制答案使用什么证据：

```text
Recall 决定模型有没有机会看到正确证据
Ranking 决定正确证据是否足够靠前
Reading 决定模型能否正确使用证据
Agent Policy 决定何时检索、如何修正、何时停止
```

经典 RAG 解决的是“给定查询，找哪些内容”；Agentic RAG 继续追问“现在是否该查、该怎么查、查到的够不够”。当 Retrieval 成为 Action，RAG 就不再只是知识外挂，而开始成为 Agent 感知外部世界、验证判断并修正行动的核心机制。
