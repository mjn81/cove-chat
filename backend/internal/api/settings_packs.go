package api

import (
	"slices"

	"cove/backend/internal/config"
)

// defaultEmoji and defaultPacks are what a Handler built without live settings (older tests, tools) uses.
func defaultEmoji() config.EmojiConfig {
	return config.EmojiConfig{EnabledStyles: slices.Clone(config.EmojiStyleIDs), DefaultStyle: config.DefaultEmojiStyle}
}

func defaultPacks() config.PacksConfig {
	return config.PacksConfig{UserUploadsEnabled: true, MaxPacksPerUser: 10, MaxStickersPerPack: 60, MaxUserStorageMB: 20}
}

// Emoji returns the emoji styles users may pick and the default one. A zero value falls back to the config defaults.
func (s *Settings) Emoji() config.EmojiConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	e := s.init.Emoji
	if len(e.EnabledStyles) == 0 {
		return defaultEmoji()
	}
	e.EnabledStyles = slices.Clone(e.EnabledStyles)
	return e
}

// SetEmoji replaces the emoji style settings; an invalid combination is ignored (the config loader and the admin
// panel already refuse one, this only protects the running server).
func (s *Settings) SetEmoji(e config.EmojiConfig) {
	if config.ValidateEmojiStyles(e.EnabledStyles, e.DefaultStyle) != nil {
		return
	}
	s.mu.Lock()
	s.init.Emoji = config.EmojiConfig{EnabledStyles: slices.Clone(e.EnabledStyles), DefaultStyle: e.DefaultStyle}
	s.mu.Unlock()
}

// Packs returns the user sticker pack switch and quotas.
func (s *Settings) Packs() config.PacksConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p := s.init.Packs
	if p.MaxPacksPerUser == 0 && p.MaxStickersPerPack == 0 && p.MaxUserStorageMB == 0 && !p.UserUploadsEnabled {
		// A Settings built without pack values (all zero) means "defaults", not "everything off".
		return defaultPacks()
	}
	return p
}

// SetPacks replaces the sticker pack switch and quotas; non-positive limits are ignored.
func (s *Settings) SetPacks(p config.PacksConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.init.Packs
	if cur.MaxPacksPerUser == 0 && cur.MaxStickersPerPack == 0 && cur.MaxUserStorageMB == 0 {
		cur = defaultPacks()
	}
	cur.UserUploadsEnabled = p.UserUploadsEnabled
	if p.MaxPacksPerUser > 0 {
		cur.MaxPacksPerUser = p.MaxPacksPerUser
	}
	if p.MaxStickersPerPack > 0 {
		cur.MaxStickersPerPack = p.MaxStickersPerPack
	}
	if p.MaxUserStorageMB > 0 {
		cur.MaxUserStorageMB = p.MaxUserStorageMB
	}
	s.init.Packs = cur
}

// emojiSettings and packSettings are what handlers use; a Handler without live Settings behaves with defaults.
func (h *Handler) emojiSettings() config.EmojiConfig {
	if h.Settings == nil {
		return defaultEmoji()
	}
	return h.Settings.Emoji()
}

func (h *Handler) packSettings() config.PacksConfig {
	if h.Settings == nil {
		return defaultPacks()
	}
	return h.Settings.Packs()
}
