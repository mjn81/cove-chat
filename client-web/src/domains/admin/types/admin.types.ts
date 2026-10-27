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
