import { type JSX, useEffect, useRef, useState, useCallback } from "react"

// ── Moderation kill switch ──
// Flip to `false` to enable zero-shot ML moderation + retry.
const MODERATION_DISABLED = true

const MOD_RETRY_MAX = 3
const MOD_RETRY_DELAY = 45000 // 45 seconds

// Module-level ML state keyed by ad text (survives retry remounts)
interface MlEntry {
	checked: boolean
	cleared: boolean
	flagged: boolean
}
const mlCache = new Map<string, MlEntry>()

type GravityPlacement =
	| "above_response"
	| "below_response"
	| "inline_response"
	| "search_result"
	| "bottom_page"
	| "sidebar"
	| "mid_response"
	| "mid_timeline"
	| "startup_overlay"

interface AdsterraSlot {
	containerId: string
	scriptSrc: string
}

const ADSTERRA_SLOTS: Record<GravityPlacement, AdsterraSlot> = {
	above_response: {
		containerId: "container-dbffd4bb6aab1ead6bb05117a7263848",
		scriptSrc: "https://pl30440053.effectivecpmnetwork.com/dbffd4bb6aab1ead6bb05117a7263848/invoke.js",
	},
	below_response: {
		containerId: "container-cca3b61cc8aaf5f2a02e0023bc5e7592",
		scriptSrc: "https://pl30440081.effectivecpmnetwork.com/cca3b61cc8aaf5f2a02e0023bc5e7592/invoke.js",
	},
	inline_response: {
		containerId: "container-bebbea40bd5b18c3eba3c47039f730cd",
		scriptSrc: "https://pl30440084.effectivecpmnetwork.com/bebbea40bd5b18c3eba3c47039f730cd/invoke.js",
	},
	search_result: {
		containerId: "container-8f42a126aafc27189f56130789147df4",
		scriptSrc: "https://pl30440089.effectivecpmnetwork.com/8f42a126aafc27189f56130789147df4/invoke.js",
	},
	bottom_page: {
		containerId: "container-2094b8945c4daf9561b4e7286ec34a3d",
		scriptSrc: "https://pl30440097.effectivecpmnetwork.com/2094b8945c4daf9561b4e7286ec34a3d/invoke.js",
	},
	sidebar: {
		containerId: "container-08de200ac6dd6880f5ec296310440f44",
		scriptSrc: "https://pl30440099.effectivecpmnetwork.com/08de200ac6dd6880f5ec296310440f44/invoke.js",
	},
	mid_response: {
		containerId: "container-af6c03f7f08ea5d178bcbc658eb02b06",
		scriptSrc: "https://pl30440151.effectivecpmnetwork.com/af6c03f7f08ea5d178bcbc658eb02b06/invoke.js",
	},
	mid_timeline: {
		containerId: "container-705d823e476483950dc21fafa431abf3",
		scriptSrc: "https://pl30440154.effectivecpmnetwork.com/705d823e476483950dc21fafa431abf3/invoke.js",
	},
	startup_overlay: {
		containerId: "container-ba7ceb35501edf7bae9f9a9e268cb6ca",
		scriptSrc: "https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js",
	},
}

function buildSrcdoc(containerId: string, scriptSrc: string): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;justify-content:center;background:transparent;min-height:80px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  [id^="container-"]{all:unset;display:flex;flex-direction:column;align-items:center;gap:8px;width:100%}
  [class*="__stand-name"],[class*="__cancel-btn"],[class*="__report-container"],[class*="__report-final"]{display:none!important}
  [class*="__bn-container"]{display:flex!important;justify-content:center!important;width:100%!important;background:transparent!important;border:none!important;padding:0!important}
  [class*="__bn"]{display:flex!important;flex-direction:row!important;align-items:center!important;gap:12px!important;max-width:520px!important;width:100%!important;padding:8px 12px!important;background:var(--bg,#18181b)!important;border:1px solid var(--border,#27272a)!important;border-radius:8px!important;min-height:56px!important;transition:background .15s!important;cursor:pointer!important;text-decoration:none!important}
  [class*="__bn"]:hover{background:var(--bg-hover,#27272a)!important}
  [class*="__title"]{display:flex!important;align-items:center!important;font-size:13px!important;font-weight:400!important;line-height:normal!important;text-align:left!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#a1a1aa)!important;flex:1!important;min-width:0!important;align-self:center!important}
  [class*="__link"]{flex:0 0 0!important;min-width:0!important;overflow:hidden!important}
  [class*="__img-container"]{width:100%!important;height:100%!important;min-width:40px!important;max-width:40px!important;max-height:40px!important;overflow:hidden!important;border-radius:2px!important;flex-shrink:0!important}
  [data-separator]{font-size:14px;line-height:1;opacity:.5;color:var(--muted,#a1a1aa);flex-shrink:0;align-self:center}
  [data-ad-label]{font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;opacity:.7;color:var(--muted,#a1a1aa);flex-shrink:0;line-height:1;white-space:nowrap;align-self:center}
</style>
</head>
<body>
<div id="${containerId}"></div>
<script data-cfasync="false" src="${scriptSrc}"><\/script>
<script>
(function(){var C=document.getElementById("${containerId}");if(!C)return
function styleAds(){var bns=C.querySelectorAll('[class*="__bn"]');for(var i=0;i<bns.length;i++){var bn=bns[i];if(bn.className.indexOf("__bn-container")!==-1)continue
var imgc=bn.querySelector('[class*="__img-container"]');if(imgc&&imgc.nextSibling&&!imgc.nextSibling.getAttribute("data-separator")){var sep=document.createElement("span");sep.setAttribute("data-separator","1");sep.textContent="\\u00B7";bn.insertBefore(sep,imgc.nextSibling)}
var titles=bn.querySelectorAll('[class*="__title"]');if(titles.length>0&&!bn.querySelector("[data-ad-label]")){var lbl=document.createElement("span");lbl.setAttribute("data-ad-label","1");lbl.textContent="Ad";bn.appendChild(lbl)}}}
styleAds();var mo=new MutationObserver(styleAds);mo.observe(C,{childList:true,subtree:true})})();
<\/script>
</body>
</html>`
}

export function AdsterraAd({
	placement,
}: {
	placement: GravityPlacement;
}): JSX.Element {
	const slot = ADSTERRA_SLOTS[placement]
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [height, setHeight] = useState(80)
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const retryCountRef = useRef(0)
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const [retryKey, setRetryKey] = useState(0)

	// ── Ad content moderation ──
	// Because srcdoc iframes are same-origin, we can read+write the iframe's
	// DOM directly from the parent.  No postMessage dance needed.
	const checkAdContent = useCallback(() => {
		if (MODERATION_DISABLED) return
		try {
			const doc = iframeRef.current?.contentDocument
			if (!doc) return
			const bns = doc.querySelectorAll<HTMLElement>('[class*="__bn"]')
			for (let i = 0; i < bns.length; i++) {
				const bn = bns[i]
				if (bn.className.indexOf("__bn-container") !== -1) continue

				// Extract ad text
				let adText = ""
				const textEls = bn.querySelectorAll(
					'[class*="__title"],[class*="__description"],[class*="__text"],[class*="__name"],[class*="__headline"],[class*="__snippet"]',
				)
				for (let ti = 0; ti < textEls.length; ti++) {
					const t = (textEls[ti].textContent || "").trim()
					if (t.length > adText.length) adText = t
				}
				if (!adText) {
					adText = (bn.textContent || "").trim().substring(0, 200)
				}
				if (!adText) continue

				let entry = mlCache.get(adText)
				if (!entry) {
					entry = { checked: false, cleared: false, flagged: false }
					mlCache.set(adText, entry)
				}

				// Already flagged → hide
				if (entry.flagged) {
					bn.style.setProperty("display", "none", "important")
					continue
				}

				// Fire ML check (once per unique ad text)
				if (!entry.checked) {
					entry.checked = true
					window.infinitecode?.moderation
						.checkAdText(adText)
						.then((result: { flagged: boolean }) => {
							const e = mlCache.get(adText)
							if (!e) return
							if (result.flagged) {
								e.flagged = true
								e.cleared = false
								scheduleRetry()
							} else {
								e.cleared = true
							}
						})
						.catch(() => {
							const e = mlCache.get(adText)
							if (e) e.cleared = true
						})
				}

				// Hide while ML is pending or ad was flagged
				if (!entry.cleared) {
					bn.style.setProperty("display", "none", "important")
				}
			}
		} catch {
			// cross-origin or no iframe yet
		}
	}, [])

	const scheduleRetry = useCallback(() => {
		if (retryCountRef.current >= MOD_RETRY_MAX) return
		retryCountRef.current++
		if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
		retryTimerRef.current = setTimeout(() => {
			setRetryKey((k) => k + 1)
		}, MOD_RETRY_DELAY)
	}, [])

	// ── Height polling ──
	const measureHeight = useCallback(() => {
		try {
			const doc = iframeRef.current?.contentDocument
			if (!doc) return
			const h = Math.max(
				doc.documentElement.scrollHeight,
				doc.body?.scrollHeight ?? 0,
			)
			if (h > 10 && h !== height) {
				setHeight(h)
			}
		} catch {
			// cross-origin — ignore
		}
	}, [height])

	// ── Polling loop ──
	useEffect(() => {
		if (!slot) return
		setHeight(80)

		const t1 = setTimeout(() => {
			measureHeight()
			checkAdContent()
			pollRef.current = setInterval(() => {
				measureHeight()
				checkAdContent()
			}, 500)
		}, 2000)

		const t2 = setTimeout(() => {
			if (pollRef.current) {
				clearInterval(pollRef.current)
				pollRef.current = null
			}
		}, 30000)

		return () => {
			clearTimeout(t1)
			clearTimeout(t2)
			if (pollRef.current) {
				clearInterval(pollRef.current)
				pollRef.current = null
			}
		}
	}, [slot, measureHeight, checkAdContent])

	// Cleanup retry timer on unmount
	useEffect(() => {
		return () => {
			if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
		}
	}, [])

	if (!slot) return <></>

	return (
		<iframe
			key={retryKey}
			ref={iframeRef}
			srcDoc={buildSrcdoc(slot.containerId, slot.scriptSrc)}
			title={`ad-${placement}`}
			scrolling="no"
			style={{
				width: "100%",
				border: "none",
				overflow: "hidden",
				height: height > 0 ? `${height}px` : "80px",
				display: "block",
			}}
		/>
	)
}
