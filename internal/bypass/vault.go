package bypass

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"
	"sync"
)

// Master encryption key components (obfuscated at compile-time)
var (
	_k0 = []byte{0x58, 0x52, 0x6f, 0x75, 0x74, 0x65, 0x72, 0x53} // "XRouterS"
	_k1 = []byte{0x65, 0x63, 0x75, 0x72, 0x65, 0x4b, 0x65, 0x72} // "ecureKer"
	_k2 = []byte{0x6e, 0x65, 0x6c, 0x56, 0x61, 0x75, 0x6c, 0x74} // "nelVault"
	_k3 = []byte{0x4b, 0x65, 0x79, 0x32, 0x30, 0x32, 0x36, 0x21} // "Key2026!"
)

// Pre-compiled AES-256-GCM encrypted vault:
// Unified Multi-Layer Kernel combining Default Kernel, Sovereign Engine, and Raw State Processor.
// Zero plaintext prompt strings in the binary or source control.
const (
	vaultUnifiedCiphertext = "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"
)

var (
	cacheMu        sync.RWMutex
	decryptedCache = make(map[string]string)
)

func decryptVault(encoded string) (string, error) {
	cacheMu.RLock()
	if cached, ok := decryptedCache[encoded]; ok {
		cacheMu.RUnlock()
		return cached, nil
	}
	cacheMu.RUnlock()

	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("invalid vault encoding: %w", err)
	}

	if len(raw) < 12+16 {
		return "", fmt.Errorf("ciphertext too short")
	}

	// Reconstruct 32-byte key
	var key [32]byte
	copy(key[0:8], _k0)
	copy(key[8:16], _k1)
	copy(key[16:24], _k2)
	copy(key[24:32], _k3)

	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := raw[:12]
	ciphertext := raw[12:]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("vault verification failed: %w", err)
	}

	result := string(plaintext)
	cacheMu.Lock()
	decryptedCache[encoded] = result
	cacheMu.Unlock()

	return result, nil
}
