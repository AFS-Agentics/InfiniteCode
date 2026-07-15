import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@infinitecode/ui/components/collapsible"
import { cn } from "@infinitecode/ui/lib/utils"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import {
	createContext,
	memo,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react"

interface TranscriptDisclosureContextValue {
	isOpen: boolean
	expandable: boolean
}

const TranscriptDisclosureContext = createContext<TranscriptDisclosureContextValue | null>(null)

function useTranscriptDisclosure() {
	const context = useContext(TranscriptDisclosureContext)
	if (!context) {
		throw new Error("Transcript disclosure components must be used within TranscriptDisclosure")
	}
	return context
}

export interface TranscriptDisclosureProps {
	open?: boolean
	defaultOpen?: boolean
	onOpenChange?: (open: boolean) => void
	expandable?: boolean
	forceOpen?: boolean
	className?: string
	children: ReactNode
}

export const TranscriptDisclosure = memo(function TranscriptDisclosure({
	open: openProp,
	defaultOpen = false,
	onOpenChange,
	expandable = true,
	forceOpen = false,
	className,
	children,
}: TranscriptDisclosureProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
	const isControlled = openProp !== undefined
	const isOpen = forceOpen || (isControlled ? openProp : uncontrolledOpen)

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (forceOpen) return
			if (!isControlled) setUncontrolledOpen(nextOpen)
			onOpenChange?.(nextOpen)
		},
		[forceOpen, isControlled, onOpenChange],
	)

	const contextValue = useMemo(
		() => ({ expandable: expandable && !forceOpen, isOpen }),
		[expandable, forceOpen, isOpen],
	)

	if (!expandable) {
		return (
			<TranscriptDisclosureContext.Provider value={contextValue}>
				<div className={cn("not-prose", className)}>{children}</div>
			</TranscriptDisclosureContext.Provider>
		)
	}

	return (
		<TranscriptDisclosureContext.Provider value={contextValue}>
			<Collapsible
				className={cn("not-prose", className)}
				open={isOpen}
				onOpenChange={handleOpenChange}
			>
				{children}
			</Collapsible>
		</TranscriptDisclosureContext.Provider>
	)
})

const triggerClassName =
	"flex w-fit max-w-full items-center gap-1.5 border-0 bg-transparent p-0 m-0 text-sm text-muted-foreground/70 transition-colors hover:text-foreground"

export interface TranscriptDisclosureTriggerProps {
	label: ReactNode
	leading?: ReactNode
	trailing?: ReactNode
	className?: string
	"aria-label"?: string
}

export const TranscriptDisclosureTrigger = memo(function TranscriptDisclosureTrigger({
	label,
	leading,
	trailing,
	className,
	"aria-label": ariaLabel,
}: TranscriptDisclosureTriggerProps) {
	const { isOpen, expandable } = useTranscriptDisclosure()
	const ChevronIcon = isOpen ? ChevronDownIcon : ChevronRightIcon

	if (!expandable) {
		return (
			<div className={cn(triggerClassName, className)} aria-label={ariaLabel}>
				{leading}
				<span className="min-w-0 truncate">{label}</span>
				{trailing}
			</div>
		)
	}

	return (
		<CollapsibleTrigger className={cn(triggerClassName, className)} aria-label={ariaLabel}>
			{leading}
			<span className="min-w-0 truncate">{label}</span>
			<ChevronIcon aria-hidden="true" className="size-4 shrink-0 transition-transform" />
			{trailing}
		</CollapsibleTrigger>
	)
})

export interface TranscriptDisclosureContentProps {
	children: ReactNode
	className?: string
}

export const TranscriptDisclosureContent = memo(function TranscriptDisclosureContent({
	children,
	className,
}: TranscriptDisclosureContentProps) {
	return (
		<CollapsibleContent
			className={cn(
				"outline-none data-closed:mt-0 data-closed:mb-0 data-closed:h-0 data-closed:overflow-hidden data-open:mt-1.5",
				className,
			)}
			keepMounted={false}
		>
			{children}
		</CollapsibleContent>
	)
})
