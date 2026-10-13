"use server";

import { revalidatePath } from "next/cache";

import { toLocale } from "@/lib/domain/locale";
import type { Intent } from "@/lib/domain/types";
import { INTENTS } from "@/lib/domain/outcome";
import { getRepositories } from "@/lib/server/db/repositories";
import { runEvaluation, type EvalResult } from "@/lib/server/evaluation";
import {
  buildSftDataset,
  datasetStats,
  toJsonl,
  type DatasetStats,
} from "@/lib/server/rag";
import { getAppUser } from "@/lib/server/userContext";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseIntent(value: string): Intent | null {
  return (INTENTS as readonly string[]).includes(value) ? (value as Intent) : null;
}

async function adminReady() {
  const user = await getAppUser();
  if (!user || !user.isAdmin) return null;
  return { user, repo: await getRepositories() };
}

export async function createKnowledgeAction(form: FormData): Promise<void> {
  const ctx = await adminReady();
  if (!ctx) return;
  const { user, repo } = ctx;
  const question = field(form, "question");
  const answer = field(form, "answer");
  if (!question || !answer) return;
  await repo.knowledge.create({
    question,
    answer,
    intent: parseIntent(field(form, "intent")),
    locale: toLocale(field(form, "locale")),
    source: "admin",
    approved: true,
    createdBy: user.email,
  });
  revalidatePath("/admin");
}

export async function updateKnowledgeAction(form: FormData): Promise<void> {
  const ctx = await adminReady();
  if (!ctx) return;
  const { repo } = ctx;
  const id = field(form, "id");
  if (!id) return;
  await repo.knowledge.update(id, {
    question: field(form, "question"),
    answer: field(form, "answer"),
    intent: parseIntent(field(form, "intent")),
    locale: toLocale(field(form, "locale")),
  });
  revalidatePath("/admin");
}

export async function setKnowledgeApprovalAction(form: FormData): Promise<void> {
  const ctx = await adminReady();
  if (!ctx) return;
  const { repo } = ctx;
  const id = field(form, "id");
  if (!id) return;
  await repo.knowledge.approve(id, field(form, "approved") === "true");
  revalidatePath("/admin");
}

export async function deleteKnowledgeAction(form: FormData): Promise<void> {
  const ctx = await adminReady();
  if (!ctx) return;
  const { repo } = ctx;
  const id = field(form, "id");
  if (!id) return;
  await repo.knowledge.remove(id);
  revalidatePath("/admin");
}

export async function runEvaluationAction(): Promise<EvalResult[]> {
  const ctx = await adminReady();
  if (!ctx) return [];
  return runEvaluation();
}

export interface DatasetExport {
  jsonl: string;
  stats: DatasetStats;
}

/**
 * Build a supervised fine-tuning dataset from real, guardrail-passing sessions
 * and approved knowledge, and return it as chat JSONL for the LoRA pipeline in
 * `scripts/finetune`. Read-only: it never mutates the knowledge base.
 */
export async function exportDatasetAction(): Promise<DatasetExport | null> {
  const ctx = await adminReady();
  if (!ctx) return null;
  const [sessions, knowledge] = await Promise.all([
    ctx.repo.sessions.listAll(1000),
    ctx.repo.knowledge.list({ approvedOnly: true }),
  ]);
  const samples = buildSftDataset({
    sessions,
    knowledge,
    options: { brand: "Aura Skincare" },
  });
  return { jsonl: toJsonl(samples), stats: datasetStats(samples) };
}
