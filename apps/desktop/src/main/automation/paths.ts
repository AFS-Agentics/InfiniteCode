/**
 * XDG Base Directory paths for InfiniteCode automation storage.
 *
 * Follows the XDG Base Directory Specification, matching the convention
 * used by InfiniteCode:
 *
 *   Config:  $XDG_CONFIG_HOME/infinitecode  (default ~/.config/infinitecode)
 *   Data:    $XDG_DATA_HOME/infinitecode    (default ~/.local/share/infinitecode)
 *
 * Automation configs live under config (human-editable JSON + prompt.md).
 * The SQLite database lives under data (machine-managed state).
 */

import os from "node:os"
import path from "node:path"

const APP_NAME = "infinitecode"

/**
 * Returns the XDG config directory for InfiniteCode.
 * Automations configs are stored at `<config>/automations/<id>/`.
 */
export function getConfigDir(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
	return path.join(xdgConfig, APP_NAME)
}

/**
 * Returns the XDG data directory for InfiniteCode.
 * The SQLite database is stored at `<data>/infinitecode.db`.
 */
export function getDataDir(): string {
	const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
	return path.join(xdgData, APP_NAME)
}
