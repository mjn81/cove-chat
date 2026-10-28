package api

import (
	"time"
)

// ── Request / Response types (used in Swagger annotations) ──────────────────

type RegisterRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password" example:"s3cur3P@ss!"`
	// InviteCode is required when the server runs in invite-only mode.
	InviteCode string `json:"invite_code,omitempty" example:"K7M2-X9QF"`
	// Captcha is the solved ALTCHA payload (base64 JSON) for a challenge from GET /api/captcha/challenge. It is
	// required when /api/server-info reports captcha_required.
	Captcha string `json:"captcha,omitempty" example:"eyJhbGdvcml0aG0iOiJTSEEtMjU2IiwuLi59"`
}

type RegisterResponse struct {
	ID       string `json:"id"       example:"a3f4..."`
	Username string `json:"username" example:"alice"`
}

type LoginRequest struct {
	Username string `json:"username" example:"alice"`
	Password string `json:"password" example:"s3cur3P@ss!"`
}

type LoginResponse struct {
	ID                      string   `json:"id"       example:"a3f4..."`
	Username                string   `json:"username" example:"alice"`
	Domain                  string   `json:"domain"   example:"localhost"`
	Status                  string   `json:"status"   example:"online"`
	StatusPreference        string   `json:"status_preference" example:"auto"`
	AvatarID                string   `json:"avatar_id"`
	AvatarIDs               []string `json:"avatar_ids"`
	BannerColor             string   `json:"banner_color,omitempty"`
	CustomMsg               string   `json:"custom_msg,omitempty"`
	AllowChannelAdds        string   `json:"allow_channel_adds,omitempty"`
	DMPermission            string   `json:"dm_permission,omitempty"`
	FriendRequestPermission string   `json:"friend_request_permission,omitempty"`
	Token                   string   `json:"token"`
	// ServerRole is "owner" or "admin" for panel users, empty otherwise.
	ServerRole string `json:"server_role,omitempty"`
}

type ChannelResponse struct {
	ID                    string            `json:"id"`
	Name                  string            `json:"name"`
	Description           string            `json:"description,omitempty"`
	AvatarID              string            `json:"avatar_id"`
	IsPrivate             bool              `json:"is_private"`
	InviteLink            string            `json:"invite_link"`
	CreatorID             string            `json:"creator_id"`
	UserRole              int               `json:"user_role"` // 0=Member, 10=Admin, 20=Owner
	Members               []string          `json:"members,omitempty"`
	MemberNames           map[string]string `json:"member_names,omitempty"`
	MemberAvatars         map[string]string `json:"member_avatars,omitempty"`
	MemberDomains         map[string]string `json:"member_domains,omitempty"`
	MemberStatuses        map[string]string `json:"member_statuses,omitempty"`
	MemberRoles           map[string]int    `json:"member_roles,omitempty"`
	CreatedAt             time.Time         `json:"created_at"`
	UnreadCount           int               `json:"unread_count,omitempty"`
	LastMessageAt         time.Time         `json:"last_message_at"`
	LastMessageCiphertext []byte            `json:"last_message_ciphertext,omitempty"`
	LastMessageNonce      []byte            `json:"last_message_nonce,omitempty"`
	LastMessageType       string            `json:"last_message_type,omitempty"`
	LastMessageSenderID   string            `json:"last_message_sender_id,omitempty"`
	LastMessageID         string            `json:"last_message_id,omitempty"`
}

type UpdateChannelRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	AvatarID    *string `json:"avatar_id,omitempty"`
	IsPrivate   *bool   `json:"is_private,omitempty"`
}

type ExploreChannelResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	AvatarID    string    `json:"avatar_id"`
	InviteLink  string    `json:"invite_link"`
	MemberCount int       `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type UserResponse struct {
	ID                      string   `json:"id" example:"user-1"`
	Username                string   `json:"username" example:"alice"`
	Domain                  string   `json:"domain" example:"localhost"`
	Status                  string   `json:"status" example:"online"`
	StatusPreference        string   `json:"status_preference" example:"auto"`
	AvatarID                string   `json:"avatar_id"`
	AvatarIDs               []string `json:"avatar_ids"`
	BannerColor             string   `json:"banner_color,omitempty"`
	CustomMsg               string   `json:"custom_msg,omitempty"`
	AllowChannelAdds        string   `json:"allow_channel_adds,omitempty"`
	DMPermission            string   `json:"dm_permission,omitempty"`
	FriendRequestPermission string   `json:"friend_request_permission,omitempty"`
	// ServerRole is only filled in for the caller's own account (/api/me), never for other users.
	ServerRole string `json:"server_role,omitempty"`
}

type UpdateUserRequest struct {
	Username                string    `json:"username,omitempty"`
	Password                string    `json:"password,omitempty"`
	OldPassword             string    `json:"old_password,omitempty"`
	AvatarID                *string   `json:"avatar_id,omitempty"`
	AvatarIDs               *[]string `json:"avatar_ids,omitempty"`
	BannerColor             *string   `json:"banner_color,omitempty"`
	CustomMsg               *string   `json:"custom_msg,omitempty"`
	StatusPreference        *string   `json:"status_preference,omitempty"`
	AllowChannelAdds        *string   `json:"allow_channel_adds,omitempty"`
	DMPermission            *string   `json:"dm_permission,omitempty"`
	FriendRequestPermission *string   `json:"friend_request_permission,omitempty"`
}

type ErrorResponse struct {
	Error string `json:"error" example:"invalid credentials"`
}

type StatusResponse struct {
	Status string `json:"status" example:"success"`
}

type CreateChannelRequest struct {
	Name        string   `json:"name"                  example:"Design Team"`
	Description string   `json:"description,omitempty" example:"A place for design discussions"`
	AvatarID    string   `json:"avatar_id,omitempty"`
	IsPrivate   bool     `json:"is_private"            example:"false"`
	Members     []string `json:"members"               example:"[\"user-id-1\",\"user-id-2\"]"`
}

type SkippedMember struct {
	UserID string `json:"user_id"`
	Reason string `json:"reason"`
}

type AddMembersRequest struct {
	UserIDs []string `json:"user_ids" example:"[\"user-1\",\"user-2\"]"`
}

type AddMembersResponse struct {
	Added   []string        `json:"added"`
	Skipped []SkippedMember `json:"skipped"`
}

type UploadFileResponse struct {
	FileID           string  `json:"file_id"`
	Size             int64   `json:"size"`
	Mime             string  `json:"mime"`
	ProcessingStatus string  `json:"processing_status,omitempty"`
	DurationSec      float64 `json:"duration_sec,omitempty"`
	Uploaded         string  `json:"uploaded"`
}

// Relationship types
type RelationshipActionRequest struct {
	Action string `json:"action"` // "request" | "accept" | "decline" | "cancel" | "remove" | "block" | "unblock"
}

type RelationshipResponse struct {
	FromUserID string        `json:"from_user_id"`
	ToUserID   string        `json:"to_user_id"`
	Type       string        `json:"type"` // "none" | "requested" | "friend" | "blocked"
	User       *UserResponse `json:"user,omitempty"`
	CreatedAt  time.Time     `json:"created_at,omitempty"`
	UpdatedAt  time.Time     `json:"updated_at,omitempty"`
}
