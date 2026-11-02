package api

import (
	"errors"
	"net/http"

	"cove/backend/internal/apistd"
)

// pageParams reads and validates `limit` and `cursor` from the query. On bad input it writes 400 validation_failed
// itself and returns ok=false, so every paged endpoint answers identically.
func pageParams(w http.ResponseWriter, r *http.Request) (limit int, cursor string, ok bool) {
	q := r.URL.Query()
	limit, err := apistd.ParsePageLimit(q.Get("limit"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return 0, "", false
	}
	return limit, q.Get("cursor"), true
}

// writePage slices an ordered, fully loaded list into the requested page and writes it. mk wraps the page and
// next cursor into the endpoint's named response type (named types keep Swagger readable; swaggo cannot do generics).
func writePage[T, R any](w http.ResponseWriter, items []T, cursor string, limit int, mk func(items []T, next string) R) {
	page, next, err := apistd.Paginate(items, cursor, limit)
	if err != nil {
		writeBadCursor(w, err)
		return
	}
	if page == nil {
		page = []T{}
	}
	writeJSON(w, http.StatusOK, mk(page, next))
}

// writeBadCursor answers a rejected cursor with 400 validation_failed.
func writeBadCursor(w http.ResponseWriter, err error) {
	msg := "invalid cursor"
	if !errors.Is(err, apistd.ErrBadCursor) {
		msg = err.Error()
	}
	writeError(w, http.StatusBadRequest, msg)
}
