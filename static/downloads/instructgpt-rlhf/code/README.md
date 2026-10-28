# InstructGPT-style RLHF: source snapshot

Source: Hands-On Modern RL, WalkingLabs / Sanbu.
Release: v0.2.1.
Commit: 051b2ff0210c718091692d37ee26d08613ad0be8.
https://github.com/walkinglabs/hands-on-modern-rl/tree/051b2ff0210c718091692d37ee26d08613ad0be8/code/chapter08_rlhf

The three Python files and requirements.txt are unmodified copies supplied for
the accompanying source-reading article. They were byte-compared with the
release commit on 2026-10-28. LICENSE is copied from the same project.
This README is an addition; no upstream implementation fixes have been applied.
Source and this annotated bundle are distributed under CC BY-NC-SA 4.0.

Scope: SFT, preference reward modeling, and the simplified PPO demonstration.
The separate verl_gsm8k integration is intentionally not included.

## Important implementation limitations

- The starting checkpoint is already Qwen2.5-0.5B-Instruct, not a raw base model.
- SFT uses a plain text dataset; it does not implement assistant-only loss masks.
- The SFT dataset actually has 14 entries and the preference dataset 19 entries,
  despite different counts in some upstream comments/print statements.
- RM training updates its backbone, but saves only the scalar reward head.
  The PPO script reloads a fresh backbone, so this is not a complete RM reload.
- The PPO script is a custom demonstration, not TRL's PPOTrainer. It has no
  critic/GAE and normalizes sequence rewards across different prompts.
- compute_log_probs averages over prompt and response tokens. This is neither
  response-only token PPO nor the joint sequence log probability.
- KL is calculated under no_grad and converted to a Python float; adding it to
  the loss changes the logged number, but supplies no KL gradient. It is not
  used in the advantages either.
- A rollout batch receives one optimizer step, so (with deterministic forward
  passes) the clipping ratio starts at 1 and clipping is not exercised as it
  would be by repeated PPO updates. Generation uses temperature/top-p sampling,
  while the logged likelihoods use unmodified model logits.
- Handwritten examples and heuristic rewards are educational data, not verified
  gold labels or evidence that alignment quality improves.

The article shows explanatory corrections separately. Do not treat these files
as a faithful end-to-end reproduction of InstructGPT or a production recipe.
No full model training was performed when preparing the blog.

## Suggested isolated environment

From this directory, with a compatible Python / PyTorch environment:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install matplotlib
python sft_pipeline.py
python reward_model_training.py
python rlhf_ppo_train.py
```

matplotlib is imported by the last two scripts but missing from the upstream
requirements.txt. PyTorch installation depends on the host and accelerator;
CPU float32 can be very slow and these models need substantial memory.
The commands download model weights and run training only if you execute them.
The model checkpoint revision is not pinned by upstream.

## SHA-256 of original files

```text
942def1550619e86ece876a8b301b340d9af051c7c0876dec42d060a3b28dc49  sft_pipeline.py
3b1be4c7cfde9af98d412768bb325adec5735b6a5a2ce3e5621d2178369dcc9a  reward_model_training.py
b5716451f6207279cd1220ad26c417f60d35b472c16c5635c967248e39bf9357  rlhf_ppo_train.py
588e719aeb35e3e79aace650e78c9bd5a45e18d1ea642274a6045c8726dd4351  requirements.txt
```
