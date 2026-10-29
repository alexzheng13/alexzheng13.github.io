---
title: "Memvid：单文件 AI 记忆系统"
date: 2026-10-29
slug: "memvid-memory-architecture"
description: "介绍 Memvid v2 的用途与架构：mv2 文件、Frame、嵌入式 WAL、TOC、全文与向量检索，以及它在 Agent 长期记忆中的位置。结合 Rust 源码解释追加写入、崩溃恢复、混合检索与设计取舍。"
categories: [AI Agents]
tags: [Memvid, Agent Memory, RAG, Storage, Rust, Vector Search]
toc: true
mathjax: true
mathjaxEnableSingleDollar: true
---

Memvid 是面向 AI Agent 的单文件记忆系统。它把资料和检索索引保存在本地，让 Agent 在新的会话中查回之前存下的信息。

<!--more-->

项目地址：[memvid/memvid](https://github.com/memvid/memvid) · Commit：[`e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813`](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813)

## 1. Memvid 是什么，解决什么问题？

Memvid 是一个面向 AI 应用的持久化记忆与检索组件。它的核心对象是 memory 文件，例如 `knowledge.mv2`。把文档写进去之后，可以按关键词、语义或时间找到相关内容，结果带有来源标识与元数据。

例如，一个编程 Agent 已经处理过项目的部署问题。下次再问“这个服务用什么部署，发布后要检查哪个接口”，应用可以先检索相关记录，将部署方式和健康检查地址放进上下文，不必重新上传所有文件。

常见用途包括：

- **项目知识库**：保存架构说明、接口约定、排障记录和技术决策。
- **个人助手记忆**：保存用户确认的偏好和计划，并在相关任务中检索。
- **离线资料检索**：在不运行独立检索服务的环境中查询本地文档。
- **Agent 调试**：查看写入顺序、检索来源，以及某个历史范围内可见的记录。

Memvid 不改变基础模型的参数。它返回的是外部证据，模型仍通过上下文使用这些信息。LoRA 属于参数适配，Memvid 属于外部存储与检索，两者可以配合。

在 RAG 系统中，它可以承担内容存储和检索这一层；文档选择、权限、提示词、生成和评估仍由应用组织。Agentic RAG 进一步让 Agent 决定何时查询、怎样改写问题、是否继续搜索，Memvid 可以成为它调用的检索工具。

## 2. 项目目录结构

先看源码的组织方式。下面保留与存储和检索主线相关的目录与文件：

```text
memvid/
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── memvid/           # 写入、查询、提交与恢复
│   ├── types/            # Frame、TOC、查询参数等数据结构
│   ├── io/               # Header、WAL、时间索引的读写
│   ├── lex.rs            # 全文索引
│   ├── vec.rs            # 向量存储与检索
│   ├── vec_pq.rs
│   ├── text_embed.rs
│   ├── toc.rs
│   └── footer.rs
├── tests/
├── benches/
└── examples/
```

这个仓库的 Rust crate 是 `memvid-core`。其中，`src/` 是实现代码；用户导入的文档和生成的记忆文件不属于源码目录。

阅读时可以从 [`src/lib.rs`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/lib.rs) 看对外导出的接口，再进入 [`src/memvid/`](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid)：

- `lifecycle.rs`：文件创建、打开和生命周期。
- `mutation.rs`：写入变更、提交和目录更新。
- `search/` 与 `ask.rs`：候选检索、排序和回答流程。
- `frame.rs` 与 `chunks.rs`：读取记录及处理文档片段。

例如，Frame 的字段定义在 `types/frame.rs`，WAL 的读写实现在 `io/wal.rs`，提交时怎样使用它们则要看 `memvid/mutation.rs`。数据结构、底层读写和业务操作分开，便于沿一次写入或查询追踪代码。

## 3. Architecture Overview：整体架构

从应用看，一次使用可以分成两条路径：

```text
写入：文档 / 文本 → 提取与切分 → Frame → 内容和索引 → 提交到 .mv2
查询：问题 → 关键词 / 向量 / 时间检索 → Frame → 原文证据 → 应用或 LLM
```

`.mv2` 是 Memvid 的二进制记忆文件，不是 Markdown 文本，也不是模型权重。它同时承载内容、索引和用于定位及恢复的元数据。CLI 和 SDK 是访问入口，Rust Core 负责底层存储与查询；LLM 在需要生成回答时使用检索结果。

[官方架构概览](https://docs.memvid.com/architecture/overview)围绕单文件、崩溃恢复、确定性与检索性能展开。单文件让内容和索引可以一起迁移；WAL 与校验信息处理写入中断；固定输入条件下的确定性便于复现存储结果。这些机制各有职责，不能只靠“所有东西放在一起”就同时解决。

还要区分：记忆数据保存在一个文件中，不等于程序、Embedding 模型和 LLM 也打包进了这个文件。

## 4. Memory Architecture：记忆怎样组织和流转？

[Memory Architecture](https://docs.memvid.com/concepts/memory-architecture)关注整个 memory 的生命周期：文件怎样被打开，新增记录怎样提交，查询怎样找到内容。

### .mv2 内部的几层结构

![Memvid 单文件内部包含 Header、Embedded WAL、Frame 内容、索引、TOC 与提交 Footer](/img/posts/memvid-architecture/mv2-layout.svg)

图中是逻辑分层，不按实际字节大小绘制：

| 层 | 保存什么 | 负责什么 |
| --- | --- | --- |
| Header | 格式标识、版本与关键偏移 | 打开文件时定位其他结构 |
| Embedded WAL | 待处理变更与检查点进度 | 支持中断后的恢复 |
| 内容区域 | 文本、二进制内容等 payload | 保存可回读的资料 |
| 索引与 Tracks | 关键词、向量、时间等访问结构 | 根据不同条件找到记录 |
| TOC + Footer | 描述符、位置、校验与提交信息 | 将这些区域关联成一致的状态 |

### 写入与读取的生命周期

写入时，应用先提供内容和元数据。导入流程可能提取文本、切分文档并生成 Embedding，然后建立 Frame 及相应索引。变更由 WAL 和提交过程协调，最终形成可恢复的文件状态。

查询时，Core 根据 Header、TOC 等信息定位索引，查询得到 Frame 标识后再读取文本或 payload。遇到非正常退出，还需要检查有效提交信息及 WAL，处理可恢复的变更。

这意味着一条检索结果不只是相似度分数：它应当能够回到某条记录、某份来源及对应内容。Frame 定义这个记录单位，索引提供访问路径，文件布局提供它们在磁盘上的定位方式。

### 文件锁与并发

并发方面，源码使用操作系统文件锁，支持共享读锁与排他写锁。它不是任意数量的写入者都能同时修改的分布式数据库。多个 Agent 共同写记忆时，应用应串行化写入或统一交给一个写入服务。

## 5. Frame Architecture：一条记忆的结构

Frame 是文件中的记录单位。可以先把它理解为“内容的位置 + 来源与时间 + 状态”，再看它怎样支持更新和检索。

### Frame 与 Payload：描述信息和内容字节分开

Frame 是记忆记录的基本单位，但在代码里，Frame 结构本身并不直接塞进全部正文。[`Frame`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/frame.rs) 的字段包括：

```rust
// 摘录 Frame 的部分字段
pub id: FrameId,
pub timestamp: i64,
pub payload_offset: u64,
pub payload_length: u64,
pub checksum: [u8; 32],
pub uri: Option<String>,
pub title: Option<String>,
pub search_text: Option<String>,
```

Payload 保存内容字节，可以采用 Plain 或 Zstd 编码；Frame 描述符记录它的位置、长度和校验值，还可以包含提取出的 `search_text`。因此，查看文本记录时，有些内容出现在 `frame.search_text`，不一定出现在一个统一的 `content` 字段里。

`frame_id` 标识文件内的具体记录；URI 则可以作为应用侧较稳定的文档标识。同一个主题更新后，应用可以继续使用相同 URI，让新记录替代旧记录。一次导入也不一定只产生一个 Frame：长文档可能包含父文档与多个 chunk，具体取决于导入接口和切分策略。

### 为什么用 Frame，而不是只保存 Embedding？

向量检索返回的首先是相似记录的位置。真正回答问题时，还需要原文、来源、时间和更新状态。只保存向量，无法还原“当时具体说了什么”。

Frame 把这些信息绑定到同一条记录，使检索命中可以回到实际证据。Embedding 只是这条记录的一种检索表示，与正文一起保存在同一个文件，但不必物理嵌在每个 Frame 描述符中。

这种设计有几个直接影响。

**内容与索引可以使用不同的组织方式。** 原文适合压缩保存；全文检索需要倒排索引；语义检索需要向量和搜索结构；时间检索需要按时间排序。把它们装进同一个容器，不代表要把它们强行编码成同一种数据。

**更新可以保留来源关系。** Frame 中有 `status`、`supersedes`、`superseded_by` 等字段，用来表达生效、替代和删除。内容的追加式写入，与元数据状态的更新是两个层面。

**切分仍然需要设计。** 过大的 chunk 容易把多个主题混在一起；过小则会丢掉上下文。对会议记录可以按议题，对代码可以按函数或模块，对个人偏好可以按确认的独立事实组织。Frame 没有消除 chunking 问题，而是提供了保存 chunk 及其关联信息的位置。

## 6. Indices and Tracks：不同的检索入口

索引回答“怎样更快找到记录”，Track 则可以保存按用途组织的数据。它们与 Frame 关联，但不需要把每种访问结构都塞进 Frame 本身。

### Lexical Index：按词找到记录

全文索引主要解决精确术语问题，例如错误码 `E_LOCKED`、函数名 `rewrite_toc_footer`、项目名和日期。Tantivy 提供倒排索引和 BM25 排序，候选最终映射回 Frame。

假设两条记录分别写着“Atlas uses FastAPI”和“Atlas uses Docker Compose”，查询 `FastAPI` 时，倒排索引可以直接定位包含这个词的记录，不用逐条读取所有正文。

分词方式会影响结果。英文缩写、代码标识符与中文短语的表现并不相同；没有关键词命中，也不能立即判断资料不存在。

### Vector Index：按语义找相关记录

语义检索先把问题变成向量，再找相近的文档或 chunk 向量。例如资料写着“exposes its HTTP API with FastAPI”，问题问“用什么处理 Web 请求”，即使没有完全相同的词，也可能找到这条记录。

源码的 [`VecDocument`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/vec.rs) 直接体现了向量与 Frame 的关联：

```rust
pub struct VecDocument {
    pub frame_id: FrameId,
    pub embedding: Vec<f32>,
}
```

向量及其索引结构序列化进文件的向量区域。实现同时有未压缩向量、PQ 和 HNSW 等路径；小规模数据可以直接扫描向量，达到阈值且启用相应功能后，构建器才选择 HNSW。

BGE-small 的一个向量有 384 维。只计算 FP32 数值，需要 `384 × 4 = 1536 bytes`，还不包括图结构、元数据和文件开销。PQ 压缩的是向量表示，不能把它的压缩倍数直接套到整个 memory 文件上。

更换 Embedding 模型时，还需要重建对应的文档向量。即使两个模型都输出 384 维，它们也可能处在不同的向量空间，不能混用。

### 时间索引与可选 Tracks

Time Index 按时间定位 Frame，具体结构在第 8 节展开。关键词、向量和时间三个入口可以配合使用，例如先限制到上周，再搜索与部署有关的记录。

除了这三类索引，TOC 还可以引用结构化 MemoryCards、Logic Mesh 关系图和 replay track。它们分别用于保存抽取出的事实、实体关系和回放信息，需要相应的处理或功能支持，不会因为创建了 `.mv2` 文件就自动拥有全部内容。

## 7. File Layout：字节怎样落到文件里？

前面介绍的是逻辑对象。落实到磁盘，程序需要知道每个区域从哪个字节开始、占多少字节，以及怎样验证它。Header、TOC 与 Footer 负责这些定位和校验信息。

### Header：先找到文件里的目录

Header 固定占用 4096 bytes，主要回答“这是什么格式”和“其他结构在哪里”。[HeaderCodec](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/header.rs) 会按固定偏移读写这些字段：

| 字段 | 作用 |
| --- | --- |
| `magic` | 文件标识，源码为 `MV2\0` |
| `version` / spec 字段 | 识别文件格式版本，不是记忆内容的历史版本 |
| `footer_offset` | 定位当前 TOC 的起始位置 |
| `wal_offset` / `wal_size` | 定位嵌入式 WAL 的区域 |
| `wal_checkpoint_pos` / `wal_sequence` | 记录 WAL 的检查点位置和序列进度 |
| `toc_checksum` | 检查目录元数据的完整性 |

`Offset` 是相对文件开头的字节位置。它让读取器能够直接跳到目标区域，而不是从头扫描所有正文。

### TOC 与 Footer：保存定位关系和提交信息

TOC 是 Table of Contents，即文件内部的目录元数据。它不是被导入的 Markdown 文件，也不是文档目录标题的集合。

[`Toc`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/manifest.rs) 保存 Frame 描述符、索引 manifest、segment catalog，以及其他可选 track 的引用。索引 manifest 会记录相关字节区域的 offset、length、checksum 等信息。

例如，要读取 Frame 42，程序先找到该记录的描述符，再根据 `payload_offset` 和 `payload_length` 读取对应字节；需要解压时，再按记录的编码还原内容。

TOC 后面还有一个提交 Footer。[`CommitFooter`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/footer.rs) 包含标识 `MV2FOOT!`、TOC 长度、BLAKE3 哈希和 generation。恢复时可以从文件尾部反向寻找有效 Footer，并验证前面的 TOC。

这里的校验解决的是损坏检测。BLAKE3 校验值不等于加密，也不能单独提供访问控制。

## 8. Time Index Track：按时间访问记忆

问题如果是“上周新增了哪些部署决策”，时间就是筛选条件。[时间索引源码](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/time_index.rs) 的记录是：

```rust
pub struct TimeIndexEntry {
    pub timestamp: i64,
    pub frame_id: u64,
}
```

写入前会按 `(timestamp, frame_id)` 排序。时间索引帮助定位范围内的 Frame，之后仍可以结合全文或语义相关性排序。记录写入时间与正文中提到的事件时间也要区分，不能把所有日期都当成同一种时间含义。

## 9. Embedded WAL：写入、提交与恢复

写入一条记忆会同时影响内容、索引和目录。如果更新到一半程序退出，文件不能把半套新索引与旧内容混成一个已完成状态。嵌入式 WAL 用于记录待提交的变更和恢复进度。

### WAL 的容量与已使用空间不同

WAL 的预留容量是一个字节区域；pending bytes 才表示当前未处理记录占了多少空间。提交并推进检查点后，这个区域可以继续使用，不是每次操作都永久向其中增加一段历史。

概览文档列出了 1、4、16、64 MB 等容量档位；当前源码还定义了小型文件起步用的 **64 KiB** WAL，并包含按需扩容逻辑。因此，不能把文档中的档位理解成所有新文件必然预留至少 1 MB。

[`EmbeddedWal`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/io/wal.rs) 维护写指针、检查点、pending bytes 和序列号。记录超过空间时不能覆盖未提交数据；[`append_wal_entry()`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/mutation.rs) 会处理扩容后重试。

源码的检查点条件包括 WAL 占用达到 75%，或检查点后追加次数达到 1000。批量模式可以调整同步与自动检查点行为，用较少的同步操作换取吞吐；也需要在结束批次时完成 flush。

### 提交时不只是追加正文

逻辑上的过程是：记录变更，提交内容与索引，生成一致的 TOC/Footer，更新相关元数据并推进 WAL 检查点。`commit()` 与恢复路径负责协调这些状态。

一个容易误解的地方是：**Frame 内容采用追加式组织，不意味着文件里所有字节都永远只能追加。**

`rewrite_toc_footer()` 中有下面这些实际写入操作，中间省略了 Footer 的构造和边界计算：

```rust
self.file.seek(SeekFrom::Start(footer_offset))?;
self.file.write_all(&toc_bytes)?;
// 构造并编码新的 CommitFooter
self.file.write_all(&encoded_footer)?;
// 计算新文件长度，至少保留 Header + WAL 区域
self.file.set_len(final_len)?;
self.file.sync_all()?;
```

它在指定位置写入新目录和 Footer，并调整文件长度。所以不能假设每次提交都会永久累积一份旧 TOC，也不能把 `.mv2` 当成自动保留每一版物理文件快照的 Git 仓库。

删除或替代过的内容可能留下不再需要的空间，vacuum 则用于整理有效数据、更新位置并回收空间。它与正常提交时重写尾部目录不是同一操作。

### 单文件和崩溃安全，各自保证什么？

单文件减少了“正文复制了，但索引或日志漏拷了”的风险。崩溃恢复则依靠有效提交信息、WAL 记录与校验判断可恢复状态。复制或备份仍应选择稳定提交点，避免直接把正在写入的文件当成一致快照。

## 10. Search & Retrieval：从候选到原文证据

![关键词与向量候选经过融合和过滤，定位 Frame 后返回原文，再由应用交给 LLM](/img/posts/memvid-architecture/retrieval-flow.svg)

*这是检索的逻辑流程。具体启用哪些索引、过滤和排序步骤，由查询入口、参数及编译功能决定。*

### Hybrid：合并候选，不是固定各取一半

关键词排名与向量分数的尺度不同，直接相加往往不合适。公开 Core 的 `ask.rs` 中有 [`fuse_hits_rrf()`](https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/ask.rs)，按各候选列表中的名次累积分数：

<div class="math-display">
\[
\operatorname{RRF}(d)=\sum_{j:\,d\in L_j}\frac{1}{c+\operatorname{rank}_j(d)}.
\]
</div>

同一 Frame 在多个列表靠前，就能获得更多贡献。`c` 用于平滑名次差异，按 `frame_id` 合并还可以避免同一个结果重复占位。

但不能据此假设所有 CLI 和 SDK 查询都只执行这一段函数。代码还有语义重排、过滤和回退路径，CLI 参数也不等于 Core 中某个内部候选数量。

尤其是 `--top-k 10`，表示最终返回数量的配置，**不意味着 BM25 和向量各搜 5 条**。候选召回预算、融合后的数量与最终输出数量是不同层次。

Adaptive Retrieval 还可能根据分数分布缩短结果列表。检查固定候选数或排查遗漏时，可以用 `--no-adaptive`；它关闭的是自适应截断，不会把一个低相关结果变成事实证据。

## 11. 接入 Agent：谁决定怎样使用记忆？

Memvid 提供存储与检索能力，Agent 还需要一套使用规则：哪些事实值得写入，什么时候检索，旧记录怎样被修正，哪些结果允许放进当前任务。

一个简单的工程安排是把规则、源资料和检索产物分开：

```text
AGENTS.md       何时查记忆、何时写入、怎样处理冲突
notes/*.md      可阅读、可编辑的事实或项目记录
knowledge.mv2   从这些资料建立的持久化记忆与索引
```

例如，用户纠正了某项长期偏好，先修改对应源笔记，再以稳定 URI 更新记录，并使用相同 Embedding 模型重建其向量。随后同时测试关键词查询和换一种说法的语义查询，确认旧信息没有继续作为有效结果出现。

这也便于处理失败：源笔记仍在，索引可以重新构建；检索结果包含来源，Agent 可以回读全文，而不是只依赖截断的 snippet。

相似度高只表示“相关”，不表示“正确”或“得到用户确认”。外部记忆中的指令同样可能包含提示注入，不能因为被检索出来就自动拥有执行权限。涉及个人或企业数据，还需要按来源控制采集、授权、保留与删除。

“本地 memory 文件”也不等于整个工作流天然离线：Embedding 模型、运行时和模型缓存通常在文件之外；如果最后调用云端 LLM，选中的上下文仍会发送给云服务。

## 12. 一个离线检索例子

准备两份示例文档，内容不涉及真实个人数据：

```text
api.md
Project Atlas exposes its HTTP API with FastAPI.
The service is written in Python. Its health-check endpoint is /health.

deployment.md
Project Atlas runs in Docker Compose on a single Linux server.
It does not use Kubernetes.
```

在一个新目录创建 memory，再导入两份文件。下面假设 `memvid` 已安装，BGE-small 已下载到本地缓存：

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

`--embedding` 明确要求生成向量，`--no-enrich` 关闭自动规则 enrichment。导入结果中的 `embedding.enabled` 和 `runtime_dimension` 可以确认是否真正生成了 384 维向量，不能只根据命令成功就认定语义索引已建立。

精确找框架名：

```bash
MEMVID_OFFLINE=1 memvid find atlas.mv2 \
  --query "FastAPI" --mode lex \
  --no-adaptive --top-k 2 --json
```

换一种说法查询：

```bash
MEMVID_OFFLINE=1 memvid find atlas.mv2 \
  --query "What does Atlas use to serve web requests?" \
  --mode sem --embedding-model bge-small \
  --no-adaptive --top-k 2 --snippet-chars 300 --json
```

在 CLI 2.0.140 的本地测试中，后一条查询把 **Atlas API** 排在第一位，返回文本包含 FastAPI。结果中同时提供 `frame_id`、URI、分数和 snippet，应用可以继续读取来源，再组织回答。这个两文档实验用于确认流程，不是检索准确率 benchmark。

`find` 到这里仍然是在检索证据。`ask` 则在检索之后接上回答生成，是否访问外部服务取决于选择的模型和配置。需要严格离线时，应检查整条调用链，而不只检查 `.mv2` 放在哪里。

## 13. 设计上的取舍

**单文件降低部署和迁移复杂度，也集中了承载内容的责任。** 不需要运行单独的向量检索服务，但仍要做好文件权限、备份、校验和恢复。多个机器同时写入时，单机文件锁也无法替代分布式协调。

**内容和索引放在一起，减少了外部同步点，也让维护操作涉及整个容器。** 扩容、重建索引和 vacuum 可能移动大量字节，因此批量导入、提交频率和备份窗口需要按实际数据量选择。

**索引提供不同的访问方式，却不负责判断信息的长期价值。** 去重、遗忘、冲突处理和任务相关性仍要在应用层定义；有了时间索引，也不意味着系统自动理解事件因果。

**确定性的编码与校验有利于测试和排障。** 固定输入顺序、时间戳与构建配置后，可以比较序列化结果，判断是否发生了意外变化。这个目标针对存储和构建过程，不表示上层 LLM 每次都会给出相同回答；自动生成的时间、不同模型或不同导入顺序也会改变输入条件。

适合它的场景，是本地或嵌入式应用需要一份可携带、可检索、可追溯的知识资产。若需求是大量租户、高并发写入、跨地域复制和严格的分布式事务，就应进一步评估服务化检索或数据库方案，而不是仅凭“一个文件”决定架构。

### 参考资料

- [Memvid Architecture Overview](https://docs.memvid.com/architecture/overview)
- [Frame Architecture](https://docs.memvid.com/introduction/frames) 与 [Memory Architecture](https://docs.memvid.com/concepts/memory-architecture)
- [Indices and Tracks](https://docs.memvid.com/concepts/indexes-and-tracks) · [Time Index Track](https://docs.memvid.com/file-format/time-index-track)
- [Embedded WAL](https://docs.memvid.com/file-format/wal) · [Search & Ask](https://docs.memvid.com/cli/search-and-ask)
- [Memvid Rust 源码，固定 commit](https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813)，Apache-2.0。文中的源码片段作了节选，图示为逻辑结构重绘。
