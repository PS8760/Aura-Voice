"use server";

import { revalidatePath } from "next/cache";

import { toLocale } from "@/lib/domain/locale";
import { getRepositories } from "@/lib/server/db/repositories";
import { getAppUser } from "@/lib/server/userContext";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function ready() {
  const user = await getAppUser();
  if (!user) return null;
  const repo = await getRepositories();
  await repo.profiles.upsert(user.userId, {
    email: user.email,
    name: user.name || "Customer",
  });
  return { user, repo };
}

export async function updateProfileAction(form: FormData): Promise<void> {
  const ctx = await ready();
  if (!ctx) return;
  const { user, repo } = ctx;
  await repo.profiles.upsert(user.userId, {
    email: user.email,
    name: field(form, "name") || user.name || "Customer",
    phone: field(form, "phone"),
    preferredLocale: toLocale(field(form, "preferredLocale")),
  });
  revalidatePath("/profile");
}

export async function addAddressAction(form: FormData): Promise<void> {
  const ctx = await ready();
  if (!ctx) return;
  const { user, repo } = ctx;
  await repo.profiles.addAddress(user.userId, {
    label: field(form, "label") || "Home",
    line1: field(form, "line1"),
    line2: field(form, "line2"),
    city: field(form, "city"),
    state: field(form, "state"),
    pincode: field(form, "pincode"),
    phone: field(form, "phone"),
    isDefault: field(form, "isDefault") === "on",
  });
  revalidatePath("/profile");
}

export async function updateAddressAction(form: FormData): Promise<void> {
  const ctx = await ready();
  if (!ctx) return;
  const { user, repo } = ctx;
  const addressId = field(form, "addressId");
  if (!addressId) return;
  await repo.profiles.updateAddress(user.userId, addressId, {
    label: field(form, "label") || "Home",
    line1: field(form, "line1"),
    line2: field(form, "line2"),
    city: field(form, "city"),
    state: field(form, "state"),
    pincode: field(form, "pincode"),
    phone: field(form, "phone"),
    isDefault: field(form, "isDefault") === "on",
  });
  revalidatePath("/profile");
}

export async function deleteAddressAction(form: FormData): Promise<void> {
  const ctx = await ready();
  if (!ctx) return;
  const { user, repo } = ctx;
  const addressId = field(form, "addressId");
  if (!addressId) return;
  await repo.profiles.removeAddress(user.userId, addressId);
  revalidatePath("/profile");
}
