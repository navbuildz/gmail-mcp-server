# Multi-account Gmail MCP Server

### Gmail for AI Agents & Assistants

An open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI agents and assistants full read and write access to Gmail. Connect multiple Gmail accounts, search emails, archive, label, and auto-unsubscribe. All through one server.

![Gmail MCP Server Banner](banner.png)

Works with **Claude**, **OpenClaw**, **Cursor**, **Windsurf**, **Cline**, **Continue**, and any MCP-compatible client.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https://github.com/navbuildz/gmail-mcp-server)

---

## Why This Exists

Most AI tools ship with a Gmail integration tied to a single account, with no way to unsubscribe, and they only work inside one app. If you use multiple Gmail accounts, or want the same email tools in Claude, Cursor and your own agents, you're out of luck.

This MCP server fixes that. One server, all your accounts, full read and write access.

## Gmail MCP Server vs Built-in Connectors

| Feature | Built-in Gmail (Claude) | Gmail MCP Server |
|---|---|---|
| Read and search emails | Yes | Yes |
| Drafts, send, labels | Yes | Yes |
| Multiple Gmail accounts at once | No | **Yes** |
| Search across all accounts in one call | No | **Yes** |
| Unsubscribe (RFC 8058 one-click + mailto) | No | **Yes** |
| Works with OpenClaw, Cursor, Windsurf, Cline | No | **Yes** |
| Self-hosted, open source | No | **Yes** |

---

## What is an MCP Server?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open standard that lets AI agents and assistants connect to external tools and data sources. An MCP server exposes tools that any compatible client can call. Think of it as a plugin system for AI.

This Gmail MCP server turns any MCP-compatible AI client into a full-featured email agent.

---

## Gmail MCP Server Features

- **Multi-account support.** Connect multiple Gmail accounts and pick one per call, or search all of them at once.
- **Full read and write access.** Not just reading emails. Archive, label, draft, send, and unsubscribe.
- **Gmail search syntax.** Use Gmail's query language: `is:unread`, `from:`, `newer_than:7d`, `has:attachment`, and more.
- **Honest unsubscribe.** Uses the RFC 8058 one-click POST or sends the `mailto:` request from the right account, and only reports success when the sender accepted it. Anything that needs a human click comes back as a link to open.
- **Batch operations.** Fetch batches of emails for AI-powered triage and bulk actions.
- **Secure by design.** OAuth 2.0 authentication, AES-256-GCM encrypted token storage, minimal Gmail scopes.
- **Deploy anywhere.** Vercel (free), Railway, Docker, or your own server.

---

## Available Tools

| Tool | Description |
|---|---|
| `list_accounts` | List all connected Gmail accounts |
| `list_emails` | Search and list emails using Gmail query syntax. Supports `account="all"` |
| `get_email` | Get full email content, headers, and parsed unsubscribe links |
| `archive_email` | Archive an email by removing it from the inbox |
| `apply_label` | Apply a label to an email. Creates the label if it doesn't exist |
| `create_draft` | Create a draft (new or a reply in the thread). Nothing is sent |
| `send_email` | Send a new email or reply, or send an existing draft by `draft_id` |
| `unsubscribe_email` | Unsubscribe from a mailing list (one-click POST or mailto), or return the link to click |
| `batch_process` | Fetch a batch of emails for triage. Supports `account="all"` |

---

## Setup Guide: Deploy in 5 Minutes

### Prerequisites

1. A [Google Cloud](https://console.cloud.google.com) project with the **Gmail API** enabled
2. OAuth 2.0 credentials (Web application type)
3. A hosting platform ([Railway](https://railway.app), your own server, or Docker)

### Step 1: Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project
2. Enable the **Gmail API** (APIs & Services → Library → search "Gmail API" → Enable)
3. Configure the **OAuth consent screen**:
   - User type: External
   - Add scopes: `gmail.readonly`, `gmail.modify`
   - Add your Gmail addresses as test users
4. Create **OAuth credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URI: `https://your-server-url/oauth/callback`
   - Save the **Client ID** and **Client Secret**

### Step 2: Deploy

#### Option A: Deploy to Vercel (free)

1. Import this repo in Vercel. `vercel.json` sets the Express preset
2. In the project, go to **Storage** and add **Upstash for Redis** (free plan). This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which is where connected accounts are saved (Vercel's disk does not persist)
3. Add the environment variables from the table below, with `SERVER_URL` set to `https://<project>.vercel.app` and no `PORT`
4. Add `https://<project>.vercel.app/oauth/callback` as an **Authorized redirect URI** in Google Cloud Console
5. Deploy

#### Option B: Deploy to Railway

1. Click the Deploy button above, or create a new project on [Railway](https://railway.app) connected to this repo
2. Add these environment variables:

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Your OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your OAuth Client Secret |
| `ENCRYPTION_KEY` | Any random string (32+ characters) |
| `ADMIN_PASSWORD` | Password for the setup page |
| `MCP_SECRET` | A long random string (`openssl rand -hex 24`). The MCP endpoint is `/mcp/<MCP_SECRET>`; without it every MCP request returns 404 |
| `SERVER_URL` | Your app URL (e.g., `https://your-app.railway.app`) |
| `PORT` | `3000` |

3. Generate a domain in Railway (Service → Settings → Networking → Generate Domain)
4. Update `SERVER_URL` with the generated domain
5. Update the **Authorized redirect URI** in Google Cloud Console to `https://your-domain.railway.app/oauth/callback`

#### Option C: Self-Host

```bash
git clone https://github.com/navbuildz/gmail-mcp-server.git
cd gmail-mcp-server
npm install
cp .env.example .env
# Edit .env with your values
npm run build
npm start
```

#### Option D: Docker

```bash
docker build -t gmail-mcp-server .
docker run -p 3000:3000 \
  -e GOOGLE_CLIENT_ID=your-client-id \
  -e GOOGLE_CLIENT_SECRET=your-client-secret \
  -e ENCRYPTION_KEY=your-random-string \
  -e ADMIN_PASSWORD=your-password \
  -e MCP_SECRET=your-long-random-secret \
  -e SERVER_URL=https://your-domain.com \
  gmail-mcp-server
```

### Step 3: Connect Gmail Accounts

1. Visit `https://your-server-url/setup`
2. Enter your admin password
3. Click **+ Add Gmail Account**
4. Sign in with Google and grant permissions
5. Repeat for each Gmail account you want to connect

> **Railway users without Redis:** After adding accounts, copy the `TOKENS_DATA=` value from the server logs and add it as an environment variable in Railway. This keeps your accounts connected across redeploys.

---

## How to Connect Gmail MCP Server to Claude

1. Go to [Claude](https://claude.ai) → Settings → Connectors
2. Click **+** → Add custom connector
3. Fill in:
   - **Name**: `Gmail` (or any name you prefer)
   - **Remote MCP server URL**: `https://your-server-url/mcp/<MCP_SECRET>` (choose "No sign-in"; the secret in the path is the credential)
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
      "url": "https://your-server-url/mcp/<MCP_SECRET>"
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
      "serverUrl": "https://your-server-url/mcp/<MCP_SECRET>"
    }
  }
}
```

---

## Multi-Account Gmail Setup

Connect as many Gmail accounts as you need. Every tool takes an `account` parameter:

- Use a specific email: `"account": "user@gmail.com"`
- Search all accounts at once: `"account": "all"` (`list_emails` and `batch_process` only; tools that change or send mail act on one account at a time)

**Example prompts you can try:**
- *"Show me unread emails from the last 2 days across all accounts"*
- *"Archive all promotional emails in user@gmail.com"*
- *"Find newsletters in each of my accounts and unsubscribe"*
- *"Find emails with attachments from the last week in work@gmail.com"*

---

## Unsubscribe from Newsletters with AI

The `unsubscribe_email` tool tries, in order:

1. **One-click POST** ([RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)) when the email has `List-Unsubscribe` plus `List-Unsubscribe-Post`. A 2xx response counts as confirmed.
2. **mailto:** sends the unsubscribe email from the account that received the newsletter.
3. **Manual links.** If neither works, it returns the unsubscribe links (from the header and the body) for you to open. It never opens a link and calls that success, because most landing pages still need a click.

Every call returns a `status`: `confirmed` (one-click accepted), `sent` (mailto sent), `needs_manual_click` (links returned), or `failed` (no unsubscribe mechanism found).

Try it: *"Find newsletters from the last month and unsubscribe from all of them"*

---

## Supported MCP Clients

| Client | Status | Configuration |
|---|---|---|
| [Claude](https://claude.ai) (Web, Desktop, Code) | Supported | Custom connector → Remote MCP server URL |
| [OpenClaw](https://openclaw.com) | Supported | MCP configuration |
| [Cursor](https://cursor.com) | Supported | `.cursor/mcp.json` |
| [Windsurf](https://codeium.com/windsurf) | Supported | MCP configuration |
| [Cline](https://github.com/cline/cline) | Supported | MCP settings |
| [Continue](https://continue.dev) | Supported | MCP configuration |
| Any MCP-compatible client | Supported | Point to the `/mcp/<MCP_SECRET>` endpoint |

---

## Architecture

```
AI Agent / Assistant (Claude, OpenClaw, Cursor, Windsurf, Cline)
  ↓ MCP Protocol (Streamable HTTP)
Gmail MCP Server (Vercel / Railway / Self-hosted / Docker)
  ├── /mcp/<secret>    MCP endpoint (tools)
  ├── /setup           Admin page (add/remove accounts)
  ├── /oauth/callback  Google OAuth callback
  └── Token Store      Encrypted refresh tokens (Upstash Redis, or a file)
        ↓
Gmail API (per-account OAuth tokens)
```

---

## Security

- **OAuth 2.0** for authentication with Google
- **AES-256-GCM** encrypted refresh token storage
- **Scopes:** `gmail.readonly`, `gmail.modify` (which also covers drafts and sending) and `userinfo.email` (to know which account was connected). No full `mail.google.com` access, so nothing is ever permanently deleted
- **No passwords stored.** Your Gmail password never touches the server
- **Secret MCP endpoint.** `/mcp/<MCP_SECRET>` is the only way in; anyone with that URL can use every tool, so treat it like a password
- **Sending is explicit.** `create_draft` never sends; `send_email` does, immediately. Set `send_email` to require approval in your MCP client if you want a confirmation step
- **Password-protected setup.** The `/setup` page requires admin authentication
- **Revocable anytime** from [Google Account Permissions](https://myaccount.google.com/permissions)

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

Want to help make this better? Here are some open ideas:

- [ ] Add email attachment download support
- [ ] Add `delete_email` tool
- [ ] Add `mark_as_read` / `mark_as_unread` tools
- [ ] Add `remove_label` tool
- [ ] Add support for Google Workspace accounts

PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

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

[MIT](LICENSE)

---

If this project is useful to you, give it a star. It helps others find it.
