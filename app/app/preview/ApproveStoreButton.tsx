"use client";

import { useActionState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { approveStore } from "../actions";

export function ApproveStoreButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(approveStore, undefined);
  return (
    <form action={action} className="space-y-3">
      <ErrorNote>{state?.error}</ErrorNote>
      <Button type="submit" disabled={disabled || pending} className="w-full py-4 text-lg">{label}</Button>
    </form>
  );
}
