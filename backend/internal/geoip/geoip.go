// Package geoip resolves a client IP to a coarse location for the active-devices list and login notices.
//
// Lookups are strictly offline: an operator-supplied MaxMind GeoLite2 City database is read from disk, so user IPs
// never leave the server. Without a database the resolver returns an empty Location and callers show the IP only.
package geoip

import (
	"fmt"
	"net"

	"github.com/oschwald/geoip2-golang"
)

// Location is a coarse, human-readable place. Fields are empty when unknown.
type Location struct {
	City    string
	Country string
}

// Resolver maps an IP address to a Location.
type Resolver interface {
	Lookup(ip string) Location
}

// Noop is the resolver used when no database is configured.
type Noop struct{}

// Lookup always returns an empty Location.
func (Noop) Lookup(string) Location { return Location{} }

// MaxMind resolves addresses from a GeoLite2/GeoIP2 City database file.
type MaxMind struct {
	db *geoip2.Reader
}

// Open loads the database at path. The caller owns the returned resolver and should Close it on shutdown.
func Open(path string) (*MaxMind, error) {
	db, err := geoip2.Open(path)
	if err != nil {
		return nil, fmt.Errorf("geoip: open %s: %w", path, err)
	}
	return &MaxMind{db: db}, nil
}

// Close releases the database file.
func (m *MaxMind) Close() error { return m.db.Close() }

// Lookup returns the English city and country names for ip. Loopback, private and unparsable addresses have no
// public location and yield an empty result.
func (m *MaxMind) Lookup(ip string) Location {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsUnspecified() || parsed.IsLinkLocalUnicast() {
		return Location{}
	}
	rec, err := m.db.City(parsed)
	if err != nil {
		return Location{}
	}
	return Location{City: rec.City.Names["en"], Country: rec.Country.Names["en"]}
}
