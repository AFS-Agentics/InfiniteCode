import { cookies, headers } from "next/headers";

import { localeCookieName, preferredLocale } from "@/lib/locale";

import { LandingPage } from "./_components/landing/landing-page";

async function getInitialLocale() {
  const cookieStore = await cookies();
  const headerStore = await headers();

  return preferredLocale(
    cookieStore.get(localeCookieName)?.value,
    headerStore.get("accept-language"),
  );
}

export default async function Home() {
  const initialLocale = await getInitialLocale();

  return <LandingPage initialLocale={initialLocale} />;
}
