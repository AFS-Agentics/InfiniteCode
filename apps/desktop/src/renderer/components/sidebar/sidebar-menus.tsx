import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@devo/ui/components/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@devo/ui/components/tooltip"
import { cn } from "@devo/ui/lib/utils"
import {
	ArchiveIcon,
	ArrowDownIcon,
	CheckIcon,
	Clock3Icon,
	CommandIcon,
	FolderIcon,
	FolderPlusIcon,
	GripVerticalIcon,
	Maximize2Icon,
	Minimize2Icon,
	MoreHorizontalIcon,
} from "lucide-react"
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react"
import type {
	SidebarOrganization,
	SidebarPreferences,
	SidebarSort,
} from "./sidebar-data"

const menuContentClass =
	"w-[280px] rounded-[20px] border border-border/70 bg-popover/95 p-2 shadow-xl shadow-black/10"
const menuItemClass =
	"h-9 gap-2.5 rounded-xl px-3 text-sm leading-none text-popover-foreground focus:bg-accent"
const menuIconClass = "size-[18px] shrink-0 text-muted-foreground"

type HeaderIconButtonProps = ComponentPropsWithoutRef<"button"> & {
	label: string
	isActive?: boolean
	children: ReactNode
}

const HeaderIconButton = forwardRef<HTMLButtonElement, HeaderIconButtonProps>(
	function HeaderIconButton({ children, label, isActive, className, ...props }, ref) {
		return (
			<button
				ref={ref}
				type="button"
				aria-label={label}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground/70 transition-colors hover:bg-black/[0.04] hover:text-muted-foreground dark:hover:bg-white/[0.06]",
					isActive && "bg-black/[0.07] text-sidebar-foreground dark:bg-white/[0.08]",
					className,
				)}
				{...props}
			>
				{children}
			</button>
		)
	},
)

function CheckedMenuItem({
	children,
	checked,
	icon,
	onClick,
}: {
	children: ReactNode
	checked: boolean
	icon: ReactNode
	onClick: () => void
}) {
	return (
		<DropdownMenuItem className={menuItemClass} onClick={onClick}>
			{icon}
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{checked && <CheckIcon className="size-4 shrink-0 text-muted-foreground" />}
		</DropdownMenuItem>
	)
}

function DisabledMenuItem({
	children,
	icon,
}: {
	children: ReactNode
	icon: ReactNode
}) {
	return (
		<DropdownMenuItem disabled className={cn(menuItemClass, "opacity-45")}>
			{icon}
			<span className="min-w-0 flex-1 truncate">{children}</span>
		</DropdownMenuItem>
	)
}

export function SidebarMainMenu({
	preferences,
	onPreferencesChange,
	onOpenCommandPalette,
}: {
	preferences: SidebarPreferences
	onPreferencesChange: (preferences: SidebarPreferences) => void
	onOpenCommandPalette: () => void
}) {
	const setOrganization = (organization: SidebarOrganization) => {
		onPreferencesChange({ ...preferences, organization })
	}

	const setSort = (sort: SidebarSort) => {
		onPreferencesChange({ ...preferences, sort })
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<HeaderIconButton label="Sidebar options">
						<MoreHorizontalIcon className="size-[18px]" />
					</HeaderIconButton>
				}
			/>
			<DropdownMenuContent align="end" sideOffset={8} className={menuContentClass}>
				<DropdownMenuGroup>
					<DisabledMenuItem icon={<ArchiveIcon className={menuIconClass} />}>
						Archive all chats
					</DisabledMenuItem>
					<DropdownMenuSeparator className="my-2" />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className={menuItemClass}>
							<FolderIcon className={menuIconClass} />
							<span className="min-w-0 flex-1 truncate">Organize sidebar</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent sideOffset={8} className={menuContentClass}>
							<DropdownMenuGroup>
								<CheckedMenuItem
									checked={preferences.organization === "by-project"}
									icon={<FolderIcon className={menuIconClass} />}
									onClick={() => setOrganization("by-project")}
								>
									By project
								</CheckedMenuItem>
								<CheckedMenuItem
									checked={preferences.organization === "recent-projects"}
									icon={<FolderIcon className={menuIconClass} />}
									onClick={() => setOrganization("recent-projects")}
								>
									Recent projects
								</CheckedMenuItem>
								<CheckedMenuItem
									checked={preferences.organization === "chronological"}
									icon={<Clock3Icon className={menuIconClass} />}
									onClick={() => setOrganization("chronological")}
								>
									Chronological list
								</CheckedMenuItem>
								<DisabledMenuItem icon={<ArrowDownIcon className={menuIconClass} />}>
									Move down
								</DisabledMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className={menuItemClass}>
							<Clock3Icon className={menuIconClass} />
							<span className="min-w-0 flex-1 truncate">Sort by</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent sideOffset={8} className={menuContentClass}>
							<DropdownMenuGroup>
								<DisabledMenuItem icon={<GripVerticalIcon className={menuIconClass} />}>
									Manual order
								</DisabledMenuItem>
								<CheckedMenuItem
									checked={preferences.sort === "created"}
									icon={<Clock3Icon className={menuIconClass} />}
									onClick={() => setSort("created")}
								>
									Created
								</CheckedMenuItem>
								<CheckedMenuItem
									checked={preferences.sort === "updated"}
									icon={<Clock3Icon className={menuIconClass} />}
									onClick={() => setSort("updated")}
								>
									Updated
								</CheckedMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator className="my-2" />
					<DropdownMenuItem className={menuItemClass} onClick={onOpenCommandPalette}>
						<CommandIcon className={menuIconClass} />
						Command palette
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function AddProjectMenu({
	onAddExistingFolder,
}: {
	onAddExistingFolder?: () => void
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<HeaderIconButton label="Add project">
						<FolderPlusIcon className="size-[18px]" />
					</HeaderIconButton>
				}
			/>
			<DropdownMenuContent align="end" sideOffset={8} className={menuContentClass}>
				<DropdownMenuGroup>
					<DisabledMenuItem icon={<FolderPlusIcon className={menuIconClass} />}>
						Start from scratch
					</DisabledMenuItem>
					<DropdownMenuItem
						disabled={!onAddExistingFolder}
						className={menuItemClass}
						onClick={onAddExistingFolder}
					>
						<FolderPlusIcon className={menuIconClass} />
						Use an existing folder
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

export function ProjectFoldersToggleButton({
	collapsed,
	onClick,
}: {
	collapsed: boolean
	onClick: () => void
}) {
	const label = collapsed ? "Expand folders" : "Collapse folders"
	const Icon = collapsed ? Maximize2Icon : Minimize2Icon

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<HeaderIconButton aria-pressed={collapsed} isActive={collapsed} label={label} onClick={onClick}>
						<Icon className="size-[17px]" />
					</HeaderIconButton>
				}
			/>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	)
}
