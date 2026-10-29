---
title: "Memvid: A Single-File Memory System for AI"
date: 2026-10-29
slug: "memvid-memory-architecture"
description: "How Memvid v2 stores and retrieves agent memory: MV2 files, frames, embedded WAL, TOC, lexical and vector indexes, with a Rust source walkthrough and the tradeoffs of a portable memory container."
categories: [AI Agents]
tags: [Memvid, Agent Memory, RAG, Storage, Rust, Vector Search]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

Memvid is a single-file memory system for AI agents. It keeps content and retrieval indexes locally, so an agent can look up information saved in earlier sessions.

<!--more-->

Project: [memvid/memvid](https://github.com/memvid/memvid) · Commit: [`e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813`](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813)

## 1. What Memvid does

Memvid is a persistent memory and retrieval component for AI applications. Its central object is a memory file, such as `knowledge.mv2`. Once documents are ingested, an application can locate relevant material by keywords, meaning or time, with source identifiers and metadata attached to results.

Suppose a coding agent previously helped deploy a service. When asked later how that service is deployed and which endpoint to check afterward, it can retrieve the deployment record and health-check address instead of requesting all the files again.

Typical uses include:

- **Project knowledge:** architecture notes, API conventions, troubleshooting records and technical decisions.
- **Personal assistants:** confirmed preferences and plans retrieved when relevant to a task.
- **Offline document retrieval:** local search without running a separate search service.
- **Agent debugging:** inspecting ingestion order, retrieved sources and records visible within a historical range.

Memvid does not modify the base model's parameters. It returns external evidence that the model uses through context. LoRA adapts parameters; Memvid stores and retrieves information. They can be used together.

In a RAG system, Memvid can handle content storage and retrieval. Document selection, authorization, prompting, generation and evaluation remain application concerns. An Agentic RAG system additionally lets an agent decide when to search, how to reformulate a question and whether another search is needed. Memvid can be one of its retrieval tools.

## 2. Project directory structure

Start with the source tree. The following files cover the main storage and retrieval paths:

```text
memvid/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── memvid/           # Writes, queries, commits and recovery
│   ├── types/            # Frame, TOC and query data structures
│   ├── io/               # Header, WAL and time-index I/O
│   ├── lex.rs            # Full-text indexing
│   ├── vec.rs            # Vector storage and search
│   ├── vec_pq.rs
│   ├── text_embed.rs
│   ├── toc.rs
│   └── footer.rs
├── tests/
├── benches/
└── examples/
```

The Rust crate is `memvid-core`. Its implementation lives under `src/`; ingested documents and generated memory files are not part of this source tree.

Begin with the exports in [`src/lib.rs`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/lib.rs), then follow the operations in [`src/memvid/`](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid):

- `lifecycle.rs`: file creation, opening and lifecycle.
- `mutation.rs`: mutations, commits and directory updates.
- `search/` and `ask.rs`: candidate retrieval, ranking and answer generation.
- `frame.rs` and `chunks.rs`: record access and document chunks.

For example, `types/frame.rs` defines a frame, `io/wal.rs` implements WAL I/O, and `memvid/mutation.rs` coordinates their use during a commit. Separating data structures, low-level I/O and operations makes a write or query easier to trace.

## 3. Architecture Overview

There are two main paths through the system:

```text
Write: document / text → extraction and chunking → frames → content and indexes → MV2 commit
Read: question → lexical / vector / time lookup → frames → source evidence → application or LLM
```

An `.mv2` file is Memvid's binary memory container, not Markdown text or model weights. It stores content, indexes and metadata for addressing and recovery. CLI and SDK interfaces expose the system; Rust Core implements storage and queries. An LLM uses retrieved evidence when an answer needs to be generated.

The [official overview](https://docs.memvid.com/architecture/overview) centers on single-file portability, crash recovery, determinism and retrieval performance. Keeping content and indexes together simplifies migration. WAL records and checksums handle interrupted writes. Deterministic construction under fixed input conditions helps reproduce storage results. These are separate mechanisms, not automatic consequences of using one file.

A single memory file does not also package the application runtime, embedding weights or an LLM.

## 4. Memory Architecture

[Memory Architecture](https://docs.memvid.com/concepts/memory-architecture) describes the lifecycle of a memory: opening its file, committing records and finding content during a query.

### Layers inside an MV2 file

![A single MV2 file containing the header, embedded WAL, frame payloads, indexes, TOC and commit footer](/img/posts/memvid-architecture/mv2-layout.svg)

The diagram shows logical layers, not byte proportions:

| Layer | Contents | Responsibility |
| --- | --- | --- |
| Header | Format identity, version and key offsets | Locate structures when opening a file |
| Embedded WAL | Pending mutations and checkpoint progress | Recover from interrupted operations |
| Content regions | Text, binary data and other payloads | Retain material that can be read back |
| Indexes and tracks | Lexical, vector, temporal and other access structures | Locate records by different criteria |
| TOC + footer | Descriptors, addresses, checksums and commit information | Tie the regions into a consistent state |

### Write and read lifecycle

For ingestion, the application supplies content and metadata. Processing may extract text, split documents and generate embeddings, then create frames and index entries. WAL and commit handling coordinate these mutations into a recoverable file state.

For retrieval, Core uses the header and TOC to locate indexes, obtains frame identifiers, and reads the corresponding text or payloads. After an abnormal exit, valid commit information and WAL records must also be checked to recover pending changes.

A useful result therefore contains more than a similarity score: it leads back to a record, a source and its content. Frames define those records, indexes provide access paths, and file layout determines where they are stored.

### File locks and concurrency

The source uses operating-system file locks, with shared readers and an exclusive writer. It is not a distributed database allowing arbitrary simultaneous writers. Applications with several memory-writing agents should serialize writes or route them through one writer service.

## 5. Frame Architecture

A frame is a record in the container. It combines content addressing, provenance, time and status, which retrieval and updates can then use.

### Frames and payloads: descriptions and content bytes

A frame is the basic memory record. In the implementation, however, the `Frame` structure does not simply contain the entire document body. Selected fields from [`Frame`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/frame.rs) are:

```rust
// Selected fields from Frame
pub id: FrameId,
pub timestamp: i64,
pub payload_offset: u64,
pub payload_length: u64,
pub checksum: [u8; 32],
pub uri: Option<String>,
pub title: Option<String>,
pub search_text: Option<String>,
```

The payload holds content bytes, optionally encoded as Plain or Zstd. Its frame descriptor records location, length and checksum, and may also contain extracted `search_text`. When inspecting text records, useful content may therefore appear in `frame.search_text` rather than a universal `content` field.

`frame_id` identifies a particular record inside the file. A URI can provide a more stable application-level document identifier. Updating a topic can reuse its URI while creating a replacement record. One ingestion operation need not create exactly one frame: long documents can have parent and chunk records, depending on the ingestion interface and chunking strategy.

### Why frames rather than embeddings alone?

Vector search first identifies related records. Answering a question still requires the original text, its source, its time and its update status. An embedding alone cannot reconstruct exactly what a document said.

Frames associate that information with a record, so a search hit can lead back to evidence. An embedding is one retrieval representation of the record. It belongs in the same container without necessarily being embedded physically in each frame descriptor.

This separation has several consequences.

**Content and indexes can use different organizations.** Source text benefits from compression; lexical search needs an inverted index; semantic retrieval needs vectors and search structures; temporal access needs ordering by time. Sharing a container does not require sharing one encoding.

**Updates can retain provenance.** Fields such as `status`, `supersedes` and `superseded_by` express active, replaced and deleted records. Appending content and changing metadata status are separate operations.

**Chunking still matters.** Large chunks can mix unrelated topics; tiny chunks lose context. Meeting notes might be split by agenda item, code by function or module, and preferences by independently confirmed facts. Frames provide a place to store chunks and their relationships; they do not remove the need to design those chunks.

## 6. Indices and Tracks

Indexes provide ways to find records; tracks hold data organized for particular purposes. Both can reference frames without putting every access structure inside each frame.

### Lexical index: locating words

Full-text search is useful for exact terms: `E_LOCKED`, `rewrite_toc_footer`, project names and dates. Tantivy supplies inverted indexing and BM25 ranking, ultimately mapping candidates to frames.

If one record says “Atlas uses FastAPI” and another says “Atlas uses Docker Compose,” a query for `FastAPI` can use postings to locate the matching record instead of reading all document bodies.

Tokenization affects results. English abbreviations, code identifiers and Chinese phrases do not necessarily behave alike. No keyword match does not immediately establish that a fact is absent.

### Vector index: locating related meaning

Semantic retrieval embeds a question and searches nearby document or chunk vectors. A record saying “exposes its HTTP API with FastAPI” may match “What serves web requests?” without identical phrasing.

[`VecDocument`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/vec.rs) makes the frame-vector relationship explicit:

```rust
pub struct VecDocument {
    pub frame_id: FrameId,
    pub embedding: Vec<f32>,
}
```

Vectors and index structures are serialized into vector regions of the file. The implementation includes uncompressed, PQ and HNSW paths. Small collections can scan vectors directly; the builder selects HNSW when its threshold and required features permit it.

A BGE-small vector has 384 dimensions. Its FP32 values alone occupy `384 × 4 = 1536 bytes`, excluding graph structures, metadata and file overhead. PQ compresses a vector representation; its compression factor is not a compression factor for the entire memory file.

Changing the embedding model requires rebuilding compatible document vectors. Two models that both output 384 dimensions can still define different vector spaces and cannot be mixed safely.

### Time index and optional tracks

The time index locates frames chronologically; Section 8 covers its structure. The three access paths can work together—for example, restricting results to last week before searching for deployment decisions.

Beyond these three indexes, the TOC can reference structured MemoryCards, a Logic Mesh relationship graph and replay tracks. These store extracted facts, entity relationships and replay information when the corresponding processing or features are enabled. Creating an MV2 file does not populate all of them automatically.

## 7. File Layout

The preceding sections describe logical objects. On disk, the engine needs byte positions, lengths and integrity information. The header, TOC and footer supply that addressing and verification metadata.

### Header: locating the directory

The header occupies 4096 bytes. It identifies the format and locates other structures. [`HeaderCodec`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/header.rs) reads and writes fields at fixed offsets:

| Field | Purpose |
| --- | --- |
| `magic` | File identifier, `MV2\0` in the source |
| `version` and spec fields | File-format compatibility, not a version of remembered facts |
| `footer_offset` | Start of the current TOC |
| `wal_offset` / `wal_size` | Location and capacity of the embedded WAL |
| `wal_checkpoint_pos` / `wal_sequence` | WAL checkpoint position and sequence progress |
| `toc_checksum` | Integrity verification for directory metadata |

An offset is a byte position relative to the beginning of the file. It lets a reader seek directly to a region rather than scan every document.

### TOC and footer: addresses and commit information

TOC means Table of Contents. It is the container's directory metadata, not an imported Markdown file or a list of document headings.

[`Toc`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/manifest.rs) contains frame descriptors, index manifests, a segment catalog and references to optional tracks. Index manifests record byte offsets, lengths and checksums.

To read Frame 42, the engine obtains its descriptor, reads `payload_length` bytes at `payload_offset`, and decodes them according to the recorded encoding.

A commit footer follows the TOC. [`CommitFooter`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/footer.rs) includes the `MV2FOOT!` marker, TOC length, a BLAKE3 hash and a generation number. Recovery can scan backward for a valid footer and verify the preceding TOC.

Checksums detect corruption. A BLAKE3 checksum is not encryption and does not provide access control by itself.

## 8. Time Index Track

For “Which deployment decisions were added last week?”, time is a filter. The [time-index implementation](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/time_index.rs) stores:

```rust
pub struct TimeIndexEntry {
    pub timestamp: i64,
    pub frame_id: u64,
}
```

Entries are sorted by `(timestamp, frame_id)` before writing. This helps identify frames within a range, after which lexical or semantic relevance can still be applied. Ingestion time and dates mentioned in the content are different temporal meanings and should not be conflated.

## 9. Embedded WAL

A write can affect content, indexes and directory metadata. If the process exits midway, a partially updated index should not be mistaken for a complete new state. The embedded write-ahead log records pending mutations and recovery progress.

### Reserved capacity is not used space

WAL capacity is the size of a reserved byte region. Pending bytes measure the records currently awaiting processing. After a commit advances the checkpoint, that region can be reused; it is not a permanent archive of every operation.

The architecture overview lists capacity tiers of 1, 4, 16 and 64 MB. The current source additionally defines a **64 KiB** initial WAL for small files and supports growth. The published tiers should not be read as a guarantee that every new file immediately reserves at least 1 MB.

[`EmbeddedWal`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/wal.rs) tracks write position, checkpoint, pending bytes and sequence numbers. A full region must not overwrite uncommitted records. [`append_wal_entry()`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/mutation.rs) can grow the region and retry.

Checkpoint conditions include 75% occupancy or 1000 appends since the last checkpoint. Batch mode can change synchronization and automatic checkpoint behavior, exchanging fewer synchronization operations for throughput. Ending the batch must complete the flush.

### A commit does more than append text

The logical sequence is to record mutations, commit content and indexes, produce consistent TOC/footer information, update metadata and advance the WAL checkpoint. `commit()` and recovery coordinate these states.

**Append-oriented frame content does not mean that every byte in the container is append-only forever.**

`rewrite_toc_footer()` includes these actual operations, with footer construction and boundary calculations omitted:

```rust
self.file.seek(SeekFrom::Start(footer_offset))?;
self.file.write_all(&toc_bytes)?;
// Construct and encode the new CommitFooter
self.file.write_all(&encoded_footer)?;
// Compute length while retaining at least the Header + WAL region
self.file.set_len(final_len)?;
self.file.sync_all()?;
```

It writes the new TOC and footer at a specified position and adjusts file length. Each commit therefore need not retain another permanent copy of the old TOC. An MV2 file is not automatically a Git repository of every previous physical file image.

Deleted or superseded content can leave unused space. Vacuum reorganizes live data, updates locations and reclaims space. That is distinct from rewriting the tail directory during an ordinary commit.

### Single-file portability and crash safety

A single container reduces the risk of copying content while forgetting a separate index or journal. Crash recovery uses valid commits, WAL records and checksums to determine recoverable state. Backups should still be taken at a stable commit point rather than treating a file being actively written as a consistent snapshot.

## 10. Search & Retrieval: from candidates to evidence

![Lexical and semantic candidates are combined and filtered, then frame evidence is read and passed to the LLM by the application](/img/posts/memvid-architecture/retrieval-flow.svg)

*A logical retrieval flow. Enabled indexes, filtering and ranking depend on the entry point, options and compiled features.*

### Hybrid: combining candidates, not a fixed half-and-half split

Lexical and vector scores have different scales. One way to combine their outputs is by rank. The public Core's `ask.rs` contains [`fuse_hits_rrf()`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/ask.rs), which accumulates contributions from each candidate list:

<div class="math-display">
\[
\operatorname{RRF}(d)=\sum_{j:\,d\in L_j}\frac{1}{c+\operatorname{rank}_j(d)}.
\]
</div>

A frame ranking highly in multiple lists gains more contributions. `c` smooths rank differences. Combining by `frame_id` also prevents the same record occupying several result slots.

This does not establish that every CLI and SDK query executes only that function. Other paths perform semantic reordering, filtering and fallbacks; a CLI option does not necessarily map directly to one Core candidate budget.

In particular, `--top-k 10` configures the final result count. **It does not imply five BM25 hits plus five vector hits.** Candidate budgets, fused candidate counts and output counts are separate stages.

Adaptive Retrieval may shorten a list based on its score distribution. `--no-adaptive` is useful when inspecting a fixed result count or diagnosing omissions. It disables adaptive cutoff; it does not turn an irrelevant neighbor into factual evidence.

## 11. Agent integration: who decides how memory is used?

Agents still need a policy for selecting durable facts, deciding when to retrieve, handling corrections and determining which results belong in the current task.

A practical arrangement separates instructions, editable sources and search artifacts:

```text
AGENTS.md       When to recall, when to write, how to resolve conflicts
notes/*.md      Human-readable facts and project records
knowledge.mv2   Persistent memory and indexes built from those sources
```

When a user corrects a durable preference, update the corresponding source note, replace the memory record through a stable URI and regenerate its vector with the same embedding model. Test both exact terms and paraphrased questions to check that the outdated record no longer appears as active evidence.

Keeping sources also makes failures manageable. Indexes can be rebuilt, and the agent can read an entire source rather than rely solely on a truncated snippet.

High similarity means relevance, not correctness or user confirmation. Retrieved text can contain prompt injection and should not acquire execution authority merely because it was retrieved. Personal and company information also requires explicit decisions about collection, authorization, retention and deletion.

A local memory file does not make an entire workflow offline. Embedding weights, runtimes and model caches usually live outside the container. Passing retrieved context to a cloud LLM still sends that selected information to the cloud service.

## 12. An offline retrieval example

Prepare two synthetic documents, without real personal data:

```text
api.md
Project Atlas exposes its HTTP API with FastAPI.
The service is written in Python. Its health-check endpoint is /health.

deployment.md
Project Atlas runs in Docker Compose on a single Linux server.
It does not use Kubernetes.
```

Create a memory in a new directory and ingest both files. These commands assume the CLI is installed and BGE-small is already cached locally:

```bash
MEMVID_OFFLINE=1 memvid create atlas.mv2

MEMVID_OFFLINE=1 memvid put atlas.mv2 \
  --input api.md --uri memvid://demo/atlas/api \
  --title "Atlas API" \
  --embedding --embedding-model bge-small --no-enrich --json

MEMVID_OFFLINE=1 memvid put atlas.mv2 \
  --input deployment.md --uri memvid://demo/atlas/deployment \
  --title "Atlas Deployment" \
  --embedding --embedding-model bge-small --no-enrich --json
```

`--embedding` explicitly requests vectors. `--no-enrich` disables automatic rules-based enrichment. Check `embedding.enabled` and `runtime_dimension` in the ingestion result to confirm that 384-dimensional embeddings were actually generated.

For an exact framework name:

```bash
MEMVID_OFFLINE=1 memvid find atlas.mv2 \
  --query "FastAPI" --mode lex \
  --no-adaptive --top-k 2 --json
```

For a paraphrase:

```bash
MEMVID_OFFLINE=1 memvid find atlas.mv2 \
  --query "What does Atlas use to serve web requests?" \
  --mode sem --embedding-model bge-small \
  --no-adaptive --top-k 2 --snippet-chars 300 --json
```

In a local CLI 2.0.140 test, the latter query ranked **Atlas API** first and returned text containing FastAPI. Results also include `frame_id`, URI, score and a snippet, allowing the application to inspect evidence before constructing an answer. This two-document test checks the workflow; it is not an accuracy benchmark.

`find` retrieves evidence. `ask` adds answer generation after retrieval; external service use depends on the selected model and configuration. A strictly offline deployment needs the whole call chain checked, not only the location of its MV2 file.

## 13. Design tradeoffs

**One file simplifies deployment and migration while concentrating responsibility for the data.** There is no separate vector service to run, but permissions, backup, verification and recovery still matter. Local file locks cannot coordinate writers across machines.

**Co-locating content and indexes reduces external synchronization points but makes maintenance a container-level operation.** WAL growth, index rebuilding and vacuum can move many bytes. Batch sizes, commit frequency and backup windows should reflect the actual collection.

**Indexes provide access paths, not a policy for long-term relevance.** Deduplication, forgetting, conflicts and task relevance still need application decisions. A time index does not automatically establish event causality.

**Deterministic encoding and verification help testing and debugging.** With input order, timestamps and build configuration fixed, serialized outputs can be compared for unexpected changes. This concerns storage and construction, not a guarantee of identical LLM answers. Generated timestamps, different models or a different ingestion order also change the input conditions.

Memvid is a useful fit when a local or embedded application needs a portable, searchable and attributable knowledge asset. Large tenant populations, heavy concurrent writes, cross-region replication and distributed transactions require evaluating service-based search or database designs as well.

### References

- [Memvid Architecture Overview](https://docs.memvid.com/architecture/overview)
- [Frame Architecture](https://docs.memvid.com/introduction/frames) and [Memory Architecture](https://docs.memvid.com/concepts/memory-architecture)
- [Indices and Tracks](https://docs.memvid.com/concepts/indexes-and-tracks) · [Time Index Track](https://docs.memvid.com/file-format/time-index-track)
- [Embedded WAL](https://docs.memvid.com/file-format/wal) · [Search & Ask](https://docs.memvid.com/cli/search-and-ask)
- [Pinned Memvid Rust source](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813), Apache-2.0. Source excerpts are abridged; diagrams are logical reconstructions.
