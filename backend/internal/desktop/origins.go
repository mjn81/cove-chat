// Package desktop holds facts about the Wails desktop shell that the server has to agree with.
package desktop

// Origins are the page origins the desktop app sends with its requests and WebSocket handshakes. They are
// fixed by Wails 2.x, which serves the bundled web client from a per-OS address: Windows uses
// http://wails.localhost (https on newer WebView2 setups), macOS and Linux use wails://wails. The server must
// accept all of them, or the app fails to connect on the OS whose origin is missing.
//
// Allowing them is safe: the desktop authenticates with a Bearer token, never an ambient cookie, and a hostile
// web page cannot claim one of these origins.
var Origins = []string{
	"http://wails.localhost",
	"https://wails.localhost",
	"wails://wails",
}
