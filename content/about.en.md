---
title: "About"
type: "about"
slug: "about"
date: 2026-09-26
description: "About Bobo: distributed systems, AI systems, and engineering practice."
eyebrow: "SYSTEMS · AI · ENGINEERING"
heading: "I'm Bobo."
deck: "I care about how complex systems remain reliable and efficient in the real world, and how the same engineering mindset can help us build better AI systems."
---

<img class="about-portrait" src="/img/about/bobo-seaside.jpg" alt="Bobo walking toward the sea">

For more than five years, I worked on the core engineering and technical leadership of real-time collaborative documents at Kingsoft Office. My work spanned system and application architecture, core implementation, code review, performance engineering, and team delivery. I care about more than making a feature run: I want systems to remain understandable, reliable, and evolvable under high concurrency, long-lived connections, and failure.

Since September 2025, I have been pursuing an MSc in Computer Science at [Leiden University](https://www.universiteitleiden.nl/en/education/study-programmes/master/computer-science), with a focus on **Advanced Computing and Systems** and **Artificial Intelligence**. This has given me a research lens for ideas I first encountered in production: distributed systems and data-intensive applications, now extended to AI systems, agents, and model inference.

I enjoy taking complex technology apart through its data flow, concurrency model, network protocol, and performance limits, until I can explain, test, and implement it. This blog documents that process through notes on Go and systems programming, distributed systems, Transformers, AI agents, courses, and engineering lessons.

<div class="about-actions">
  <a class="about-action about-action-primary" href="/en/post/">Read the blog</a>
  <a class="about-action" href="https://github.com/alexzheng13" target="_blank" rel="noopener noreferrer">GitHub</a>
</div>

## Selected work

<div class="about-work-grid">
  <section class="about-work-item">
    <p class="about-work-label">REAL-TIME COLLABORATION</p>
    <h3>Collaborative documents</h3>
    <p>Worked on architecture, core systems, and backend performance, and received two invention patents covering collaborative-session scheduling and text-aware image compression.</p>
  </section>
  <section class="about-work-item">
    <p class="about-work-label">HIGH-PERFORMANCE NETWORKING</p>
    <h3>Go RPC at connection scale</h3>
    <p>Designed an event-driven network library with lock-free buffers and zero-copy techniques. At 300,000 long-lived connections, memory usage fell by 84%, while both average and P99 latency decreased by about 57%.</p>
  </section>
  <section class="about-work-item">
    <p class="about-work-label">DISTRIBUTED DATA</p>
    <h3>High-performance cloud K-V database</h3>
    <p>Built a Go and C++ K-V system with transactions, optimistic locking, consistent hashing, TCC, TTL, and multi-version management, while continuously improving its concurrent access path.</p>
  </section>
</div>

## Current interests

I am most interested in **systems for AI**: reliable runtimes for models and agents, efficient inference and retrieval, and evaluation and feedback loops that enable systems to improve. I also continue to explore distributed data systems, high-performance networking, Go, Rust, and cloud-native infrastructure.

I believe good engineering is not about accumulating complexity. It is about finding the right abstractions so that a system remains understandable as it grows. Writing is one way I turn fuzzy experience into knowledge I can examine and share.

## Experience

<div class="about-timeline">
  <div class="about-timeline-item">
    <div class="about-timeline-time">2025.09 — Present</div>
    <div>
      <h3>Leiden University</h3>
      <p>Computer Science MSc · Advanced Computing and Systems / Artificial Intelligence</p>
    </div>
  </div>
  <div class="about-timeline-item">
    <div class="about-timeline-time">5+ years</div>
    <div>
      <h3>Kingsoft Office</h3>
      <p>Real-time collaborative documents, distributed systems, and high-performance backend engineering, spanning architecture, core development, optimization, and technical leadership.</p>
    </div>
  </div>
  <div class="about-timeline-item">
    <div class="about-timeline-time">BSc</div>
    <div>
      <h3>Software Engineering</h3>
      <p>Started in software engineering and gradually moved deeper into concurrency, storage, networking, and large-scale data processing.</p>
    </div>
  </div>
</div>

If you are also working where systems and AI meet, you can find me on [GitHub](https://github.com/alexzheng13).
