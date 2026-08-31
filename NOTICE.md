# NOTICE — third-party content and attribution

## DABstep

This repository contains apo evaluations derived from
[DABstep](https://huggingface.co/datasets/adyen/DABstep) (Data Agent Benchmark
for Multi-step Reasoning), © Adyen and The HuggingFace Team, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Dataset revision pinned in `scripts/fetch-data.sh`
  (commit `f6980beb8908f6dbb5056924f020fa49a0bf946b`, also recorded as
  `benchmark_task_revision` in each task's metadata).
- Task questions, guidelines, and ground-truth answers under
  `tasks/dabstep/` are derived from the DABstep dev split. The data bundle
  itself is fetched at runtime into `data/dabstep/` and never committed.
- Paper: [DABstep: Data Agent Benchmark for Multi-step Reasoning](https://arxiv.org/abs/2504.06287).

With the CC BY 4.0 license in mind: this repository redistributes adapted task
material with attribution and a pointer to the license. If you extend this
repository with tasks from other benchmarks, add an entry here with the
license and the pinned revision before committing.
