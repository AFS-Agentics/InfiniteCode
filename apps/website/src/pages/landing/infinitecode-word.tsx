import type { ReactNode } from "react";

type InfiniteCodeWordProps = {
	className?: string;
	iconClassName?: string;
};

export function InfiniteCodeWord({
	className = "",
	iconClassName = "h-[0.95em] w-[0.95em]",
}: InfiniteCodeWordProps) {
	return (
		<span
			className={[
				"inline-flex items-center gap-[0.28em] whitespace-nowrap align-[-0.08em]",
				className,
			].join(" ")}
		>
			<img
				alt=""
				className={["shrink-0", iconClassName].join(" ")}
				height={24}
				src="/infinitecode-mark.svg"
				width={24}
			/>
			<span>InfiniteCode</span>
		</span>
	);
}

export function renderWithInfiniteCodeMark(
	text: string,
	options: { iconClassName?: string; wordClassName?: string } = {},
): ReactNode {
	if (!text.includes("InfiniteCode")) {
		return text;
	}

	return text.split("InfiniteCode").flatMap((part, index) => {
		if (index === 0) {
			return part ? [part] : [];
		}

		return [
			<InfiniteCodeWord
				className={options.wordClassName}
				iconClassName={options.iconClassName}
				key={`infinitecode-${index}`}
			/>,
			part,
		];
	});
}
