# Fine-tuning (optional bonus)

Retrieval makes Aria's answers **grounded**. Fine-tuning makes them sound like
the house. This folder is the fine-tuning half of that story.

It is deliberately optional and runs **where compute exists** — a GPU and the
Python ML stack — because the graded app must stay at ₹0 and offline.

## The three layers

| Layer | What it does | Where |
| --- | --- | --- |
| Knowledge base (RAG) | Decides *what is true* and cites it | `src/lib/server/rag` |
| Runtime guardrails | Reject any reply that invents or reverses a fact | `src/lib/server/agent.ts` |
| Fine-tuning (this folder) | Teaches the model *how to say it* | `scripts/finetune` |

## 1. Export a dataset

Sign in to `/admin`, open **Fine-tuning dataset**, and click **Export dataset**.
That downloads `aura-support-sft.jsonl` in chat format:

```json
{"messages":[{"role":"system","content":"…"},{"role":"user","content":"…"},{"role":"assistant","content":"…"}]}
```

Only examples the product *already trusts* are exported:

- resolved sessions (`resolution = RESOLVED`) whose intent is in scope and that
  have a captured final reply, and
- approved knowledge entries.

Rejected drafts, escalations and unresolved calls are never used as targets, so
you never train the model to imitate a bad answer.

## 2. Train a LoRA adapter

```bash
pip install "unsloth[cu121]" trl peft transformers datasets accelerate bitsandbytes

python scripts/finetune/train_lora.py \
  --dataset aura-support-sft.jsonl \
  --base-model unsloth/Llama-3.2-3B-Instruct \
  --output-dir scripts/finetune/out \
  --merge
```

This trains a small LoRA adapter on top of a 3B instruct model and (with
`--merge`) writes a merged checkpoint suitable for serving.

> A few hundred clean examples already move tone noticeably; a few thousand
> across intents and locales make it consistent.

## 3. Serve it locally

```bash
ollama create aura-support -f scripts/finetune/Modelfile
ollama run aura-support "where is ORD-101"
```

Then point the app at the tuned model (and restart the server, since env is read
at module load):

```bash
export OLLAMA_MODEL=aura-support
export AURA_ENABLE_LOCAL_AI=true
```

The runtime agent automatically uses it for loose ends — but the deterministic
policy engine and the guardrails still decide and verify every fact, so a
fine-tuned model can never override policy.

## Why fine-tune at all if there's RAG?

RAG changes the *facts*; fine-tuning changes the *style*. They compose: retrieval
feeds verified passages into the prompt, the tuned model renders them in the
brand voice, and the guardrail proves nothing was invented.
