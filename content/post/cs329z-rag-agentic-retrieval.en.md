---
title: "CS 329Z: From RAG to Agentic RAG — Retrieval, Reranking, and Closed-Loop Decisions"
date: 2026-10-06 09:00:00 +0200
slug: "cs329z-rag-agentic-retrieval"
description: "A structured guide to RAG based on Stanford CS 329Z notes: Retriever–Reader, chunking, BM25, DPR, ColBERT, hybrid search, reranking, evaluation, GraphRAG, Self-RAG, CRAG, and Search-R1."
categories: [AI Agents]
tags: [RAG, Agentic RAG, Retrieval, BM25, DPR, ColBERT, GraphRAG, Contextual Retrieval]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

RAG is often summarized as “retrieve a few passages from a vector database and put them in the prompt.” That description is not wrong, but it hides the difficult questions: **How should knowledge be chunked? How do we combine semantic and exact matching? How should candidates be reranked? How do we know whether the evidence is sufficient, and when should the system search again?**

Seen this way, RAG is not merely an external knowledge store. It is an evidence-centered decision pipeline:

```text
Documents → Chunk and index → Multi-path recall → Fuse and rerank → Read and generate
                                      ↑                              ↓
                                      └── Evaluate, rewrite, search again ──┘
```

This article reorganizes the RAG chapter from my **Stanford CS 329Z: Engineering AI Agents** notes. The first half develops retrieval and evaluation. The second puts retrieval back inside the agent loop and explains why the architecture naturally evolves toward **Agentic RAG**.

<!--more-->

## 1. Why do capable models still need retrieval?

Language models compress a great deal of public knowledge into their parameters, but parametric memory is a poor home for every kind of knowledge:

- **Knowledge changes**: product documentation, prices, policies, and company data can become stale quickly.
- **Private data is absent from pretraining**: internal documents, personal files, and live business state must come from elsewhere.
- **Answers need evidence**: users often need to inspect where a conclusion came from, not just read the conclusion.
- **Context has limits**: a longer context window does not guarantee that every relevant fact will be used reliably.

Retrieval avoids asking the model to memorize everything in advance. It supplies the most relevant, useful, and traceable evidence at the moment an answer is produced. Updating an index is usually easier than retraining a model, while returned sources make the answer more auditable than a purely parametric response.

### 1.1 Retriever–Reader: the minimal RAG abstraction

Let the document collection be:

<div class="math-display">
\[
\mathcal{D}=\{D_1,D_2,\ldots,D_n\}
\]
</div>

Given a query `Q`, the Retriever selects `K` candidate passages:

<div class="math-display">
\[
f(\mathcal{D},Q)\rightarrow \{P_1,P_2,\ldots,P_K\}
\]
</div>

The Reader combines the question and evidence to produce answer `A`:

<div class="math-display">
\[
g\!\left(Q,\{P_1,P_2,\ldots,P_K\}\right)\rightarrow A
\]
</div>

`K` might be five, or it might be one hundred candidates followed by a reranker. Earlier systems often paired sparse retrievers such as TF-IDF or BM25 with a trained reading-comprehension model. Today the Reader is often an LLM, but the two-stage abstraction still holds.

![Retriever–Reader framework: a retriever selects evidence and a reader answers from the query and retrieved passages](/img/posts/cs329z-rag/retriever-reader.webp)

## 2. RAG is not one fixed architecture

One source of variation is the granularity of the retrieved representation. The embedding determines what a single vector stands for:

| Granularity | Typical methods | One vector represents | Best suited to |
| --- | --- | --- | --- |
| Static word | word2vec, GloVe | A word type | Word-level similarity |
| Contextual token | BERT, RoBERTa | A token in context | Local meaning and entities |
| Passage | Sentence-BERT, DPR, E5 | A chunk | Large-scale semantic recall |
| Multimodal | CLIP | Text or image | Cross-modal retrieval |
| Graph | node2vec, GNN encoder | A node or relation | Structured relation queries |

At the system level, RAG designs are often grouped into three forms:

- **Naive RAG**: one query, one retrieval pass, one generation pass;
- **Advanced RAG**: query rewriting, hybrid recall, reranking, compression, and verification;
- **Modular or Agentic RAG**: the model dynamically chooses sources, retrieval methods, and stopping conditions.

![The evolution from Naive RAG to Advanced RAG and Modular RAG](/img/posts/cs329z-rag/rag-variants.webp)

The key transition is not whether the application has a vector database. It is whether retrieval remains a fixed preprocessing step or becomes an **action that can be planned, evaluated, and repeated**.

## 3. Chunking: retrieval quality starts before the index

Long documents are usually divided into chunks before indexing. This looks like simple preprocessing, but it directly limits the best recall the system can achieve.

### 3.1 Fixed-length chunks

A common baseline uses 100–500 tokens per chunk with roughly 10–20% overlap:

```text
Chunk 1: token 1   ───────── token 300
Chunk 2:                 token 271 ───────── token 570
                              └─ overlap ─┘
```

Overlap keeps a sentence from disappearing when it crosses a boundary, but it does not resolve the underlying tradeoff:

- If a chunk is too small, its embedding lacks context. “Revenue grew by 3%” does not say which company or quarter.
- If a chunk is too large, one vector averages several topics and can wash out the relevant detail.

### 3.2 Structural and dynamic chunking

A stronger design respects document structure: sentences, paragraphs, headings, and sections. Two extensions can add useful context:

1. **Context-enriched chunking** adds a title, source, date, or summary.
2. **AI dynamic chunking** asks a model to locate semantic breakpoints rather than cutting at a fixed token count.

More complexity is not automatically better. FAQs, source code, financial reports, and chat logs have different structures. Chunking should be tested against the actual data and queries instead of using one global length for every collection.

## 4. Contextual Retrieval: add context, then combine lexical and semantic search

Suppose the original chunk contains only:

> The company's revenue grew by 3% over the previous quarter.

The sentence is meaningful, but it omits the company, date, and document type. A query such as “How much did ACME's revenue grow in Q2 2023?” may fail to retrieve it.

Contextual Retrieval first generates a short description for each chunk, for example:

> This chunk is from ACME Corp's Q2 2023 SEC filing and discusses quarterly revenue growth.

The system then indexes the context together with the original chunk.

![An original chunk compared with a context-enriched version](/img/posts/cs329z-rag/contextualized-chunk-example.webp)

This retains two complementary signals:

- **Embeddings** capture meaning, paraphrases, and related expressions.
- **BM25** captures exact company names, dates, numbers, error codes, and other literal terms.

![Contextual Retrieval enriches each chunk before building semantic and lexical indexes](/img/posts/cs329z-rag/contextual-retrieval-overview.webp)

![The hybrid-search flow used by Contextual Retrieval](/img/posts/cs329z-rag/contextual-retrieval-hybrid.webp)

The experiment in the notes illustrates the direction of the effect. Combining embeddings with BM25 reduces retrieval failure from 5.7% to 5.0%; adding chunk context brings it down further to 2.9%. These numbers belong to a specific experimental setup and should not be generalized blindly. The more durable lesson is that **context enrichment and complementary lexical and semantic signals can produce more reliable gains than swapping embedding models alone**.

![Retrieval failure rates across embedding, BM25, and contextual-retrieval configurations](/img/posts/cs329z-rag/contextual-retrieval-failure-rate.webp)

### 4.1 Late Chunking: understand the document before pooling the chunk

The conventional pipeline chunks first and encodes each chunk independently. Late Chunking reverses that order:

1. Encode the full document with a long-context encoder.
2. Obtain token representations that have seen the surrounding document.
3. Mean-pool the token spans belonging to each chunk.

The resulting chunk vectors remain suitable for vector search, but they carry information from the broader document.

![Naive Chunking compared with Late Chunking](/img/posts/cs329z-rag/late-chunking.webp)

Contextual Retrieval adds explicit textual context. Late Chunking encodes context implicitly into token representations. Both address the same failure: **a local passage should not be forced to stand alone after being detached from its source**.

## 5. Retrievers: from exact terms to semantic matching

### 5.1 BM25: exact matching still matters

BM25 balances three signals:

- how frequently a term appears in the current document;
- how rare the term is across the collection;
- document length, so longer documents are not rewarded merely for containing more words.

A common form is:

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

Here, `f(q_i,D)` is term frequency, `|D|` is document length, and `avgdl` is the average document length. IDF can be written as:

<div class="math-display">
\[
\operatorname{IDF}(q_i)=
\log\!\left(
\frac{N-n(q_i)+0.5}{n(q_i)+0.5}+1
\right)
\]
</div>

![The term-frequency, length-normalization, and IDF components of BM25](/img/posts/cs329z-rag/bm25-formula.webp)

BM25 does not understand meaning, but it excels at product IDs, function names, people, and error codes. For a rare literal such as `ERR_CONN_RESET_1042`, exact matching is often more reliable than a dense embedding.

### 5.2 DPR: put queries and passages in one vector space

Dense Passage Retrieval uses separate encoders for the query and passage, then compares their vectors by dot product:

<div class="math-display">
\[
s(q,p)=E_Q(q)^{\top}E_P(p)
\]
</div>

Passage vectors can be computed offline and placed in an approximate-nearest-neighbor index. At query time, the system only encodes the query and retrieves the Top-K passages.

![DPR's offline passage encoding and online query retrieval pipeline](/img/posts/cs329z-rag/dpr-architecture.webp)

DPR can retrieve semantic neighbors that share no keywords, but a single vector must compress an entire passage and may overlook rare literal evidence.

### 5.3 ColBERT: preserve token-level evidence

ColBERT does not collapse a passage into one vector. It separately pre-encodes query and document tokens, then performs **Late Interaction** at query time. Its MaxSim score can be written as:

<div class="math-display">
\[
S_{q,d}=\sum_{i\in q}\max_{j\in d}q_i^{\top}d_j
\]
</div>

For every query token, it finds the best matching document token and sums those scores. This retains finer evidence than DPR's single-vector comparison without requiring the full pairwise computation of a Cross-Encoder over the whole corpus.

## 6. Hybrid Search and reranking

No retriever covers every query:

- BM25 can miss synonyms, paraphrases, and natural-language reformulations.
- Dense retrievers can miss rare entities, identifiers, and strings that must match exactly.

Production systems therefore often run sparse and dense retrieval in parallel and merge their candidate lists.

### 6.1 RRF: merge ranks rather than incompatible scores

BM25 scores and vector similarities live on different scales, so adding them directly requires calibration. Reciprocal Rank Fusion uses only the rank assigned by each retriever:

<div class="math-display">
\[
\operatorname{RRF}(d)=
\sum_{r\in\mathcal{R}}
\frac{1}{k+\operatorname{rank}_r(d)}
\]
</div>

`k` is a smoothing constant and `rank_r(d)` is the rank of document `d` under retriever `r`. A document that ranks well in several lists receives a strong fused score. RRF avoids raw-score calibration and naturally supports more than two retrievers.

### 6.2 Cross-Encoders: let the query and passage attend jointly

A Bi-Encoder represents the query and passage independently, which enables large-scale recall. A Cross-Encoder concatenates them and uses full attention to output a relevance score.

![Bi-Encoder and Cross-Encoder architectures](/img/posts/cs329z-rag/bi-vs-cross-encoder.webp)

Cross-Encoders are usually more accurate, but every query–passage pair must be evaluated online. A practical cascade is therefore:

```text
BM25 / DPR       retrieve hundreds of candidates
       ↓
RRF              merge candidate lists
       ↓
ColBERT / Cross-Encoder   rerank a smaller Top-N
       ↓
LLM              generate from a few high-quality passages
```

| Method | Representation | Speed | Strongest at | Main limitation |
| --- | --- | --- | --- | --- |
| BM25 | Sparse inverted index | Fast | Exact terms, IDs, names, code | Paraphrases and synonyms |
| DPR | One vector per passage | Fast | Semantic recall at scale | Rare literals and compression loss |
| ColBERT | One vector per token | Medium | Fine-grained token evidence | Larger index |
| Cross-Encoder | Joint query–passage encoding | Slow | Accurate shortlist reranking | Cannot scan the full corpus |

The goal is not to crown one “best model.” Each stage should work within the compute budget it fits: **cheap components maximize recall; expensive components improve precision**.

## 7. How should a Retriever be evaluated?

Judging only whether the final answer sounds good mixes retrieval failures with generation failures. The Retriever needs its own evaluation.

### 7.1 Hit@K and Failed@K

A query is a hit if at least one relevant passage appears in the Top-K:

<div class="math-display">
\[
\operatorname{Hit@K}(q)=
\mathbb{1}\!\left[\operatorname{Rel}_q\cap\operatorname{TopK}_q\neq\varnothing\right]
\]
</div>

Failed@K means there is no relevant evidence in the Top-K:

<div class="math-display">
\[
\operatorname{Failed@K}=1-\operatorname{Hit@K}
\]
</div>

### 7.2 Recall@K

When several passages are relevant, Recall@K measures how many were retrieved:

<div class="math-display">
\[
\operatorname{Recall@K}(q)=
\frac{|\operatorname{Rel}_q\cap\operatorname{TopK}_q|}
{|\operatorname{Rel}_q|}
\]
</div>

### 7.3 MRR@K

Mean Reciprocal Rank measures how early the first relevant result appears:

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

When relevance has multiple grades rather than a binary label, nDCG discounts relevant results that appear lower in the list:

<div class="math-display">
\[
\operatorname{DCG@K}=\sum_{i=1}^{K}
\frac{2^{\operatorname{rel}_i}-1}{\log_2(i+1)},
\qquad
\operatorname{nDCG@K}=\frac{\operatorname{DCG@K}}{\operatorname{IDCG@K}}
\]
</div>

![Retrieval metrics including Hit, Failed, Recall, MRR, and nDCG](/img/posts/cs329z-rag/retrieval-metrics.webp)

Evaluation should also be sliced by query type: exact entities, paraphrased questions, multi-hop tasks, time-sensitive facts, and permission-sensitive requests can expose very different weaknesses. A high average score can still hide failure on the most important business queries.

## 8. GraphRAG: when the answer depends on relationships and global structure

Vector retrieval is good at finding local passages similar to a query. Some questions, however, are not asking “which passage looks most similar?” They ask:

- How are people, organizations, and events connected?
- What themes recur across a large collection?
- What happened within the local relationship network of an entity?

GraphRAG extracts entities and relationships, builds a knowledge graph, detects communities, and produces reports that summarize those communities.

![Communities formed by entities and relations in GraphRAG](/img/posts/cs329z-rag/graphrag-communities.webp)

![The GraphRAG pipeline from source documents and text units to entities, communities, and local or global answers](/img/posts/cs329z-rag/graphrag-pipeline.webp)

This supports two broad answer modes:

- **Local answers** begin with nodes, relationships, and source passages near a particular entity.
- **Global answers** combine community reports to address collection-wide questions.

GraphRAG is not a default upgrade for every application. Entity resolution, relation extraction, graph updates, and community summaries add cost. The structure is most justified when queries genuinely depend on multi-hop relationships or global themes.

## 9. Agentic RAG: make retrieval an action

Classic RAG retrieves once for every question and accepts the first result set. Agentic RAG asks the model to make three decisions inside a loop:

1. **Should I retrieve?** Is the current knowledge sufficient?
2. **What should I retrieve?** How should the task be rewritten or split into subquestions?
3. **Is the evidence good enough?** Is it relevant, trustworthy, and consistent, or should the system search again?

Retrieval becomes an action selected by a policy rather than a mandatory pipeline stage:

<div class="math-display">
\[
a_t\in\{\text{answer},\ \text{retrieve}(q),\ \text{rewrite}(q),\ \text{verify},\ \text{stop}\}
\]
</div>

![On-demand retrieval, candidate generation, critique, and answer selection](/img/posts/cs329z-rag/self-rag-retrieve-on-demand.webp)

### 9.1 Self-RAG: reflect on retrieval and evidence

Self-RAG introduces reflection tokens that express decisions such as:

- whether retrieval is necessary;
- whether a retrieved passage is relevant;
- whether the generated statement is supported by evidence;
- whether the answer is useful or another retrieval pass is needed.

Its important contribution is not simply “retrieve more.” It places **retrieval decisions, evidence judgments, and generation** inside one learnable process.

### 9.2 CRAG: let a critic decide how to handle the result

Corrective RAG adds a critic that evaluates the retrieved evidence before choosing a strategy:

| Critic judgment | Next action |
| --- | --- |
| Correct | Use the high-quality evidence directly |
| Ambiguous | Rewrite, retrieve more, or add sources |
| Incorrect | Discard the result and use an alternative source |

![CRAG routes retrieval results according to Correct, Ambiguous, and Incorrect judgments](/img/posts/cs329z-rag/crag-critic.webp)

### 9.3 Search-R1: learn a search policy with reinforcement learning

Search-R1 treats search as a multi-step decision process and learns trajectories such as:

```text
Think → Search → Read → Think → Search → … → Answer
```

![Search-R1 learns a multi-round reasoning and search policy through reinforcement learning](/img/posts/cs329z-rag/search-r1.webp)

This is different from merely prompting a model to search first. Reinforcement learning optimizes the whole trajectory: when to query, how to use observations, when to continue, and when to stop. The eventual answer reward shapes the policy that produced the search sequence.

## 10. Where does RAG fail?

Once RAG is viewed as a closed-loop system, failures fall into three layers.

### 10.1 Retrieval failures

- **Recall ceiling**: if the first stage never retrieves the evidence, neither reranking nor a stronger LLM can recover it.
- **Stale index**: the source changed but the embedding or inverted index did not.
- **Permission leak**: the system retrieves a document the user is not authorized to read.
- **Query mismatch**: the user's intent is not translated into a form that fits the collection.

### 10.2 Reader failures

- **Lost in the middle**: the evidence is present but buried in long context.
- **Distraction**: highly similar yet irrelevant passages pull the model away from the answer.
- **Evidence conflict**: sources from different dates or systems disagree.
- **Unsupported synthesis**: several true fragments are combined into a conclusion supported by none of them.

### 10.3 Agent-loop failures

- **Compounding error**: a bad query produces bad evidence, which drives another bad query.
- **No stopping rule**: the agent keeps searching without gaining information.
- **Prompt injection**: instructions inside retrieved documents are mistaken for system commands.
- **Cost explosion**: rewriting, reranking, and repeated search have no budget.

A production system therefore needs document-level authorization, source and timestamp metadata, citation tracing, search-round and cost limits, conflict handling, and a strict separation between retrieved content and trusted instructions.

## 11. A practical implementation order

If I were building a RAG system from scratch, I would iterate in this order:

1. Build a real query set with passage relevance labels and define evaluation first.
2. Establish an interpretable baseline with structural chunking and BM25.
3. Add a dense retriever and combine it with BM25 through RRF.
4. Inspect Failed@K before deciding whether Contextual Retrieval or Late Chunking is necessary.
5. Use ColBERT or a Cross-Encoder only on a smaller candidate set.
6. Evaluate retrieval and final answers separately instead of conflating their errors.
7. Introduce query planning, critics, and agent loops only when a single retrieval pass is demonstrably insufficient.
8. Add higher-maintenance structures such as GraphRAG only when the task requires them.

The principle is simple: **make a measurable single retrieval pass work before turning it into a multi-step agent action**. Otherwise, the agent merely automates repeated calls to an unstable retriever.

## Conclusion: RAG is about controlling evidence

The real value of RAG is not placing more tokens into a context window. It is controlling which evidence the answer is allowed to use:

```text
Recall determines whether the correct evidence can be seen.
Ranking determines whether it appears early enough.
Reading determines whether the model uses it correctly.
Agent policy determines when to search, how to revise, and when to stop.
```

Classic RAG asks, “Given this query, what should I retrieve?” Agentic RAG adds, “Should I search now, how should I search, and is the evidence sufficient?” Once retrieval becomes an action, RAG is no longer only a knowledge attachment. It becomes a central mechanism through which an agent observes the external world, verifies its beliefs, and corrects its next move.
