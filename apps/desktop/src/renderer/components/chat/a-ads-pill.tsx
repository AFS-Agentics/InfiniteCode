import { type JSX, useEffect, useRef, useState } from "react"

const AADS_BASE = "//acceptable.a-ads.com"
const AADS_PARAMS =
	"/?size=Adaptive&background_color=18181b&title_color=a1a1aa&title_hover_color=818181&text_color=71717a&link_color=a1a1aa&link_hover_color=818181"

const DEFAULT_UNIT_ID = 2448648

function buildSrcdoc(unitId: number): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{display:flex;flex-direction:column;align-items:center;background:transparent;min-height:56px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .ad-wrap{display:flex;flex-direction:column;align-items:flex-start;max-width:520px;width:100%}
  .ad-label{font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;opacity:.7;color:#a1a1aa;line-height:1;padding:2px 0 0 2px}
  .pill{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:2px;padding:6px 12px;background:#18181b;border:1px solid #27272a;border-radius:8px}
  .pill iframe{max-width:100%;height:auto;display:block}
</style>
</head>
<body>
<div class="ad-wrap">
  <span class="ad-label">Ad</span>
  <div class="pill">
    <iframe src="${AADS_BASE}/${unitId}${AADS_PARAMS}" style="border:0;padding:0;width:100%;max-width:468px;height:60px;overflow:hidden;display:block" scrolling="no" title="A-Ads"></iframe>
  </div>
</div>
</body>
</html>`
}

interface AAdsPillProps {
	/** A-Ads unit ID. Default: 2448648 */
	unitId?: number
}

export function AAdsPill({ unitId = DEFAULT_UNIT_ID }: AAdsPillProps): JSX.Element {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [height, setHeight] = useState(70)

	useEffect(() => {
		const iframe = iframeRef.current
		if (!iframe) return
		const measure = () => {
			try {
				const doc = iframe.contentDocument
				if (!doc) return
				const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
				if (h > 10 && h !== height) setHeight(h)
			} catch {
				/* same-origin, safe */
			}
		}
		const poll = setInterval(measure, 500)
		const stop = setTimeout(() => clearInterval(poll), 30000)
		setTimeout(measure, 500)
		return () => {
			clearInterval(poll)
			clearTimeout(stop)
		}
	}, [height])

	return (
		<iframe
			ref={iframeRef}
			srcDoc={buildSrcdoc(unitId)}
			title="A-Ads"
			scrolling="no"
			style={{
				width: "100%",
				border: "none",
				overflow: "hidden",
				height: height > 0 ? `${height}px` : "70px",
				display: "block",
			}}
		/>
	)
}
