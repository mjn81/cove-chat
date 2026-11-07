package tests

import (
	"net"
	"sync"
	"sync/atomic"
	"testing"
)

// lossyProxy sits between a UDP client and the server and drops server-to-client datagrams chosen by drop. It lets
// tests exercise loss recovery without touching the real network.
type lossyProxy struct {
	front    *net.UDPConn
	back     *net.UDPConn
	mu       sync.Mutex
	client   *net.UDPAddr
	numDrops atomic.Int32
}

func newLossyProxy(t *testing.T, server string, drop func(size int) bool) *lossyProxy {
	t.Helper()
	front, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	saddr, _ := net.ResolveUDPAddr("udp", server)
	back, err := net.DialUDP("udp", nil, saddr)
	if err != nil {
		t.Fatal(err)
	}
	p := &lossyProxy{front: front, back: back}
	go func() { // client -> server
		buf := make([]byte, 2048)
		for {
			n, from, err := front.ReadFromUDP(buf)
			if err != nil {
				return
			}
			p.mu.Lock()
			p.client = from
			p.mu.Unlock()
			if _, err := back.Write(buf[:n]); err != nil {
				return
			}
		}
	}()
	go func() { // server -> client
		buf := make([]byte, 2048)
		for {
			n, err := back.Read(buf)
			if err != nil {
				return
			}
			if drop(n) {
				p.numDrops.Add(1)
				continue
			}
			p.mu.Lock()
			c := p.client
			p.mu.Unlock()
			if c != nil {
				_, _ = front.WriteToUDP(buf[:n], c)
			}
		}
	}()
	t.Cleanup(func() { front.Close(); back.Close() })
	return p
}

func (p *lossyProxy) addr() string { return p.front.LocalAddr().String() }
func (p *lossyProxy) dropped() int { return int(p.numDrops.Load()) }
