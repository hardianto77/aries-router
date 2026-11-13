package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/johsua092-ui/xrouter/internal/config"
	"github.com/johsua092-ui/xrouter/internal/database"
	"github.com/johsua092-ui/xrouter/internal/gateway"
)

const banner = `
  ██╗  ██╗██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗ 
  ╚██╗██╔╝██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
   ╚███╔╝ ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
   ██╔██╗ ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
  ██╔╝ ██╗██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
  HIGH-PERFORMANCE GOLANG AI GATEWAY · PURE GO (ZERO-CGO)
`

func main() {
	// Optimize runtime memory scavenger: reclaim heap aggressively back to the OS
	debug.SetGCPercent(50)
	if os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(64 * 1024 * 1024) // 64MiB soft limit
	}

	fmt.Print(banner)
	cfg := config.Load()

	log.Printf("[XRouter] Initializing X Router (Go Core v%s)...", cfg.Version)
	log.Printf("[XRouter] Data Directory: %s", cfg.DataDir)
	log.Printf("[XRouter] Port: %s", cfg.Port)

	db, err := database.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("[XRouter FATAL] Database failed to open: %v", err)
	}
	defer db.Close()

	gw := gateway.New(cfg, db)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      gw,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // 0 for streaming SSE
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("[XRouter] Server listening on http://0.0.0.0:%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[XRouter FATAL] ListenAndServe failed: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[XRouter] Shutting down server gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("[XRouter ERROR] Server forced to shutdown: %v", err)
	}

	log.Println("[XRouter] Server exited cleanly.")
}
