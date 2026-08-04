# Discoveree Desktop — Typography ruling: mono at data scope

**Ruling · v1** · **Date:** 4 August 2026 · **Author:** Product design
**Trigger:** owner feedback — the grey mono has grown typewriter-heavy at volume.
**Diagnosis:** JetBrains Mono crept far beyond `design_guidelines.md`'s original scope ("numerical data, metrics, timestamps") into whole meta lines, attribution lines, kickers, vocabulary words, chip text, field labels, and the entire footer. Mono had been doing double duty as a *quiet/technical voice*; grey already does quietness. Two markers doing one job reads like a terminal.
**Status:** Ruled, applied, judged live — and **amended by the owner's live judgment (§0 below), which supersedes §1's data-token scope**. Each module spec carries a one-line pointer here.

---

## 0. Superseding amendment — the owner's live judgment (4 Aug 2026)

The owner judged the applied v1 ruling live: cleaner, but the remaining scattered mono data tokens carry no value for her. **Decision: consistently clean.** This section supersedes §1's data-token scope and §§2, 4, 5 below; §3's Inter demotions and §6's token-level approach stand.

- **Mono survives only in the developer-artifact class:** code/config/snippet blocks, commands (`discoveree mcp serve`), the copyable test-prompt chip, and key-mask/address fields (entry and display) — things pasted into or out of other software. Everything else — figures, counts, dates, durations, domains, ports, channels, identifiers in running lines — renders **Inter**, at the sizes and greys §3 already sets for its line.
- **The `.data` utility becomes Inter + `font-variant-numeric: tabular-nums`**, colour and size inherited; the 0.95em mono compensation is deleted. It applies **where digit alignment matters**: tables, live counters and elapsed timers, metered rows, stacked stamps and meta lines (so values tick and update without width jitter). Prose and one-off values need nothing. The `RichText` `"mono"` tone maps to this utility — inline figures in ledes are now Inter tabular-nums, same segments, same call sites.
- **Grep rule v2 (replaces §6's):** `font-mono` may appear only in code/config/snippet blocks, the copyable prompt chip, and key-mask/address fields. Any other `font-mono` is a regression.
- **§5's face fallback is moot for UI text.** It remains on file only for the snippet blocks: if *they* ever read heavy, the pre-decided swap is still Geist Mono, still one line in the font-stack token.
- **Checklist (replaces §8 where they conflict):** the grep rule v2 passes; `.data` renders Inter tabular-nums with the compensation removed; no mono outside developer artifacts in either theme; alignment verified on a table view, a ticking counter, and the footer; hierarchy still carried by size/weight/grey alone.

Reversibility is unchanged: this is the same one-file surface as v1, moved one step further in the same direction.

## 1. The ruling, in one line *(v1 — data-token scope superseded by §0)*

**Mono marks data. Grey marks quietness. They are different jobs, and mono is never again the voice of a whole line.** A run of characters renders mono if and only if it is a *value* — something you might copy, compare digit-by-digit, or align. Everything else, at any size and any grey, is Inter.

This is a restoration, not a redesign: it is `design_guidelines.md`'s original mono scope ("numerical data, metrics, timestamps"), enforced.

## 2. What KEEPS mono — the data set *(superseded by §0: only item 5's developer artifacts survive)*

Rendered via the one inline utility (§5), inheriting the line's colour:

1. **Figures and counts** — `118`, `84`, `sentiment 61`'s `61`, `2 of 5`, percentages. (`tabular-nums` always.)
2. **Dates, times, durations, elapsed counters** — `4 h ago`, `Thu 09:00`, `28 Jul`, `0:34`, `9 days`.
3. **Domains, URLs, addresses, ports, emails, channels** — `amplitude.com`, `http://faiths-mbp.local:7317/mcp`, `:7317`, `faith@discoveree.com`, `#sales-eu`.
4. **Identifiers** — key masks (`sk-ant-…R4kQ`, `DSCV-••••-…`), issue keys (`PROD-482`), versions (`1.0.3`), sizes (`42 MB`), file names and paths.
5. **Code, config, and commands** — snippet blocks, `discoveree mcp serve`, the copyable test-prompt chip (it is content-to-paste), `.mcp.json`. These stay full-block mono, unchanged.
6. **Figures inside prose** — the existing `RichText` tone `"mono"` (ledes, change lines) is unchanged; a `41` inside a 21px sentence is the idiom working as intended.

## 3. What moves to Inter — class by class

| Class | Was | Now (authoritative) |
|---|---|---|
| **Kickers** (`COMPETITORS · SINCE YOU LAST LOOKED`, block kickers, `Serving` on Home) | mono 11px/600 upper, tracked | **Inter 11px/600, uppercase, tracking .08em**, same greys (`text-label` / `text-ghost`). Uppercase + tracking were always doing the work; mono added only the typewriter. |
| **Meta lines** (competitor/theme/segment/tool rows, object headers) | mono 12px `text-faint` | **Inter 12.5px/400 `text-faint`**, separators `·` in `text-sep`; data tokens within them per §4. |
| **Attribution / provenance / basis lines** (`shared by Jonas in #sales-eu · via Claude · 4 Aug`, `G2 · 28 Jul · ★★☆`, `built on 23 feedback items…`) | mono 12px | **Inter 12.5px/400 `text-faint`** + §4 tokens. People's names, tool names, "shared by", "via", "built on" are words. Star glyphs need no rule — they are face-agnostic. |
| **Vocabulary judgment words** (`big threat`, `forming`, `strong fit`, `rising`, `DIRECT`-adjacent words in running meta) | mono lowercase | **Inter**, same size and grey as their line. Judgments are words, not data — the module specs' vocabulary tables are amended by reference. |
| **Stamps** (`verified 4 h ago`, `next Thu 09:00`, `refreshed 2 d ago`, `checking now · 0:34`) | whole stamp mono 12px | **Keyword in Inter 12px/400 `text-faint`; value in mono** (§4): verified `4 h ago` · checking now `0:34`. Stamp-as-control behaviour unchanged. |
| **Evidence chips** (`2 sources`, `142 features`, `Jira · 27 initiatives`) | mono 10.5px | **Inter 11px/500**, `bg-chip` unchanged, `font-variant-numeric: tabular-nums`. **No mono inside chips** — the chip container already marks "citation"; a second marker at 11px is noise (the one sanctioned exception to "digits are mono", stated here so review doesn't flag it). |
| **Badge chips** (`DIRECT`, `NEW`, `WEB SEARCH`, `VIA CLAUDE`, `VERTICAL`) | mono 10px upper | **Inter 10px/650, uppercase, tracking .06em**, tint surfaces unchanged. |
| **Field labels** (**Competitor:** / **Claim:**, Who/Where/When) | drifted to mono in build | **Inter 13px/500 `text-body`** — restoring spec intent; these were never ruled mono. |
| **Footer** (all segments) | whole footer mono 11px | **Inter 11.5px/400 `text-faint`**; data tokens mono 11px per §4. Copy fragments ("Local ·", "Agents idle · next run", "Works offline", "Licence to", "MCP serving") are words. |

Sizes step up ~0.5px where mono 12px/11px/10.5px becomes Inter, compensating Inter's smaller apparent size at equal point size. Greys are untouched everywhere — this ruling changes face, never hierarchy.

## 4. The composition rule — data inside an Inter line *(superseded by §0: `.data` is now Inter + tabular-nums; no mono-inline composition remains)*

Mixed lines (`amplitude.com · big threat · sentiment 61 · 84 reviews · verified 16 d ago`) render as **one Inter run with mono data tokens inline**:

- One utility, e.g. `.data`: `font-mono`, weight 400, `font-size: 0.95em`, `tabular-nums`, colour inherited. The `0.95em` compensates JetBrains Mono's tall x-height and wide set against Inter; the engineer tunes it once (±0.02em) **in the utility only** — never per component.
- The existing `RichText` tone `"mono"` maps to this utility — most call sites already segment their lines, so this is a class swap, not a rewrite.
- Tokens never split mid-value: `16 d ago` is one token, `sentiment` + `61` are word + token.
- Inside chips and badges: no `.data` (§3, chips row).

## 5. The mono face — keep JetBrains Mono, at the new scope *(moot for UI text per §0; stands for snippet blocks only)*

**Ruling: keep JetBrains Mono, cut its scope; do not change the face in the same release.** Reasons:

1. The complaint is *volume*, and volume is what §3 removes (roughly: mono falls from whole-line coverage of every meta, kicker, chip and footer to scattered short values plus code blocks). Changing scope and face together confounds the owner's live judgment — she should see the scope cut cleanly.
2. It is already integrated, self-hosted, and OFL-licensed.

**Named fallback, pre-decided so no second debate is needed:** if the live result still reads heavy, the swap is **Geist Mono** (SIL OFL — self-hostable offline, lighter colour and less flavoured than JetBrains Mono at small sizes). One line in the font-stack token; nothing else moves. **SF Mono is ruled out**: Apple's licence does not permit bundling/self-hosting, and a `ui-monospace` system stack renders differently per platform — both fail the offline-self-host constraint and the "same product on every machine" bar.

## 6. Implementation — token-level, reversible

- **Change surface:** the `.data` utility (new), the kicker/chip/badge/meta/footer class definitions, and the `RichText` `"mono"` tone mapping. No per-component redesign; components keep their structure and segments.
- **Grep rule (add to CI/review):** `font-mono` may appear only in — the `.data` utility, code/config/snippet blocks, key/address input fields, and the copyable prompt chip. Any other `font-mono` is a regression.
- **Reversal:** re-pointing the demoted classes back to mono is the same one-file change in the opposite direction. Nothing in this ruling touches copy, layout, spacing, or colour tokens.

## 7. Before / after — the three heaviest surfaces (final form per §0)

Notation: `backticked` = mono (v1 only). The final form contains no mono outside developer artifacts; `.data` = Inter tabular-nums where noted.

**Competitor row meta line** (was: entire line mono 12px; v1 interim: mono values in an Inter line)
- Before: `amplitude.com · big threat · sentiment 61 · 84 reviews · verified 16 d ago` *(all mono)*
- After: amplitude.com · big threat · sentiment 61 · 84 reviews · verified 16 d ago *(one Inter 12.5px `text-faint` run; `.data` tabular-nums on the line so counts and stamps update without width jitter)*

**Arrival-card attribution** (was: entire line mono 12px)
- Before: `shared by Jonas in #sales-eu · via Claude · 4 Aug` *(all mono)*
- After: shared by Jonas in #sales-eu · via Claude · 4 Aug *(one Inter 12.5px `text-faint` run; nothing marked — quietness is the grey's job alone)*

**Status footer** (was: entire 30px footer mono 11px)
- Before: `● Local · 42 MB on disk    Agents idle · next run 21:00    MCP serving :7317    Works offline    Licence to 14 Mar 2027` *(all mono)*
- After: ● Local · 42 MB on disk Agents idle · next run 21:00 MCP serving :7317 Works offline Licence to 14 Mar 2027 *(Inter 11.5px `text-faint` throughout; `.data` tabular-nums so elapsed counters and next-run values tick in place)*

## 8. Review checklist addendum (applies on top of every module spec's Appendix B)

- No whole line outside code/config blocks renders mono; the §6 grep rule passes.
- Every §2 data token renders through `.data` with `tabular-nums`; no token splits mid-value.
- Chips and badges contain no mono; chip digits use Inter `tabular-nums`.
- Kickers, vocabulary words, stamp keywords, field labels, and footer copy fragments are Inter at the §3 sizes; greys unchanged from the module specs.
- Both themes re-checked on the three §7 surfaces plus a kicker-dense page (Settings) — the hierarchy must survive the swap with no grey adjustments.
- The `.data` size compensation is set in exactly one place.
