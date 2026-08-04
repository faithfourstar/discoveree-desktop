/**
 * The MCP caller seam (ADR 005 §4.1) — where seat, licence state and (in 5b)
 * reader-key auth attach. Today every caller is the owner's full seat; both
 * write tools call requireWriteSeat FROM DAY ONE so 5b's reader enforcement
 * is a data change, not a code path change.
 *
 * BAN (ADR 005 §3.6, CI-greppable): server/mcp/ never imports server/lib/llm/.
 */
import { LOCAL_USER_ID } from "../db/seedLocal.js";

export interface McpCaller {
  seat: "full" | "reader";
  /** Owner's LOCAL_USER_ID today; the key's createdByUserId later (5b). */
  userId: string;
  /** Reader-key id; null on the owner seat. */
  keyId: string | null;
  /** Per-key product pin (ADR 003 §4) — 5b. CLI --product pins via ctx, not here. */
  productScope: string | null;
}

/** Today: always the owner, seat "full". 5b resolves keys/licence here. */
export function resolveMcpCaller(): McpCaller {
  return {
    seat: "full",
    userId: LOCAL_USER_ID,
    keyId: null,
    productScope: null,
  };
}

/**
 * The refusal (ADR 005 §4.2): serialised as an isError tool result the model
 * relays VERBATIM. Echoes the attempted write so nothing the user typed is
 * lost; names the owner (the sales motion is a conversation with a
 * colleague); never includes pricing in the machine-readable payload.
 */
export class ReaderSeatError extends Error {
  constructor(
    public readonly tool: string,
    public readonly args: Record<string, unknown>,
    public readonly ownerName: string,
  ) {
    super("reader_seat");
    this.name = "ReaderSeatError";
  }

  toPayload(): Record<string, unknown> {
    return {
      error: "reader_seat",
      message:
        `This connection has a free reader seat on this team's context — it can read everything ` +
        `shared with it, but writing (logging feedback, proposing intel) needs a full seat. ` +
        `Ask ${this.ownerName} to add one, or see discoveree.com/seats.`,
      requested_write: { tool: this.tool, arguments: this.args },
    };
  }
}

/**
 * Both write tools call this from day one; it never fires in solo mode. The
 * licensing sprint makes `seat` a function of (key audience × licence state)
 * — the trial-expiry reader state reuses this exact check.
 */
export function requireWriteSeat(
  caller: McpCaller,
  tool: string,
  args: Record<string, unknown>,
  ownerName: string,
): void {
  if (caller.seat === "reader") {
    throw new ReaderSeatError(tool, args, ownerName);
  }
}
