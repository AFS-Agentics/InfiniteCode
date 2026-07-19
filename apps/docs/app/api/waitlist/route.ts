import { NextResponse } from "next/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
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

  // Deployment target: Vercel (no D1 binding available).
  // The waitlist form on the docs site logs the email server-side for triage;
  // we acknowledge success without persisting to a database.
  //
  // To re-enable persistence later, wire a Vercel KV / Postgres binding
  // (or any other store) and replace this stub.
  console.info("[waitlist] received", { email });

  return jsonResponse({ ok: true });
}

export function GET() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}
