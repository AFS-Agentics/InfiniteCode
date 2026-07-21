import { type JSX, useEffect, useRef, useState, useCallback } from "react"

type AdPlacement =
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

const ADSTERRA_SLOTS: Record<AdPlacement, AdsterraSlot> = {
	above_response: {
		containerId: "container-ba7ceb35501edf7bae9f9a9e268cb6ca",
		scriptSrc: "https://pl30395772.effectivecpmnetwork.com/ba7ceb35501edf7bae9f9a9e268cb6ca/invoke.js",
	},
	below_response: {
		containerId: "container-ddfcad99fa622b592770145f4f07372b",
		scriptSrc: "https://pl30464614.effectivecpmnetwork.com/ddfcad99fa622b592770145f4f07372b/invoke.js",
	},
	inline_response: {
		containerId: "container-b18e70626e0dddad4ba21c397b4e98d1",
		scriptSrc: "https://pl30464615.effectivecpmnetwork.com/b18e70626e0dddad4ba21c397b4e98d1/invoke.js",
	},
	search_result: {
		containerId: "container-688c0e329e8d56d353b559e234154e24",
		scriptSrc: "https://pl30464616.effectivecpmnetwork.com/688c0e329e8d56d353b559e234154e24/invoke.js",
	},
	bottom_page: {
		containerId: "container-cb0fe8418e1b8563f7d6778b507469a3",
		scriptSrc: "https://pl30464617.effectivecpmnetwork.com/cb0fe8418e1b8563f7d6778b507469a3/invoke.js",
	},
	sidebar: {
		containerId: "container-546b6a720522220dfee4699d836c0597",
		scriptSrc: "https://pl30464618.effectivecpmnetwork.com/546b6a720522220dfee4699d836c0597/invoke.js",
	},
	mid_response: {
		containerId: "container-253e5a8e418e38feff541b854f1447aa",
		scriptSrc: "https://pl30464619.effectivecpmnetwork.com/253e5a8e418e38feff541b854f1447aa/invoke.js",
	},
	mid_timeline: {
		containerId: "container-1e2d39134cbb1561b9f6c4fff905be83",
		scriptSrc: "https://pl30464620.effectivecpmnetwork.com/1e2d39134cbb1561b9f6c4fff905be83/invoke.js",
	},
	startup_overlay: {
		containerId: "container-89aca5050629a20ab44f23ede699e636",
		scriptSrc: "https://pl30464621.effectivecpmnetwork.com/89aca5050629a20ab44f23ede699e636/invoke.js",
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
  [class*="__bn"]:not([class*="__bn-container"]){display:flex!important;flex-direction:row!important;align-items:center!important;gap:12px!important;max-width:520px!important;width:100%!important;padding:8px 12px!important;background:var(--bg,#18181b)!important;border:1px solid var(--border,#27272a)!important;border-radius:8px!important;min-height:56px!important;transition:background .15s!important;cursor:pointer!important;text-decoration:none!important}
  [class*="__bn"]:not([class*="__bn-container"]):hover{background:var(--bg-hover,#27272a)!important}
  [class*="__title"]{display:flex!important;align-items:center!important;font-size:13px!important;font-weight:400!important;line-height:normal!important;text-align:left!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;color:var(--muted,#a1a1aa)!important;flex:1!important;min-width:0!important;align-self:center!important}
  [class*="__link"]{flex:0 0 0!important;min-width:0!important;overflow:hidden!important}
  [class*="__img-container"]{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;height:100%!important;min-width:40px!important;max-width:40px!important;max-height:40px!important;overflow:hidden!important;border-radius:2px!important;flex-shrink:0!important}
  [data-separator]{font-size:14px;line-height:1;opacity:.5;color:var(--muted,#a1a1aa);flex-shrink:0;align-self:center}
  [data-ad-label]{font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;opacity:.7;color:var(--muted,#a1a1aa);flex-shrink:0;line-height:1;white-space:nowrap;align-self:center}
</style>
</head>
<body>
<div id="${containerId}"></div>
<script data-cfasync="false" src="${scriptSrc}"><\/script>
<script>
(function(){var C=document.getElementById("${containerId}");if(!C)return
function styleAds(){var bns=C.querySelectorAll('[class*="__bn"]:not([class*="__bn-container"])');for(var i=0;i<bns.length;i++){var bn=bns[i]
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
	placement: AdPlacement;
}): JSX.Element {
	const slot = ADSTERRA_SLOTS[placement]
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [height, setHeight] = useState(0)
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

	// Poll the iframe content height until it stabilises — postMessage
	// doesn't reliably work from srcdoc iframes in Electron.
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

	useEffect(() => {
		if (!slot) return
		setHeight(0)

		// Start polling after a short delay so the iframe has time to render
		const t1 = setTimeout(() => {
			measureHeight()
			pollRef.current = setInterval(measureHeight, 500)
		}, 2000)

		// Cleanup after 30 seconds (ads should have loaded by then)
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
	}, [slot, measureHeight])

	if (!slot) return <></>

	return (
		<iframe
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
