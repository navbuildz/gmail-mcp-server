import { google, gmail_v1 } from "googleapis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  labelIds: string[];
}

export interface EmailDetail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  labelIds: string[];
  headers: Record<string, string>;
  unsubscribeLinks: string[];
}

export interface ComposeInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  htmlBody?: string;
  /** Reply in the thread of this message: sets threading headers, Re: subject and default recipient. */
  replyToMessageId?: string;
  /** Reply to the sender and everyone else on the original (minus yourself). */
  replyAll?: boolean;
}

export interface ComposeResult {
  id: string;
  threadId: string;
  draftId?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
}

export interface UnsubscribeResult {
  success: boolean;
  method: "header-mailto" | "header-http" | "body-link" | "none";
  detail: string;
}

// ---------------------------------------------------------------------------
// Gmail Service — one instance per access token (per session)
// ---------------------------------------------------------------------------

export class GmailService {
  private gmail: gmail_v1.Gmail;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  // -----------------------------------------------------------------------
  // list_emails
  // -----------------------------------------------------------------------

  async listEmails(
    query?: string,
    maxResults: number = 20
  ): Promise<EmailSummary[]> {
    const res = await this.gmail.users.messages.list({
      userId: "me",
      q: query || undefined,
      maxResults: Math.min(maxResults, 100),
    });

    const messageIds = res.data.messages ?? [];
    if (messageIds.length === 0) return [];

    // Fetch headers for each message in parallel (batched)
    const summaries = await Promise.all(
      messageIds.map((m) => this.getEmailSummary(m.id!))
    );

    return summaries;
  }

  private async getEmailSummary(messageId: string): Promise<EmailSummary> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = res.data.payload?.headers ?? [];
    const hdr = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    return {
      id: res.data.id!,
      threadId: res.data.threadId!,
      subject: hdr("Subject"),
      from: hdr("From"),
      date: hdr("Date"),
      snippet: res.data.snippet ?? "",
      labelIds: res.data.labelIds ?? [],
    };
  }

  // -----------------------------------------------------------------------
  // get_email
  // -----------------------------------------------------------------------

  async getEmail(messageId: string): Promise<EmailDetail> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = res.data.payload?.headers ?? [];
    const hdr = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const headersMap: Record<string, string> = {};
    for (const h of headers) {
      if (h.name && h.value) headersMap[h.name] = h.value;
    }

    const body = this.extractBody(res.data.payload ?? {});
    const unsubscribeLinks = this.parseUnsubscribeLinks(headersMap, body);

    return {
      id: res.data.id!,
      threadId: res.data.threadId!,
      subject: hdr("Subject"),
      from: hdr("From"),
      to: hdr("To"),
      date: hdr("Date"),
      snippet: res.data.snippet ?? "",
      body,
      labelIds: res.data.labelIds ?? [],
      headers: headersMap,
      unsubscribeLinks,
    };
  }

  // -----------------------------------------------------------------------
  // archive_email — remove INBOX label
  // -----------------------------------------------------------------------

  async archiveEmail(messageId: string): Promise<{ success: boolean }> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        removeLabelIds: ["INBOX"],
      },
    });
    return { success: true };
  }

  // -----------------------------------------------------------------------
  // apply_label — create if needed, then apply
  // -----------------------------------------------------------------------

  async applyLabel(
    messageId: string,
    labelName: string
  ): Promise<{ success: boolean; labelId: string }> {
    const labelId = await this.getOrCreateLabel(labelName);

    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    return { success: true, labelId };
  }

  private async getOrCreateLabel(labelName: string): Promise<string> {
    // Check existing labels
    const res = await this.gmail.users.labels.list({ userId: "me" });
    const existing = (res.data.labels ?? []).find(
      (l) => l.name?.toLowerCase() === labelName.toLowerCase()
    );
    if (existing) return existing.id!;

    // Create new label
    const created = await this.gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return created.data.id!;
  }

  // -----------------------------------------------------------------------
  // unsubscribe_email
  // -----------------------------------------------------------------------

  async unsubscribeEmail(messageId: string): Promise<UnsubscribeResult> {
    const email = await this.getEmail(messageId);
    const listUnsubscribe = email.headers["List-Unsubscribe"] ?? "";

    // 1. Try HTTP link from List-Unsubscribe header
    const httpLinks = this.extractHttpLinks(listUnsubscribe);
    for (const link of httpLinks) {
      try {
        const resp = await fetch(link, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          return {
            success: true,
            method: "header-http",
            detail: `Successfully requested unsubscribe via header link: ${link}`,
          };
        }
      } catch {
        // Try next link
      }
    }

    // 2. Try POST to List-Unsubscribe with List-Unsubscribe-Post header
    const postHeader = email.headers["List-Unsubscribe-Post"];
    if (postHeader && httpLinks.length > 0) {
      for (const link of httpLinks) {
        try {
          const resp = await fetch(link, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: postHeader,
            redirect: "follow",
            signal: AbortSignal.timeout(10000),
          });
          if (resp.ok) {
            return {
              success: true,
              method: "header-http",
              detail: `Successfully POSTed unsubscribe via RFC 8058: ${link}`,
            };
          }
        } catch {
          // Try next
        }
      }
    }

    // 3. Try mailto from List-Unsubscribe header
    const mailtoMatch = listUnsubscribe.match(/mailto:([^>,\s]+)/i);
    if (mailtoMatch) {
      const mailtoAddr = mailtoMatch[1];
      try {
        await this.sendUnsubscribeMail(mailtoAddr);
        return {
          success: true,
          method: "header-mailto",
          detail: `Sent unsubscribe email to ${mailtoAddr}`,
        };
      } catch (err) {
        // Fall through
      }
    }

    // 4. Scan body for unsubscribe links
    const bodyLinks = this.extractUnsubscribeLinksFromBody(email.body);
    for (const link of bodyLinks) {
      try {
        const resp = await fetch(link, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          return {
            success: true,
            method: "body-link",
            detail: `Visited unsubscribe link found in email body: ${link}`,
          };
        }
      } catch {
        // Try next
      }
    }

    // 5. Nothing worked — return the links we found so Claude can inform the user
    const allLinks = [...httpLinks, ...bodyLinks];
    return {
      success: false,
      method: "none",
      detail:
        allLinks.length > 0
          ? `Could not auto-unsubscribe. Found these links the user can try manually:\n${allLinks.join("\n")}`
          : "No unsubscribe mechanism found in this email.",
    };
  }

  private async sendUnsubscribeMail(toAddress: string): Promise<void> {
    // Compose a minimal unsubscribe email
    const raw = Buffer.from(
      [
        `To: ${toAddress}`,
        `Subject: Unsubscribe`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        "Unsubscribe",
      ].join("\r\n")
    )
      .toString("base64url");

    await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  }

  // -----------------------------------------------------------------------
  // create_draft / send_email
  // -----------------------------------------------------------------------

  async createDraft(input: ComposeInput): Promise<ComposeResult> {
    const { raw, threadId, meta } = await this.buildMessage(input);
    const res = await this.gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId } },
    });
    return {
      id: res.data.message?.id ?? "",
      threadId: res.data.message?.threadId ?? "",
      draftId: res.data.id ?? undefined,
      ...meta,
    };
  }

  async sendEmail(input: ComposeInput): Promise<ComposeResult> {
    const { raw, threadId, meta } = await this.buildMessage(input);
    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId },
    });
    return { id: res.data.id ?? "", threadId: res.data.threadId ?? "", ...meta };
  }

  /** Sends an existing draft exactly as it is saved in Gmail. */
  async sendDraft(draftId: string): Promise<ComposeResult> {
    const draft = await this.gmail.users.drafts.get({ userId: "me", id: draftId, format: "metadata" });
    const hdrs = draft.data.message?.payload?.headers ?? [];
    const h = (n: string) => hdrs.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
    const res = await this.gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return {
      id: res.data.id ?? "",
      threadId: res.data.threadId ?? "",
      draftId,
      to: splitAddresses(h("To")),
      cc: splitAddresses(h("Cc")),
      bcc: splitAddresses(h("Bcc")),
      subject: h("Subject"),
    };
  }

  private async buildMessage(input: ComposeInput): Promise<{
    raw: string;
    threadId?: string;
    meta: Omit<ComposeResult, "id" | "threadId" | "draftId">;
  }> {
    let to = clean(input.to);
    let cc = clean(input.cc);
    const bcc = clean(input.bcc);
    let subject = input.subject ?? "";
    let threadId: string | undefined;
    const extra: string[] = [];

    if (input.replyToMessageId) {
      const orig = await this.gmail.users.messages.get({
        userId: "me",
        id: input.replyToMessageId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Reply-To", "To", "Cc", "Message-ID", "References"],
      });
      const hdrs = orig.data.payload?.headers ?? [];
      const h = (n: string) => hdrs.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      threadId = orig.data.threadId ?? undefined;
      const messageId = h("Message-ID");
      if (messageId) {
        extra.push(`In-Reply-To: ${messageId}`);
        extra.push(`References: ${[h("References"), messageId].filter(Boolean).join(" ")}`);
      }
      if (!subject) {
        const s = h("Subject");
        subject = /^re:/i.test(s) ? s : `Re: ${s}`;
      }
      if (to.length === 0) {
        to = splitAddresses(h("Reply-To") || h("From"));
        if (input.replyAll) {
          const me = (await this.gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() ?? "";
          const seen = new Set(to.map(bareAddress));
          const others = [...splitAddresses(h("To")), ...splitAddresses(h("Cc"))].filter((a) => {
            const b = bareAddress(a);
            if (b === me || seen.has(b)) return false;
            seen.add(b);
            return true;
          });
          cc = [...cc, ...others];
        }
      }
    }

    if (to.length + cc.length + bcc.length === 0) {
      throw new Error("No recipients. Pass 'to' (or reply_to_message_id to answer the sender).");
    }
    for (const v of [...to, ...cc, ...bcc, subject]) {
      if (/[\r\n]/.test(v)) throw new Error("Recipients and subject cannot contain line breaks.");
    }

    const headers = [
      ...(to.length ? [`To: ${to.join(", ")}`] : []),
      ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
      ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      ...extra,
    ];

    let mime: string;
    if (input.htmlBody) {
      const boundary = `b_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      mime = [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        ...textPart("text/plain", input.body),
        `--${boundary}`,
        ...textPart("text/html", input.htmlBody),
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      mime = [...headers, ...textPart("text/plain", input.body)].join("\r\n");
    }

    return {
      raw: Buffer.from(mime, "utf8").toString("base64url"),
      threadId,
      meta: { to, cc, bcc, subject },
    };
  }

  // -----------------------------------------------------------------------
  // batch_process — fetch structured data for Claude to decide on
  // -----------------------------------------------------------------------

  async batchProcess(
    query: string,
    maxResults: number = 20
  ): Promise<EmailSummary[]> {
    return this.listEmails(query, maxResults);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private extractBody(payload: gmail_v1.Schema$MessagePart): string {
    // Prefer text/plain, fall back to text/html
    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }

    if (payload.mimeType === "text/html" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }

    // Multipart: recurse
    if (payload.parts) {
      // Try text/plain first
      for (const part of payload.parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
      }
      // Fall back to text/html
      for (const part of payload.parts) {
        if (part.mimeType === "text/html" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
      }
      // Recurse into nested multipart
      for (const part of payload.parts) {
        const result = this.extractBody(part);
        if (result) return result;
      }
    }

    return "";
  }

  private parseUnsubscribeLinks(
    headers: Record<string, string>,
    body: string
  ): string[] {
    const links: string[] = [];

    // From List-Unsubscribe header
    const listUnsub = headers["List-Unsubscribe"] ?? "";
    links.push(...this.extractHttpLinks(listUnsub));

    const mailtoMatch = listUnsub.match(/mailto:([^>,\s]+)/i);
    if (mailtoMatch) links.push(`mailto:${mailtoMatch[1]}`);

    // From body
    links.push(...this.extractUnsubscribeLinksFromBody(body));

    return [...new Set(links)];
  }

  private extractHttpLinks(text: string): string[] {
    const matches = text.match(/https?:\/\/[^>,\s<]+/gi);
    return matches ?? [];
  }

  private extractUnsubscribeLinksFromBody(body: string): string[] {
    const links: string[] = [];
    // Match href links near "unsubscribe" text
    const hrefPattern =
      /href\s*=\s*["']?(https?:\/\/[^"'\s>]+(?:unsubscribe|opt.?out|remove|manage.?preferences)[^"'\s>]*)["']?/gi;
    let match;
    while ((match = hrefPattern.exec(body)) !== null) {
      links.push(match[1]);
    }
    // Also match plain URLs with unsubscribe keywords
    const urlPattern =
      /(https?:\/\/\S+(?:unsubscribe|opt.?out|remove|manage.?preferences)\S*)/gi;
    while ((match = urlPattern.exec(body)) !== null) {
      if (!links.includes(match[1])) {
        links.push(match[1]);
      }
    }
    return [...new Set(links)];
  }
}

// ---------------------------------------------------------------------------
// MIME helpers for compose
// ---------------------------------------------------------------------------

function clean(list?: string[]): string[] {
  return (list ?? []).flatMap(splitAddresses);
}

/** Splits "a@x.com, \"Doe, Jane\" <j@y.com>" on commas outside quotes and angle brackets. */
function splitAddresses(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<") angle = true;
    else if (ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function bareAddress(a: string): string {
  return (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase();
}

/** RFC 2047 encoding, only when the subject is not plain ASCII. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function textPart(type: "text/plain" | "text/html", content: string): string[] {
  const b64 = Buffer.from(content, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `Content-Type: ${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64,
  ];
}
