package api

// CaptchaChallengeResponse is the body of GET /api/captcha/challenge, in the ALTCHA v1 challenge format.
type CaptchaChallengeResponse struct {
	Algorithm string `json:"algorithm" example:"SHA-256"`
	// Challenge is hex(SHA-256(salt + n)) for a secret number n the client has to find.
	Challenge string `json:"challenge" example:"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"`
	// MaxNumber is the upper bound of the search range [0, maxnumber].
	MaxNumber int `json:"maxnumber" example:"100000"`
	// Salt is random and carries the expiry as ?expires=<unix>.
	Salt string `json:"salt" example:"3f9a1c2b4d5e6f708192a3b4?expires=1893456000"`
	// Signature is hex(HMAC-SHA256(server key, challenge)); the server checks it when the solution comes back.
	Signature string `json:"signature" example:"c0ffee..."`
}
