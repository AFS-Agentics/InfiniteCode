import type { NetworkProxySettings } from "../preload/api"

export const DEFAULT_NETWORK_NO_PROXY = "localhost,127.0.0.1,::1"

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
	mode: "system",
	proxyUrl: "",
	noProxy: DEFAULT_NETWORK_NO_PROXY,
}

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks5h:"])

export function normalizeProxyUrl(value: string): string | null {
	const trimmed = value.trim()
	if (!trimmed) return null
	try {
		const url = new URL(trimmed)
		return SUPPORTED_PROXY_PROTOCOLS.has(url.protocol) ? trimmed : null
	} catch {
		return null
	}
}

export function normalizeNoProxy(value: string): string | null {
	const trimmed = value.trim()
	return trimmed ? trimmed : null
}
