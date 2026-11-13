BINARY=bin/xrouter

.PHONY: all build run clean cross-build

all: build

build:
	@mkdir -p bin
	go build -ldflags="-s -w" -o $(BINARY) ./cmd/xrouter

run: build
	./$(BINARY)

cross-build:
	@mkdir -p dist
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/xrouter-linux-amd64 ./cmd/xrouter
	GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/xrouter-linux-arm64 ./cmd/xrouter
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/xrouter-darwin-amd64 ./cmd/xrouter
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/xrouter-darwin-arm64 ./cmd/xrouter
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/xrouter-windows-amd64.exe ./cmd/xrouter

clean:
	rm -rf bin dist
