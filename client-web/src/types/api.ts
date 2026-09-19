export interface AuthUser {
	id: string;
	username: string;
	domain: string;
	status: string;
	status_preference: string;
	avatar_id?: string;
	avatar_ids?: string[];
	banner_color?: string;
	custom_msg?: string;
	allow_channel_adds?: 'everyone' | 'friends' | 'nobody';
	dm_permission?: 'everyone' | 'friends' | 'nobody';
	friend_request_permission?: 'everyone' | 'nobody';
	token?: string;
}

export interface Channel {
	id: string;
	name: string;
	description?: string;
	avatar_id?: string;
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
	last_message_at?: string;
	// Still-encrypted preview of the channel's most recent message, from the
	// backend's ListChannels response — decrypted client-side into
	// last_message_preview (see channels.slice.ts) for the sidebar row.
	last_message_ciphertext?: string;
	last_message_nonce?: string;
	last_message_type?: 'text' | 'file' | 'voice' | 'video';
	last_message_sender_id?: string;
	last_message_id?: string;
	// Client-only: decrypted, formatted preview text for the sidebar row
	// (e.g. "You: hey" or "[voice]"). Populated once on load from the
	// ciphertext fields above, and kept live via WS 'message' events.
	last_message_preview?: string;
}

export interface ExploreChannel {
	id: string;
	name: string;
	description?: string;
	avatar_id?: string;
	invite_link: string;
	member_count: number;
	created_at: string;
}

export interface Message {
	id: string;
	channel_id: string;
	sender_id: string;
	type: 'text' | 'file' | 'voice' | 'video';
	ciphertext: string;
	nonce: string;
	compression: string;
	sent_at: string;
	edited_at?: string;
	reply_to_id?: string;
	// Client-only: never sent by the server. Set on a locally-inserted
	// optimistic message while it's in flight or once it's known to have
	// failed to send (e.g. WS disconnected, or no server echo within the
	// delivery timeout).
	pending?: 'sending' | 'failed';
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
	processing_status?: 'ready' | 'processing' | 'failed';
	duration_sec?: number;
	uploaded_at: string;
}

export interface User {
  id: string;
  username: string;
  domain: string;
  status: string;
  avatar_id?: string;
  avatar_ids?: string[];
  banner_color?: string;
  custom_msg?: string;
  allow_channel_adds?: 'everyone' | 'friends' | 'nobody';
  dm_permission?: 'everyone' | 'friends' | 'nobody';
  friend_request_permission?: 'everyone' | 'nobody';
}

export type RelationshipType = 'none' | 'requested' | 'friend' | 'blocked';
export type RelationshipAction = 'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock';

export interface RelationshipResponse {
  from_user_id: string;
  to_user_id: string;
  type: RelationshipType;
  user?: User;
  created_at?: string;
  updated_at?: string;
}

export interface SkippedMember {
  user_id: string;
  reason: string;
}

export interface AddMembersResponse {
  added: string[];
  skipped: SkippedMember[];
}

