import type { Invite, InviteStatus } from '../types/admin.types';

/** Locally computed status, so a code that expires while the panel is open updates without a refetch. */
export function liveInviteStatus(invite: Invite, now: number = Date.now()): InviteStatus {
	if (invite.revoked) return 'revoked';
	if (invite.expires_at && Date.parse(invite.expires_at) <= now) return 'expired';
	if (invite.max_uses > 0 && invite.uses >= invite.max_uses) return 'exhausted';
	return 'active';
}

/** "3 / 10" for limited codes, "3 / ∞" for unlimited ones. */
export function formatInviteUses(invite: Pick<Invite, 'uses' | 'max_uses'>): string {
	return `${invite.uses} / ${invite.max_uses > 0 ? invite.max_uses : '∞'}`;
}

/** Converts a `datetime-local` value into the RFC3339 string the API wants (empty → undefined). */
export function toRFC3339(localValue: string): string | undefined {
	if (!localValue) return undefined;
	const ms = Date.parse(localValue);
	return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Human-readable size using binary units. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/** "3d 4h", "2h 5m" or "12m" for an uptime in seconds. */
export function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

/**
 * Backend errors are i18n keys, optionally followed by `: detail`
 * (`admin.errors.invalid_setting: server.http_port: must be between…`).
 */
export function splitErrorKey(message: string): { key: string; detail?: string } {
	const i = message.indexOf(': ');
	return i < 0 ? { key: message } : { key: message.slice(0, i), detail: message.slice(i + 2) };
}
