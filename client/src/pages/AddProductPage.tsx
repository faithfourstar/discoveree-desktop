import { useState } from "react";
import { Link } from "wouter";
import { useAppActions, useAppState } from "@/state/AppStateContext";

/**
 * "Add another product" (ADR 003) — the day-one URL prompt, reused: one
 * address, and Discoveree drafts the new product's context. Reached from
 * the product switcher; each product keeps its own context, sharing only
 * org-level entities through the adoption flow.
 */
export function AddProductPage() {
  const { productCreate } = useAppState();
  const actions = useAppActions();
  const [draft, setDraft] = useState("");

  const submit = () => {
    if (!draft.trim() || productCreate.pending) {
      return;
    }
    actions.createProduct({ url: draft });
  };

  return (
    <div className="flex min-h-full items-center justify-center px-8">
      <div className="w-full max-w-[600px]">
        <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
          Give me the product’s URL and I’ll build the first draft of its
          context.
        </p>
        <div className="mb-3.5 flex gap-2.5">
          <input
            type="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submit();
              }
            }}
            placeholder="https://"
            aria-label="The product's URL"
            className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || productCreate.pending}
            className="h-[46px] rounded-[9px] bg-teal px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {productCreate.pending ? "Setting up…" : "Begin"}
          </button>
        </div>
        {productCreate.error ? (
          <p className="mb-3 text-[12.5px] leading-[1.6] text-red-700 dark:text-red-400">
            {productCreate.error}
          </p>
        ) : null}
        <p className="text-[12.5px] leading-[1.65] text-faint">
          Roughly four minutes: help centre, releases and changelog get read,
          then I’ll propose competitors for you to keep or drop. Each product
          keeps its own context — competitors your organisation already
          tracks are offered for adoption, never researched twice.
        </p>
        <p className="mt-4">
          <Link
            href="/"
            className="text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            ← Back
          </Link>
        </p>
      </div>
    </div>
  );
}
