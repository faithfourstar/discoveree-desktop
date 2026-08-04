import { ApiError, apiUrl, relativeStamp, shortDateOf } from "@/lib/api";
import { buildConnectionsLede, buildToolRows } from "@/mock/connections";
import type {
  ConnectionsOverview,
  ConsumptionStats,
  McpArrivalCard,
  McpToolId,
  McpToolRow,
  ServingStatus,
} from "@/mock/types";

/**
 * Live client for the ADR 005 review surface — the pinned REST contract:
 * GET /api/products/:productId/intel-proposals, POST …/:id/accept,
 * POST …/:id/dismiss. The mcp_activity summary endpoint is not yet pinned;
 * the Serving line stays mock-driven until it is (reported).
 */

export interface ServerIntelProvenance {
  via: "mcp";
  /** Inferred from the MCP initialize clientInfo, e.g. "claude-desktop 1.x". */
  client: string | null;
  /** Required from the tool call; "unattributed" permitted. */
  sharedBy: string;
  keyId: string | null;
  /** Optional free text, e.g. "from #competitive-intel thread". */
  detail: string | null;
  at: string;
}

export interface ServerIntelProposal {
  id: string;
  targetKind: "competitor_entity" | "new_competitor";
  targetEntityId: string | null;
  targetName: string | null;
  kind: string;
  claim: string;
  sourceUrl: string | null;
  effectiveDate: string | null;
  provenance: ServerIntelProvenance | null;
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) {
    return undefined as T;
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body — payload stays null.
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

function productApi(productId: string, path: string): string {
  return `/api/products/${encodeURIComponent(productId)}${path}`;
}

// ---------------------------------------------------------------------------
// Serving surface (server/mcp/cliInvocation.ts + activity.ts, verified)
// ---------------------------------------------------------------------------

export interface ServerCliInvocation {
  kind: "packaged" | "dev";
  command: string;
  args: string[];
}

export interface ServerMcpConfig {
  servingPort: number;
  httpUrl: string;
  /** Absolute path to the CLI entry — honest pre-packaging (dev era). */
  cliPath: string;
  transports: { http: boolean; stdio: boolean };
  /** LAN exposure is a 5b opt-in — null until it exists. */
  lanAddress: string | null;
  invocation: ServerCliInvocation;
  snippets: {
    claudeDesktop: Record<string, unknown>;
    claudeCodeHttp: string;
    claudeCodeStdio: Record<string, unknown>;
    cursor: Record<string, unknown>;
    chatgpt: { connectable: false; reason: string };
  };
}

interface ActivityWindow {
  queriesThisWeek: number;
  firstQueryAt: string | null;
  lastQueryAt: string | null;
}

export interface ServerMcpActivity {
  totalCalls: number;
  errorCount: number;
  byClient: Array<
    { clientName: string | null; clientVersion: string | null } & ActivityWindow
  >;
  byTool: Array<{ toolName: string } & ActivityWindow>;
  /** Per-reader rows (keyId) — empty until reader keys exist (5b). */
  byKey: Array<{ keyId: string } & ActivityWindow>;
}

/** POST claude-desktop-setup — success only when the file was written. */
export interface ServerClaudeSetup {
  written: true;
  configPath: string;
  entry: Record<string, unknown>;
}

export const connectionsApi = {
  getMcpConfig: () => request<ServerMcpConfig>("/api/settings/mcp-config"),
  getMcpActivity: () =>
    request<ServerMcpActivity>("/api/settings/mcp-activity"),
  claudeDesktopSetup: () =>
    request<ServerClaudeSetup>("/api/settings/mcp-config/claude-desktop-setup", {
      method: "POST",
    }),
  listIntelProposals: (productId: string) =>
    request<{ proposals: ServerIntelProposal[] }>(
      productApi(productId, "/intel-proposals"),
    ),
  acceptIntelProposal: (productId: string, id: string) =>
    request<unknown>(
      productApi(productId, `/intel-proposals/${encodeURIComponent(id)}/accept`),
      { method: "POST" },
    ),
  dismissIntelProposal: (productId: string, id: string) =>
    request<unknown>(
      productApi(
        productId,
        `/intel-proposals/${encodeURIComponent(id)}/dismiss`,
      ),
      { method: "POST" },
    ),
};

// ---------------------------------------------------------------------------
// Live composition — ConnectionsOverview from the served config + activity
// ---------------------------------------------------------------------------

/** Owner assertions ("I've pasted it in"), toolId → ISO date, client-local. */
export type LocalToolSetup = Readonly<Partial<Record<McpToolId, string>>>;

/**
 * Attribute a client identity to a tool row. Stateless HTTP calls carry
 * clientName null (clientInfo only travels with initialize on stdio) — those
 * land under a truthful catch-all on the Custom row, never invented.
 */
export function classifyClient(clientName: string | null): {
  tool: McpToolId;
  label: string;
} {
  if (!clientName) {
    return { tool: "custom", label: "over HTTP · unidentified" };
  }
  const lower = clientName.toLowerCase();
  if (lower.includes("claude")) {
    return { tool: "claude", label: lower.includes("code") ? "Code" : "Desktop" };
  }
  if (lower.includes("cursor")) {
    return { tool: "cursor", label: clientName };
  }
  if (
    lower.includes("copilot") ||
    lower.includes("vscode") ||
    lower.includes("visual studio")
  ) {
    return { tool: "copilot", label: clientName };
  }
  if (lower.includes("chatgpt") || lower.includes("openai")) {
    return { tool: "chatgpt", label: clientName };
  }
  return { tool: "custom", label: clientName };
}

function setUpAgoFrom(iso: string): { setUpAgo: string; agedDays?: number } {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
  if (days === 0) {
    return { setUpAgo: "today" };
  }
  return days > 7
    ? { setUpAgo: `${days} d ago`, agedDays: days }
    : { setUpAgo: `${days} d ago` };
}

export function connectionsFromServer(
  config: ServerMcpConfig,
  activity: ServerMcpActivity,
  localSetup: LocalToolSetup,
  pendingProposalsTotal: number,
): ConnectionsOverview {
  const serving: ServingStatus = {
    httpPort: config.servingPort,
    http: "serving",
    // The dev-era invocation is not a PATH command — the caveat line renders,
    // and every snippet uses the absolute form that works today (spec 2.5).
    cliOnPath: config.invocation.kind === "packaged",
    cliCommand: [config.invocation.command, ...config.invocation.args].join(" "),
    ...(config.lanAddress ? { lanAddress: config.lanAddress } : {}),
  };

  // Aggregate the 7-day window per tool row.
  const perTool = new Map<
    McpToolId,
    { total: number; lastAt: string | null; byLabel: Map<string, number> }
  >();
  for (const client of activity.byClient) {
    if (client.queriesThisWeek === 0) {
      continue;
    }
    const { tool, label } = classifyClient(client.clientName);
    const entry = perTool.get(tool) ?? {
      total: 0,
      lastAt: null,
      byLabel: new Map<string, number>(),
    };
    entry.total += client.queriesThisWeek;
    if (
      client.lastQueryAt &&
      (entry.lastAt === null || client.lastQueryAt > entry.lastAt)
    ) {
      entry.lastAt = client.lastQueryAt;
    }
    entry.byLabel.set(
      label,
      (entry.byLabel.get(label) ?? 0) + client.queriesThisWeek,
    );
    perTool.set(tool, entry);
  }

  const states: Partial<Record<string, McpToolRow["state"]>> = {};
  for (const id of [
    "claude",
    "cursor",
    "chatgpt",
    "copilot",
    "custom",
  ] as const) {
    const usage = perTool.get(id);
    if (usage && usage.total > 0) {
      // Connection is confirmed only by a received query (spec 0.5.1).
      const stats: ConsumptionStats = {
        queriesThisWeek: usage.total,
        lastQueryAgo: usage.lastAt ? relativeStamp(usage.lastAt) : "this week",
        ...(usage.byLabel.size > 1
          ? {
              byClient: [...usage.byLabel.entries()].map(
                ([label, queries]) => ({ label, queries }),
              ),
            }
          : {}),
      };
      states[id] = { kind: "connected", stats };
    } else {
      const assertedAt = localSetup[id];
      if (assertedAt) {
        states[id] = { kind: "waiting", ...setUpAgoFrom(assertedAt) };
      }
    }
  }

  const tools = buildToolRows(
    serving,
    states,
    pendingProposalsTotal > 0 ? { claude: pendingProposalsTotal } : {},
  );
  // Server-authoritative snippets where served (copy-paste-true for this
  // install); Copilot/Custom derive from the same served invocation.
  for (const tool of tools) {
    if (tool.id === "claude") {
      tool.snippets = [
        {
          filename: "claude_desktop_config.json",
          body: JSON.stringify(config.snippets.claudeDesktop, null, 2),
        },
        {
          filename: "Claude Code — one command",
          body: config.snippets.claudeCodeHttp,
        },
      ];
    } else if (tool.id === "cursor") {
      tool.snippets = [
        {
          filename: "~/.cursor/mcp.json",
          body: JSON.stringify(config.snippets.cursor, null, 2),
        },
      ];
    } else if (tool.id === "chatgpt") {
      // connectable:false — the served reason is the honest scoping line.
      tool.description = config.snippets.chatgpt.reason;
      tool.snippets = [];
    } else if (tool.id === "custom") {
      tool.snippets = [
        { filename: "the command", body: serving.cliCommand },
        { filename: "the local address", body: config.httpUrl },
      ];
    }
  }

  const overview: ConnectionsOverview = {
    lede: [],
    serving,
    tools,
    readers: [], // per-reader rows arrive with reader keys (5b)
    writeAttempts: [],
    checking: null,
    ...(pendingProposalsTotal > 0 ? { pendingProposalsTotal } : {}),
  };
  overview.lede = buildConnectionsLede(overview);
  return overview;
}

/** "claude-desktop 1.x" → "Claude Desktop"; honest fallback "your AI". */
export function toolLabelFromClient(client: string | null): string {
  if (!client) {
    return "your AI";
  }
  const stem = client.split(/\s+/)[0] ?? client;
  return stem
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function arrivalFromProposal(
  proposal: ServerIntelProposal,
  competitorsByEntityId: ReadonlyMap<string, { id: string; name: string }>,
): McpArrivalCard {
  const provenance = proposal.provenance;
  const via = toolLabelFromClient(provenance?.client ?? null);
  const target = proposal.targetEntityId
    ? competitorsByEntityId.get(proposal.targetEntityId)
    : undefined;
  const name = target?.name ?? proposal.targetName ?? "a competitor";
  const sharedBy =
    provenance && provenance.sharedBy !== "unattributed"
      ? provenance.sharedBy
      : undefined;
  const originLabel = [
    `via ${via}`,
    ...(provenance?.detail ? [provenance.detail] : []),
  ].join(" · ");
  const card: McpArrivalCard = {
    id: proposal.id,
    kind: "competitor-intel",
    title: `Competitor intel — ${name}`,
    verbatim: proposal.claim,
    attribution: {
      via,
      ...(sharedBy ? { sharedBy } : {}),
      ...(provenance?.detail ? { channel: provenance.detail } : {}),
      date: shortDateOf(provenance?.at ?? proposal.createdAt),
    },
    ...(target ? { targetObjectId: target.id } : {}),
    targetName: name,
    extracted: [
      { label: "Competitor", value: name },
      { label: "Claim", value: proposal.claim },
    ],
    evidence: [
      {
        id: `ev:${proposal.id}-origin`,
        kind: "source",
        label: originLabel,
        objectId: proposal.id,
        ...(proposal.sourceUrl ? { href: proposal.sourceUrl } : {}),
      },
    ],
  };
  return card;
}
