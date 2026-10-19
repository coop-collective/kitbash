package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"example.com/service/internal/httpapi"
)

func run() error {
	address, err := httpapi.Address(os.Getenv("HOST"), os.Getenv("PORT"))
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	server := httpapi.Server(address)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	slog.Info("listening", "address", listener.Addr().String())
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	deadline, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if err = server.Shutdown(deadline); err != nil {
		_ = server.Close()
		return err
	}
	err = <-result
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	if err := run(); err != nil {
		slog.Error("service stopped", "error", err)
		os.Exit(1)
	}
}
