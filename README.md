# Gmail MCP Server — Multi-Account Gmail for AI Assistants

An open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects AI assistants to Gmail with full read and write access. Supports multiple Gmail accounts, email search, archive, labeling, and automatic unsubscribe — all through a single MCP server.

Works with **Claude**, **Cursor**, **Windsurf**, **Cline**, **Continue**, and any MCP-compatible client.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/new?referralCode=)

---

## Gmail MCP Server vs Built-in Connectors

| Feature | Built-in Gmail (Claude) | Gmail MCP Server |
|---|---|---|
| Read emails | Yes | Yes |
| Write / modify emails | No | **Yes** |
| Multiple Gmail accounts | No | **Yes** |
| Archive emails | No | **Yes** |
| Apply labels | No | **Yes** |
| Auto-unsubscribe | No | **Yes** |
| Works with Cursor | No | **Yes** |
| Works with Windsurf | No | **Yes** |
| Works with Cline | No | **Yes** |
| Open source | No | **Yes** |

---

## What is an MCP Server?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open standard that lets AI assistants connect to external tools and data sources. An MCP server exposes "tools" that AI assistants can call — like searching emails, archiving messages, or unsubscribing from newsletters.

This Gmail MCP server turns any MCP-compatible AI assistant into a full email agent.

---

## Gmail MCP Server Features

- **Multi-account** — connect multiple Gmail accounts and switch between them, or query all at once
- **Full read + write** — not just reading emails, but archiving, labeling, and modifying them
- **Gmail search syntax** — use Gmail's powerful query language (`is:unread`, `from:`, `newer_than:7d`, `has:attachment`, etc.)
- **Auto-unsubscribe** — automatically finds and triggers unsubscribe links (List-Unsubscribe headers, mailto, body links)
- **Batch operations** — fetch batches of emails for AI-powered triage
- **Secure** — OAuth 2.0 with encrypted token storage, minimal scopes, no passwords stored
- **Self-hostable** — deploy to Railway, run on your own server, or use Docker

---

## Available Tools

| Tool | Description |
|---|---|
| `list_accounts` | List all connected Gmail accounts |
| `list_emails` | Search and list emails with Gmail query syntax. Supports `account="all"` |
| `get_email` | Get full email content, headers, and parsed unsubscribe links |
| `archive_email` | Archive an email (remove from inbox) |
| `apply_label` | Apply a label to an email (creates the label if it doesn't exist) |
| `unsubscribe_email` | Auto-unsubscribe from mailing lists |
| `batch_process` | Fetch a batch of emails for AI-powered triage. Supports `account="all"` |

---

## Setup Guide — Deploy in 5 Minutes

### Prerequisites

1. A [Google Cloud](https://console.cloud.google.com) project with the **Gmail API** enabled
2. OAuth 2.0 credentials (Web application type)
3. A hosting platform ([Railway](https://railway.app), your own server, or Docker)

### Step 1: Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a new project
2. Enable the **Gmail API** (APIs & Services → Library → search "Gmail API" → Enable)
3. Configure **OAuth consent screen**:
   - User type: External
   - Add scopes: `gmail.readonly`, `gmail.modify`
   - Add your Gmail addresses as test users
4. Create **OAuth credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URI: `https://your-server-url/oauth/callback`
   - Save the **Client ID** and **Client Secret**

### Step 2: Deploy

#### Option A: Deploy to Railway (Recommended)

1. Click the Deploy button above, or create a new project on [Railway](https://railway.app) connected to this repo
2. Add these environment variables:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Your OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your OAuth Client Secret |
| `ENCRYPTION_KEY` | Any random string (32+ characters) |
| `ADMIN_PASSWORD` | Password for the setup page |
| `SERVER_URL` | Your Railway app URL (e.g., `https://your-app.railway.app`) |
| `PORT` | `3000` |

3. Generate a domain in Railway (Service → Settings → Networking → Generate Domain)
4. Update `SERVER_URL` with the generated domain
5. Update the **Authorized redirect URI** in Google Cloud Console to `https://your-domain.railway.app/oauth/callback`

#### Option B: Self-Host

```bash
git clone https://github.com/navbuildz/gmail-mcp-server.git
cd gmail-mcp-server
npm install
cp .env.example .env
# Edit .env with your values
npm run build
npm start
```

#### Option C: Docker

```bash
docker build -t gmail-mcp-server .
docker run -p 3000:3000 \
  -e GOOGLE_CLIENT_ID=your-client-id \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -e ENCRYPTION_KEY=your-random-string \
  -e ADMIN_PASSWORD=your-password \
  -e SERVER_URL=https://your-domain.com \
  gmail-mcp-server
```

### Step 3: Connect Gmail Accounts

1. Visit `https://your-server-url/setup`
2. Enter your admin password
3. Click **+ Add Gmail Account**
4. Sign in with Google and grant permissions
5. Repeat for each Gmail account you want to connect

> **Railway users:** After adding accounts, copy the `TOKENS_DATA` value shown on the setup page and add it as an environment variable in Railway. This ensures accounts persist across redeploys.

---

## How to Connect Gmail MCP Server to Claude

1. Go to [Claude](https://claude.ai) → Settings → Connectors
2. Click **+** → Add custom connector
3. Fill in:
   - **Name**: `Gmail` (or any name you prefer)
   - **Remote MCP server URL**: `https://your-server-url/mcp`
   - Leave OAuth fields blank
4. Click **Add**
5. Start a new conversation and try: *"List my connected Gmail accounts"*

---

## How to Connect Gmail MCP Server to Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "gmail": {
      "url": "https://your-server-url/mcp"
    }
  }
}
```

---

## How to Connect Gmail MCP Server to Windsurf

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "gmail": {
      "serverUrl": "https://your-server-url/mcp"
    }
  }
}
```

---

## Multi-Account Gmail Setup

Connect as many Gmail accounts as you need. Each tool accepts an `account` parameter:

- Use a specific email: `"account": "user@gmail.com"`
- Query all accounts: `"account": "all"`

**Example prompts:**
- *"Show me unread emails from the last 2 days across all accounts"*
- *"Archive all promotional emails in user@gmail.com"*
- *"Unsubscribe from newsletters in all accounts"*
- *"Find emails with attachments from the last week in work@gmail.com"*

---

## Auto-Unsubscribe from Newsletters

The `unsubscribe_email` tool automatically:

1. Checks the `List-Unsubscribe` header (RFC 8058 one-click POST)
2. Tries HTTP unsubscribe links from the header
3. Sends an unsubscribe email via `mailto:` links
4. Scans the email body for unsubscribe URLs
5. Returns manual links if auto-unsubscribe fails

**Example:** *"Find newsletters from the last month and unsubscribe from all of them"*

---

## Supported MCP Clients

| Client | Status | Configuration |
|---|---|---|
| [Claude](https://claude.ai) (Web, Desktop, Code) | Supported | Custom connector → Remote MCP server URL |
| [Cursor](https://cursor.com) | Supported | `.cursor/mcp.json` |
| [Windsurf](https://codeium.com/windsurf) | Supported | MCP configuration |
| [Cline](https://github.com/cline/cline) | Supported | MCP settings |
| [Continue](https://continue.dev) | Supported | MCP configuration |
| Any MCP-compatible client | Supported | Point to `/mcp` endpoint |

---

## Architecture

```
AI Assistant (Claude / Cursor / Windsurf / Cline)
  ↓ MCP Protocol (Streamable HTTP)
Gmail MCP Server (Railway / Self-hosted / Docker)
  ├── /mcp          ← MCP endpoint (tools)
  ├── /setup        ← Admin page (add/remove accounts)
  ├── /oauth/callback ← Google OAuth callback
  └── Token Store   ← Encrypted refresh tokens
        ↓
Gmail API (per-account OAuth tokens)
```

---

## Security

- **OAuth 2.0** — industry-standard authentication with Google
- **Encrypted storage** — refresh tokens encrypted with AES-256-GCM
- **Minimal scopes** — only `gmail.readonly` and `gmail.modify`
- **No passwords** — your Gmail password never touches the server
- **Admin-protected setup** — the `/setup` page requires a password
- **Revocable** — remove access anytime from [Google Account Permissions](https://myaccount.google.com/permissions)

---

## Gmail Search Query Examples

The `list_emails` and `batch_process` tools accept Gmail's full search syntax:

| Query | What it finds |
|---|---|
| `is:unread` | Unread emails |
| `is:unread newer_than:2d` | Unread emails from the last 2 days |
| `from:user@example.com` | Emails from a specific sender |
| `subject:invoice` | Emails with "invoice" in the subject |
| `has:attachment` | Emails with attachments |
| `category:promotions` | Promotional emails |
| `newer_than:7d` | Emails from the last week |
| `after:2025/01/01 before:2025/02/01` | Emails in a date range |
| `label:important is:unread` | Unread important emails |
| `larger:5M` | Emails larger than 5MB |

---

## Contributing

Contributions are welcome! Here are some ideas:

- [ ] Add `send_email` tool for composing and sending emails
- [ ] Add `reply_to_email` tool
- [ ] Add email attachment download support
- [ ] Add `delete_email` tool
- [ ] Add `mark_as_read` / `mark_as_unread` tools
- [ ] Add `remove_label` tool
- [ ] Add support for Google Workspace accounts

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **Gmail API**: [googleapis](https://github.com/googleapis/google-api-nodejs-client)
- **HTTP**: Express 5
- **Auth**: Google OAuth 2.0

---

## License

[MIT](LICENSE) — use it however you want.

---

## Star History

If this project is useful to you, please consider giving it a star. It helps others discover it.
