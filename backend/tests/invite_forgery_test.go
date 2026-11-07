package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"cove/backend/internal/api"
	"cove/backend/internal/apistd"
	"cove/backend/internal/crypto"
	"cove/backend/internal/models"
	"cove/backend/internal/store"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// inviteTestKEK matches the KEK setupWhisperTestServer derives.
var inviteTestKEK = crypto.DeriveKEK("whisper-test-kek")

// sealForChannel encrypts plaintext with the channel's key the way a client does (separate nonce and ciphertext).
func sealForChannel(t *testing.T, st *store.Store, channelID, plaintext string) (nonce, ct []byte) {
	t.Helper()
	ch, err := st.GetChannel(channelID)
	if err != nil {
		t.Fatalf("get channel: %v", err)
	}
	key, err := st.DecryptChannelKey(ch, inviteTestKEK)
	if err != nil {
		t.Fatalf("channel key: %v", err)
	}
	nonce, ct, err = crypto.SealGCM(key, []byte(plaintext))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	return nonce, ct
}

func newNamedChannel(t *testing.T, srvURL, token, name string, private bool) string {
	t.Helper()
	body := jsonBody(t, api.CreateChannelRequest{Name: name, IsPrivate: private, Members: []string{}})
	resp := mustDo(t, newJSONReq(t, http.MethodPost, srvURL+"/api/channels", token, body))
	var ch map[string]any
	decodeJSON(t, resp, &ch)
	return ch["id"].(string)
}

// wsConn is a test WebSocket whose frames are drained by one reader goroutine, so a wait can time out without
// cancelling a read (which would close the connection).
type wsConn struct {
	*websocket.Conn
	events chan *models.WSMessage
}

func dialWS(t *testing.T, ctx context.Context, srvURL, token string) *wsConn {
	t.Helper()
	conn, _, err := websocket.Dial(ctx, "ws"+srvURL[4:]+"/ws", &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}},
	})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	c := &wsConn{Conn: conn, events: make(chan *models.WSMessage, 256)}
	go func() {
		for {
			var m models.WSMessage
			if err := wsjson.Read(ctx, conn, &m); err != nil {
				close(c.events)
				return
			}
			select {
			case c.events <- &m:
			default:
			}
		}
	}()
	return c
}

// waitForWSEvent returns the payload of the next frame of the given type, or nil after d.
func waitForWSEvent(conn *wsConn, typ string, d time.Duration) map[string]any {
	timer := time.After(d)
	for {
		select {
		case m, ok := <-conn.events:
			if !ok {
				return nil
			}
			if m.Type == typ {
				var out map[string]any
				_ = json.Unmarshal(m.Payload, &out)
				return out
			}
		case <-timer:
			return nil
		}
	}
}

// sendInvite sends an invite message with the given body into the transport channel and returns whether it was stored.
func sendInvite(t *testing.T, ctx context.Context, conn *wsConn, st *store.Store, transport, body string) (stored bool, rejection map[string]any) {
	t.Helper()
	nonce, ct := sealForChannel(t, st, transport, body)
	sendWS(t, ctx, conn.Conn, "message", map[string]any{"channel_id": transport, "type": "invite", "ciphertext": ct, "nonce": nonce})
	rejection = waitForWSEvent(conn, "message_error", 700*time.Millisecond)
	return waitForMessage(t, st, transport, ct) != nil, rejection
}

func TestInviteMessage_ForgeryIsRejected(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	owner := registerAndLogin(t, srv, "inv_owner", "Password123!")
	attacker := registerAndLogin(t, srv, "inv_attacker", "Password123!")
	member := registerAndLogin(t, srv, "inv_member", "Password123!")

	privateID := newNamedChannel(t, srv.URL, owner, "Secret", true)
	privateCh, _ := st.GetChannel(privateID)
	publicID := newNamedChannel(t, srv.URL, owner, "Lobby", false)
	if err := st.AddMemberToChannel(privateID, userIDOf(t, srv, member), models.RoleMember); err != nil {
		t.Fatal(err)
	}
	if err := st.AddMemberToChannel(publicID, userIDOf(t, srv, member), models.RoleMember); err != nil {
		t.Fatal(err)
	}

	attackerTransport := newNamedChannel(t, srv.URL, attacker, "Attacker room", true)
	memberTransport := newNamedChannel(t, srv.URL, member, "Member room", true)
	ownerTransport := newNamedChannel(t, srv.URL, owner, "Owner room", true)

	aConn := dialWS(t, ctx, srv.URL, attacker)
	defer aConn.Close(websocket.StatusNormalClosure, "")
	mConn := dialWS(t, ctx, srv.URL, member)
	defer mConn.Close(websocket.StatusNormalClosure, "")
	oConn := dialWS(t, ctx, srv.URL, owner)
	defer oConn.Close(websocket.StatusNormalClosure, "")

	cases := []struct {
		name       string
		conn       *wsConn
		transport  string
		body       string
		wantStored bool
		wantCode   string
	}{
		{"owner shares own private link", oConn, ownerTransport, `{"code":"` + privateCh.InviteLink + `","name":"Secret"}`, true, ""},
		{"non-member forges a private link", aConn, attackerTransport, `{"code":"` + privateCh.InviteLink + `"}`, false, apistd.CodeInviteNotAllowed},
		{"plain member cannot share the private link", mConn, memberTransport, `{"code":"` + privateCh.InviteLink + `"}`, false, apistd.CodeInviteNotAllowed},
		{"private channel id is not an invite code", oConn, ownerTransport, `{"code":"` + privateID + `"}`, false, apistd.CodeValidationFailed},
		{"member shares a public channel by id", mConn, memberTransport, `{"code":"` + publicID + `"}`, true, ""},
		{"non-member cannot share a public channel", aConn, attackerTransport, `{"code":"` + publicID + `"}`, false, apistd.CodeInviteNotAllowed},
		{"unknown code", oConn, ownerTransport, `{"code":"does-not-exist"}`, false, apistd.CodeValidationFailed},
		{"not json", oConn, ownerTransport, `hello`, false, apistd.CodeValidationFailed},
		{"missing code", oConn, ownerTransport, `{"name":"x"}`, false, apistd.CodeValidationFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stored, rej := sendInvite(t, ctx, tc.conn, st, tc.transport, tc.body)
			if stored != tc.wantStored {
				t.Fatalf("stored = %v, want %v", stored, tc.wantStored)
			}
			if tc.wantCode == "" {
				if rej != nil {
					t.Fatalf("unexpected rejection: %v", rej)
				}
				return
			}
			if rej == nil {
				t.Fatal("expected a message_error event")
			}
			if rej["code"] != tc.wantCode || rej["channel_id"] != tc.transport {
				t.Errorf("rejection = %v, want code %q on channel %s", rej, tc.wantCode, tc.transport)
			}
		})
	}
}

func TestInviteMessage_AdminMaySharePrivateLinkAndKickedMayNot(t *testing.T) {
	srv, st, cleanup := setupWhisperTestServer(t)
	defer cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	owner := registerAndLogin(t, srv, "inv_owner2", "Password123!")
	admin := registerAndLogin(t, srv, "inv_admin2", "Password123!")
	privateID := newNamedChannel(t, srv.URL, owner, "Secret2", true)
	privateCh, _ := st.GetChannel(privateID)
	adminID := userIDOf(t, srv, admin)
	if err := st.AddMemberToChannel(privateID, adminID, models.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	transport := newNamedChannel(t, srv.URL, admin, "Admin room", true)
	conn := dialWS(t, ctx, srv.URL, admin)
	defer conn.Close(websocket.StatusNormalClosure, "")

	body := `{"code":"` + privateCh.InviteLink + `"}`
	if stored, rej := sendInvite(t, ctx, conn, st, transport, body); !stored || rej != nil {
		t.Fatalf("admin invite stored=%v rejection=%v", stored, rej)
	}

	if err := st.RemoveMemberFromChannel(privateID, adminID, models.StatusKicked); err != nil {
		t.Fatal(err)
	}
	stored, rej := sendInvite(t, ctx, conn, st, transport, body+" ")
	if stored || rej == nil || rej["code"] != apistd.CodeInviteNotAllowed {
		t.Fatalf("kicked admin: stored=%v rejection=%v", stored, rej)
	}
}
