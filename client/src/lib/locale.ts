/**
 * The display-locale seam (build brief "Display locale", decided 4 Aug 2026).
 *
 * Copy is AUTHORED in British English — one canonical voice for authors and
 * agents (design_guidelines.md). The app RENDERS en-GB or en-US via a
 * display-time dictionary transform: the guidelines' substitution table
 * inverted (GB → US) plus a curated idiom list. `toDisplayEnglish` is the
 * one function every user-facing string flows through (via `useT()` in
 * client/src/state/locale.tsx).
 *
 * DATA BOUNDARY — assert and preserve: the transform applies to APP COPY
 * ONLY. Mined verbatims (review quotes), agent-stored content (change
 * titles, summaries, descriptions), user input and object names are NEVER
 * transformed — a competitor called "Colour Labs" or a customer who wrote
 * "prioritise" stays exactly as recorded. Route data fields around `t()`;
 * in RichText, segments carrying data (`objectId`, tone "mono", or
 * `data: true`) are passed through untouched.
 *
 * Dates and numbers use the resolved locale via `displayDateFormat`, which
 * replaces hardcoded `new Intl.DateTimeFormat("en-GB", …)` call sites.
 */

export type DisplayLocale = "en-GB" | "en-US";
export type DisplayLocaleSetting = "auto" | DisplayLocale;

export function isDisplayLocaleSetting(
  value: unknown,
): value is DisplayLocaleSetting {
  return value === "auto" || value === "en-GB" || value === "en-US";
}

// ---------------------------------------------------------------------------
// Locale resolution — en-GB for UK/IE/Commonwealth regions, en-US otherwise
// ---------------------------------------------------------------------------

/**
 * Regions whose English follows British conventions. A non-English language
 * tag with one of these regions (e.g. cy-GB) still resolves en-GB — the
 * machine lives in a British-English region.
 */
const GB_REGIONS = new Set([
  "GB",
  "UK",
  "IE",
  "AU",
  "NZ",
  "ZA",
  "IN",
  "SG",
  "HK",
  "MT",
  "CY",
  "KE",
  "NG",
  "GH",
  "ZW",
  "BW",
  "UG",
  "TZ",
  "ZM",
  "MW",
  "JM",
  "TT",
  "BB",
  "BS",
  "GY",
  "FJ",
  "PG",
  "PK",
  "BD",
  "LK",
  "MY",
  "BN",
  "MU",
  "NA",
  "IM",
  "JE",
  "GG",
  "GI",
  "FK",
]);

/** Resolve the detected display locale from BCP-47 tags (navigator.languages). */
export function detectDisplayLocale(
  languages: readonly string[],
): DisplayLocale {
  for (const tag of languages) {
    const region = tag.split("-")[1]?.toUpperCase();
    if (region) {
      return GB_REGIONS.has(region) ? "en-GB" : "en-US";
    }
  }
  // Region-less tags ("en") and empty lists: US is the primary target market.
  return "en-US";
}

export function resolveDisplayLocale(
  setting: DisplayLocaleSetting,
  detected: DisplayLocale,
): DisplayLocale {
  return setting === "auto" ? detected : setting;
}

// ---------------------------------------------------------------------------
// The dictionary — design_guidelines substitution table, inverted (GB → US)
// ---------------------------------------------------------------------------

const PAIRS: [gb: string, us: string][] = [];

function add(gb: string, us: string): void {
  PAIRS.push([gb, us]);
}

/** All inflections of an -ise verb stem: organise → organize family. */
function addIse(stem: string): void {
  for (const [gbSuffix, usSuffix] of [
    ["ise", "ize"],
    ["ises", "izes"],
    ["ised", "ized"],
    ["ising", "izing"],
    ["isation", "ization"],
    ["isations", "izations"],
    ["iser", "izer"],
    ["isers", "izers"],
  ] as const) {
    add(stem + gbSuffix, stem + usSuffix);
  }
}

// -ise family (guidelines table + stems found in the codebase's copy).
for (const stem of [
  "organ",
  "priorit",
  "custom",
  "summar",
  "categor",
  "visual",
  "optim",
  "recogn",
  "final",
  "emphas",
  "special",
  "synchron",
  "author",
  "personal",
  "standard",
  "monet",
  "util",
  "digit",
  "normal",
  "initial",
  "material",
  "capital",
  "minim",
  "maxim",
  "item",
  "sanit",
  "general",
  "central",
  "local",
  "modern",
]) {
  addIse(stem);
}

// analyse family. NOTE: "analyses" is deliberately absent — it is both the
// GB verb form AND the (US-identical) plural of "analysis"; transforming it
// would corrupt the noun. The rare verb use renders untransformed.
add("analyse", "analyze");
add("analysed", "analyzed");
add("analysing", "analyzing");
add("analyser", "analyzer");
add("analysers", "analyzers");

// -our → -or (explicit word list — never a suffix rule, so "your", "hour",
// "four" and friends are untouchable).
for (const [gb, us] of [
  ["behaviour", "behavior"],
  ["behaviours", "behaviors"],
  ["behavioural", "behavioral"],
  ["colour", "color"],
  ["colours", "colors"],
  ["coloured", "colored"],
  ["colouring", "coloring"],
  ["colourful", "colorful"],
  ["favour", "favor"],
  ["favours", "favors"],
  ["favoured", "favored"],
  ["favourable", "favorable"],
  ["favourite", "favorite"],
  ["favourites", "favorites"],
  ["honour", "honor"],
  ["honours", "honors"],
  ["honoured", "honored"],
  ["labour", "labor"],
  ["labours", "labors"],
  ["neighbour", "neighbor"],
  ["neighbours", "neighbors"],
  ["neighbouring", "neighboring"],
  ["flavour", "flavor"],
  ["flavours", "flavors"],
  ["endeavour", "endeavor"],
  ["endeavours", "endeavors"],
  ["rumour", "rumor"],
  ["rumours", "rumors"],
  ["humour", "humor"],
  ["armour", "armor"],
] as const) {
  add(gb, us);
}

// -re → -er.
for (const [gb, us] of [
  ["centre", "center"],
  ["centres", "centers"],
  ["centred", "centered"],
  ["centring", "centering"],
  ["litre", "liter"],
  ["litres", "liters"],
  ["metre", "meter"],
  ["metres", "meters"],
  ["kilometre", "kilometer"],
  ["kilometres", "kilometers"],
  ["fibre", "fiber"],
  ["fibres", "fibers"],
  ["calibre", "caliber"],
  ["theatre", "theater"],
  ["theatres", "theaters"],
] as const) {
  add(gb, us);
}

// -ce nouns ("licensed"/"licensing" are already shared spellings).
for (const [gb, us] of [
  ["licence", "license"],
  ["licences", "licenses"],
  ["defence", "defense"],
  ["defences", "defenses"],
  ["offence", "offense"],
  ["offences", "offenses"],
  ["pretence", "pretense"],
  ["practise", "practice"],
  ["practised", "practiced"],
  ["practising", "practicing"],
] as const) {
  add(gb, us);
}

// Doubled-l past forms and friends.
for (const [gb, us] of [
  ["cancelled", "canceled"],
  ["cancelling", "canceling"],
  ["modelled", "modeled"],
  ["modelling", "modeling"],
  ["labelled", "labeled"],
  ["labelling", "labeling"],
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["signalled", "signaled"],
  ["signalling", "signaling"],
  ["totalled", "totaled"],
  ["totalling", "totaling"],
  ["dialled", "dialed"],
  ["dialling", "dialing"],
  ["fuelled", "fueled"],
  ["fuelling", "fueling"],
  ["levelled", "leveled"],
  ["levelling", "leveling"],
  ["fulfil", "fulfill"],
  ["fulfils", "fulfills"],
  ["fulfilment", "fulfillment"],
  ["enrol", "enroll"],
  ["enrols", "enrolls"],
  ["enrolment", "enrollment"],
  ["instalment", "installment"],
  ["instalments", "installments"],
  ["skilful", "skillful"],
] as const) {
  add(gb, us);
}

// -ogue and assorted spellings.
for (const [gb, us] of [
  ["dialogue", "dialog"], // UI copy sense (guidelines table)
  ["dialogues", "dialogs"],
  ["catalogue", "catalog"],
  ["catalogues", "catalogs"],
  ["catalogued", "cataloged"],
  ["cataloguing", "cataloging"],
  ["analogue", "analog"],
  ["grey", "gray"],
  ["greyed", "grayed"],
  ["greying", "graying"],
  ["programme", "program"],
  ["programmes", "programs"],
  ["artefact", "artifact"],
  ["artefacts", "artifacts"],
  ["cheque", "check"],
  ["cheques", "checks"],
  ["whilst", "while"],
  ["amongst", "among"],
  ["learnt", "learned"],
  ["spelt", "spelled"],
] as const) {
  add(gb, us);
}

// Curated idiom exceptions — meaning-preserving, not just spelling.
// ("every 2 weeks" matches the schedule select's "every 3 days" label style.)
for (const [gb, us] of [
  ["fortnightly", "every 2 weeks"],
  // Longest-first matching keeps the article cases grammatical.
  ["once a fortnight", "once every 2 weeks"],
  ["a fortnight", "two weeks"],
  ["fortnight", "two weeks"],
  ["carry on", "continue"],
  ["carries on", "continues"],
  ["carrying on", "continuing"],
  ["straight away", "right away"],
  ["have a look", "take a look"],
] as const) {
  add(gb, us);
}

const DICTIONARY = new Map<string, string>(
  PAIRS.map(([gb, us]) => [gb.toLowerCase(), us]),
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longest-first so multi-word idioms win over their component words.
const PATTERN = new RegExp(
  `\\b(?:${[...DICTIONARY.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|")})\\b`,
  "gi",
);

/** "Licence" → "License", "LICENCE" → "LICENSE", "licence" → "license". */
function matchCase(source: string, replacement: string): string {
  if (source === source.toLowerCase()) {
    return replacement;
  }
  if (source === source.toUpperCase() && source.length > 1) {
    return replacement.toUpperCase();
  }
  const first = source.charAt(0);
  if (first === first.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * The one display transform. en-GB returns the authored copy verbatim;
 * en-US applies the dictionary word-by-word, preserving case. Apply this to
 * APP COPY only — never to mined verbatims, agent-stored content, user
 * input or object names (see the data boundary above).
 */
export function toDisplayEnglish(text: string, locale: DisplayLocale): string {
  if (locale === "en-GB") {
    return text;
  }
  return text.replace(PATTERN, (match) => {
    const us = DICTIONARY.get(match.toLowerCase());
    return us === undefined ? match : matchCase(match, us);
  });
}

// ---------------------------------------------------------------------------
// Active locale for non-hook call sites (date/number formatters)
// ---------------------------------------------------------------------------

// Authored default until the provider resolves; the provider sets this
// during render, before children format anything.
let activeLocale: DisplayLocale = "en-GB";

export function setActiveDisplayLocale(locale: DisplayLocale): void {
  activeLocale = locale;
}

export function activeDisplayLocale(): DisplayLocale {
  return activeLocale;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Locale-following replacement for `new Intl.DateTimeFormat("en-GB", …)`:
 * en-GB renders "4 Aug", en-US "Aug 4". Cached per locale + options.
 */
export function displayDateFormat(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${activeLocale}:${JSON.stringify(options)}`;
  let format = formatterCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(activeLocale, options);
    formatterCache.set(key, format);
  }
  return format;
}
