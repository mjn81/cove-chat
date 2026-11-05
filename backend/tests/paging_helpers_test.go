package tests

import (
	"net/http"
	"testing"
)

// decodeItems decodes the paged-list envelope {"items": [...]} of a 200 response into a slice (nil when the server sent null).
func decodeItems[T any](t *testing.T, resp *http.Response) []T {
	t.Helper()
	var env struct {
		Items []T `json:"items"`
	}
	decodeJSON(t, resp, &env)
	return env.Items
}
