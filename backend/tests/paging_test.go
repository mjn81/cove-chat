package tests

import (
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"cove/backend/internal/apistd"
	"cove/backend/internal/models"
)

// ---- apistd helpers ------------------------------------------------------- //

func TestParsePageLimit(t *testing.T) {
	cases := []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{"", apistd.DefaultPageLimit, false},
		{"1", 1, false},
		{"100", 100, false},
		{"0", 0, true},
		{"-3", 0, true},
		{"101", 0, true},
		{"abc", 0, true},
	}
	for _, c := range cases {
		got, err := apistd.ParsePageLimit(c.raw)
		if (err != nil) != c.wantErr || (!c.wantErr && got != c.want) {
			t.Errorf("ParsePageLimit(%q) = %d, %v", c.raw, got, err)
		}
	}
}

func TestCursorRoundTripAndTamper(t *testing.T) {
	c := apistd.EncodeCursor("msg", "01ABC")
	if c == "" {
		t.Fatal("empty cursor")
	}
	v, err := apistd.DecodeCursor("msg", c)
	if err != nil || v != "01ABC" {
		t.Fatalf("round trip = %q, %v", v, err)
	}
	if v, err := apistd.DecodeCursor("msg", ""); err != nil || v != "" {
		t.Fatalf("empty cursor = %q, %v", v, err)
	}
	for _, bad := range []string{"%%%", "garbage", apistd.EncodeCursor("other", "x")} {
		if _, err := apistd.DecodeCursor("msg", bad); err == nil {
			t.Errorf("cursor %q accepted", bad)
		}
	}
}

func TestPaginateOffsets(t *testing.T) {
	items := []int{1, 2, 3, 4, 5}
	page, next, err := apistd.Paginate(items, "", 2)
	if err != nil || len(page) != 2 || next == "" {
		t.Fatalf("first page = %v, %q, %v", page, next, err)
	}
	page, next, _ = apistd.Paginate(items, next, 2)
	if len(page) != 2 || page[0] != 3 || next == "" {
		t.Fatalf("second page = %v, %q", page, next)
	}
	page, next, _ = apistd.Paginate(items, next, 2)
	if len(page) != 1 || page[0] != 5 || next != "" {
		t.Fatalf("last page = %v, %q", page, next)
	}
	if _, _, err := apistd.Paginate(items, "nonsense", 2); err == nil {
		t.Fatal("garbage cursor accepted")
	}
}

// ---- endpoint helpers ------------------------------------------------------ //

type pageOf struct {
	Items      []map[string]any `json:"items"`
	NextCursor string           `json:"next_cursor"`
}

// getPage fetches one page and fails unless the status matches.
func getPage(t *testing.T, base, path, token string, want int) pageOf {
	t.Helper()
	resp := mustDo(t, newJSONReq(t, http.MethodGet, base+path, token, nil))
	if resp.StatusCode != want {
		t.Fatalf("GET %s = %d, want %d: %s", path, resp.StatusCode, want, rawBody(t, resp))
	}
	var out pageOf
	if want == http.StatusOK {
		decodeJSON(t, resp, &out)
		if out.Items == nil {
			t.Fatalf("GET %s: items must be a (possibly empty) array", path)
		}
	} else {
		resp.Body.Close()
	}
	return out
}

// walkPages follows next_cursor until exhausted and returns every item id/key in order. It also asserts that
// each non-final page is full, i.e. the envelope does not stop early.
func walkPages(t *testing.T, base, path, token, key string, limit int) []string {
	t.Helper()
	sep := "?"
	if u, _ := url.Parse(path); u != nil && u.RawQuery != "" {
		sep = "&"
	}
	var all []string
	cursor := ""
	for i := 0; i < 50; i++ {
		p := fmt.Sprintf("%s%slimit=%d", path, sep, limit)
		if cursor != "" {
			p += "&cursor=" + url.QueryEscape(cursor)
		}
		pg := getPage(t, base, p, token, http.StatusOK)
		if len(pg.Items) > limit {
			t.Fatalf("%s returned %d items for limit %d", p, len(pg.Items), limit)
		}
		for _, it := range pg.Items {
			all = append(all, fmt.Sprint(it[key]))
		}
		if pg.NextCursor == "" {
			return all
		}
		if len(pg.Items) != limit {
			t.Fatalf("%s: next_cursor set on a short page (%d items)", p, len(pg.Items))
		}
		cursor = pg.NextCursor
	}
	t.Fatalf("%s never ended", path)
	return nil
}

func assertUnique(t *testing.T, ids []string, want int) {
	t.Helper()
	seen := map[string]bool{}
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("duplicate %q across pages: %v", id, ids)
		}
		seen[id] = true
	}
	if len(ids) != want {
		t.Fatalf("got %d items across pages, want %d: %v", len(ids), want, ids)
	}
}

// assertBadPaging checks the shared 400 validation_failed contract for limit/cursor.
func assertBadPaging(t *testing.T, base, path, token string) {
	t.Helper()
	sep := "?"
	if u, _ := url.Parse(path); u != nil && u.RawQuery != "" {
		sep = "&"
	}
	for _, q := range []string{"limit=0", "limit=-1", "limit=101", "limit=abc", "cursor=%25%25garbage"} {
		resp := mustDo(t, newJSONReq(t, http.MethodGet, base+path+sep+q, token, nil))
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("GET %s%s%s = %d, want 400", path, sep, q, resp.StatusCode)
		}
		if _, code := errEnvelope(t, resp); code != "validation_failed" {
			t.Fatalf("GET %s%s%s code = %q, want validation_failed", path, sep, q, code)
		}
	}
}

// ---- endpoints ------------------------------------------------------------- //

func TestListMessages_PagedNewestFirst(t *testing.T) {
	e := testServerWithStore(t)
	tok := registerAndLogin(t, e.srv, "pg_msg", testPassword)
	chID := createGroupChannel(t, e.srv, tok, "paged")
	uid := meID(t, e.srv, tok)

	base := time.Now().UTC().Add(-time.Hour)
	for i := 0; i < 7; i++ {
		m := &models.Message{
			ID: fmt.Sprintf("%02d", i), ChannelID: chID, SenderID: uid, Type: models.MessageType("text"),
			Ciphertext: []byte("c"), Nonce: []byte("n"), SentAt: base.Add(time.Duration(i) * time.Minute),
		}
		if err := e.store.SaveMessage(m); err != nil {
			t.Fatal(err)
		}
	}

	got := walkPages(t, e.srv.URL, "/api/channels/"+chID+"/messages", tok, "id", 3)
	assertUnique(t, got, 7)
	if got[0] != "06" || got[6] != "00" {
		t.Fatalf("messages must be newest page first, got %v", got)
	}

	first := getPage(t, e.srv.URL, "/api/channels/"+chID+"/messages?limit=7", tok, http.StatusOK)
	if len(first.Items) != 7 || first.NextCursor != "" {
		t.Fatalf("exact-fit page = %d items, cursor %q", len(first.Items), first.NextCursor)
	}
	assertBadPaging(t, e.srv.URL, "/api/channels/"+chID+"/messages", tok)
}

func TestListMessages_CursorIsNotTransferableBetweenEndpoints(t *testing.T) {
	e := testServerWithStore(t)
	tok := registerAndLogin(t, e.srv, "pg_x", testPassword)
	for i := 0; i < 3; i++ {
		createGroupChannel(t, e.srv, tok, fmt.Sprintf("xc%d", i))
	}
	chans := getPage(t, e.srv.URL, "/api/channels?limit=1", tok, http.StatusOK)
	if chans.NextCursor == "" {
		t.Fatal("expected a cursor")
	}
	chID := createGroupChannel(t, e.srv, tok, "other")
	resp := mustDo(t, newJSONReq(t, http.MethodGet, e.srv.URL+"/api/channels/"+chID+"/messages?cursor="+url.QueryEscape(chans.NextCursor), tok, nil))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("foreign cursor = %d, want 400", resp.StatusCode)
	}
}

func TestListChannels_Paged(t *testing.T) {
	srv := testServer(t)
	tok := registerAndLogin(t, srv, "pg_chan", testPassword)
	for i := 0; i < 5; i++ {
		createGroupChannel(t, srv, tok, fmt.Sprintf("room%d", i))
	}
	got := walkPages(t, srv.URL, "/api/channels", tok, "id", 2)
	assertUnique(t, got, 5)
	assertBadPaging(t, srv.URL, "/api/channels", tok)
	if r := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", "", nil)); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", r.StatusCode)
	}
}

func TestExplore_Paged(t *testing.T) {
	srv := testServer(t)
	tokA := registerAndLogin(t, srv, "pg_exa", testPassword)
	tokB := registerAndLogin(t, srv, "pg_exb", testPassword)
	for i := 0; i < 5; i++ {
		createGroupChannel(t, srv, tokA, fmt.Sprintf("Public %d", i))
	}
	got := walkPages(t, srv.URL, "/api/channels/explore?q=Public", tokB, "id", 2)
	assertUnique(t, got, 5)
	assertBadPaging(t, srv.URL, "/api/channels/explore?q=Public", tokB)
}

func TestChannelMembers_Paged(t *testing.T) {
	srv := testServer(t)
	tokO := registerAndLogin(t, srv, "pg_mo", testPassword)
	var ids []string
	for i := 0; i < 4; i++ {
		tok := registerAndLogin(t, srv, fmt.Sprintf("pg_m%d", i), testPassword)
		ids = append(ids, meID(t, srv, tok))
	}
	chID := createGroupChannel(t, srv, tokO, "crowd", ids...)
	got := walkPages(t, srv.URL, "/api/channels/"+chID+"/members", tokO, "id", 2)
	assertUnique(t, got, 5)
	assertBadPaging(t, srv.URL, "/api/channels/"+chID+"/members", tokO)
}

func TestSearchUsers_PagedKeepsMinLengthAndTotalCap(t *testing.T) {
	e := testServerWithStore(t)
	tok := registerAndLogin(t, e.srv, "zz_pgsearch", testPassword)
	for i := 0; i < 60; i++ {
		if err := e.store.UpdateUser(&models.User{ID: fmt.Sprintf("bulk-%03d", i), Username: fmt.Sprintf("bulkuser%03d", i), Domain: "localhost"}); err != nil {
			t.Fatal(err)
		}
	}
	short := getPage(t, e.srv.URL, "/api/users?q=b", tok, http.StatusOK)
	if len(short.Items) != 0 || short.NextCursor != "" {
		t.Fatalf("1-char query = %+v", short)
	}
	got := walkPages(t, e.srv.URL, "/api/users?q=bulkuser", tok, "id", 20)
	assertUnique(t, got, 50) // the total result cap still applies across pages
	assertBadPaging(t, e.srv.URL, "/api/users?q=bulkuser", tok)
}

func TestRelationships_Paged(t *testing.T) {
	srv := testServer(t)
	tokT := registerAndLogin(t, srv, "pg_target", testPassword)
	tID := meID(t, srv, tokT)
	var senders []string
	for i := 0; i < 3; i++ {
		tok := registerAndLogin(t, srv, fmt.Sprintf("pg_req%d", i), testPassword)
		senders = append(senders, tok)
		r := mustDo(t, newJSONReq(t, http.MethodPut, srv.URL+"/api/users/"+tID+"/relationship", tok, jsonBody(t, map[string]any{"action": "request"})))
		if r.StatusCode != http.StatusOK {
			t.Fatalf("request = %d", r.StatusCode)
		}
	}
	got := walkPages(t, srv.URL, "/api/relationships/incoming", tokT, "from_user_id", 2)
	assertUnique(t, got, 3)
	assertBadPaging(t, srv.URL, "/api/relationships/incoming", tokT)

	out := walkPages(t, srv.URL, "/api/relationships", senders[0], "to_user_id", 1)
	assertUnique(t, out, 1)
	assertBadPaging(t, srv.URL, "/api/relationships", senders[0])
}

func TestAdminInvitesAndAudit_Paged(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	for i := 0; i < 5; i++ {
		if r := e.do(t, "POST", "/api/admin/invites", owner, map[string]any{"max_uses": 1}); r.StatusCode != http.StatusCreated {
			t.Fatalf("create invite = %d", r.StatusCode)
		}
	}
	got := walkPages(t, e.srv.URL, "/api/admin/invites", owner, "code", 2)
	assertUnique(t, got, 5)
	assertBadPaging(t, e.srv.URL, "/api/admin/invites", owner)

	audit := walkPages(t, e.srv.URL, "/api/admin/audit", owner, "id", 2)
	if len(audit) < 6 { // grant admin + 5 invites
		t.Fatalf("audit walked %d entries, want at least 6", len(audit))
	}
	assertUnique(t, audit, len(audit))
	assertBadPaging(t, e.srv.URL, "/api/admin/audit", owner)
}

func TestAdminAudit_NotTruncatedAt200(t *testing.T) {
	e := newAdminEnv(t, "open")
	owner, _, _ := e.seedRoles(t)
	actor, err := e.store.GetUserByUsername("owner")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 230; i++ {
		if err := e.store.Audit(actor, "test.bulk", fmt.Sprintf("t%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	got := walkPages(t, e.srv.URL, "/api/admin/audit", owner, "id", 100)
	if len(got) < 230 {
		t.Fatalf("audit paging stopped at %d entries, want all (>=230)", len(got))
	}
}
