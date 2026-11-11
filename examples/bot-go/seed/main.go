// Command seed prepares a LOCAL Cove server for trying bots: a public sample bot with slash commands, two channels
// (bot-lab and bot-lab-2) with the bot installed, and a welcome message with buttons (plus the action menu in
// bot-lab). Run it with `make dev-seed-bots` while `make dev-back` is running.
//
// It is idempotent: a second run finds what exists and changes nothing. Secrets never go to git:
//
//   - the bot token is written to .env.local (read by the example bot, `make dev-bot`),
//   - a generated dev account password is written to .dev-seed.local.
//
// Which account creates the bot:
//
//  1. COVE_SEED_USER and COVE_SEED_PASSWORD, if set (use an admin or the owner of your local server);
//  2. else the account saved in .dev-seed.local;
//  3. else a new account "botdev" with a random password, registered now, printed once and saved there. On a fresh
//     database it becomes the server owner; on an existing one it is a normal user and the server must allow it to
//     create bots (admin panel > Bots > "Who can create bots", or bots.creation = "users" in backend/config.toml).
package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"example.com/cove-bot/internal/botspec"
)

const (
	envFile  = ".env.local"
	seedFile = ".dev-seed.local"
)

var channelNames = []string{"bot-lab", "bot-lab-2"}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "seed: "+format+"\n", args...)
	os.Exit(1)
}

type api struct {
	base  *url.URL
	auth  string // full Authorization header value
	httpc *http.Client
}

func (a *api) do(method, path string, in, out any) (int, error) {
	var body io.Reader
	if in != nil {
		raw, _ := json.Marshal(in)
		body = bytes.NewReader(raw)
	}
	// JoinPath would escape a "?", so the query is split off first.
	p, q, _ := strings.Cut(path, "?")
	u := a.base.JoinPath(p)
	u.RawQuery = q
	req, err := http.NewRequest(method, u.String(), body)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Cove-Client", "devseed/0.1 (api 2)")
	if a.auth != "" {
		req.Header.Set("Authorization", a.auth)
	}
	resp, err := a.httpc.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("%s %s: %s: %s", method, path, resp.Status, strings.TrimSpace(string(data)))
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

func readKV(path string) map[string]string {
	out := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "="); ok && !strings.HasPrefix(k, "#") {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

func writeKV(path string, kv map[string]string, order []string) {
	var b strings.Builder
	for _, k := range order {
		fmt.Fprintf(&b, "%s=%s\n", k, kv[k])
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		fail("writing %s: %v", path, err)
	}
}

func randomPassword() string {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		fail("random: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// signIn returns an authenticated client for the seed account (see the package comment for how it is chosen).
func signIn(base *url.URL) *api {
	a := &api{base: base, httpc: &http.Client{Timeout: 20 * time.Second}}
	user, pass := os.Getenv("COVE_SEED_USER"), os.Getenv("COVE_SEED_PASSWORD")
	generated := false
	if user == "" {
		saved := readKV(seedFile)
		user, pass = saved["username"], saved["password"]
	}
	if user == "" {
		user, pass, generated = "botdev", randomPassword(), true
	}
	login := func() (string, error) {
		var out struct {
			Token string `json:"token"`
		}
		_, err := a.do(http.MethodPost, "/api/login", map[string]string{"username": user, "password": pass}, &out)
		return out.Token, err
	}
	if generated {
		if _, err := a.do(http.MethodPost, "/api/register", map[string]string{"username": user, "password": pass}, nil); err != nil {
			fail("could not register the dev account %q (%v).\nIf it already exists, put its credentials in %s as username=... and password=..., or set COVE_SEED_USER / COVE_SEED_PASSWORD.", user, err, seedFile)
		}
		writeKV(seedFile, map[string]string{"username": user, "password": pass}, []string{"username", "password"})
		fmt.Printf("Created the dev account %q with password %s\n(shown once; also saved to %s, which is git-ignored)\n", user, pass, seedFile)
	}
	token, err := login()
	if err != nil {
		fail("signing in as %q failed: %v", user, err)
	}
	a.auth = "Bearer " + token
	return a
}

type botDTO struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

func main() {
	rawURL := os.Getenv("COVE_URL")
	if rawURL == "" {
		rawURL = "http://localhost:4000"
	}
	base, err := url.Parse(rawURL)
	if err != nil || base.Host == "" {
		fail("COVE_URL %q is not a URL", rawURL)
	}
	if _, err := (&api{base: base, httpc: &http.Client{Timeout: 5 * time.Second}}).do(http.MethodGet, "/api/version", nil, nil); err != nil {
		fail("no Cove server answers at %s (start it with `make dev-back`): %v", base, err)
	}

	user := signIn(base)

	// 1. The bot.
	var mine struct {
		Items []botDTO `json:"items"`
	}
	if _, err := user.do(http.MethodGet, "/api/bots?limit=100", nil, &mine); err != nil {
		fail("%v", err)
	}
	var bot *botDTO
	for i := range mine.Items {
		if mine.Items[i].Username == botspec.Name {
			bot = &mine.Items[i]
		}
	}
	env := readKV(envFile)
	token := env["COVE_BOT_TOKEN"]
	if bot == nil {
		var created struct {
			Bot   botDTO `json:"bot"`
			Token string `json:"token"`
		}
		status, err := user.do(http.MethodPost, "/api/bots", map[string]any{"username": botspec.Name, "description": botspec.Description, "public": true}, &created)
		if err != nil {
			if status == http.StatusForbidden {
				fail("this account may not create bots: %v\nLet it (admin panel > Bots > \"Who can create bots\", or bots.creation = \"users\" in backend/config.toml) or use an admin account via COVE_SEED_USER / COVE_SEED_PASSWORD.", err)
			}
			fail("%v", err)
		}
		bot, token = &created.Bot, created.Token
		fmt.Printf("Created the bot %q (public).\n", botspec.Name)
	} else if token == "" {
		// The bot exists but this machine has no token (shown only once): issue a new one.
		var rotated struct {
			Token string `json:"token"`
		}
		if _, err := user.do(http.MethodPost, "/api/bots/"+bot.ID+"/token", nil, &rotated); err != nil {
			fail("%v", err)
		}
		token = rotated.Token
		fmt.Printf("The bot %q exists but %s had no token: issued a new one.\n", botspec.Name, envFile)
	} else {
		fmt.Printf("The bot %q already exists.\n", botspec.Name)
	}
	writeKV(envFile, map[string]string{"COVE_URL": base.String(), "COVE_BOT_TOKEN": token}, []string{"COVE_URL", "COVE_BOT_TOKEN"})
	botAPI := &api{base: base, auth: "Bot " + token, httpc: user.httpc}
	if _, err := botAPI.do(http.MethodPut, "/api/bots/me/commands", botspec.Commands, nil); err != nil {
		fail("registering commands (is the token in %s still valid?): %v", envFile, err)
	}

	// 2. The channels, with the bot installed.
	var chans struct {
		Items []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"items"`
	}
	if _, err := user.do(http.MethodGet, "/api/channels?limit=100", nil, &chans); err != nil {
		fail("%v", err)
	}
	ids := map[string]string{}
	for _, c := range chans.Items {
		ids[c.Name] = c.ID
	}
	for _, name := range channelNames {
		if ids[name] == "" {
			var ch struct {
				ID string `json:"id"`
			}
			if _, err := user.do(http.MethodPost, "/api/channels", map[string]any{"name": name, "description": "Try the sample bot here", "members": []string{}, "is_private": false}, &ch); err != nil {
				fail("%v", err)
			}
			ids[name] = ch.ID
			fmt.Printf("Created the channel #%s.\n", name)
		}
		scopes := []string{"messages.send", "messages.read", "members.read"}
		if _, err := user.do(http.MethodPut, "/api/channels/"+ids[name]+"/bots/"+bot.ID, map[string]any{"scopes": scopes}, nil); err != nil {
			fail("installing the bot in #%s: %v", name, err)
		}

		// 3. A welcome message, once (the bot reads the channel to see whether it already posted one).
		var hist struct {
			Items []struct {
				Content string `json:"content"`
			} `json:"items"`
		}
		if _, err := botAPI.do(http.MethodGet, "/api/bots/me/channels/"+ids[name]+"/messages?limit=50", nil, &hist); err != nil {
			fail("reading #%s as the bot: %v", name, err)
		}
		welcomed := false
		for _, m := range hist.Items {
			welcomed = welcomed || strings.HasPrefix(m.Content, botspec.WelcomeMarker)
		}
		if welcomed {
			continue
		}
		if _, err := botAPI.do(http.MethodPost, "/api/bots/me/channels/"+ids[name]+"/messages", botspec.Welcome("#"+name), nil); err != nil {
			fail("welcome message in #%s: %v", name, err)
		}
		if name == channelNames[0] {
			if _, err := botAPI.do(http.MethodPut, "/api/bots/me/channels/"+ids[name]+"/keyboard", botspec.Menu, nil); err != nil {
				fail("action menu in #%s: %v", name, err)
			}
		}
		fmt.Printf("Posted the welcome message in #%s.\n", name)
	}

	fmt.Printf("\nDone. Token saved to examples/bot-go/%s (git-ignored).\nNow run `make dev-bot` to bring %s online, open #%s, and try /ping, /roll 20, /poll \"Lunch?\", /counter and /menu.\nYou can also find it under Explore > Bots and press Message.\n", envFile, botspec.Name, channelNames[0])
}
