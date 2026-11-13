package httpx

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// DoH endpoints (Cloudflare & Google) addressed by IP literal to bypass local DNS
var dohEndpoints = []string{
	"https://1.1.1.1/dns-query",
	"https://8.8.8.8/resolve",
}

var dohClient = &http.Client{Timeout: 5 * time.Second}

type dohResponse struct {
	Status int `json:"Status"`
	Answer []struct {
		Type int    `json:"Type"`
		Data string `json:"data"`
	} `json:"Answer"`
}

type v6CacheEntry struct {
	ips []string
	exp time.Time
}

var (
	v6CacheMu sync.Mutex
	v6Cache   = map[string]v6CacheEntry{}
)

func OpencodeHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	return host == "opencode.ai" || strings.HasSuffix(host, ".opencode.ai")
}

// ResolveOpencodeIPv6 returns cached-or-fresh AAAA records for *.opencode.ai via DoH
func ResolveOpencodeIPv6(ctx context.Context, host string) []string {
	v6CacheMu.Lock()
	if e, ok := v6Cache[host]; ok && time.Now().Before(e.exp) {
		ips := e.ips
		v6CacheMu.Unlock()
		return ips
	}
	v6CacheMu.Unlock()

	for _, endpoint := range dohEndpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?name="+host+"&type=AAAA", nil)
		if err != nil {
			continue
		}
		req.Header.Set("accept", "application/dns-json")
		resp, err := dohClient.Do(req)
		if err != nil {
			continue
		}
		var decoded dohResponse
		func() {
			defer resp.Body.Close()
			_ = json.NewDecoder(resp.Body).Decode(&decoded)
		}()
		if decoded.Status != 0 {
			continue
		}
		var ips []string
		for _, a := range decoded.Answer {
			if a.Type != 28 {
				continue
			}
			if ip := net.ParseIP(a.Data); ip != nil {
				ips = append(ips, a.Data)
			}
		}
		if len(ips) > 0 {
			v6CacheMu.Lock()
			v6Cache[host] = v6CacheEntry{ips: ips, exp: time.Now().Add(4 * time.Minute)}
			v6CacheMu.Unlock()
			return ips
		}
	}
	return nil
}

// DialIPv6First wraps base so *.opencode.ai dials its real IPv6 first and
// only falls back to the system path when IPv6 is unreachable.
func DialIPv6First(base *net.Dialer, enabled bool) func(ctx context.Context, network, address string) (net.Conn, error) {
	if !enabled {
		return base.DialContext
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return base.DialContext(ctx, network, address)
		}
		if net.ParseIP(host) != nil || !OpencodeHost(host) {
			return base.DialContext(ctx, network, address)
		}
		lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		ips := ResolveOpencodeIPv6(lookupCtx, host)
		cancel()
		for _, ip := range ips {
			dialCtx, stop := context.WithTimeout(ctx, base.Timeout)
			conn, err := base.DialContext(dialCtx, "tcp6", net.JoinHostPort(ip, port))
			stop()
			if err == nil {
				return conn, nil
			}
		}
		return base.DialContext(ctx, network, address)
	}
}

// DirectTransport returns an http.Transport clone routing *.opencode.ai over IPv6 first
func DirectTransport(timeout time.Duration, ipv6First bool) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = DialIPv6First(&net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
	}, ipv6First)
	transport.Proxy = nil
	return transport
}
