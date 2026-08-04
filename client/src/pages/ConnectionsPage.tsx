import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ConfirmDialogue } from "@/components/ConfirmDialogue";
import { RichText } from "@/components/RichText";
import { useProductHref } from "@/lib/productUrl";
import { useAppActions, useAppState } from "@/state/AppStateContext";
import { useT } from "@/state/locale";
import type {
  CheckingRow,
  ConnectionsOverview,
  ConsumptionStats,
  McpToolRow,
  ReaderRow,
  ServingStatus,
  WriteAttempt,
} from "@/mock/types";

/**
 * Connections — a Level-1 Overview of plumbing, not context objects
 * (connections-spec). Blocks in fixed order: SERVING → YOUR AI TOOLS →
 * READERS ON YOUR NETWORK → CHECKING. Connection is claimed only on a
 * received query; snippets are never aspirational.
 */

function BlockKicker({
  children,
  action,
}: {
  children: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 mt-9 flex items-baseline gap-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
      {children}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}

/** A mono block/address with the ghost Copy → `copied` affordance (0.4). */
function CopyMono({
  body,
  filename,
  inline,
}: {
  body: string;
  filename?: string | undefined;
  inline?: boolean | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(body).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  if (inline) {
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="rounded-[5px] bg-chip px-[7px] py-0.5 font-mono text-xs tabular-nums text-body">
          {body}
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-[11px] text-ghost hover:text-teal-deep"
        >
          {copied ? "copied" : "Copy"}
        </button>
      </span>
    );
  }
  return (
    <div className="max-w-[560px]">
      {filename ? (
        <div className="mb-1 font-mono text-[10.5px] text-faint">
          {filename}
        </div>
      ) : null}
      <div className="relative rounded-[9px] border border-edge-hairline bg-inset px-4 py-3">
        <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.6] text-body">
          {body}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="absolute right-3 top-2.5 text-[11px] text-ghost hover:text-teal-deep"
        >
          {copied ? "copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Serving block (1.3)
// ---------------------------------------------------------------------------

function ServingBlock({ serving }: { serving: ServingStatus }) {
  const t = useT();
  const failed = serving.http !== "serving";
  return (
    <section id="serving">
      <BlockKicker>Serving</BlockKicker>
      <p className="mb-2 text-[15px] leading-[1.6] text-ink [text-wrap:pretty]">
        {t(
          "Your context is served over MCP — the open standard your AI tools already speak. Two ways in: the discoveree command answers even when this app is closed, and the local address serves while it's open.",
        )}
      </p>
      <p className="mb-4 text-[12.5px] leading-[1.65] text-faint">
        {t(
          "Serving reads your context directly — it needs no API key, costs you nothing per query, and keeps working in the reading-only state. Answers carry the same object IDs and sources you see on these pages.",
        )}
      </p>
      <div className="flex flex-col gap-2.5">
        {failed ? (
          <div className="rounded-[9px] border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-[13.5px] leading-[1.6] text-red-700 dark:text-red-400">
              {t("Couldn't serve on port")}{" "}
              <span className="data">
                {serving.httpPort}
              </span>{" "}
              {t("— another app is using it.")}{" "}
              <button
                type="button"
                className="font-medium text-teal-deep hover:underline"
              >
                {t(`Serve on ${serving.httpPort + 1} instead`)}
              </button>
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-body">
              {t(
                "ChatGPT and custom tools point at the old address — copy the new one. Tools using the discoveree command aren't affected.",
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="w-[150px] flex-none text-[13px] text-body">
              {t("The local address")}
            </span>
            <CopyMono inline body={`http://localhost:${serving.httpPort}/mcp`} />
            <span className="ml-auto text-[11.5px] text-faint">
              serving now
            </span>
          </div>
        )}
        {serving.lanAddress ? (
          <div className="flex items-baseline gap-3">
            <span className="w-[150px] flex-none text-[13px] text-body">
              {t("On your network")}
            </span>
            <CopyMono inline body={serving.lanAddress} />
            <span className="ml-auto text-[11.5px] text-faint">
              {t("what readers connect to — see below")}
            </span>
          </div>
        ) : null}
        <div className="flex items-baseline gap-3">
          <span className="w-[150px] flex-none text-[13px] text-body">
            {t("The command")}
          </span>
          <CopyMono inline body={serving.cliCommand} />
          {serving.cliLastUsedAgo ? (
            <span className="data ml-auto text-[11.5px] text-faint">
              last used {serving.cliLastUsedAgo}
            </span>
          ) : null}
        </div>
        {!serving.cliOnPath ? (
          <p className="text-[12.5px] leading-[1.6] text-faint">
            {t(
              "The discoveree command isn't installed on your PATH yet, so this config uses the full path — it works the same.",
            )}{" "}
            <button
              type="button"
              className="font-medium text-teal-deep hover:underline"
            >
              {t("Install the command")}
            </button>
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tool rows (Part 2)
// ---------------------------------------------------------------------------

function ConsumptionMeta({ stats }: { stats: ConsumptionStats }) {
  const productHref = useProductHref();
  return (
    <>
      <div className="data mt-1 text-[12.5px] text-faint">
        {stats.queriesThisWeek} queries this week
        {stats.byClient && stats.byClient.length > 1
          ? stats.byClient
              .map((client) => ` · ${client.label} ${client.queries}`)
              .join("")
          : ""}
      </div>
      {stats.readingMostly && stats.readingMostly.length > 0 ? (
        <p className="mt-1 text-[13px] leading-[1.6] text-faint">
          Reading mostly{" "}
          {stats.readingMostly.map((area, index) => (
            <span key={area.areaId}>
              {index > 0 ? " and " : ""}
              <Link
                href={productHref(`/${area.areaId}`)}
                className="text-teal-deep hover:underline"
              >
                {area.label}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
    </>
  );
}

/**
 * "Set up automatically" with its three honest outcomes (spec §2.4).
 * Never-aspirational: success renders only from the server-confirmed write
 * (the mock simulates the same contract); failure keeps the manual snippet
 * below as the working path.
 */
function ClaudeAutoSetup() {
  const t = useT();
  const actions = useAppActions();
  const { claudeSetup } = useAppState();

  // A confirmed write flips the row to waiting, which unmounts this panel —
  // the confirmation line renders on the row itself (ToolRowView).
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={claudeSetup?.kind === "pending"}
          onClick={() => actions.setUpClaudeAutomatically()}
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {claudeSetup?.kind === "pending" ? t("Setting up…") : claudeSetup?.kind === "failed" ? t("Try again") : t("Set up automatically")}
        </button>
      </div>
      {claudeSetup?.kind === "failed" ? (
        <p className="text-[12.5px] leading-[1.6] text-red-700 dark:text-red-400">
          {t(claudeSetup.message)}
        </p>
      ) : null}
    </div>
  );
}

function SetupPanel({
  tool,
  onDone,
}: {
  tool: McpToolRow;
  onDone: () => void;
}) {
  const t = useT();
  const actions = useAppActions();
  return (
    <div className="mt-3 flex flex-col gap-3 border-l border-edge-hairline pl-4">
      <p className="text-[13.5px] leading-[1.65] text-body">
        {t(tool.description)}
      </p>
      {tool.id === "claude" ? <ClaudeAutoSetup /> : null}
      {tool.snippets.map((snippet) => (
        <CopyMono
          key={snippet.body}
          body={snippet.body}
          filename={snippet.filename}
        />
      ))}
      {tool.id === "claude" ? (
        <>
          <p className="text-[12.5px] leading-[1.65] text-faint">
            {t(
              "This uses the discoveree command, which reads your local context directly — Claude gets answers even when Discoveree isn't running.",
            )}
          </p>
          <p className="text-[12px] leading-[1.6] text-ghost">
            {t(
              "Working in a shared repo? Add a .mcp.json so everyone's Claude Code finds this context.",
            )}{" "}
            <button
              type="button"
              className="font-medium text-teal-deep hover:underline"
            >
              {t("Copy project snippet")}
            </button>
          </p>
        </>
      ) : null}
      {tool.id === "chatgpt" ? (
        <p className="text-[12.5px] leading-[1.65] text-faint">
          {t(
            "This connection needs Discoveree open. For always-on access, use a tool that supports the command, such as Claude.",
          )}
        </p>
      ) : null}
      {tool.notFoundNote ? (
        <p className="text-[12.5px] leading-[1.65] text-faint">
          {t(tool.notFoundNote)}
        </p>
      ) : null}
      {/* Closing the loop on manual setup (spec 2.4, ruled): a user
          assertion moves the row to waiting — a convenience, never a gate;
          a real first query promotes from any state. */}
      <div>
        <button
          type="button"
          onClick={() => {
            actions.setUpTool(tool.id);
            onDone();
          }}
          className="text-[12.5px] font-medium text-teal-deep hover:underline"
        >
          {t("I've pasted it in")}
        </button>
        <p className="mt-1 text-[12.5px] leading-[1.65] text-faint">
          {t(
            "Discoveree can't read other tools' settings — say when you've pasted, and it will listen for the first query.",
          )}
        </p>
      </div>
    </div>
  );
}

function ToolRowView({ tool }: { tool: McpToolRow }) {
  const t = useT();
  const actions = useAppActions();
  const { claudeSetup } = useAppState();
  const productHref = useProductHref();
  const [open, setOpen] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const state = tool.state;

  return (
    <div id={tool.id} className="border-t border-edge-hairline py-4 last:border-b">
      {state.kind === "connected" ? (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[15.5px] font-medium text-ink">
              {tool.name}
            </span>
            <span className="data ml-auto text-xs text-faint">
              {state.justConnected ? (
                <span className="text-teal-deep">
                  {t("Connected — first query received")} just now
                </span>
              ) : (
                <>last query {state.stats.lastQueryAgo}</>
              )}
            </span>
          </div>
          <ConsumptionMeta stats={state.stats} />
          {tool.pendingProposals !== undefined ? (
            <Link
              href={productHref("/competitors")}
              className="data mt-1 inline-block text-xs text-teal-deep hover:underline"
            >
              · {tool.pendingProposals} proposals awaiting review
            </Link>
          ) : null}
          <div className="mt-1.5 flex gap-3">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              {t("Show config")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmForget(true)}
              className="text-[12.5px] font-medium text-faint hover:underline"
            >
              {t("Forget this tool")}
            </button>
          </div>
          {open ? <SetupPanel tool={tool} onDone={() => setOpen(false)} /> : null}
        </>
      ) : state.kind === "waiting" ? (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[15.5px] font-medium text-ink">
              {tool.name}
            </span>
            <span
              className={[
                "data ml-auto text-xs",
                state.agedDays !== undefined
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-faint",
              ].join(" ")}
            >
              {state.agedDays !== undefined
                ? `set up ${state.setUpAgo} · never heard from`
                : t("waiting for its first query")}
            </span>
          </div>
          {tool.id === "claude" && claudeSetup?.kind === "written" ? (
            <p
              className="mt-1.5 text-[13px] leading-[1.65] text-body"
              data-testid="claude-setup-written"
            >
              {t(claudeSetup.replacedExisting ? "Updated in" : "Written to")}{" "}
              <span className="data break-all">{claudeSetup.configPath}</span>
              {" — "}
              {t("restart Claude Desktop, then ask it something.")}
            </p>
          ) : null}
          {state.agedDays !== undefined ? (
            <>
              <p className="mt-1.5 text-[15px] leading-[1.6] text-body">
                {t(
                  `The config may not have been pasted, or ${tool.name} needs restarting after a config change.`,
                )}
              </p>
              <div className="mt-1.5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setOpen((value) => !value)}
                  className="text-[12.5px] font-medium text-teal-deep hover:underline"
                >
                  {t("Show the config")}
                </button>
                <button
                  type="button"
                  onClick={() => actions.setUpTool(tool.id)}
                  className="text-[12.5px] font-medium text-teal-deep hover:underline"
                >
                  {t("Set up again")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[15px] leading-[1.6] text-body">
                {t(
                  `Set up ${state.setUpAgo}. Ask ${tool.name} something about your product to test the wiring.`,
                )}
              </p>
              <div className="mt-2">
                <CopyMono
                  inline
                  body="What do you know about my product from Discoveree?"
                />
              </div>
            </>
          )}
          {open ? <SetupPanel tool={tool} onDone={() => setOpen(false)} /> : null}
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[15.5px] font-medium text-body">
              {tool.name}
            </span>
            <span className="hidden flex-1 truncate text-[13px] text-faint sm:inline">
              {t(tool.description)}
            </span>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="ml-auto whitespace-nowrap text-[12.5px] font-medium text-teal-deep hover:underline"
            >
              {t("Set up")}
            </button>
          </div>
          {open ? <SetupPanel tool={tool} onDone={() => setOpen(false)} /> : null}
        </>
      )}
      {confirmForget ? (
        <ConfirmDialogue
          title={t(`Forget ${tool.name}?`)}
          body={t(
            `This clears Discoveree's record of ${tool.name}'s connection. ${tool.name}'s own config still points here until you remove it there.`,
          )}
          confirmLabel={t("Forget")}
          onConfirm={() => {
            setConfirmForget(false);
            actions.forgetTool(tool.id);
          }}
          onCancel={() => setConfirmForget(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readers block (Part 3)
// ---------------------------------------------------------------------------

function ReaderRowView({ reader }: { reader: ReaderRow }) {
  const t = useT();
  const actions = useAppActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onMouseDown = (event: Event) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const tool = reader.label.split("—").pop()?.trim() ?? "reader";
  const display = reader.renamedTo
    ? `${reader.renamedTo}'s ${tool}`
    : reader.label;

  return (
    <div className="border-t border-edge-hairline py-4 last:border-b">
      <div className="flex items-baseline gap-3">
        <span className="text-[15.5px] font-medium text-ink">{display}</span>
        <span className="data ml-auto text-xs text-faint">
          last read {reader.stats.lastQueryAgo}
        </span>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-label="Reader actions"
            className="rounded p-1 text-ghost transition-colors hover:text-muted"
          >
            <MoreHorizontal size={15} strokeWidth={1.75} aria-hidden />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-7 z-10 w-[180px] rounded-[9px] border border-edge bg-surface py-1.5 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(true);
                  setNameDraft(reader.renamedTo ?? "");
                }}
                className="block w-full px-3.5 py-1.5 text-left text-[13px] text-body hover:bg-inset"
              >
                {t("Rename")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmRemove(true);
                }}
                className="block w-full px-3.5 py-1.5 text-left text-[13px] text-red-700 hover:bg-inset dark:text-red-400"
              >
                {t("Remove reader")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="data mt-1 text-[12.5px] text-faint">
        {reader.stats.queriesThisWeek} queries this week
        {reader.stats.readingMostly && reader.stats.readingMostly.length > 0
          ? ` · reading mostly ${reader.stats.readingMostly
              .map((area) => area.label)
              .join(" and ")}`
          : ""}
      </div>
      {renaming ? (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[13px] text-body">{t("This is")}</span>
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                actions.renameReader(reader.id, nameDraft);
                setRenaming(false);
              }
              if (event.key === "Escape") {
                setRenaming(false);
              }
            }}
            onBlur={() => {
              if (nameDraft.trim()) {
                actions.renameReader(reader.id, nameDraft);
              }
              setRenaming(false);
            }}
            aria-label="Reader name"
            className="w-[140px] border-b border-edge-input bg-transparent pb-0.5 text-[13px] text-ink outline-none focus:border-teal"
          />
        </div>
      ) : null}
      {confirmRemove ? (
        <ConfirmDialogue
          title={t(`Remove ${display}?`)}
          body={t("Their tool loses access until you share the address again.")}
          confirmLabel={t("Remove")}
          onConfirm={() => {
            setConfirmRemove(false);
            actions.removeReader(reader.id);
          }}
          onCancel={() => setConfirmRemove(false)}
        />
      ) : null}
    </div>
  );
}

const ACTION_COPY: Record<WriteAttempt["action"], string> = {
  "add-competitor": "add a competitor",
  "log-feedback": "log feedback",
  other: "change the context",
};

function WriteAttemptRow({ attempt }: { attempt: WriteAttempt }) {
  const t = useT();
  const actions = useAppActions();
  const firstName = attempt.readerLabel.split("'")[0] ?? attempt.readerLabel;
  return (
    <div className="border-t border-edge-hairline py-3.5 last:border-b">
      <div className="flex items-baseline gap-3">
        <p className="flex-1 text-[15px] leading-[1.6] text-ink">
          {attempt.countThisWeek !== undefined && attempt.countThisWeek > 1 ? (
            <>
              {attempt.readerLabel} {t("has tried to write")}{" "}
              <span className="data">
                {attempt.countThisWeek}
              </span>{" "}
              {t("times this week — most recently")}{" "}
              {t(ACTION_COPY[attempt.action] ?? "a change")}
              {attempt.objectName ? (
                <>
                  ,{" "}
                  <span className="data">
                    {attempt.objectName}
                  </span>
                </>
              ) : null}
              .
            </>
          ) : (
            <>
              {attempt.readerLabel} {t("tried to")}{" "}
              {t(ACTION_COPY[attempt.action] ?? "change the context")}
              {attempt.objectName ? (
                <>
                  {" — "}
                  <span className="data">
                    {attempt.objectName}
                  </span>
                  {" — "}
                </>
              ) : (
                " — "
              )}
              {t("readers can't write, so nothing changed.")}
            </>
          )}
        </p>
        <span className="data text-[11.5px] text-faint">
          {attempt.at}
        </span>
      </div>
      <div className="mt-1 flex gap-3">
        <button
          type="button"
          className="text-[12.5px] font-medium text-teal-deep hover:underline"
        >
          {t(`Invite ${firstName} to a full seat`)} ↗
        </button>
        <button
          type="button"
          onClick={() => actions.dismissWriteAttempt(attempt.id)}
          className="text-[12.5px] font-medium text-faint hover:underline"
        >
          {t("Dismiss")}
        </button>
      </div>
    </div>
  );
}

function ConnectTeammateFlow({ serving }: { serving: ServingStatus }) {
  const t = useT();
  const { productName } = useAppState();
  const [tool, setTool] = useState<"claude" | "cursor" | "chatgpt" | "custom">(
    "claude",
  );
  const [invitationCopied, setInvitationCopied] = useState(false);
  const address = serving.lanAddress ?? `http://localhost:${serving.httpPort}/mcp`;

  // Teammate snippets are always HTTP — the command can't cross machines,
  // and no snippet may pretend it can (spec 3.3.3).
  const httpSnippet = JSON.stringify(
    { mcpServers: { discoveree: { url: address } } },
    null,
    2,
  );

  const invitation = `I'm sharing ${productName}'s product context from Discoveree. Point your AI tool at ${address} and ask it anything about the product — reading is free, nothing to install. (Needs my machine awake and both of us on the office network.)`;

  return (
    <div className="mt-4 flex flex-col gap-3 border-l border-edge-hairline pl-4">
      <p className="text-[15px] leading-[1.6] text-ink">
        {t(
          "Send a teammate this address — their AI tool reads your context over your local network.",
        )}
      </p>
      <CopyMono body={address} />
      {serving.lanAddressIp ? (
        <p className="text-[12px] text-ghost">
          also reachable as{" "}
          <span className="data">{serving.lanAddressIp}</span>
        </p>
      ) : null}
      <div className="flex gap-2">
        {(["claude", "cursor", "chatgpt", "custom"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTool(option)}
            aria-pressed={tool === option}
            className={[
              "rounded-[6px] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
              tool === option
                ? "bg-chip text-ink"
                : "text-faint hover:text-muted",
            ].join(" ")}
          >
            {option === "chatgpt" ? "ChatGPT" : option}
          </button>
        ))}
      </div>
      <CopyMono body={httpSnippet} filename={t("their tool's MCP settings")} />
      <div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(invitation)
              .catch(() => undefined);
            setInvitationCopied(true);
            window.setTimeout(() => setInvitationCopied(false), 2000);
          }}
          className="text-[12.5px] font-medium text-teal-deep hover:underline"
        >
          {invitationCopied ? t("Copied") : t("Copy an invitation")}
        </button>
      </div>
      <p className="text-[12.5px] leading-[1.65] text-faint">
        {t("Reading needs this app open, and both machines on the same network.")}
      </p>
      <p className="text-[12.5px] leading-[1.65] text-faint">
        {t(
          "claude.ai in the browser can't reach local machines — that's the team tier's shared server.",
        )}
      </p>
    </div>
  );
}

function ReadersBlock({
  overview,
}: {
  overview: ConnectionsOverview;
}) {
  const t = useT();
  const [flowOpen, setFlowOpen] = useState(false);
  return (
    <section id="readers">
      <BlockKicker>Readers on your network</BlockKicker>
      <p className="mb-2 text-[15px] leading-[1.6] text-ink [text-wrap:pretty]">
        {t(
          "Teammates read free. Their AI tools connect to this machine over your local network — read-only, no account, no licence. Changing the context — adding competitors, logging feedback — is what a full seat is for.",
        )}
      </p>
      <p className="mb-2 text-[12px] text-ghost">
        {t("Readers appear here the first time they ask something.")}
      </p>
      <div className="flex flex-col">
        {overview.readers.map((reader) => (
          <ReaderRowView key={reader.id} reader={reader} />
        ))}
      </div>
      {overview.writeAttempts.length > 0 ? (
        <div className="mt-4 flex flex-col">
          {overview.writeAttempts.map((attempt) => (
            <WriteAttemptRow key={attempt.id} attempt={attempt} />
          ))}
        </div>
      ) : null}
      {flowOpen && overview.serving ? (
        <ConnectTeammateFlow serving={overview.serving} />
      ) : (
        <button
          type="button"
          onClick={() => setFlowOpen(true)}
          className="mt-3 w-full py-3 text-left text-[13px] font-medium text-teal-deep hover:underline"
        >
          {t("Connect a teammate")}
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Checking block (Part 5)
// ---------------------------------------------------------------------------

function CheckingBlock({ rows }: { rows: readonly CheckingRow[] }) {
  const t = useT();
  const productHref = useProductHref();
  return (
    <section id="checking">
      <BlockKicker>Checking</BlockKicker>
      <p className="mb-3 text-[15px] leading-[1.6] text-ink [text-wrap:pretty]">
        {t(
          "Discoveree checks these on a schedule while the app is open, and catches up when you launch. Nothing is ever written to them without your explicit say-so.",
        )}
      </p>
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-baseline gap-3 border-t border-edge-hairline py-3.5 last:border-b"
          >
            <span className="text-[14.5px] font-medium text-ink">
              {row.name}
            </span>
            {row.door ? (
              <>
                <span className="text-[13px] text-faint">
                  {t(row.door.line)}
                </span>
                <span className="data text-xs text-faint">{row.meta}</span>
                <Link
                  href={productHref(row.door.href)}
                  className="ml-auto text-[12.5px] font-medium text-teal-deep hover:underline"
                >
                  {t("Open Customers")} →
                </Link>
              </>
            ) : row.pollFailed ? (
              <>
                <span className="text-xs text-red-700 dark:text-red-400">
                  {row.pollFailed.reason} ·{" "}
                  <span className="data">{row.pollFailed.at}</span>
                </span>
                <span className="ml-auto flex gap-3">
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-teal-deep hover:underline"
                  >
                    {t("Try again")}
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-teal-deep hover:underline"
                  >
                    {t("View log")}
                  </button>
                </span>
              </>
            ) : (
              <span className="data text-xs text-faint">{row.meta}</span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-faint">
        {t(
          "Suggestions you accept are created in Jira — that is the only thing ever written there.",
        )}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function DayOneConnections({ overview }: { overview: ConnectionsOverview }) {
  const t = useT();
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-10">
      <div className="w-full max-w-[600px]">
        <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
          {t(
            "Everything Discoveree knows can answer questions wherever you work. Connect Claude, Cursor or ChatGPT — most take under a minute — then ask about your product and watch the answer arrive with sources.",
          )}
        </p>
        <div className="flex flex-col">
          {overview.tools.map((tool) => (
            <ToolRowView key={tool.id} tool={tool} />
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-[1.6] text-ghost">
          {t(
            "claude.ai in the browser can't reach local machines — that needs the team tier's shared server.",
          )}
        </p>
        <p className="mt-2 text-[12.5px] leading-[1.65] text-faint">
          {t(
            "Serving reads your context directly — it needs no API key, costs you nothing per query, and keeps working in the reading-only state.",
          )}
        </p>
      </div>
    </div>
  );
}

export function ConnectionsPage() {
  const state = useAppState();
  const t = useT();
  const overview = state.connections;
  const [highlight, setHighlight] = useState<string | null>(null);

  // Anchor landing (spec 0.1): scroll + one-time highlight from the hash.
  useEffect(() => {
    const anchor = window.location.hash.replace(/^#/, "");
    if (!anchor) {
      return;
    }
    const element = document.getElementById(anchor);
    if (element) {
      element.scrollIntoView({ block: "start" });
      setHighlight(anchor);
      const timer = window.setTimeout(() => setHighlight(null), 1200);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, []);

  if (!overview) {
    return (
      <div className="flex min-h-full items-center justify-center px-8">
        <p className="max-w-[600px] text-center text-[15px] leading-relaxed text-muted">
          {t(
            "Your AI tools connect here — the serving surface arrives with this update.",
          )}
        </p>
      </div>
    );
  }

  const anyConfigured = overview.tools.some(
    (tool) => tool.state.kind !== "unconfigured",
  );
  if (!anyConfigured && overview.readers.length === 0 && !overview.checking) {
    return <DayOneConnections overview={overview} />;
  }

  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-4 flex items-baseline gap-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
            {t("Connections · serving and checking")}
          </span>
          <a
            href="#readers"
            className="ml-auto text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            {t("Connect a teammate")}
          </a>
        </div>
        <p className="mb-2 text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
          <RichText value={overview.lede} />
        </p>

        {overview.serving ? (
          <div className={highlight === "serving" ? "tint-fade" : undefined}>
            <ServingBlock serving={overview.serving} />
          </div>
        ) : null}

        {overview.serving ? (
          <section>
            <BlockKicker
              action={
                <button
                  type="button"
                  className="font-sans text-[12.5px] font-medium normal-case tracking-normal text-teal-deep hover:underline"
                >
                  {t("Connect a tool")}
                </button>
              }
            >
              Your AI tools
            </BlockKicker>
            <div className="flex flex-col">
              {overview.tools.map((tool) => (
                <div
                  key={tool.id}
                  className={highlight === tool.id ? "tint-fade" : undefined}
                >
                  <ToolRowView tool={tool} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-[1.6] text-ghost">
              {t(
                "claude.ai in the browser can't reach local machines — that needs the team tier's shared server.",
              )}
            </p>
          </section>
        ) : null}

        {overview.serving ? (
          <div className={highlight === "readers" ? "tint-fade" : undefined}>
            <ReadersBlock overview={overview} />
          </div>
        ) : null}

        {overview.checking ? (
          <div className={highlight === "checking" ? "tint-fade" : undefined}>
            <CheckingBlock rows={overview.checking} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
