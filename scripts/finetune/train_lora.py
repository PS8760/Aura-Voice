#!/usr/bin/env python3
"""
LoRA supervised fine-tuning for the Aura Voice CX support agent.

This is the "teach the house tone" half of the stack. Retrieval (see
`src/lib/server/rag`) decides *what is true*; this run teaches a small local
model *how to say it* — warm, concise, and only from verified facts.

It is intentionally optional: it needs a GPU and the ML stack below, neither of
which ships with the zero-cost web app. The dataset it consumes is produced by
the admin portal's "Export dataset" button (chat JSONL), which contains only
interactions that already passed the runtime guardrails.

Usage
-----
    pip install "unsloth[cu121]" trl peft transformers datasets accelerate bitsandbytes
    python scripts/finetune/train_lora.py \
        --dataset aura-support-sft.jsonl \
        --base-model unsloth/Llama-3.2-3B-Instruct \
        --output-dir scripts/finetune/out

Then serve it with Ollama using `scripts/finetune/Modelfile` and point the app at
it with OLLAMA_MODEL=<name>.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="LoRA SFT for the support agent.")
    parser.add_argument("--dataset", required=True, help="Path to chat JSONL.")
    parser.add_argument(
        "--base-model",
        default="unsloth/Llama-3.2-3B-Instruct",
        help="Base instruct model to adapt.",
    )
    parser.add_argument("--output-dir", default="scripts/finetune/out")
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--max-seq-length", type=int, default=2048)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Merge the adapter into the base weights after training.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        raise SystemExit(f"dataset not found: {dataset_path}")

    # Imported lazily so `--help` works without the GPU stack installed.
    from datasets import load_dataset
    from unsloth import FastLanguageModel
    from trl import SFTConfig, SFTTrainer

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        load_in_4bit=True,
        dtype=None,
    )
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.0,
        bias="none",
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )

    data = load_dataset("json", data_files=str(dataset_path), split="train")

    def to_text(example: dict) -> dict:
        # `tokenizer.apply_chat_template` renders the system/user/assistant turns
        # exactly the way the inference server (Ollama / vLLM) will at serve time.
        text = tokenizer.apply_chat_template(
            example["messages"], tokenize=False, add_generation_prompt=False
        )
        return {"text": text}

    data = data.map(to_text)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=data,
        args=SFTConfig(
            dataset_text_field="text",
            max_seq_length=args.max_seq_length,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            learning_rate=args.learning_rate,
            warmup_ratio=0.05,
            logging_steps=1,
            save_strategy="epoch",
            output_dir=args.output_dir,
            seed=args.seed,
            report_to="none",
        ),
    )
    trainer.train()

    trainer.save_model(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)
    print(f"Saved LoRA adapter to {args.output_dir}")

    if args.merge:
        merged_dir = str(Path(args.output_dir) / "merged")
        model.save_pretrained_merged(merged_dir, tokenizer)
        print(f"Saved merged model to {merged_dir}")


if __name__ == "__main__":
    main()
