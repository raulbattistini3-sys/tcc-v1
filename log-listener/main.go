// log-listener receives telemetry from the TCC extension's remote upload and
// appends every accepted request as one JSON line to <out>/log-<timestamp>.log,
// starting a new file each minute (UTC, e.g. log-2026-11-07T10-32Z.log).
// Same protocol as tools/collector.mjs, standard library only.
//
//	go run .                                   listen on 0.0.0.0:8787, random token
//	go run . -port 9000 -token s3cret -out ../results/live
//	TCC_TOKEN=s3cret go run .
//
// Plain HTTP: use it on a LAN or behind a TLS tunnel (Tailscale, cloudflared),
// not a raw port-forward, or the token travels in clear text.
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"time"
)

const (
	maxBody    = 2 << 20 // 2 MiB
	ratePerMin = 240
)

// envelope holds the fields the listener checks; the rest of the body is kept verbatim.
type envelope struct {
	V         int    `json:"v"`
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	InstallID string `json:"installId"`
	Batches   []struct {
		Events []json.RawMessage `json:"events"`
	} `json:"batches"`
	Events []json.RawMessage `json:"events"`
}

type limiter struct {
	mu   sync.Mutex
	byIP map[string]*window
}

type window struct {
	n     int
	reset time.Time
}

func (l *limiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	w := l.byIP[ip]
	if w == nil || now.After(w.reset) {
		l.byIP[ip] = &window{n: 1, reset: now.Add(time.Minute)}
		return true
	}
	w.n++
	return w.n <= ratePerMin
}

// minuteLayout names one file per UTC minute. No colons: Windows forbids them
// in file names. Lexical order of the names is chronological order.
const minuteLayout = "2006-01-02T15-04Z"

// sink appends lines to one file per UTC minute, created on the first request
// of that minute, so idle minutes leave no empty files. A mutex serialises writers so
// concurrent requests never interleave half-lines.
type sink struct {
	mu    sync.Mutex
	dir   string
	slot  string
	file  *os.File
	total int
}

func (s *sink) write(line []byte, events int) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	slot := time.Now().UTC().Format(minuteLayout)
	if s.file == nil || slot != s.slot {
		if s.file != nil {
			s.file.Close()
		}
		f, err := os.OpenFile(filepath.Join(s.dir, "log-"+slot+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return s.total, err
		}
		s.file, s.slot = f, slot
	}
	if _, err := s.file.Write(append(line, '\n')); err != nil {
		return s.total, err
	}
	s.total += events
	return s.total, nil
}

func (s *sink) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file != nil {
		s.file.Close()
	}
}

func main() {
	port := flag.Int("port", 8787, "TCP port")
	host := flag.String("host", "0.0.0.0", "interface to bind (0.0.0.0 = all)")
	token := flag.String("token", os.Getenv("TCC_TOKEN"), "bearer token (default: $TCC_TOKEN or random)")
	out := flag.String("out", "out", "directory for the log-<timestamp>.log files")
	flag.Parse()

	if *token == "" {
		b := make([]byte, 12)
		rand.Read(b)
		*token = hex.EncodeToString(b)
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		log.Fatal(err)
	}
	expected := []byte("Bearer " + *token)
	lim := &limiter{byIP: map[string]*window{}}
	sk := &sink{dir: *out}
	defer sk.close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("POST /ingest", func(w http.ResponseWriter, r *http.Request) {
		ip, _, _ := net.SplitHostPort(r.RemoteAddr)
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), expected) != 1 {
			http.Error(w, "bad token", http.StatusUnauthorized)
			return
		}
		if !lim.allow(ip) {
			http.Error(w, "slow down", http.StatusTooManyRequests)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			if _, tooBig := errors.AsType[*http.MaxBytesError](err); tooBig {
				http.Error(w, "too large", http.StatusRequestEntityTooLarge)
			} else {
				http.Error(w, "read error", http.StatusBadRequest)
			}
			return
		}
		var env envelope
		if json.Unmarshal(body, &env) != nil || env.V != 1 || env.Kind == "" {
			http.Error(w, "bad schema", http.StatusBadRequest)
			return
		}
		n := len(env.Events)
		for _, b := range env.Batches {
			n += len(b.Events)
		}

		// Wrap rather than re-encode: the original body is stored byte for byte.
		line, _ := json.Marshal(struct {
			ReceivedAt int64           `json:"receivedAt"`
			IP         string          `json:"ip"`
			Body       json.RawMessage `json:"body"`
		}{time.Now().UnixMilli(), ip, body})
		total, err := sk.write(line, n)
		if err != nil {
			log.Printf("write: %v", err)
			http.Error(w, "storage error", http.StatusInternalServerError)
			return
		}
		who := env.Label
		if who == "" && len(env.InstallID) >= 8 {
			who = env.InstallID[:8]
		}
		log.Printf("%s %s %s %d events (total %d)", ip, who, env.Kind, n, total)
		w.WriteHeader(http.StatusNoContent)
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", *host, *port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		log.Fatalf("listen %s: %v", srv.Addr, err)
	}
	abs, _ := filepath.Abs(*out)
	log.Printf("listening on %s, writing to %s", srv.Addr, abs)
	log.Printf("token: %s", *token)
	log.Print("paste one of these into the extension's Settings → Collector URL:")
	for _, a := range lanAddrs() {
		log.Printf("  http://%s:%d/ingest", a, *port)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx) // lets in-flight writes finish
	}()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	log.Print("stopped")
}

func lanAddrs() []string {
	var out []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}
