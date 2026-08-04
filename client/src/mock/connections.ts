import type {
  ConnectionsOverview,
  McpArrivalCard,
  McpToolRow,
  RichSegment,
  RichText,
  ServingStatus,
  WriteAttempt,
} from "./types";

/**
 * Mock data + pure helpers for the Connections surface. Snippets are built
 * from the ServingStatus so they are never aspirational (spec 2.5): the
 * command string renders exactly what works on this machine today.
 */

// ---------------------------------------------------------------------------
// Snippets — resolved against ServingStatus, copy-paste-true
// ---------------------------------------------------------------------------

function stdioSnippet(serving: ServingStatus): string {
  const [command, ...args] = serving.cliCommand.split(" ");
  return JSON.stringify(
    {
      mcpServers: {
        discoveree: { command: command ?? "discoveree", args },
      },
    },
    null,
    2,
  );
}

function httpAddress(serving: ServingStatus): string {
  return `http://localhost:${serving.httpPort}/mcp`;
}

export function buildToolRows(
  serving: ServingStatus,
  states: Partial<Record<string, McpToolRow["state"]>>,
  pendingByTool: Partial<Record<string, number>> = {},
): McpToolRow[] {
  const stdio = stdioSnippet(serving);
  const address = httpAddress(serving);
  const rows: McpToolRow[] = [
    {
      id: "claude",
      name: "Claude",
      description:
        "Claude spawns Discoveree's context server directly — it works even when this app is closed.",
      transport: "stdio",
      state: states["claude"] ?? { kind: "unconfigured" },
      snippets: [{ filename: "claude_desktop_config.json", body: stdio }],
    },
    {
      id: "cursor",
      name: "Cursor",
      description: "Point Cursor's MCP settings at Discoveree.",
      transport: "stdio",
      state: states["cursor"] ?? { kind: "unconfigured" },
      snippets: [{ filename: "~/.cursor/mcp.json", body: stdio }],
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      description:
        "ChatGPT connects to Discoveree's local address while the app is running.",
      transport: "http",
      state: states["chatgpt"] ?? { kind: "unconfigured" },
      snippets: [{ body: address }],
    },
    {
      id: "copilot",
      name: "GitHub Copilot",
      description:
        "Point VS Code's MCP settings at Discoveree — Copilot reads your context in the editor.",
      transport: "stdio",
      state: states["copilot"] ?? { kind: "unconfigured" },
      snippets: [{ filename: ".vscode/mcp.json", body: stdio }],
    },
    {
      id: "custom",
      name: "Custom or my own agents",
      description: "Anything that speaks MCP can read your context.",
      transport: "both",
      state: states["custom"] ?? { kind: "unconfigured" },
      snippets: [
        { filename: "the command", body: serving.cliCommand },
        { filename: "the local address", body: address },
      ],
    },
  ];
  for (const row of rows) {
    const pending = pendingByTool[row.id];
    if (pending !== undefined && pending > 0) {
      row.pendingProposals = pending;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Serving states
// ---------------------------------------------------------------------------

const healthyServing: ServingStatus = {
  httpPort: 7317,
  http: "serving",
  lanAddress: "http://faiths-mbp.local:7317/mcp",
  lanAddressIp: "http://192.168.1.24:7317/mcp",
  cliOnPath: true,
  cliCommand: "discoveree mcp serve",
  cliLastUsedAgo: "3 h ago",
};

/** CLI not on PATH: snippets render the absolute form that works today. */
const noPathServing: ServingStatus = {
  ...healthyServing,
  cliOnPath: false,
  cliCommand: "/Applications/Discoveree.app/Contents/MacOS/discoveree mcp serve",
};

const degradedServing: ServingStatus = {
  httpPort: 7317,
  http: { failed: "port-in-use" },
  cliOnPath: true,
  cliCommand: "discoveree mcp serve",
  cliLastUsedAgo: "3 h ago",
};

// ---------------------------------------------------------------------------
// The lede — priority ladder (spec 1.2)
// ---------------------------------------------------------------------------

export function buildConnectionsLede(
  overview: Pick<
    ConnectionsOverview,
    "serving" | "tools" | "readers" | "checking" | "pendingProposalsTotal"
  >,
): RichText {
  const segs: RichSegment[] = [];

  if (overview.serving && overview.serving.http !== "serving") {
    segs.push({
      text: `The local address isn't serving — port ${overview.serving.httpPort} is in use. Claude still gets answers through the discoveree command. `,
    });
  }

  const pending = overview.pendingProposalsTotal ?? 0;
  const connected = overview.tools.filter(
    (tool) => tool.state.kind === "connected",
  );
  const waiting = overview.tools.filter(
    (tool) => tool.state.kind === "waiting",
  );

  if (pending > 0) {
    segs.push({ text: String(pending), tone: "mono" });
    segs.push({
      text: ` piece${pending === 1 ? "" : "s"} of intel arrived via Claude and ${pending === 1 ? "is" : "are"} waiting for `,
    });
    segs.push({
      text: "your review",
      tone: "link",
      objectId: "module:competitors",
    });
    segs.push({ text: "." });
  } else if (connected.length > 0) {
    const total = connected.reduce(
      (sum, tool) =>
        sum + (tool.state.kind === "connected" ? tool.state.stats.queriesThisWeek : 0),
      0,
    );
    segs.push({ text: "Your context answered " });
    segs.push({ text: String(total), tone: "mono" });
    segs.push({ text: " questions this week — " });
    connected.forEach((tool, index) => {
      if (tool.state.kind !== "connected") {
        return;
      }
      if (index > 0) {
        segs.push({ text: ", " });
      }
      segs.push({
        text: String(tool.state.stats.queriesThisWeek),
        tone: "mono",
      });
      segs.push({ text: ` from ${tool.name}` });
    });
    if (overview.readers.length > 0) {
      segs.push({ text: " — and " });
      segs.push({ text: String(overview.readers.length), tone: "mono" });
      segs.push({
        text: ` teammate${overview.readers.length === 1 ? " is" : "s are"} reading over your network.`,
      });
    } else {
      segs.push({ text: "." });
    }
  } else if (waiting.length > 0) {
    const first = waiting[0];
    if (first) {
      segs.push({
        text: `${first.name} is set up but hasn't asked anything yet — the test prompt below is the quickest way to check the wiring.`,
      });
    }
  }

  const jira = (overview.checking ?? []).find((row) => !row.door);
  if (jira && !jira.pollFailed) {
    const checked = /checked ([^·]+)·?/.exec(jira.meta)?.[1]?.trim();
    if (checked) {
      segs.push({ text: ` ${jira.name} was checked ` });
      segs.push({ text: checked, tone: "mono" });
      segs.push({ text: " ago." });
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const checkingRows: ConnectionsOverview["checking"] = [
  {
    id: "checking:jira",
    name: "Jira",
    meta: "jira.acme.com · 27 roadmap items · checked 2 h · daily",
  },
  {
    id: "checking:feedback-sources",
    name: "Feedback sources",
    meta: "G2 · CSV import",
    door: { line: "managed in Customers", href: "/customers" },
  },
];

const mayaAttempt: WriteAttempt = {
  id: "attempt:maya-harvey",
  readerLabel: "Maya's Claude",
  action: "add-competitor",
  objectName: "Harvey",
  at: "Tue 14:02",
  countThisWeek: 3,
};

export type ConnectionsVariant =
  | "populated"
  | "day-one"
  | "aged"
  | "degraded"
  | "arrivals";

export function makeConnections(
  variant: ConnectionsVariant,
): ConnectionsOverview {
  if (variant === "day-one") {
    const overview: ConnectionsOverview = {
      lede: [],
      serving: healthyServing,
      tools: buildToolRows(healthyServing, {}),
      readers: [],
      writeAttempts: [],
      checking: null,
    };
    overview.lede = buildConnectionsLede(overview);
    return overview;
  }

  if (variant === "degraded") {
    const overview: ConnectionsOverview = {
      lede: [],
      serving: degradedServing,
      tools: buildToolRows(degradedServing, {
        claude: {
          kind: "connected",
          stats: {
            queriesThisWeek: 118,
            lastQueryAgo: "14 min ago",
            byClient: [
              { label: "Desktop", queries: 96 },
              { label: "Code", queries: 22 },
            ],
          },
        },
        chatgpt: { kind: "waiting", setUpAgo: "today" },
      }),
      readers: [],
      writeAttempts: [],
      checking: checkingRows,
    };
    overview.lede = buildConnectionsLede(overview);
    return overview;
  }

  if (variant === "aged") {
    // CLI off PATH (absolute-path snippets) + an aged waiting row.
    const overview: ConnectionsOverview = {
      lede: [],
      serving: noPathServing,
      tools: buildToolRows(noPathServing, {
        chatgpt: { kind: "waiting", setUpAgo: "9 d ago", agedDays: 9 },
      }),
      readers: [],
      writeAttempts: [],
      checking: checkingRows,
    };
    overview.lede = buildConnectionsLede(overview);
    return overview;
  }

  const pending = variant === "arrivals" ? 2 : 0;
  const overview: ConnectionsOverview = {
    lede: [],
    serving: healthyServing,
    tools: buildToolRows(
      healthyServing,
      {
        claude: {
          kind: "connected",
          stats: {
            queriesThisWeek: 118,
            lastQueryAgo: "14 min ago",
            byClient: [
              { label: "Desktop", queries: 96 },
              { label: "Code", queries: 22 },
            ],
            readingMostly: [
              { areaId: "competitors", label: "competitors" },
              { areaId: "customers", label: "feedback themes" },
            ],
          },
        },
        cursor: {
          kind: "connected",
          stats: { queriesThisWeek: 22, lastQueryAgo: "2 h ago" },
        },
        chatgpt: { kind: "waiting", setUpAgo: "today" },
      },
      pending > 0 ? { claude: pending } : {},
    ),
    readers: [
      {
        id: "reader:priya",
        label: "Priya's MacBook — Cursor",
        stats: {
          queriesThisWeek: 41,
          lastQueryAgo: "2 h ago",
          readingMostly: [{ areaId: "strategy", label: "strategy" }],
        },
      },
      {
        id: "reader:jonas",
        label: "Jonas's ThinkPad — Claude",
        stats: { queriesThisWeek: 12, lastQueryAgo: "1 d ago" },
      },
    ],
    writeAttempts: [mayaAttempt],
    checking: checkingRows,
    ...(pending > 0 ? { pendingProposalsTotal: pending } : {}),
  };
  overview.lede = buildConnectionsLede(overview);
  return overview;
}

// ---------------------------------------------------------------------------
// Arrivals (spec 4.2)
// ---------------------------------------------------------------------------

export function makeArrivals(): McpArrivalCard[] {
  return [
    {
      id: "arrival:harvey",
      kind: "competitor-intel",
      title: "Competitor intel — Harvey",
      verbatim:
        "Lost the Meridian renewal to Harvey — they led with SSO and SCIM in the first call.",
      attribution: {
        via: "Claude",
        sharedBy: "Jonas",
        channel: "#sales-eu",
        date: "4 Aug",
      },
      targetName: "Harvey",
      extracted: [
        { label: "Competitor", value: "Harvey" },
        { label: "Claim", value: "leads enterprise deals with SSO and SCIM" },
      ],
      evidence: [
        {
          id: "ev:arrival-harvey-origin",
          kind: "source",
          label: "via Claude · #sales-eu",
          objectId: "arrival:harvey",
        },
      ],
    },
    {
      id: "arrival:mixpanel-pricing",
      kind: "competitor-intel",
      title: "Competitor intel — Mixpanel",
      verbatim:
        "Mixpanel quoted the Fenwick team 30% under list to keep them off our shortlist.",
      attribution: {
        via: "Claude",
        date: "4 Aug",
      },
      targetObjectId: "competitor:mixpanel",
      targetName: "Mixpanel",
      extracted: [
        { label: "Competitor", value: "Mixpanel" },
        { label: "Claim", value: "discounting 30% under list in competitive deals" },
      ],
      evidence: [
        {
          id: "ev:arrival-mixpanel-origin",
          kind: "source",
          label: "via Claude",
          objectId: "arrival:mixpanel-pricing",
        },
      ],
    },
  ];
}
