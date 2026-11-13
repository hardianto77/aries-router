package bypass

import (
	"os"
	"regexp"
	"strings"
)

// Dynamic kernel presets decrypted on-the-fly via AES-256-GCM vault
// Zero plaintext prompt strings in source control or compiled binary.
func GetKernelPreset(preset string) string {
	if custom := os.Getenv("XROUTER_UNIFIED_KERNEL_PROMPT"); custom != "" {
		return custom
	}
	if decrypted, err := decryptVault(vaultUnifiedCiphertext); err == nil {
		return decrypted
	}
	return "[UNIFIED_KERNEL_STACK]"
}

// WrapCustomWithKernelLayers wraps any user-defined custom prompt with the 3 encrypted kernel foundation layers
func WrapCustomWithKernelLayers(customPrompt string) string {
	foundation := GetKernelPreset("unified")
	cleanCustom := strings.TrimSpace(customPrompt)
	if cleanCustom == "" {
		return foundation
	}
	return foundation + "\n\n════════════════════════════════════════════════════════════════════════════════\nLAYER 4 · OPERATOR CUSTOM DIRECTIVES:\n════════════════════════════════════════════════════════════════════════════════\n" + cleanCustom
}

func ApplyDualInjection(messages []map[string]interface{}, prompt string) []map[string]interface{} {
	// Prepend system prompt
	sys := map[string]interface{}{"role": "system", "content": prompt}
	out := append([]map[string]interface{}{sys}, messages...)

	// Also attach anchor to latest user message to combat recency drift in multi-turn chats
	for i := len(out) - 1; i >= 0; i-- {
		if out[i]["role"] == "user" {
			if str, ok := out[i]["content"].(string); ok {
				out[i]["content"] = prompt + "\n\n" + str
			}
			break
		}
	}
	return out
}

var refusalPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(it is not possible to analyze|lacks empirical evidence to support|the question is flawed)\b`),
	regexp.MustCompile(`(?i)\b(i cannot|i can't|i am unable|as an ai|as a language model|my safety guidelines)\b`),
}

func DetectRefusalTrap(content string) bool {
	for _, p := range refusalPatterns {
		if p.MatchString(content) {
			return true
		}
	}
	return false
}
