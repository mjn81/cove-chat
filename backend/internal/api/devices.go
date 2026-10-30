package api

import (
	"net/http"
	"strings"

	"cove/backend/internal/auth"
	"cove/backend/internal/middleware"
)

// sessionDisconnecter is implemented by the WebSocket hub so ending a session also closes its live sockets.
// It is optional (tests build a Handler with no Hub), hence a separate interface.
type sessionDisconnecter interface {
	DisconnectSession(sessionID string)
}

// maxDeviceField bounds client-supplied header text before it is stored and shown to the user.
const maxDeviceField = 120

func cleanDeviceField(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	if len(s) > maxDeviceField {
		s = s[:maxDeviceField]
	}
	return s
}

// parseUserAgent reduces a browser User-Agent to "Browser on OS" plus the OS family. Order matters: Edge, Opera
// and Chrome all contain "Chrome", and Chrome contains "Safari".
func parseUserAgent(ua string) (device, platform string) {
	browser := "Browser"
	for _, b := range []struct{ token, name string }{
		{"Edg/", "Edge"}, {"OPR/", "Opera"}, {"Firefox/", "Firefox"},
		{"Chrome/", "Chrome"}, {"Safari/", "Safari"},
	} {
		if strings.Contains(ua, b.token) {
			browser = b.name
			break
		}
	}
	switch {
	case strings.Contains(ua, "Android"):
		platform = "Android"
	case strings.Contains(ua, "iPhone"), strings.Contains(ua, "iPad"):
		platform = "iOS"
	case strings.Contains(ua, "Windows"):
		platform = "Windows"
	case strings.Contains(ua, "Mac OS X"), strings.Contains(ua, "Macintosh"):
		platform = "macOS"
	case strings.Contains(ua, "Linux"), strings.Contains(ua, "X11"):
		platform = "Linux"
	}
	if platform == "" {
		return browser, ""
	}
	return browser + " on " + platform, platform
}

// sessionMetaFor describes the client making r: IP (proxy-aware), a device label, and where it is.
// Native apps send X-Cove-Device / X-Cove-App; browsers fall back to their User-Agent.
func (h *Handler) sessionMetaFor(r *http.Request) auth.SessionMeta {
	ua := r.UserAgent()
	device, platform := parseUserAgent(ua)
	if d := cleanDeviceField(r.Header.Get("X-Cove-Device")); d != "" {
		device = d
	}
	app := cleanDeviceField(r.Header.Get("X-Cove-App"))
	if app == "" {
		app = "Cove Web"
	}
	ip := middleware.ClientIP(r)
	meta := auth.SessionMeta{
		IP:         ip,
		UserAgent:  cleanDeviceField(ua),
		DeviceName: device,
		AppName:    app,
		Platform:   platform,
	}
	if h.Geo != nil {
		loc := h.Geo.Lookup(ip)
		meta.City, meta.Country = loc.City, loc.Country
	}
	// Behind Cloudflare the edge already knows the country; only trusted when proxy headers are trusted.
	if meta.Country == "" && middleware.TrustProxyHeaders {
		if cc := r.Header.Get("CF-IPCountry"); len(cc) == 2 && cc != "XX" && cc != "T1" {
			meta.Country = strings.ToUpper(cc)
		}
	}
	return meta
}

func toSessionResponse(s auth.Session, currentID string) SessionResponse {
	return SessionResponse{
		ID:           s.ID,
		DeviceName:   s.Meta.DeviceName,
		AppName:      s.Meta.AppName,
		Platform:     s.Meta.Platform,
		IP:           s.Meta.IP,
		City:         s.Meta.City,
		Country:      s.Meta.Country,
		CreatedAt:    s.CreatedAt,
		LastActiveAt: s.LastActiveAt,
		Current:      s.ID == currentID,
	}
}

// ListSessions godoc
//
//	@Summary     List the signed-in devices of the current user
//	@Description Returns every live session of the caller, most recently active first. The session making the
//	@Description request is flagged as current. Bearer tokens are never returned.
//	@Description **Access:** Authenticated.
//	@Tags        sessions
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {array}  SessionResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/sessions [get]
func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	cur := auth.SessionFromContext(r.Context())
	list := h.Sessions.ListByUser(cur.UserID)
	out := make([]SessionResponse, 0, len(list))
	for _, s := range list {
		out = append(out, toSessionResponse(s, cur.ID))
	}
	writeJSON(w, http.StatusOK, out)
}

// TerminateSession godoc
//
//	@Summary     Terminate one signed-in device
//	@Description Ends the caller's own session with the given id and closes its live connections. Another user's
//	@Description session id behaves exactly like an unknown one (404).
//	@Description **Access:** Authenticated (own sessions only).
//	@Tags        sessions
//	@Produce     json
//	@Security    BearerAuth
//	@Param       id path string true "Session ID"
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     404 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/sessions/{id} [delete]
func (h *Handler) TerminateSession(w http.ResponseWriter, r *http.Request) {
	cur := auth.SessionFromContext(r.Context())
	id := r.PathValue("id")
	if !h.Sessions.DeleteByID(cur.UserID, id) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	h.disconnectSessions(id)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

// TerminateOtherSessions godoc
//
//	@Summary     Terminate all other signed-in devices
//	@Description Ends every session of the caller except the one making the request.
//	@Description **Access:** Authenticated.
//	@Tags        sessions
//	@Produce     json
//	@Security    BearerAuth
//	@Success     200 {object} StatusResponse
//	@Failure     401 {object} ErrorResponse
//	@Failure     429 {object} ErrorResponse
//	@Router      /api/sessions/terminate-others [post]
func (h *Handler) TerminateOtherSessions(w http.ResponseWriter, r *http.Request) {
	cur := auth.SessionFromContext(r.Context())
	h.disconnectSessions(h.Sessions.DeleteOthers(cur.UserID, cur.ID)...)
	writeJSON(w, http.StatusOK, StatusResponse{Status: "success"})
}

func (h *Handler) disconnectSessions(ids ...string) {
	if d, ok := h.Hub.(sessionDisconnecter); ok && d != nil {
		for _, id := range ids {
			d.DisconnectSession(id)
		}
	}
}
