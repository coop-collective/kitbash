package httpapi

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRoutes(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/healthz", "", 200}, {"HEAD", "/healthz", "", 200},
		{"POST", "/healthz", "", 405}, {"GET", "/missing", "", 404},
		{"POST", "/echo", `{"message":"hello"}`, 200},
		{"POST", "/echo", `{"unknown":1}`, 400},
		{"POST", "/echo", `{"message":"hi"} {}`, 400},
		{"POST", "/echo", `{"message":"` + strings.Repeat("a", maxBody) + `"}`, 413},
	} {
		t.Run(tc.method+tc.path+tc.body[:min(30, len(tc.body))], func(t *testing.T) {
			w := httptest.NewRecorder()
			Handler().ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
			if w.Code != tc.status {
				t.Fatalf("status = %d; want %d; body %s", w.Code, tc.status, w.Body)
			}
			if tc.method == "HEAD" && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
			if tc.status == 200 && w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
		})
	}
}

func TestAddress(t *testing.T) {
	got, err := Address("", "")
	if err != nil || got != "127.0.0.1:8080" {
		t.Fatalf("default: %s %v", got, err)
	}
	for _, port := range []string{"0", "65536", "80abc", "-1", "+80", " 80", "1.5"} {
		if _, err = Address("", port); err == nil {
			t.Fatalf("accepted %q", port)
		}
	}
	if _, err = Address("bad-host", "80"); err == nil {
		t.Fatal("accepted invalid host")
	}
	if got, err = Address("::1", "80"); err != nil || got != "[::1]:80" {
		t.Fatal(got, err)
	}
}

func TestRealServerAndShutdown(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := Server(listener.Addr().String())
	t.Cleanup(func() { _ = srv.Close() })
	done := make(chan error, 1)
	go func() { done <- srv.Serve(listener) }()
	client := &http.Client{Timeout: time.Second}
	response, err := client.Get("http://" + listener.Addr().String() + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || string(body) != `{"ok":true}` {
		t.Fatalf("body: %s, %v", body, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = srv.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("server did not stop")
	}
}
