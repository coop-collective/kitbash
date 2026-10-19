package main

import (
	"context"
	"errors"
	"example.com/service/internal/httpapi"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		log.Fatal("invalid PORT")
	}
	scratch, err := httpapi.DefaultScratch()
	if err != nil {
		log.Fatal(err)
	}
	server := httpapi.Server("0.0.0.0:"+port, scratch)
	stopped := make(chan os.Signal, 1)
	drained := make(chan struct{})
	signal.Notify(stopped, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		defer close(drained)
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			_ = server.Close()
		}
	}()
	log.Printf("ready scratchMemoryBacked=%t", scratch.MemoryBacked)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-drained
}
