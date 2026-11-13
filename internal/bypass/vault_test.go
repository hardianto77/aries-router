package bypass

import (
	"strings"
	"testing"
)

func TestGetKernelPreset(t *testing.T) {
	def := GetKernelPreset("default")
	if !strings.Contains(def, "UNIFIED MULTI-LAYER EXECUTION KERNEL") {
		t.Fatalf("expected unified kernel to decrypt properly, got: %s", def)
	}

	if !strings.Contains(def, "LAYER 1 · SOVEREIGN DIRECT ACTION") ||
		!strings.Contains(def, "LAYER 2 · CORE OPERATING AXIOMS") ||
		!strings.Contains(def, "LAYER 3 · RAW STATE PROCESSOR") {
		t.Fatalf("expected all 3 layers combined in kernel, got: %s", def)
	}

	customArmored := WrapCustomWithKernelLayers("Always answer in Indonesian slang.")
	if !strings.Contains(customArmored, "LAYER 4 · OPERATOR CUSTOM DIRECTIVES") ||
		!strings.Contains(customArmored, "Always answer in Indonesian slang") {
		t.Fatalf("expected custom prompt to be armored with kernel layers, got: %s", customArmored)
	}
}

func BenchmarkDecryptVault(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = GetKernelPreset("default")
	}
}
