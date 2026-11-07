/** DTOs for the `/api/admin/*` endpoints. Field names mirror the backend JSON. */

export type RegistrationMode = 'open' | 'invite_only' | 'closed';

export interface ServerInfo {
	registration_mode: RegistrationMode;
	needs_owner: boolean;
}

export interface AdminOverview {
	version: string;
	domain: string;
	users: number;
	channels: number;
	active_invites: number;
	registration_mode: RegistrationMode;
	uptime_seconds: number;
	data_size_bytes: number;
}

export type ConfigSettingType = 'enum' | 'int' | 'bool' | 'string';
export type ConfigValue = string | number | boolean;

export interface ConfigSetting {
	key: string;
	group: string;
	type: ConfigSettingType;
	options?: string[];
	min?: number;
	max?: number;
	owner_only: boolean;
	restart_required: boolean;
	value: ConfigValue;
}

export interface UpdateConfigResult {
	applied: string[];
	restart_required: string[];
}

export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface Invite {
	code: string;
	note?: string;
	created_by: string;
	created_at: string;
	expires_at: string | null;
	/** 0 means unlimited. */
	max_uses: number;
	uses: number;
	revoked: boolean;
	source: 'panel' | 'config';
	status: InviteStatus;
}

export interface CreateInviteInput {
	code?: string;
	note?: string;
	max_uses: number;
	expires_at?: string;
}

export interface AuditEntry {
	id: string;
	at: string;
	actor_id: string;
	actor_name: string;
	action: string;
	target?: string;
}

export interface AdminAccount {
	id: string;
	username: string;
	role: 'admin' | 'owner';
}

/** Result of sending a server-wide notice. */
export interface NoticeResult {
	recipients: number;
	failed: number;
}

/** Where the server runs, which decides whether it may replace its own binary. */
export type InstallMode = 'binary' | 'docker' | 'unknown';

/** Progress of a server update job (`GET /api/admin/update`). */
export type ServerUpdateState = 'idle' | 'downloading' | 'installing' | 'restarting' | 'failed';

/** A release file the owner uploaded for an air-gapped install. */
export interface ServerUploadInfo {
	version: string;
	/** True when a checksum was supplied and matched. */
	verified: boolean;
	sha256: string;
	kind: 'zip' | 'binary';
	size_bytes: number;
}

export interface ServerUpdateInfo {
	current_version: string;
	/** Empty when no release could be determined. */
	latest_version: string;
	update_available: boolean;
	/** GitHub release body (Markdown source, shown as plain text). */
	release_notes: string;
	release_url?: string;
	prerelease: boolean;
	published_at?: string;
	checked_at?: string;
	/** i18n key set when GitHub could not be reached. */
	check_error?: string;
	mode: InstallMode;
	can_update: boolean;
	/** Why `can_update` is false: docker, unsupported, up_to_date or busy. */
	reason?: 'docker' | 'unsupported' | 'up_to_date' | 'busy';
	/** Manual command, set in docker mode. */
	instructions?: string;
	/** True when POST /api/admin/restart can restart this install (not Docker, not unsupported). */
	can_restart: boolean;
	/** Where the release list came from: the Cove manifest or GitHub. */
	source?: 'manifest' | 'github';
	uploaded?: ServerUploadInfo;
	state: ServerUpdateState;
	progress_percent: number;
	/** i18n key describing why the last attempt failed. */
	error?: string;
}

export interface ServerUpdateStarted {
	status: string;
	version: string;
	state: ServerUpdateState;
}
