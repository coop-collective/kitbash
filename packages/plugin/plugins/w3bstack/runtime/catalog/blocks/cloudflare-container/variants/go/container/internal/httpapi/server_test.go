package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHashAndBoundsCleanUp(t *testing.T) {
	root := t.TempDir()
	handler := Handler(Scratch{Path: root})
	for _, size := range []int{5, int(MaxBytes), int(MaxBytes) + 1} {
		body := bytes.Repeat([]byte{'x'}, size)
		if size == 5 {
			body = []byte("hello")
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "/hash", bytes.NewReader(body)))
		if size > int(MaxBytes) {
			if response.Code != 413 {
				t.Fatalf("oversize = %d", response.Code)
			}
		} else {
			if response.Code != 200 {
				t.Fatalf("valid = %d", response.Code)
			}
			var result struct {
				Bytes  int
				Sha256 string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Bytes != size {
				t.Fatal(result)
			}
			if size == 5 && result.Sha256 != "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" {
				t.Fatal(result)
			}
		}
		files, err := os.ReadDir(root)
		if err != nil || len(files) != 0 {
			t.Fatalf("leaked files: %v %v", files, err)
		}
	}
}

func TestScratchAndRoutes(t *testing.T) {
	root := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if _, err := ScratchRoot([]string{link}); err == nil {
		t.Fatal("accepted symlink")
	}
	scratch, err := ScratchRoot([]string{root})
	if err != nil {
		t.Fatal(err)
	}
	handler := Handler(scratch)
	for _, url := range []string{"/hash?port=22", "/admin"} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest("POST", url, strings.NewReader("x")))
		if r.Code != 404 {
			t.Fatal(r.Code)
		}
	}
}

func TestTwoInFlightRequestsBoundConcurrency(t *testing.T) {
	root := t.TempDir()
	handler := Handler(Scratch{Path: root})
	readers := []*io.PipeReader{}
	writers := []*io.PipeWriter{}
	done := make(chan struct{}, 2)
	entered := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		r, w := io.Pipe()
		readers = append(readers, r)
		writers = append(writers, w)
		go func() {
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/hash", &signalReader{r, entered, false}))
			done <- struct{}{}
		}()
	}
	<-entered
	<-entered
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("POST", "/hash", strings.NewReader("x")))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatal(response.Code)
	}
	for _, w := range writers {
		_ = w.Close()
	}
	<-done
	<-done
	for _, r := range readers {
		_ = r.Close()
	}
	files, _ := os.ReadDir(root)
	if len(files) != 0 {
		t.Fatal("scratch leaked")
	}
}

type signalReader struct {
	reader  io.Reader
	entered chan struct{}
	sent    bool
}

func (r *signalReader) Read(b []byte) (int, error) {
	if !r.sent {
		r.sent = true
		r.entered <- struct{}{}
	}
	return r.reader.Read(b)
}
