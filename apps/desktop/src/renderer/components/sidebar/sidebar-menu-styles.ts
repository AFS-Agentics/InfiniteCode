import {
	optionMenuContentClass,
	optionMenuItemClass,
} from "@infinitecode/ui/components/option-menu-styles"
import { cn } from "@infinitecode/ui/lib/utils"

export const projectMenuContentClass = cn(optionMenuContentClass, "w-[232px]")
export const sessionMenuContentClass = cn(optionMenuContentClass, "w-40")

export const rowMenuItemClass = cn(
	optionMenuItemClass,
	"focus:bg-accent dark:focus:bg-white/[0.08] dark:data-[highlighted]:bg-white/[0.08] dark:hover:bg-white/[0.08]",
)
