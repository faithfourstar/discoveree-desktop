# Messaging log

Append-only log of build/design decisions that are **messaging-worthy** — product behaviours the website, launch posts, or sales conversations should be able to claim. Any session (human or agent) that designs or ships a user-visible behaviour worth marketing adds a row here, at the moment of decision.

**Convention:** one row per item. Newest at the top. `Status` is `new` until the website copy (docs/marketing/website-copy.md) incorporates it, then `in copy`. Keep the claim in customer language, not implementation language — "complaints re-escalate after a fix" not "regression flag on feedback rows". Cite the source doc so claims stay verifiable.

| Date | Claim (customer language) | Source | Status |
|---|---|---|---|
| 2026-08-04 | Your AI feeds your context layer from your internal tools: intel heard in Slack or recorded in your CRM arrives via the AI assistant you already use — with provenance ("shared by Jonas in #sales"), and nothing enters the context until you accept it. No connectors to build or maintain. | build-brief §4a + §10 sequence (MCP sprint agreed next after Customer Insights) | new |
| 2026-08-04 | The regression rule: because feedback carries source dates, "fixed" isn't the end of the story — complaints arriving *after* a fix re-escalate the theme rather than staying buried under "addressed". Enables the loop: ship → hear → judge → suggest the next iteration → ship. | Roadmap-review design discussion | in copy |
