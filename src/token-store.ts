import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Encrypted token store
//
// Persistence strategy (in priority order):
// 0. Upstash Redis, when its env vars are set (Vercel: the disk does not persist)
// 1. File on disk (works if volume is mounted or running locally)
// 2. TOKENS_DATA env var (base64-encoded JSON — survives Railway redeploys)
//
// On save: writes to both file AND logs the env var value so you can copy it.
// On load: tries file first, falls back to TOKENS_DATA env var.
// ---------------------------------------------------------------------------

interface StoredAccount {
  email: string;
  refreshToken: string; // encrypted
  addedAt: string;
}

interface StoreData {
  accounts: StoredAccount[];
}

const ALGORITHM = "aes-256-gcm";

function dataDir(): string {
  return process.env.DATA_DIR || "./data";
}

function dataFile(): string {
  return join(dataDir(), "accounts.json");
}

function deriveKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }
  return scryptSync(secret, "gmail-mcp-salt", 32);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decrypt(blob: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, encHex] = blob.split(":");
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

const REDIS_KEY = "gmail-mcp:accounts";

function redisClient(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export class TokenStore {
  private accounts = new Map<string, StoredAccount>();
  private redis = redisClient();

  constructor() {
    if (!this.redis) this.load();
  }

  /** Re-reads Redis so every serverless instance sees accounts added by another. */
  async refresh(): Promise<void> {
    if (!this.redis) return;
    const raw = await this.redis.get<StoreData>(REDIS_KEY);
    this.accounts = new Map((raw?.accounts ?? []).map((a) => [a.email, a]));
  }

  private load(): void {
    // Try file first
    try {
      const dir = dataDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file = dataFile();
      if (existsSync(file)) {
        const raw: StoreData = JSON.parse(readFileSync(file, "utf8"));
        for (const acct of raw.accounts ?? []) {
          this.accounts.set(acct.email, acct);
        }
        console.log(`[token-store] Loaded ${this.accounts.size} account(s) from file`);
        return;
      }
    } catch (err) {
      console.error("[token-store] Failed to load from file", err);
    }

    // Fall back to TOKENS_DATA env var
    const envData = process.env.TOKENS_DATA;
    if (envData) {
      try {
        const raw: StoreData = JSON.parse(
          Buffer.from(envData, "base64").toString("utf8")
        );
        for (const acct of raw.accounts ?? []) {
          this.accounts.set(acct.email, acct);
        }
        console.log(`[token-store] Loaded ${this.accounts.size} account(s) from TOKENS_DATA env var`);
        // Write to file so subsequent saves work
        this.saveToFile();
        return;
      } catch (err) {
        console.error("[token-store] Failed to parse TOKENS_DATA env var", err);
      }
    }

    console.log("[token-store] No existing accounts found — starting fresh");
  }

  private saveToFile(): void {
    try {
      const dir = dataDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        dataFile(),
        JSON.stringify(
          { accounts: Array.from(this.accounts.values()) } satisfies StoreData,
          null,
          2
        )
      );
    } catch (err) {
      console.error("[token-store] Failed to write file", err);
    }
  }

  private async save(): Promise<void> {
    if (this.redis) {
      await this.redis.set(REDIS_KEY, {
        accounts: Array.from(this.accounts.values()),
      } satisfies StoreData);
      return;
    }
    this.saveToFile();

    // Also output the base64-encoded data for the TOKENS_DATA env var
    const data: StoreData = { accounts: Array.from(this.accounts.values()) };
    const encoded = Buffer.from(JSON.stringify(data)).toString("base64");
    console.log(`[token-store] TOKENS_DATA=${encoded}`);
  }

  /** Returns base64-encoded token data for copying to env var */
  getTokensDataForExport(): string {
    const data: StoreData = { accounts: Array.from(this.accounts.values()) };
    return Buffer.from(JSON.stringify(data)).toString("base64");
  }

  async addAccount(email: string, refreshToken: string): Promise<void> {
    this.accounts.set(email, {
      email,
      refreshToken: encrypt(refreshToken),
      addedAt: new Date().toISOString(),
    });
    await this.save();
    console.log(`[token-store] Added account: ${email}`);
  }

  async removeAccount(email: string): Promise<boolean> {
    const deleted = this.accounts.delete(email);
    if (deleted) {
      await this.save();
      console.log(`[token-store] Removed account: ${email}`);
    }
    return deleted;
  }

  getRefreshToken(email: string): string | null {
    const acct = this.accounts.get(email);
    if (!acct) return null;
    try {
      return decrypt(acct.refreshToken);
    } catch (err) {
      console.error(`[token-store] Failed to decrypt token for ${email}`, err);
      return null;
    }
  }

  listAccounts(): { email: string; addedAt: string }[] {
    return Array.from(this.accounts.values()).map((a) => ({
      email: a.email,
      addedAt: a.addedAt,
    }));
  }

  hasAccount(email: string): boolean {
    return this.accounts.has(email);
  }

  get size(): number {
    return this.accounts.size;
  }
}
