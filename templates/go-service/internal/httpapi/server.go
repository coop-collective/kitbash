package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"
)

const maxBody = 4096

// Address validates values without reading shared process state.
func Address(host, port string) (string, error) {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "8080"
	}
	if net.ParseIP(host) == nil {
		return "", errors.New("HOST must be an IP address")
	}
	for _, c := range port {
		if c < '0' || c > '9' {
			return "", errors.New("PORT must be an integer from 1 to 65535")
		}
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", errors.New("PORT must be an integer from 1 to 65535")
	}
	return net.JoinHostPort(host, port), nil
}

func Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodHead {
			_, _ = io.WriteString(w, `{"ok":true}`)
		}
	})
	// A bounded JSON route demonstrates strict input handling without a framework.
	mux.HandleFunc("POST /echo", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		defer r.Body.Close()
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var payload struct {
			Message string `json:"message"`
		}
		if err := decoder.Decode(&payload); err != nil {
			decodeError(w, err)
			return
		}
		var trailing any
		if err := decoder.Decode(&trailing); err != io.EOF {
			if err == nil {
				err = errors.New("extra JSON value")
			}
			decodeError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(payload)
	})
	return mux
}

func decodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, "invalid JSON", http.StatusBadRequest)
}

func Server(address string) *http.Server {
	return &http.Server{
		Addr: address, Handler: Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
}
