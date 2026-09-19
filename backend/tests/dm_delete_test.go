package tests

import (
	"net/http"
	"testing"

	"nodetalk/backend/internal/api"
	"nodetalk/backend/internal/models"
)

func TestDeleteDM_ForBoth(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "dm_user_a", "password123!")
	tokenB := registerAndLogin(t, srv, "dm_user_b", "password123!")

	// Fetch user B profile to get ID
	meResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenB, nil))
	var userB models.User
	decodeJSON(t, meResp, &userB)

	// User A creates DM with User B
	createBody := jsonBody(t, api.CreateChannelRequest{
		Name:    "", // DM has empty name
		Members: []string{userB.ID},
	})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, createBody))
	if chResp.StatusCode != http.StatusCreated && chResp.StatusCode != http.StatusOK {
		t.Fatalf("failed to create DM: status %d", chResp.StatusCode)
	}
	var dm models.Channel
	decodeJSON(t, chResp, &dm)

	// Verify both users see channel in ListChannels
	listAResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenA, nil))
	var listA []*models.Channel
	decodeJSON(t, listAResp, &listA)
	if len(listA) != 1 || listA[0].ID != dm.ID {
		t.Fatalf("expected user A to see DM, got %d channels", len(listA))
	}

	listBResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenB, nil))
	var listB []*models.Channel
	decodeJSON(t, listBResp, &listB)
	if len(listB) != 1 || listB[0].ID != dm.ID {
		t.Fatalf("expected user B to see DM, got %d channels", len(listB))
	}

	// User A deletes DM for BOTH (for_both=true)
	delResp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/channels/"+dm.ID+"?for_both=true", tokenA, nil))
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("delete for_both failed with status %d", delResp.StatusCode)
	}

	// Verify neither user sees it now
	listAResp2 := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenA, nil))
	var listA2 []*models.Channel
	decodeJSON(t, listAResp2, &listA2)
	if len(listA2) != 0 {
		t.Fatalf("expected user A channels to be empty, got %d", len(listA2))
	}

	listBResp2 := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenB, nil))
	var listB2 []*models.Channel
	decodeJSON(t, listBResp2, &listB2)
	if len(listB2) != 0 {
		t.Fatalf("expected user B channels to be empty, got %d", len(listB2))
	}
}

func TestDeleteDM_ForMeOnly(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenC := registerAndLogin(t, srv, "dm_user_c", "password123!")
	tokenD := registerAndLogin(t, srv, "dm_user_d", "password123!")

	// Fetch user C and D profiles to get IDs
	meCResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenC, nil))
	var userC models.User
	decodeJSON(t, meCResp, &userC)

	meDResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenD, nil))
	var userD models.User
	decodeJSON(t, meDResp, &userD)

	// User C creates DM with User D
	createBody := jsonBody(t, api.CreateChannelRequest{
		Name:    "",
		Members: []string{userD.ID},
	})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenC, createBody))
	var dm models.Channel
	decodeJSON(t, chResp, &dm)

	// User C deletes DM only for them (for_both=false)
	delResp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/channels/"+dm.ID+"?for_both=false", tokenC, nil))
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("delete for_both=false failed with status %d", delResp.StatusCode)
	}

	// User C's list should NOT contain the DM (hidden)
	listCResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenC, nil))
	var listC []*models.Channel
	decodeJSON(t, listCResp, &listC)
	if len(listC) != 0 {
		t.Fatalf("expected user C to have 0 visible channels after clearing, got %d", len(listC))
	}

	// User D's list SHOULD still contain the DM
	listDResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/channels", tokenD, nil))
	var listD []*models.Channel
	decodeJSON(t, listDResp, &listD)
	if len(listD) != 1 || listD[0].ID != dm.ID {
		t.Fatalf("expected user D to still see DM, got %d channels", len(listD))
	}
}

func TestDeleteDM_Unauthorized(t *testing.T) {
	srv := testServer(t)
	defer srv.Close()

	tokenA := registerAndLogin(t, srv, "dm_perm_a", "password123!")
	tokenB := registerAndLogin(t, srv, "dm_perm_b", "password123!")
	tokenE := registerAndLogin(t, srv, "dm_perm_e", "password123!")

	meBResp := mustDo(t, newJSONReq(t, http.MethodGet, srv.URL+"/api/me", tokenB, nil))
	var userB models.User
	decodeJSON(t, meBResp, &userB)

	// User A creates DM with User B
	createBody := jsonBody(t, api.CreateChannelRequest{
		Name:    "",
		Members: []string{userB.ID},
	})
	chResp := mustDo(t, newJSONReq(t, http.MethodPost, srv.URL+"/api/channels", tokenA, createBody))
	var dm models.Channel
	decodeJSON(t, chResp, &dm)

	// Outsider User E attempts to delete DM -> 403 Forbidden (protectMember middleware)
	delResp := mustDo(t, newJSONReq(t, http.MethodDelete, srv.URL+"/api/channels/"+dm.ID, tokenE, nil))
	if delResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status 403 Forbidden for outsider, got %d", delResp.StatusCode)
	}
}
