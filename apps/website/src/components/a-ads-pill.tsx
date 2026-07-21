import { type JSX } from "react"

const AADS_BASE = "//acceptable.a-ads.com"
const AADS_PARAMS =
	"/?size=Adaptive&background_color=18181b&title_color=a1a1aa&title_hover_color=818181&text_color=71717a&link_color=a1a1aa&link_hover_color=818181"
const DEFAULT_UNIT_ID = 2448648

interface AAdsPillProps {
	unitId?: number
}

const wrapperStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "flex-start",
	maxWidth: 520,
	width: "100%",
}

const labelStyle: React.CSSProperties = {
	fontSize: 10,
	fontWeight: 500,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	opacity: 0.7,
	color: "#a1a1aa",
	lineHeight: 1,
	padding: "2px 0 0 2px",
}

const pillStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	width: "100%",
	minHeight: 56,
	marginTop: 2,
	padding: "6px 12px",
	background: "#18181b",
	border: "1px solid #27272a",
	borderRadius: 8,
}

const iframeStyle: React.CSSProperties = {
	border: 0,
	padding: 0,
	width: "100%",
	maxWidth: 468,
	height: 60,
	overflow: "hidden",
	display: "block",
}

export function AAdsPill({ unitId = DEFAULT_UNIT_ID }: AAdsPillProps): JSX.Element {
	return (
		<div className="mx-auto my-8 w-full px-4" style={{ maxWidth: 560 }}>
			<div style={wrapperStyle}>
				<span style={labelStyle}>Ad</span>
				<div style={pillStyle}>
					<iframe
						data-aa={unitId}
						src={`${AADS_BASE}/${unitId}${AADS_PARAMS}`}
						style={iframeStyle}
						scrolling="no"
						title="A-Ads"
					/>
				</div>
			</div>
		</div>
	)
}
