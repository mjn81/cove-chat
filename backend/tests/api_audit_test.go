package tests

import (
	"encoding/json"
	"net/http/httptest"
	"cove/backend/internal/store"
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/logger"
	"cove/backend/internal/models"
	"cove/update"
)

// rawBody reads and closes a response body.
func rawBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// errEnvelope decodes the standard error envelope.
func errEnvelope(t *testing.T, resp *http.Response) (msg, code string) {
	t.Helper()
	var out struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	readJSON(t, resp, &out)
	return out.Error, out.Code
}



// ---- #5 explore never leaks invite links; public channels join by id ----- //

func TestExplore_HidesInviteLinkAndJoinWorksByPublicID(t *testing.T) {
	srv := testServer(t)
	tokA := registerAndLogin(t, srv, "ex_alice", "password123!")
	tokB := registerAndLogin(t, srv, "ex_bob", "password123!")

	pub := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokA, jsonBody(t, api.CreateChannelRequest{Name: "Open Lounge"})))
	var pubCh map[string]any
	decodeJSON(t, pub, &pubCh)
	priv := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokA, jsonBody(t, api.CreateChannelRequest{Name: "Hidden Lounge", IsPrivate: true})))
	var privCh map[string]any
	decodeJSON(t, priv, &privCh)

	resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels/explore?q=Lounge", tokB, nil))
	body := rawBody(t, resp)
	if strings.Contains(body, "invite_link") {
		t.Fatalf("explore leaks invite_link: %s", body)
	}
	if !strings.Contains(body, "Open Lounge") || strings.Contains(body, "Hidden Lounge") {
		t.Fatalf("explore should list exactly the public channel: %s", body)
	}

	// A public channel can be joined with its id (that is all explore offers now).
	join := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/join/"+pubCh["id"].(string), tokB, nil))
	if join.StatusCode != http.StatusOK {
		t.Fatalf("join public by id = %d, want 200", join.StatusCode)
	}
	// A private channel id is NOT a join credential.
	bad := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/join/"+privCh["id"].(string), tokB, nil))
	if bad.StatusCode != http.StatusNotFound {
		t.Fatalf("join private by id = %d, want 404", bad.StatusCode)
	}
}

// ---- #6 UpdateMember: DTO + role whitelist ------------------------------- //

func TestUpdateMember_RoleWhitelist(t *testing.T) {
	srv := testServer(t)
	tokO := registerAndLogin(t, srv, "um_owner", "password123!")
	tokM := registerAndLogin(t, srv, "um_member", "password123!")
	memberID := meID(t, srv, tokM)
	chID := createGroupChannel(t, srv, tokO, "roles", memberID)

	patch := func(token string, role any) *http.Response {
		return mustDo(t, newJSONReq(t, http.MethodPatch, srv.URL+"/api/channels/"+chID+"/members/"+memberID, token,
			jsonBody(t, map[string]any{"role": role})))
	}
	for _, role := range []int{20, 5, -1, 99} {
		resp := patch(tokO, role)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("role %d = %d, want 400", role, resp.StatusCode)
		}
		if _, code := errEnvelope(t, resp); code != "validation_failed" {
			t.Fatalf("role %d code = %q, want validation_failed", role, code)
		}
	}
	if r := patch(tokO, 10); r.StatusCode != http.StatusOK {
		t.Fatalf("promote to admin = %d, want 200", r.StatusCode)
	}
	if r := patch(tokO, 0); r.StatusCode != http.StatusOK {
		t.Fatalf("demote to member = %d, want 200", r.StatusCode)
	}
	if r := patch(tokM, 10); r.StatusCode != http.StatusForbidden {
		t.Fatalf("member changing roles = %d, want 403", r.StatusCode)
	}
}

// ---- #7 upload response hides the storage path --------------------------- //

func uploadMultipart(t *testing.T, base, token string, content []byte) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("file", "blob.bin")
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPost, base+"/api/files", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	return mustDo(t, req)
}

func TestUploadFile_ResponseHasNoStoragePath(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "up_user", "password123!")
	resp := uploadMultipart(t, srv.URL, tok, []byte("opaque-ciphertext"))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload = %d", resp.StatusCode)
	}
	body := rawBody(t, resp)
	if strings.Contains(body, "storage_path") || strings.Contains(body, "uploads") {
		t.Fatalf("upload response leaks the server's storage path: %s", body)
	}
	var f api.UploadFileResponse
	if err := json.Unmarshal([]byte(body), &f); err != nil || f.ID == "" || f.Size != int64(len("opaque-ciphertext")) {
		t.Fatalf("upload response lost fields clients rely on: %s (%v)", body, err)
	}
}

func TestUploadFile_OversizeIs413AndOtherParseErrorsAre400(t *testing.T) {
	srv := testServerWith(t, func(h *api.Handler) { h.MaxFileSizeMB = 1 })
	tok := registerAndLogin(t, srv, "ov_user", "password123!")
	resp := uploadMultipart(t, srv.URL, tok, bytes.Repeat([]byte("x"), 3<<20))
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload = %d, want 413", resp.StatusCode)
	}
	if _, code := errEnvelope(t, resp); code != "payload_too_large" {
		t.Fatalf("oversize code = %q", code)
	}

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/files", strings.NewReader("not multipart at all"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=zzz")
	req.Header.Set("Authorization", "Bearer "+tok)
	bad := mustDo(t, req)
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed multipart = %d, want 400", bad.StatusCode)
	}
}

// ---- #8 invite codes stay out of logs and the audit trail ---------------- //

func TestInviteCodes_NotLoggedOrAuditedInPlaintext(t *testing.T) {
	var logs bytes.Buffer
	logger.SetOutput(&logs)
	defer logger.SetOutput(os.Stdout)

	e := newAdminEnv(t, "invite_only")
	owner, _, _ := e.seedRoles(t)
	const secret = "ZQXJ-7788-HUSH"
	if r := e.do(t, "POST", "/api/admin/invites", owner, map[string]any{"code": secret, "max_uses": 3}); r.StatusCode != http.StatusCreated {
		t.Fatalf("create invite = %d", r.StatusCode)
	}
	if r := e.do(t, "DELETE", "/api/admin/invites/"+secret, owner, nil); r.StatusCode != http.StatusOK {
		t.Fatalf("revoke invite = %d", r.StatusCode)
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatalf("invite code written to the log:\n%s", logs.String())
	}
	resp := e.do(t, "GET", "/api/admin/audit", owner, nil)
	if body := rawBody(t, resp); strings.Contains(body, secret) || !strings.Contains(body, "invite.create") {
		t.Fatalf("audit trail must record the action without the code: %s", body)
	}
}

// ---- #9 restore checks the password before reading the upload ------------ //

func TestRestore_WrongPasswordRejectedBeforeParsingTheUpload(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)

	// The password part is followed by a file part that is cut off. Parsing the whole form first would fail with
	// 400 (invalid_upload); checking the password as soon as it is read answers 403.
	boundary := "xBOUNDARYx"
	body := "--" + boundary + "\r\nContent-Disposition: form-data; name=\"password\"\r\n\r\nwrong-password\r\n" +
		"--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x\"\r\n\r\npartial-data-with-no-closing-boundary"
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/admin/restore", strings.NewReader(body))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Authorization", "Bearer "+owner)
	resp := mustDo(t, req)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("restore with a wrong password and a broken body = %d, want 403", resp.StatusCode)
	}
}

// ---- #10 server update needs the owner's password ------------------------ //

func TestUpdate_StartRequiresPassword(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	for name, body := range map[string]any{
		"missing": map[string]any{},
		"wrong":   map[string]any{"password": "definitely-not-it"},
	} {
		resp := u.do(t, "POST", "/api/admin/update", u.owner, body)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s password = %d, want 403", name, resp.StatusCode)
		}
	}
	if u.readExe(t) != updOld {
		t.Fatal("binary changed without a valid password")
	}
	resp := u.do(t, "POST", "/api/admin/update", u.owner, map[string]any{"password": testPassword})
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("correct password = %d, want 202", resp.StatusCode)
	}
}

func TestUpdate_UploadRequiresPasswordBeforeTheFile(t *testing.T) {
	u := newUpdateEnv(t, update.ModeBinary, nil)
	z := u.goodZip(t)
	resp := u.upload(t, u.owner, map[string]string{"version": "1.0.0", "password": "wrong"}, "a.zip", z)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("wrong password upload = %d, want 403", resp.StatusCode)
	}
	if in := u.info(t, u.owner, ""); in.Uploaded != nil {
		t.Fatal("an upload with a wrong password was staged")
	}
	resp = u.upload(t, u.owner, map[string]string{"version": "1.0.0", "password": ""}, "a.zip", z)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("missing password upload = %d, want 403", resp.StatusCode)
	}
}

// ---- #11 user search bounds ---------------------------------------------- //

func TestSearchUsers_MinLengthAndCap(t *testing.T) {
	e := testServerWithStore(t)
	tok := registerAndLogin(t, e.srv, "zz_searcher", "password123!")
	for i := 0; i < 60; i++ {
		if err := e.store.UpdateUser(&models.User{ID: fmt.Sprintf("bulk-%03d", i), Username: fmt.Sprintf("bulkuser%03d", i), Domain: "localhost"}); err != nil {
			t.Fatal(err)
		}
	}
	list := func(q string) []map[string]any {
		resp := mustDo(t, newJSONReq(t, http.MethodGet, e.srv.URL+"/api/users?q="+q, tok, nil))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("search %q = %d", q, resp.StatusCode)
		}
		var out []map[string]any
		decodeJSON(t, resp, &out)
		return out
	}
	if got := list("b"); len(got) != 0 {
		t.Fatalf("1-char query returned %d users, want 0", len(got))
	}
	if got := list("bulkuser"); len(got) != 50 {
		t.Fatalf("broad query returned %d users, want the 50 cap", len(got))
	}
}

// ---- #13 captcha challenge is rate limited ------------------------------- //

func TestCaptchaChallenge_IsRateLimited(t *testing.T) {
	srv := testServerWithLimits(t, 1, 1000, nil)
	limited := false
	for i := 0; i < 20; i++ {
		resp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/captcha/challenge", "", nil))
		code := resp.StatusCode
		resp.Body.Close()
		if code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("captcha challenge endpoint has no rate limit")
	}
}

// ---- #15 enum validation on the profile ---------------------------------- //

func TestUpdateProfile_RejectsInvalidEnums(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "pe_user", "password123!")
	for _, body := range []map[string]any{
		{"status_preference": "bogus"},
		{"allow_channel_adds": "bogus"},
		{"dm_permission": "bogus"},
		{"friend_request_permission": "friends"},
	} {
		resp := mustDo(t, newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", tok, jsonBody(t, body)))
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%v = %d, want 400", body, resp.StatusCode)
		}
		if _, code := errEnvelope(t, resp); code != "validation_failed" {
			t.Fatalf("%v code = %q", body, code)
		}
	}
	for _, pref := range []string{"auto", "online", "away", "dnd", "offline"} {
		resp := mustDo(t, newJSONReq(t, http.MethodPatch, srv.URL+"/api/users/me", tok, jsonBody(t, map[string]any{"status_preference": pref})))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status_preference %q = %d, want 200", pref, resp.StatusCode)
		}
	}
}

type storeServer struct {
	srv   *httptest.Server
	store *store.Store
}

// testServerWithStore is testServer that also hands out the store, to seed data without paying for password hashing.
func testServerWithStore(t *testing.T) storeServer {
	t.Helper()
	var st *store.Store
	srv := testServerWith(t, func(h *api.Handler) { st = h.Store })
	return storeServer{srv: srv, store: st}
}
