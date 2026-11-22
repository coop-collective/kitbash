package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const MaxBytes int64 = 1_048_576

type Scratch struct {
	Path         string
	MemoryBacked bool
}

// A writable directory is not necessarily RAM-backed; inspect the filesystem on Linux.
func ScratchRoot(candidates []string) (Scratch, error) {
	for _, root := range candidates {
		if root == "" {
			continue
		}
		info, err := os.Lstat(root)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		probe, err := os.MkdirTemp(root, "probe-")
		if err != nil {
			continue
		}
		if err := os.Remove(probe); err != nil {
			return Scratch{}, err
		}
		return Scratch{root, memoryBacked(root)}, nil
	}
	return Scratch{}, errors.New("no writable scratch directory")
}

func DefaultScratch() (Scratch, error) {
	return ScratchRoot([]string{os.Getenv("TMPDIR"), "/dev/shm", "/app-tmp", "/tmp"})
}

func Handler(scratch Scratch) http.Handler {
	slots := make(chan struct{}, 2)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" && r.URL.RawQuery == "" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "scratchMemoryBacked": scratch.MemoryBacked})
			return
		}
		if r.URL.Path != "/hash" || r.URL.RawQuery != "" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "Busy", 503)
			return
		}
		directory, err := os.MkdirTemp(scratch.Path, "job-")
		if err != nil {
			http.Error(w, "Scratch unavailable", 500)
			return
		}
		defer os.RemoveAll(directory)
		file, err := os.OpenFile(filepath.Join(directory, "input"), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			http.Error(w, "Scratch unavailable", 500)
			return
		}
		defer file.Close()
		limited := http.MaxBytesReader(w, r.Body, MaxBytes)
		defer limited.Close()
		bytes, err := io.Copy(file, limited)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				http.Error(w, "Payload too large", 413)
			} else {
				http.Error(w, "Invalid body", 400)
			}
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			http.Error(w, "Scratch unavailable", 500)
			return
		}
		hash := sha256.New()
		if _, err := io.Copy(hash, file); err != nil {
			http.Error(w, "Scratch unavailable", 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{"bytes": bytes, "sha256": hex.EncodeToString(hash.Sum(nil))})
	})
}

func Server(address string, scratch Scratch) *http.Server {
	return &http.Server{Addr: address, Handler: Handler(scratch), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
}
