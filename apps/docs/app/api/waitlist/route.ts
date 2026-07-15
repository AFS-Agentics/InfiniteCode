import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

type D1Statement = {
  bind: (...values: string[]) => {
    run: () => Promise<unknown>;
  };
};

type WaitlistDatabase = {
  exec: (query: string) => Promise<unknown>;
  prepare: (query: string) => D1Statement;
};

type WaitlistEnv = CloudflareEnv & {
  DB?: WaitlistDatabase;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

async function getWaitlistDatabase() {
  const { env } = await getCloudflareContext({ async: true });

  return (env as WaitlistEnv).DB;
}

export async function POST(request: Request) {
  let payload: { email?: unknown };

  try {
    payload = (await request.json()) as { email?: unknown };
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const email =
    typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  if (!emailPattern.test(email)) {
    return jsonResponse({ error: "Invalid email address." }, 400);
  }

  const db = await getWaitlistDatabase();

  if (!db) {
    return jsonResponse({ error: "Missing DB D1 binding." }, 500);
  }

  try {
    await db.exec(
      "CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'devo-site', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    );

    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at);",
    );

    await db
      .prepare(
        "INSERT INTO waitlist (email, source) VALUES (?, ?) ON CONFLICT(email) DO NOTHING",
      )
      .bind(email, "devo-site")
      .run();
  } catch (error) {
    console.error("Failed to write waitlist email", error);

    return jsonResponse(
      {
        error: "Failed to write waitlist email.",
        hint: "Make sure the D1 migration has been applied to the remote database.",
      },
      500,
    );
  }

  return jsonResponse({ ok: true });
}

export function GET() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}
