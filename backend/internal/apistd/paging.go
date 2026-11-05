package apistd

import (
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
)

// Paging constants of the paged-list envelope (docs/api-standard.md section 9).
const (
	// DefaultPageLimit is the page size used when the client sends no `limit`.
	DefaultPageLimit = 50
	// MaxPageLimit is the largest accepted `limit`.
	MaxPageLimit = 100

	// CursorKindOffset tags cursors that are an offset into a deterministically ordered list.
	CursorKindOffset = "off"
)

// ErrBadLimit and ErrBadCursor mark invalid paging query parameters; handlers answer them with 400 validation_failed.
var (
	ErrBadLimit  = errors.New("limit must be a number between 1 and 100")
	ErrBadCursor = errors.New("invalid cursor")
)

// ParsePageLimit parses the `limit` query value: empty means DefaultPageLimit, otherwise 1..MaxPageLimit.
func ParsePageLimit(raw string) (int, error) {
	if raw == "" {
		return DefaultPageLimit, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > MaxPageLimit {
		return 0, ErrBadLimit
	}
	return n, nil
}

// EncodeCursor builds an opaque cursor. kind namespaces the cursor to one kind of list, so a cursor taken from one
// endpoint is rejected by another instead of silently producing a wrong page.
func EncodeCursor(kind, value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(kind + ":" + value))
}

// DecodeCursor reverses EncodeCursor. An empty cursor means "first page" and yields an empty value; anything that is
// not valid base64url, or was minted for another kind, is ErrBadCursor.
func DecodeCursor(kind, raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return "", ErrBadCursor
	}
	prefix := kind + ":"
	s := string(b)
	if !strings.HasPrefix(s, prefix) {
		return "", ErrBadCursor
	}
	return strings.TrimPrefix(s, prefix), nil
}

// DecodeOffsetCursor decodes an offset cursor (kind CursorKindOffset) into a non-negative offset.
func DecodeOffsetCursor(raw string) (int, error) {
	v, err := DecodeCursor(CursorKindOffset, raw)
	if err != nil {
		return 0, err
	}
	if v == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, ErrBadCursor
	}
	return n, nil
}

// Paginate returns one page of an ordered, fully loaded list together with the cursor of the next page ("" on the
// last page). The cursor is an offset, so the caller must hand in the list in a stable order.
func Paginate[T any](items []T, cursor string, limit int) (page []T, next string, err error) {
	off, err := DecodeOffsetCursor(cursor)
	if err != nil {
		return nil, "", err
	}
	if off > len(items) {
		off = len(items)
	}
	end := off + limit
	if end >= len(items) {
		return items[off:], "", nil
	}
	return items[off:end], EncodeCursor(CursorKindOffset, strconv.Itoa(end)), nil
}
