export interface AuthUser {
	id: string;
	username: string;
	domain: string;
	status: string;
	status_preference: string;
	avatar_id?: string;
	custom_msg?: string;
	token?: string;
}

export interface Channel {
	id: string;
	name: string;
	is_private: boolean;
	invite_link?: string;
	creator_id: string;
	user_role: number; // 0=Member, 10=Admin, 20=Owner
	members: string[];
	member_names?: Record<string, string>;
	member_avatars?: Record<string, string>;
	member_domains?: Record<string, string>;
	member_statuses?: Record<string, string>;
	member_roles?: Record<string, number>;
	created_at: string;
	unread_count?: number;
}

export interface ExploreChannel {
	id: string;
	name: string;
	invite_link: string;
	member_count: number;
	created_at: string;
}

export interface Message {
	id: string;
	channel_id: string;
	sender_id: string;
	type: 'text' | 'file' | 'voice';
	ciphertext: string;
	nonce: string;
	compression: string;
	sent_at: string;
	edited_at?: string;
	reply_to_id?: string;
}

export interface Presence {
	last_seen: string;
	current_status: 'online' | 'away' | 'offline';
}

export interface UploadedFile {
	id: string;
	owner_id: string;
	channel_id?: string;
	size: number;
	mime: string;
	thumb_ciphertext?: string;
	thumb_nonce?: string;
	uploaded_at: string;
}

export interface User {
  id: string;
  username: string;
  domain: string;
  status: string;
  avatar_id?: string;
  custom_msg?: string;
}
