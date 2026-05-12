import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { google } from "googleapis";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { GmailService } from "./gmail-service.js";
import { TokenStore } from "./token-store.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const tokenStore = new TokenStore();

// ---------------------------------------------------------------------------
// Gmail service factory — exchanges stored refresh token for access token
// ---------------------------------------------------------------------------

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    `${SERVER_URL}/oauth/callback`
  );
}

async function getGmailServiceForAccount(email: string): Promise<GmailService> {
  const refreshToken = tokenStore.getRefreshToken(email);
  if (!refreshToken) {
    throw new Error(
      `Account "${email}" is not connected. Use list_accounts to see connected accounts, or add it via the /setup page.`
    );
  }

  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });

  const { token } = await oauth2.getAccessToken();
  if (!token) {
    throw new Error(
      `Failed to get access token for "${email}". The account may need to be re-authorized via /setup.`
    );
  }

  return new GmailService(token);
}

function resolveAccounts(account: string): string[] {
  if (account.toLowerCase() === "all") {
    const all = tokenStore.listAccounts().map((a) => a.email);
    if (all.length === 0) {
      throw new Error("No accounts connected. Add accounts via the /setup page.");
    }
    return all;
  }
  if (!tokenStore.hasAccount(account)) {
    const available = tokenStore.listAccounts().map((a) => a.email);
    throw new Error(
      `Account "${account}" is not connected. Available accounts: ${available.join(", ") || "none"}`
    );
  }
  return [account];
}

// ---------------------------------------------------------------------------
// MCP server factory — registers all tools
// ---------------------------------------------------------------------------

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "gmail-mcp-server",
    version: "1.0.0",
  });

  // ---- list_accounts ----
  server.tool(
    "list_accounts",
    "List all connected Gmail accounts. Use the email addresses returned here as the 'account' parameter in other tools.",
    {},
    async () => {
      const accounts = tokenStore.listAccounts();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                connected_accounts: accounts,
                usage_hint:
                  "Use any email address as the 'account' parameter, or use 'all' to query every account.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ---- list_emails ----
  server.tool(
    "list_emails",
    "Search and list emails. Supports Gmail search syntax (is:unread, from:, newer_than:7d, etc). Use account='all' to search across all connected accounts.",
    {
      account: z
        .string()
        .describe(
          "Email address of the account to search, or 'all' for every connected account"
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Gmail search query (e.g. 'is:unread', 'from:user@example.com newer_than:2d', 'subject:invoice')"
        ),
      max_results: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of emails to return per account (1-100)"),
    },
    async ({ account, query, max_results }) => {
      const accounts = resolveAccounts(account);
      const allResults: Array<{ account: string; emails: any[] }> = [];

      for (const email of accounts) {
        try {
          const gmail = await getGmailServiceForAccount(email);
          const emails = await gmail.listEmails(query, max_results);
          allResults.push({ account: email, emails });
        } catch (err: any) {
          allResults.push({
            account: email,
            emails: [],
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(allResults, null, 2),
          },
        ],
      };
    }
  );

  // ---- get_email ----
  server.tool(
    "get_email",
    "Get the full content of a specific email including body, headers, and any unsubscribe links found.",
    {
      account: z
        .string()
        .describe("Email address of the account this message belongs to"),
      message_id: z.string().describe("The Gmail message ID"),
    },
    async ({ account, message_id }) => {
      const gmail = await getGmailServiceForAccount(account);
      const email = await gmail.getEmail(message_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ account, ...email }, null, 2),
          },
        ],
      };
    }
  );

  // ---- archive_email ----
  server.tool(
    "archive_email",
    "Archive an email by removing it from the inbox. The email remains accessible via search or All Mail.",
    {
      account: z
        .string()
        .describe("Email address of the account this message belongs to"),
      message_id: z.string().describe("The Gmail message ID to archive"),
    },
    async ({ account, message_id }) => {
      const gmail = await getGmailServiceForAccount(account);
      const result = await gmail.archiveEmail(message_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              account,
              ...result,
              message: `Email ${message_id} archived successfully.`,
            }),
          },
        ],
      };
    }
  );

  // ---- apply_label ----
  server.tool(
    "apply_label",
    "Apply a label to an email. Creates the label if it does not already exist.",
    {
      account: z
        .string()
        .describe("Email address of the account this message belongs to"),
      message_id: z.string().describe("The Gmail message ID"),
      label_name: z
        .string()
        .describe(
          "Label name to apply (e.g. 'Receipts', 'Follow Up'). Created automatically if it does not exist."
        ),
    },
    async ({ account, message_id, label_name }) => {
      const gmail = await getGmailServiceForAccount(account);
      const result = await gmail.applyLabel(message_id, label_name);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              account,
              ...result,
              message: `Label "${label_name}" applied to email ${message_id}.`,
            }),
          },
        ],
      };
    }
  );

  // ---- unsubscribe_email ----
  server.tool(
    "unsubscribe_email",
    "Attempt to unsubscribe from a mailing list. Tries List-Unsubscribe header (HTTP and mailto), then scans the email body for unsubscribe links.",
    {
      account: z
        .string()
        .describe("Email address of the account this message belongs to"),
      message_id: z
        .string()
        .describe("The Gmail message ID to unsubscribe from"),
    },
    async ({ account, message_id }) => {
      const gmail = await getGmailServiceForAccount(account);
      const result = await gmail.unsubscribeEmail(message_id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ account, ...result }, null, 2),
          },
        ],
      };
    }
  );

  // ---- batch_process ----
  server.tool(
    "batch_process",
    "Fetch a batch of emails matching a query for triage. Returns structured data so you can decide which actions to take on each email. Use account='all' to scan all accounts.",
    {
      account: z
        .string()
        .describe(
          "Email address of the account to search, or 'all' for every connected account"
        ),
      query: z
        .string()
        .describe(
          "Gmail search query (e.g. 'is:unread category:promotions', 'newer_than:7d')"
        ),
      max_results: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of emails to fetch per account"),
    },
    async ({ account, query, max_results }) => {
      const accounts = resolveAccounts(account);
      const allResults: Array<{ account: string; emails: any[] }> = [];

      for (const email of accounts) {
        try {
          const gmail = await getGmailServiceForAccount(email);
          const emails = await gmail.batchProcess(query, max_results);
          allResults.push({ account: email, emails });
        } catch (err: any) {
          allResults.push({ account: email, emails: [] });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total: allResults.reduce((n, r) => n + r.emails.length, 0),
                query,
                results: allResults,
                hint: "Review each email and decide whether to archive, label, unsubscribe, or skip. Use the individual tools with the correct account parameter.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Admin auth middleware for /setup routes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MCP auth middleware — Bearer token check on /mcp routes
// ---------------------------------------------------------------------------

function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  if (!MCP_AUTH_TOKEN) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing Bearer token" },
      id: null,
    });
    return;
  }

  const provided = header.slice("Bearer ".length);
  const expected = MCP_AUTH_TOKEN;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: invalid Bearer token" },
      id: null,
    });
    return;
  }

  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const key =
    req.query.key as string | undefined ??
    req.headers["x-admin-key"] as string | undefined;

  if (key !== ADMIN_PASSWORD) {
    res.status(401).send(`
      <html><body style="font-family:system-ui;max-width:400px;margin:80px auto;text-align:center">
        <h2>Admin Login</h2>
        <form method="GET">
          <input type="password" name="key" placeholder="Admin password" style="padding:8px;width:100%;box-sizing:border-box;margin-bottom:12px" />
          <button type="submit" style="padding:8px 24px">Login</button>
        </form>
      </body></html>
    `);
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Setup page — manage connected Gmail accounts
// ---------------------------------------------------------------------------

app.get("/setup", requireAdmin, (_req: Request, res: Response) => {
  const accounts = tokenStore.listAccounts();
  const key = _req.query.key as string;
  const message = _req.query.message as string | undefined;

  const accountRows = accounts.length > 0
    ? accounts
        .map(
          (a) => `
        <tr>
          <td>${a.email}</td>
          <td>${new Date(a.addedAt).toLocaleDateString()}</td>
          <td>
            <form method="POST" action="/setup/remove?key=${encodeURIComponent(key)}" style="display:inline">
              <input type="hidden" name="email" value="${a.email}" />
              <button type="submit" onclick="return confirm('Remove ${a.email}?')" style="color:red;background:none;border:1px solid red;padding:4px 12px;cursor:pointer">Remove</button>
            </form>
          </td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="3" style="text-align:center;color:#888">No accounts connected yet</td></tr>`;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Gmail MCP — Setup</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; }
        h1 { font-size: 1.5rem; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #eee; }
        th { font-weight: 600; border-bottom: 2px solid #ddd; }
        .btn { display: inline-block; padding: 10px 24px; background: #4285f4; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; }
        .btn:hover { background: #3367d6; }
        .msg { padding: 12px; background: #e8f5e9; border-radius: 6px; margin-bottom: 16px; }
        .msg.error { background: #fce4ec; }
      </style>
    </head>
    <body>
      <h1>Gmail MCP Server — Setup</h1>
      ${message ? `<div class="msg">${message}</div>` : ""}
      <table>
        <thead><tr><th>Account</th><th>Added</th><th></th></tr></thead>
        <tbody>${accountRows}</tbody>
      </table>
      <a class="btn" href="/oauth/start?key=${encodeURIComponent(key)}">+ Add Gmail Account</a>
      ${accounts.length > 0 ? `
      <div style="margin-top:24px;padding:16px;background:#fff3cd;border-radius:6px">
        <strong>Important:</strong> After adding/removing accounts, copy the value below and paste it as the <code>TOKENS_DATA</code> environment variable in Railway. This ensures accounts survive redeploys.
        <div style="margin-top:8px">
          <textarea readonly style="width:100%;height:60px;font-family:monospace;font-size:11px;box-sizing:border-box" onclick="this.select()">${tokenStore.getTokensDataForExport()}</textarea>
        </div>
      </div>
      ` : ""}
      <hr style="margin-top:40px;border:none;border-top:1px solid #eee" />
      <p style="color:#888;font-size:13px">
        MCP endpoint: <code>${SERVER_URL}/mcp</code><br/>
        Connected accounts: ${accounts.length}
      </p>
    </body>
    </html>
  `);
});

app.post("/setup/remove", requireAdmin, (req: Request, res: Response) => {
  const email = req.body.email;
  const key = req.query.key as string;

  if (email && tokenStore.hasAccount(email)) {
    tokenStore.removeAccount(email);
    res.redirect(`/setup?key=${encodeURIComponent(key)}&message=${encodeURIComponent(`Removed ${email}`)}`);
  } else {
    res.redirect(`/setup?key=${encodeURIComponent(key)}&message=${encodeURIComponent("Account not found")}`);
  }
});

// ---------------------------------------------------------------------------
// OAuth flow — server-managed Google auth
// ---------------------------------------------------------------------------

app.get("/oauth/start", (req: Request, res: Response) => {
  const key = req.query.key as string;
  if (key !== ADMIN_PASSWORD) {
    res.status(401).send("Unauthorized");
    return;
  }

  const oauth2 = makeOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: key, // pass admin key through OAuth flow
  });

  res.redirect(url);
});

app.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const error = req.query.error as string;

  if (error) {
    res.redirect(
      `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent(`OAuth error: ${error}`)}`
    );
    return;
  }

  if (!code) {
    res.redirect(
      `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent("No authorization code received")}`
    );
    return;
  }

  try {
    const oauth2 = makeOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      res.redirect(
        `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent("No refresh token received. Try removing the app from your Google account permissions and re-adding.")}`
      );
      return;
    }

    // Get the user's email address
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const userInfo = await oauth2Api.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      res.redirect(
        `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent("Could not determine email address")}`
      );
      return;
    }

    tokenStore.addAccount(email, tokens.refresh_token);

    res.redirect(
      `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent(`Successfully connected ${email}`)}`
    );
  } catch (err: any) {
    console.error("[oauth/callback] Error:", err);
    res.redirect(
      `/setup?key=${encodeURIComponent(state)}&message=${encodeURIComponent(`Error: ${err.message}`)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    accounts: tokenStore.size,
  });
});

// ---------------------------------------------------------------------------
// MCP transport — Streamable HTTP (stateless: each request gets a fresh server)
// ---------------------------------------------------------------------------

app.post("/mcp", requireMcpAuth, async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
    });

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);

    await transport.handleRequest(req, res, req.body);

    // Clean up after response is sent
    res.on("close", () => {
      mcpServer.close().catch(() => {});
      transport.close().catch(() => {});
    });
  } catch (err: any) {
    console.error("[mcp] Error handling request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: err.message },
        id: null,
      });
    }
  }
});

app.get("/mcp", requireMcpAuth, async (req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "SSE streams not supported in stateless mode. Use POST." },
    id: null,
  });
});

app.delete("/mcp", requireMcpAuth, async (req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Session management not used in stateless mode." },
    id: null,
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Gmail MCP server listening on port ${PORT}`);
  console.log(`  MCP endpoint:  ${SERVER_URL}/mcp`);
  console.log(`  Setup page:    ${SERVER_URL}/setup`);
  console.log(`  Health check:  ${SERVER_URL}/health`);
  console.log(`  Accounts:      ${tokenStore.size}`);
  if (MCP_AUTH_TOKEN) {
    console.log(`  MCP auth:      Bearer token required`);
  } else {
    console.warn(
      "\n  ⚠  WARNING: MCP_AUTH_TOKEN is not set — /mcp endpoint is open to any caller.\n" +
        "     Anyone who reaches this URL can query every connected Gmail account.\n" +
        "     Set MCP_AUTH_TOKEN to a strong random value before deploying publicly.\n" +
        "     Generate one with: openssl rand -base64 48\n"
    );
  }
});
