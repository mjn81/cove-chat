package tests

import (
	"reflect"
	"strings"
	"testing"

	"cove/backend/internal/api"
	"cove/backend/internal/config"
)

// The typed PATCH /api/admin/config body must stay in step with the config schema: every editable setting has a
// pointer field of the matching kind, and nothing extra is exposed.
func TestConfigChangesDTO_MatchesSchema(t *testing.T) {
	typ := reflect.TypeOf(api.ConfigChanges{})
	fields := map[string]reflect.Type{}
	for i := 0; i < typ.NumField(); i++ {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		fields[name] = typ.Field(i).Type
	}
	want := map[string]reflect.Kind{"bool": reflect.Bool, "int": reflect.Int, "string": reflect.String, "enum": reflect.String, "list": reflect.Slice}
	for _, s := range config.Schema() {
		ft, ok := fields[s.Key]
		if !ok {
			t.Errorf("setting %s has no field in api.ConfigChanges", s.Key)
			continue
		}
		if ft.Kind() != reflect.Pointer || ft.Elem().Kind() != want[s.Type] {
			t.Errorf("setting %s (%s): field type %v, want *%v", s.Key, s.Type, ft, want[s.Type])
		}
		delete(fields, s.Key)
	}
	for extra := range fields {
		t.Errorf("api.ConfigChanges exposes %s, which is not an editable setting", extra)
	}
}

func TestConfigChanges_MapOnlyHoldsSetFields(t *testing.T) {
	mode, port, dev := "closed", 8080, true
	got := api.ConfigChanges{RegistrationMode: &mode, ServerHTTPPort: &port, ServerDev: &dev}.Map()
	want := map[string]any{"registration.mode": "closed", "server.http_port": float64(8080), "server.dev": true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Map() = %v, want %v", got, want)
	}
}
