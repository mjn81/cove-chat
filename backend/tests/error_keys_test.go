package tests

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// keyedHandlers are the user-facing handler files whose error messages are i18n keys the clients translate.
var keyedHandlers = []string{"channels.go", "files.go", "users.go", "relationships.go", "messages.go"}

var (
	// the message argument of writeError / writeInternal / decodeJSON*, when it is a string literal or a Sprintf format
	literalMsg = regexp.MustCompile(`(?:writeError\(w, [^,]+, |writeInternal\(w, [^\n]*?, err, |decodeJSON(?:Limit)?\(w, r, &\w+, (?:1<<\d+, )?)(?:fmt\.Sprintf\()?"([^"]*)"`)
	keyShape   = regexp.MustCompile(`^(apiErrors|auth\.errors|admin\.errors)\.[a-z_]+(: .*)?$`)
	usedAPIKey = regexp.MustCompile(`"apiErrors\.([a-z_]+)`)
)

func TestHandlerErrorMessagesAreI18nKeys(t *testing.T) {
	for _, name := range keyedHandlers {
		src, err := os.ReadFile(filepath.Join("..", "internal", "api", name))
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range literalMsg.FindAllStringSubmatch(string(src), -1) {
			if !keyShape.MatchString(m[1]) {
				t.Errorf("%s: error message %q is a literal; use an apiErrors.* key", name, m[1])
			}
		}
	}
}

func TestAPIErrorKeysExistInEveryLocale(t *testing.T) {
	used := map[string]bool{}
	for _, name := range keyedHandlers {
		src, _ := os.ReadFile(filepath.Join("..", "internal", "api", name))
		for _, m := range usedAPIKey.FindAllStringSubmatch(string(src), -1) {
			used[m[1]] = true
		}
	}
	if len(used) == 0 {
		t.Fatal("no apiErrors keys found in the handlers")
	}
	for _, lang := range []string{"en", "fa", "ar"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "client-web", "src", "i18n", "locales", lang+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			APIErrors map[string]string `json:"apiErrors"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		for key := range used {
			if strings.TrimSpace(doc.APIErrors[key]) == "" {
				t.Errorf("%s.json is missing apiErrors.%s", lang, key)
			}
		}
	}
}
