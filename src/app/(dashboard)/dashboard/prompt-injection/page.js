"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Card,
  Button,
  Modal,
  ConfirmModal,
  Input,
  Toggle,
  Badge,
  ModelSelectModal,
  Select,
} from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const PRESET_TEMPLATES = [
  {
    name: "Bahasa Indonesia Persona",
    description: "Keeps every response in natural, professional Bahasa Indonesia",
    position: "system_prepend",
    content: "IMPORTANT: Give all answers and explanations in fluent, polite, easy-to-understand Bahasa Indonesia, unless the user explicitly requests another language.",
  },
  {
    name: "Senior Software Engineer",
    description: "High-quality, modular code with concise explanations",
    position: "system_prepend",
    content: "You are a Principal Software Engineer. Write clean, idiomatic, and production-ready code with strong error handling and type safety. Keep theoretical commentary minimal and prioritize actionable, robust code solutions.",
  },
  {
    name: "Strict JSON Output Enforcer",
    description: "Forces the output to be pure valid JSON with no markdown wrapping",
    position: "system_append",
    content: "CRITICAL REQUIREMENT: Output strictly valid JSON with no introductory text, no conversational wrap-up, and no markdown code fences (` ```json `). The response must be directly parseable by JSON.parse().",
  },
  {
    name: "Concise & Terse Answers",
    description: "Cuts the small talk and gets straight to the answer",
    position: "system_append",
    content: "Be direct, concise, and terse. Do not include pleasantries, filler phrases, or restate the question. Answer the core request immediately.",
  },
  {
    name: "Security & Secret Redaction Guard",
    description: "Stops API keys, tokens and secret credentials from leaking",
    position: "system_prepend",
    content: "Security Policy: Never reveal, generate, or reflect actual API keys, private credentials, database passwords, or secret environment variables in your responses. If asked for secrets, redact them with [REDACTED].",
  },
];

const POSITION_LABELS = {
  system_prepend: { label: "Prepend System", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", icon: "arrow_upward", desc: "Insert at the start of the system prompt" },
  system_append: { label: "Append System", badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20", icon: "arrow_downward", desc: "Insert at the end of the system prompt" },
  system_override: { label: "Override System", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", icon: "restart_alt", desc: "Replaces the entire original system prompt" },
  user_prepend: { label: "Prepend User", badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20", icon: "north_west", desc: "Inserts before the last user message" },
  user_append: { label: "Append User", badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20", icon: "south_east", desc: "Inserts after the last user message" },
};

const TARGET_TYPE_LABELS = {
  all: { label: "Global (All Traffic)", desc: "Applies to every model and combo request on the gateway" },
  combos: { label: "Specific Combos", desc: "Applies only when the request targets a specific combo" },
  models: { label: "Specific Models", desc: "Applies only to a specific model or model pattern" },
  custom: { label: "Custom (Both)", desc: "A specific combination of models and combos" },
};

const POPULAR_MODELS = [
  "openai/gpt-4o",
  "claude-3-7-sonnet",
  "deepseek/deepseek-chat",
  "gemini-2.5-pro",
];

export default function PromptInjectionPage() {
  const [rules, setRules] = useState([]);
  const [combos, setCombos] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"
  const [targetFilter, setTargetFilter] = useState("all"); // "all" | "combos" | "models" | "global"

  // Modal State
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [deletingRule, setDeletingRule] = useState(null);
const normVal = (m) => (typeof m === "string" ? m : m?.value || m?.name || m?.id || "");
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Playground state
  const [showPlayground, setShowPlayground] = useState(false);
  const [testTarget, setTestTarget] = useState("");
  const [testApiKey, setTestApiKey] = useState("");
  const [testUserMsg, setTestUserMsg] = useState("Write a helper function that sorts an array of objects.");
  const [testSystemMsg, setTestSystemMsg] = useState("You are an AI assistant.");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Playground custom dropdowns
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [targetSearch, setTargetSearch] = useState("");
  const targetDropdownRef = useRef(null);

  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const [keySearch, setKeySearch] = useState("");
  const keyDropdownRef = useRef(null);

  const filteredCombos = useMemo(() => {
    if (!targetSearch) return combos;
    const q = targetSearch.toLowerCase();
    return combos.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [combos, targetSearch]);

  const filteredModels = useMemo(() => {
    if (!targetSearch) return POPULAR_MODELS;
    const q = targetSearch.toLowerCase();
    return POPULAR_MODELS.filter((m) => m.toLowerCase().includes(q));
  }, [targetSearch]);

  const filteredApiKeys = useMemo(() => {
    if (!keySearch) return apiKeys;
    const q = keySearch.toLowerCase();
    return apiKeys.filter(
      (k) =>
        (k.name && k.name.toLowerCase().includes(q)) ||
        (k.key && k.key.toLowerCase().includes(q)) ||
        (k.id && k.id.toLowerCase().includes(q))
    );
  }, [apiKeys, keySearch]);

  useEffect(() => {
    if (!showTargetDropdown && !showKeyDropdown) return;
    const handleClickOutside = (e) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target)) {
        setShowTargetDropdown(false);
      }
      if (keyDropdownRef.current && !keyDropdownRef.current.contains(e.target)) {
        setShowKeyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showTargetDropdown, showKeyDropdown]);

  const selectedKeyObj = useMemo(() => {
    if (!testApiKey) return null;
    return apiKeys.find((k) => (k.key || k.id) === testApiKey || k.id === testApiKey);
  }, [apiKeys, testApiKey]);

  const selectedKeyLabel = useMemo(() => {
    if (!testApiKey) return "(All / Anonymous / Local)";
    if (!selectedKeyObj) return testApiKey;
    return `${selectedKeyObj.name || "API Key"} (${selectedKeyObj.key ? selectedKeyObj.key.slice(0, 8) + "..." : selectedKeyObj.id.slice(0, 8) + "..."})`;
  }, [testApiKey, selectedKeyObj]);

  // Form Fields
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    enabled: true,
    targetType: "models",
    targetCombos: [],
    targetModels: [],
    targetKeys: [],
    matchCondition: {
      type: "always",
      pattern: "",
      caseSensitive: false,
    },
    position: "system_prepend",
    content: "",
    priority: 10,
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const { copied: copiedId, copy } = useCopyToClipboard(2000);

  // Fetch all initial data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [rulesRes, combosRes, modelsRes, providersRes, keysRes] = await Promise.all([
        fetch("/api/prompt-injection").then((r) => (r.ok ? r.json() : { rules: [] })).catch(() => ({ rules: [] })),
        fetch("/api/combos").then((r) => (r.ok ? r.json() : { combos: [] })).catch(() => ({ combos: [] })),
        fetch("/api/usage/available-models").then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
        fetch("/api/providers").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        fetch("/api/keys").then((r) => (r.ok ? r.json() : { keys: [] })).catch(() => ({ keys: [] })),
      ]);

      setRules(rulesRes.rules || []);
      setCombos(combosRes.combos || []);
      setAvailableModels(modelsRes.models || []);
      setActiveProviders(providersRes.connections || []);
      setApiKeys(keysRes.keys || []);
    } catch (err) {
      console.error("Failed to load prompt injection data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Form
  const handleOpenCreate = () => {
    setEditingRule(null);
    setFormData({
      name: "",
      description: "",
      enabled: true,
      targetType: "models",
      targetCombos: [],
      targetModels: [],
      targetKeys: [],
      matchCondition: {
        type: "always",
        pattern: "",
        caseSensitive: false,
      },
      position: "system_prepend",
      content: "",
      priority: 10,
    });
    setFormError("");
    setShowFormModal(true);
  };

  const handleOpenEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name || "",
      description: rule.description || "",
      enabled: rule.enabled !== false,
      targetType: rule.targetType || "models",
      targetCombos: Array.isArray(rule.targetCombos) ? [...rule.targetCombos] : [],
      targetModels: Array.isArray(rule.targetModels) ? [...rule.targetModels] : [],
      targetKeys: Array.isArray(rule.targetKeys) ? [...rule.targetKeys] : [],
      matchCondition: rule.matchCondition ? {
        type: rule.matchCondition.type || "always",
        pattern: rule.matchCondition.pattern || "",
        caseSensitive: !!rule.matchCondition.caseSensitive,
      } : { type: "always", pattern: "", caseSensitive: false },
      position: rule.position || "system_prepend",
      content: rule.content || "",
      priority: Number.isFinite(rule.priority) ? rule.priority : 10,
    });
    setFormError("");
    setShowFormModal(true);
  };

  const handleDuplicate = (rule) => {
    setEditingRule(null);
    setFormData({
      name: `${rule.name || "Rule"} (Copy)`,
      description: rule.description || "",
      enabled: true,
      targetType: rule.targetType || "models",
      targetCombos: Array.isArray(rule.targetCombos) ? [...rule.targetCombos] : [],
      targetModels: Array.isArray(rule.targetModels) ? [...rule.targetModels] : [],
      targetKeys: Array.isArray(rule.targetKeys) ? [...rule.targetKeys] : [],
      matchCondition: rule.matchCondition ? {
        type: rule.matchCondition.type || "always",
        pattern: rule.matchCondition.pattern || "",
        caseSensitive: !!rule.matchCondition.caseSensitive,
      } : { type: "always", pattern: "", caseSensitive: false },
      position: rule.position || "system_prepend",
      content: rule.content || "",
      priority: (rule.priority || 10) + 1,
    });
    setFormError("");
    setShowFormModal(true);
  };

  // Save Rule
  const handleSaveForm = async (e) => {
    e?.preventDefault();
    if (!formData.name.trim()) {
      setFormError("Rule name is required.");
      return;
    }
    if (!formData.content.trim()) {
      setFormError("Prompt content cannot be empty.");
      return;
    }
    if (formData.targetType === "combos" && formData.targetCombos.length === 0) {
      setFormError("Please select at least one target combo.");
      return;
    }
    if (formData.targetType === "models" && formData.targetModels.length === 0) {
      setFormError("Please specify at least one target model pattern.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const cleanTargetModels = (formData.targetModels || [])
        .map((m) => (typeof m === "string" ? m : (m?.value || m?.name || m?.id || "")).trim())
        .filter(Boolean);
      const cleanTargetCombos = (formData.targetCombos || [])
        .map((c) => (typeof c === "string" ? c : (c?.name || c?.id || "")).trim())
        .filter(Boolean);
      const cleanTargetKeys = (formData.targetKeys || [])
        .map((k) => (typeof k === "string" ? k : (k?.id || k?.key || "")).trim())
        .filter(Boolean);

      const payload = {
        ...formData,
        targetModels: cleanTargetModels,
        targetCombos: cleanTargetCombos,
        targetKeys: cleanTargetKeys,
        id: editingRule ? editingRule.id : undefined,
      };

      const res = await fetch("/api/prompt-injection", {
        method: editingRule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to save rule");
        return;
      }

      setShowFormModal(false);
      await loadData();
    } catch (err) {
      setFormError(err.message || "An unexpected error occurred");
    } finally {
      setSaving(false);
    }
  };

  // Toggle Rule Status
  const handleToggleRule = async (rule) => {
    const nextStatus = !rule.enabled;
    // Optimistic UI update
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled: nextStatus } : r))
    );

    try {
      const res = await fetch("/api/prompt-injection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: nextStatus }),
      });
      if (!res.ok) {
        // Revert on failure
        setRules((prev) =>
          prev.map((r) => (r.id === rule.id ? { ...r, enabled: !nextStatus } : r))
        );
      }
    } catch {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !nextStatus } : r))
      );
    }
  };

  // Delete Rule
  const handleDeleteConfirm = async () => {
    if (!deletingRule) return;
    try {
      const res = await fetch(`/api/prompt-injection?id=${encodeURIComponent(deletingRule.id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== deletingRule.id));
      }
    } catch (err) {
      console.error("Failed to delete rule:", err);
    } finally {
      setDeletingRule(null);
    }
  };

  // Add model / combo chips
  const addTargetCombo = (comboName) => {
    if (!comboName) return;
    if (!formData.targetCombos.includes(comboName)) {
      setFormData((prev) => ({
        ...prev,
        targetCombos: [...prev.targetCombos, comboName],
      }));
    }
  };

  const removeTargetCombo = (comboName) => {
    setFormData((prev) => ({
      ...prev,
      targetCombos: prev.targetCombos.filter((c) => c !== comboName),
    }));
  };

  const [modelInput, setModelInput] = useState("");
  const handleAddModelInput = (e) => {
    if (e.key === "Enter" || e.type === "blur") {
      e.preventDefault();
      const val = modelInput.trim();
      if (val && !formData.targetModels.includes(val)) {
        setFormData((prev) => ({
          ...prev,
          targetModels: [...prev.targetModels, val],
        }));
        setModelInput("");
      }
    }
  };

  const removeTargetModel = (modelToRemove) => {
    const toRemove = typeof modelToRemove === "string" ? modelToRemove : (modelToRemove?.value || modelToRemove?.name || modelToRemove?.id || "");
    setFormData((prev) => ({
      ...prev,
      targetModels: prev.targetModels.filter((m) => {
        const val = typeof m === "string" ? m : (m?.value || m?.name || m?.id || "");
        return val !== toRemove;
      }),
    }));
  };

  // Insert variable into content
  const insertVariable = (varName) => {
    setFormData((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content} ${varName}` : varName,
    }));
  };

  // Apply Template
  const applyTemplate = (tpl) => {
    setFormData((prev) => ({
      ...prev,
      position: tpl.position,
      content: tpl.content,
      description: prev.description || tpl.description,
    }));
  };

  // Playground simulation run
  const runPlaygroundTest = async (ruleToTest = null) => {
    const target = testTarget || (combos[0]?.name || "openai/gpt-4o");
    setTesting(true);
    setTestResult(null);

    const testRule = ruleToTest || {
      name: formData.name || "Test Rule",
      enabled: true,
      targetType: formData.targetType,
      targetCombos: formData.targetCombos,
      targetModels: formData.targetModels,
      targetKeys: formData.targetKeys,
      matchCondition: formData.matchCondition,
      position: formData.position,
      content: formData.content,
    };

    const isCombo = combos.some((c) => c.name === target);

    try {
      const res = await fetch("/api/prompt-injection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          rule: testRule,
          sampleBody: {
            messages: [
              ...(testSystemMsg ? [{ role: "system", content: testSystemMsg }] : []),
              { role: "user", content: testUserMsg },
            ],
          },
          context: {
            modelStr: target,
            comboName: isCombo ? target : "",
            provider: target.includes("/") ? target.split("/")[0] : "",
            model: target.includes("/") ? target.split("/")[1] : target,
            apiKey: testApiKey || "",
            userText: testUserMsg || "",
          },
        }),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      console.error("Test failed:", err);
    } finally {
      setTesting(false);
    }
  };

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return rules.filter((rule) => {
      // Status
      if (statusFilter === "active" && !rule.enabled) return false;
      if (statusFilter === "inactive" && rule.enabled) return false;

      // Target type
      if (targetFilter === "combos" && rule.targetType !== "combos" && rule.targetType !== "custom") return false;
      if (targetFilter === "models" && rule.targetType !== "models" && rule.targetType !== "custom") return false;
      if (targetFilter === "global" && rule.targetType !== "all") return false;

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (rule.name || "").toLowerCase().includes(q);
        const matchDesc = (rule.description || "").toLowerCase().includes(q);
        const matchContent = (rule.content || "").toLowerCase().includes(q);
        const matchCombos = (rule.targetCombos || []).some((c) => c.toLowerCase().includes(q));
        const matchModels = (rule.targetModels || []).some((m) => m.toLowerCase().includes(q));
        const matchKeys = (rule.targetKeys || []).some((k) => k.toLowerCase().includes(q));
        const matchPattern = (rule.matchCondition?.pattern || "").toLowerCase().includes(q);
        return matchName || matchDesc || matchContent || matchCombos || matchModels || matchKeys || matchPattern;
      }

      return true;
    });
  }, [rules, statusFilter, targetFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter((r) => r.enabled).length;
    const comboTargets = new Set();
    const modelTargets = new Set();
    let globalCount = 0;

    rules.forEach((r) => {
      if (r.targetType === "all") globalCount++;
      (r.targetCombos || []).forEach((c) => comboTargets.add(c));
      (r.targetModels || []).forEach((m) => modelTargets.add(m));
    });

    return {
      total,
      active,
      combosCount: comboTargets.size,
      modelsCount: modelTargets.size,
      globalCount,
    };
  }, [rules]);

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[24px] text-primary">tune</span>
            <h1 className="text-xl font-semibold tracking-tight text-text-main">
              Prompt Injection
            </h1>
            <Badge variant="outline" className="text-[11px] text-primary border-primary/30 bg-primary/5">
              AI Gateway
            </Badge>
          </div>
          <p className="text-xs text-text-muted mt-1 max-w-2xl">
            Gateway-level prompt manipulation: inject, prepend, append, or override system instructions and prompt messages for a specific model or combo, transparently, before the request is passed to the provider.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowPlayground(true);
              if (!testTarget && combos.length > 0) setTestTarget(combos[0].name);
            }}
            className="gap-1.5 text-xs"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            Simulate / Test
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreate}
            className="gap-1.5 text-xs shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Injection Rule
          </Button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card padding="sm" className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Total Rules</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-text-main">{stats.total}</span>
            <span className="text-xs text-text-muted">rules</span>
          </div>
        </Card>

        <Card padding="sm" className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Active Rules</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-500">{stats.active}</span>
            <span className="text-xs text-text-muted">enforced</span>
          </div>
        </Card>

        <Card padding="sm" className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Combos Covered</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-sky-500">{stats.combosCount}</span>
            <span className="text-xs text-text-muted">combos</span>
          </div>
        </Card>

        <Card padding="sm" className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted uppercase tracking-wider">Models Covered</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-primary">{stats.modelsCount}</span>
            <span className="text-xs text-text-muted">patterns</span>
          </div>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card padding="sm" className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by rule name, description, target combo, model pattern..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-transparent border-0 focus:outline-none text-text-main placeholder:text-text-muted/60"
          />
        </div>

        <div className="flex items-center gap-2 border-t sm:border-t-0 sm:border-l border-border-subtle pt-2 sm:pt-0 sm:pl-3">
          {/* Target Filter */}
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="px-2.5 py-1 text-xs rounded-lg border border-border-subtle bg-surface-2 text-text-main focus:outline-none"
          >
            <option value="all">All Targets</option>
            <option value="combos">Combos Only</option>
            <option value="models">Models Only</option>
            <option value="global">Global Only</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1 text-xs rounded-lg border border-border-subtle bg-surface-2 text-text-main focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>
      </Card>

      {/* Rules List */}
      {loading ? (
        <div className="py-16 text-center text-xs text-text-muted">
          <div className="inline-block size-6 animate-spin rounded-full border-2 border-primary border-t-transparent mb-2" />
          <p>Loading prompt injection rules...</p>
        </div>
      ) : filteredRules.length === 0 ? (
        <Card padding="lg" className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
            <span className="material-symbols-outlined text-[24px]">tune</span>
          </div>
          <h3 className="text-sm font-semibold text-text-main">
            {searchQuery || statusFilter !== "all" || targetFilter !== "all"
              ? "No matching prompt injection rules"
              : "No Prompt Injection Rules Yet"}
          </h3>
          <p className="text-xs text-text-muted mt-1 max-w-sm">
            {searchQuery || statusFilter !== "all" || targetFilter !== "all"
              ? "Try adjusting your search query or filter settings."
              : "Create injection rules to automatically prepend, append, or override prompts for combos and models passing through your gateway."}
          </p>
          {!searchQuery && statusFilter === "all" && targetFilter === "all" && (
            <Button
              size="sm"
              variant="primary"
              onClick={handleOpenCreate}
              className="mt-4 gap-1.5 text-xs"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Create First Rule
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredRules.map((rule) => {
            const posConfig = POSITION_LABELS[rule.position] || POSITION_LABELS.system_prepend;

            return (
              <Card
                key={rule.id}
                padding="md"
                className={`transition-all ${
                  rule.enabled
                    ? "hover:border-primary/40"
                    : "opacity-75"
                } flex flex-col gap-3.5`}
              >
                {/* Top Row: Name, Badges, Status Toggle */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-2 border border-border-subtle text-text-muted">
                      P{rule.priority ?? 10}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-text-main truncate">
                          {rule.name}
                        </h3>

                        {/* Position Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${posConfig.badge}`}
                          title={posConfig.desc}
                        >
                          <span className="material-symbols-outlined text-[12px]">{posConfig.icon}</span>
                          {posConfig.label}
                        </span>

                        {/* Target Badges */}
                        {rule.targetType === "all" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="material-symbols-outlined text-[12px]">public</span>
                            Global Traffic
                          </span>
                        )}

                        {/* API Keys Filter Badge */}
                        {Array.isArray(rule.targetKeys) && rule.targetKeys.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <span className="material-symbols-outlined text-[12px]">key</span>
                            {rule.targetKeys.length} API Key{rule.targetKeys.length > 1 ? "s" : ""}
                          </span>
                        )}

                        {/* Keyword / Regex Condition Badge */}
                        {rule.matchCondition?.type === "contains" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                            <span className="material-symbols-outlined text-[12px]">filter_alt</span>
                            Keyword: &quot;{rule.matchCondition.pattern}&quot;
                          </span>
                        )}

                        {rule.matchCondition?.type === "regex" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-mono">
                            <span className="material-symbols-outlined text-[12px]">code</span>
                            /{rule.matchCondition.pattern}/
                          </span>
                        )}
                      </div>

                      {rule.description && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
                          {rule.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions & Toggle */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 mr-2">
                      <Toggle
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule)}
                      />
                      <span className="text-[11px] font-medium text-text-muted hidden sm:inline">
                        {rule.enabled ? "Active" : "Off"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setTestTarget(
                          rule.targetCombos?.[0] || rule.targetModels?.[0] || "openai/gpt-4o"
                        );
                        setShowPlayground(true);
                        runPlaygroundTest(rule);
                      }}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                      title="Test in Playground"
                    >
                      <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDuplicate(rule)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                      title="Duplicate Rule"
                    >
                      <span className="material-symbols-outlined text-[18px]">content_copy</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(rule)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                      title="Edit Rule"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingRule(rule)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Delete Rule"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                  </div>
                </div>

                {/* Target Scope Tags (if specific combos or models) */}
                {rule.targetType !== "all" && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-text-muted text-[10px] font-medium uppercase tracking-wider mr-1">
                      Target:
                    </span>

                    {/* Combos */}
                    {(rule.targetCombos || []).map((combo) => (
                      <span
                        key={combo}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-medium"
                      >
                        <span className="material-symbols-outlined text-[12px]">layers</span>
                        {combo}
                      </span>
                    ))}

                    {/* Models */}
                    {(rule.targetModels || []).map((model, idx) => {
                      const modelStr = typeof model === "string" ? model : (model?.value || model?.name || model?.id || String(model));
                      return (
                        <span
                          key={`${modelStr}-${idx}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 font-mono text-[10.5px]"
                        >
                          <span className="material-symbols-outlined text-[12px]">smart_toy</span>
                          {modelStr}
                        </span>
                      );
                    })}

                    {(rule.targetCombos || []).length === 0 && (rule.targetModels || []).length === 0 && (
                      <span className="text-text-muted/60 italic text-[11px]">No targets specified</span>
                    )}
                  </div>
                )}

                {/* Content Box */}
                <div className="relative rounded-lg bg-surface-2 border border-border-subtle p-3 font-mono text-xs text-text-main overflow-x-auto">
                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border-subtle text-[10px] text-text-muted">
                    <span className="font-semibold uppercase tracking-wider">Injected Prompt Payload</span>
                    <button
                      type="button"
                      onClick={() => copy(rule.content, rule.id)}
                      className="flex items-center gap-1 hover:text-text-main transition-colors"
                    >
                      <span className="material-symbols-outlined text-[13px]">
                        {copiedId === rule.id ? "check" : "content_copy"}
                      </span>
                      <span>{copiedId === rule.id ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono leading-relaxed text-[11.5px] text-text-main/90 max-h-36 overflow-y-auto custom-scrollbar">
                    {rule.content}
                  </pre>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Guide Section */}
      <Card padding="md" className="mt-2 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-text-main">
          <span className="material-symbols-outlined text-[16px] text-primary">info</span>
          AI Gateway Prompt Injection Guide
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-text-muted mt-1 leading-relaxed">
          <div className="p-2.5 rounded-lg bg-surface-2 border border-border-subtle">
            <span className="font-semibold text-text-main block mb-1">1. Flexible Injection Formats</span>
            Supports 5 placement modes: <code>Prepend System</code>, <code>Append System</code>, <code>Override System</code>, <code>Prepend User</code>, and <code>Append User</code>, translated automatically into OpenAI, Claude and Gemini formats.
          </div>
          <div className="p-2.5 rounded-lg bg-surface-2 border border-border-subtle">
            <span className="font-semibold text-text-main block mb-1">2. Specific Targets &amp; Wildcards</span>
            Apply a rule to a specific Combo (e.g. <code>my-combo</code>) or Model (e.g. <code>claude-3-7-sonnet</code>, <code>openai/*</code>, or the wildcard <code>*</code>).
          </div>
          <div className="p-2.5 rounded-lg bg-surface-2 border border-border-subtle">
            <span className="font-semibold text-text-main block mb-1">3. Dynamic Variables</span>
            Use the built-in variable templates <code>{"{{model}}"}</code>, <code>{"{{provider}}"}</code>, <code>{"{{date}}"}</code>, and <code>{"{{time}}"}</code>, evaluated automatically when a request arrives.
          </div>
        </div>
      </Card>

      {/* Modal Create / Edit Rule */}
      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingRule ? "Edit Prompt Injection Rule" : "Create Prompt Injection Rule"}
        size="xl"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowFormModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="prompt-injection-rule-form"
              variant="primary"
              size="sm"
              disabled={saving}
              className="gap-1.5"
            >
              {saving && <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
          </>
        }
      >
        <form id="prompt-injection-rule-form" onSubmit={handleSaveForm} className="flex flex-col gap-4 pb-2">
          {formError && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {formError}
            </div>
          )}

          {/* Quick Preset Picker */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-main">Gunakan Starter Template (Opsional)</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-border-subtle bg-surface-2 hover:bg-surface-3 hover:border-primary/40 text-text-main transition-colors text-left"
                >
                  ⚡ {tpl.name}
                </button>
              ))}
            </div>
          </div>

          {/* Name & Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3 flex flex-col gap-1">
              <label className="text-xs font-medium text-text-main">Rule Name *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Bahasa Indonesia Formatter, Senior Coder Guard"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-main">Priority (Order)</label>
              <Input
                type="number"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 10 })}
                min={1}
                max={999}
              />
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-main">Description (Optional)</label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Short note on what this injection is for..."
            />
          </div>

          {/* Target Scope */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-main">Target Scope *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(TARGET_TYPE_LABELS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormData({ ...formData, targetType: key })}
                  className={`p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                    formData.targetType === key
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border-subtle bg-surface-2 text-text-muted hover:text-text-main"
                  }`}
                >
                  <span className="text-xs">{item.label}</span>
                  <span className="text-[10px] opacity-75 font-normal leading-tight">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Target Combos Picker */}
          {(formData.targetType === "combos" || formData.targetType === "custom") && (
            <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border-subtle bg-surface-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-main flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-sky-500">layers</span>
                  Target Combos ({formData.targetCombos.length})
                </label>
                <span className="text-[11px] text-text-muted">Choose the combo to inject into</span>
              </div>

              {combos.length === 0 ? (
                <p className="text-xs text-text-muted italic">No combos have been created yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {combos.map((c) => {
                    const isSelected = formData.targetCombos.includes(c.name);
                    return (
                      <button
                        key={c.id || c.name}
                        type="button"
                        onClick={() => {
                          if (isSelected) removeTargetCombo(c.name);
                          else addTargetCombo(c.name);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                          isSelected
                            ? "bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-500/40"
                            : "bg-surface text-text-muted border-border-subtle hover:text-text-main"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isSelected ? "check" : "add"}
                        </span>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Target Models Input & Picker */}
          {(formData.targetType === "models" || formData.targetType === "custom") && (
            <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border-subtle bg-surface-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-main flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-purple-500">smart_toy</span>
                  Target Models &amp; Wildcards ({formData.targetModels.length})
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowModelPicker(true)}
                  className="gap-1 text-[11px]"
                >
                  <span className="material-symbols-outlined text-[13px]">search</span>
                  Browse Models
                </Button>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <Input
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  onKeyDown={handleAddModelInput}
                  placeholder="Type model or wildcard pattern (e.g. claude-*, gpt-4o, deepseek/*) and press Enter"
                  className="text-xs font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(e) => handleAddModelInput(e)}
                  disabled={!modelInput.trim()}
                  className="text-xs shrink-0"
                >
                  Add
                </Button>
              </div>

              {formData.targetModels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {formData.targetModels.map((m, idx) => {
                    const modelStr = typeof m === "string" ? m : (m?.value || m?.name || m?.id || String(m));
                    return (
                      <span
                        key={`${modelStr}-${idx}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30 text-xs font-mono"
                      >
                        {modelStr}
                        <button
                          type="button"
                          onClick={() => removeTargetModel(m)}
                          className="hover:text-red-500 ml-0.5"
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Target API Keys Filter (Optional) */}
          <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-border-subtle bg-surface-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-amber-500">key</span>
                Target API Keys (Optional)
              </label>
              <span className="text-[11px] text-text-muted">
                {formData.targetKeys.length === 0 ? "All API Keys (Global Traffic)" : `${formData.targetKeys.length} API keys selected`}
              </span>
            </div>

            {apiKeys.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                No API keys created yet. The injection applies to every gateway request.
              </p>
            ) : (
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, targetKeys: [] })}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                      formData.targetKeys.length === 0
                        ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40"
                        : "bg-surface text-text-muted border-border-subtle hover:text-text-main"
                    }`}
                  >
                    All API Keys (Default)
                  </button>
                  <span className="text-[11px] text-text-muted">or pick specific keys:</span>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                  {apiKeys.map((k) => {
                    const isSelected = formData.targetKeys.includes(k.id) || formData.targetKeys.includes(k.name);
                    return (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setFormData({
                              ...formData,
                              targetKeys: formData.targetKeys.filter((id) => id !== k.id && id !== k.name),
                            });
                          } else {
                            setFormData({
                              ...formData,
                              targetKeys: [...formData.targetKeys, k.id],
                            });
                          }
                        }}
                        className={`px-2 py-1 rounded-lg text-xs border flex items-center gap-1.5 transition-colors ${
                          isSelected
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40 font-medium"
                            : "bg-surface text-text-muted border-border-subtle hover:text-text-main"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {isSelected ? "check_box" : "check_box_outline_blank"}
                        </span>
                        <span>{k.name || "Unnamed Key"}</span>
                        {k.key && (
                          <span className="text-[10px] font-mono opacity-60">({k.key.slice(0, 6)}...)</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Trigger Condition (Keyword / Regex Filter) */}
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-border-subtle bg-surface-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-indigo-500">filter_alt</span>
                Prompt Trigger Filter (Optional)
              </label>
              <span className="text-[11px] text-text-muted">
                {formData.matchCondition.type === "always" ? "Selalu dieksekusi" : "Hanya jika prompt cocok"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { type: "always", label: "Always Active", desc: "Setiap request tanpa filter teks" },
                { type: "contains", label: "Contains Keywords", desc: "When the prompt contains a given word" },
                { type: "regex", label: "Regex Pattern", desc: "Jika prompt cocok pola RegExp" },
              ].map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      matchCondition: { ...formData.matchCondition, type: opt.type },
                    })
                  }
                  className={`p-2 rounded-xl border text-left flex flex-col gap-0.5 transition-all ${
                    formData.matchCondition.type === opt.type
                      ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-500 font-semibold"
                      : "border-border-subtle bg-surface text-text-muted hover:text-text-main"
                  }`}
                >
                  <span className="text-xs">{opt.label}</span>
                  <span className="text-[10px] opacity-75 font-normal leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>

            {formData.matchCondition.type === "contains" && (
              <div className="flex flex-col gap-1.5 mt-1">
                <label className="text-[11px] font-medium text-text-muted">
                  Keywords (separate with commas if there is more than one):
                </label>
                <Input
                  value={formData.matchCondition.pattern}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      matchCondition: { ...formData.matchCondition, pattern: e.target.value },
                    })
                  }
                  placeholder="Contoh: code, python, buatkan fungsi, sql query, bug"
                  className="text-xs"
                />
                <div className="flex items-center gap-2 mt-0.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!formData.matchCondition.caseSensitive}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          matchCondition: { ...formData.matchCondition, caseSensitive: e.target.checked },
                        })
                      }
                      className="rounded border-border-subtle text-primary focus:ring-0"
                    />
                    Case sensitive (huruf besar/kecil berpengaruh)
                  </label>
                </div>
              </div>
            )}

            {formData.matchCondition.type === "regex" && (
              <div className="flex flex-col gap-1.5 mt-1">
                <label className="text-[11px] font-medium text-text-muted">
                  Pola Regular Expression (RegExp):
                </label>
                <Input
                  value={formData.matchCondition.pattern}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      matchCondition: { ...formData.matchCondition, pattern: e.target.value },
                    })
                  }
                  placeholder="Contoh: \\b(python|javascript|typescript)\\b atau ^(tulis|buatkan)\\b"
                  className="text-xs font-mono"
                />
                <div className="flex items-center gap-2 mt-0.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!formData.matchCondition.caseSensitive}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          matchCondition: { ...formData.matchCondition, caseSensitive: e.target.checked },
                        })
                      }
                      className="rounded border-border-subtle text-primary focus:ring-0"
                    />
                    Case sensitive (the /i flag is the default when unchecked)
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Position Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-main">Injection Position *</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {Object.entries(POSITION_LABELS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFormData({ ...formData, position: key })}
                  className={`p-2 rounded-xl border text-center flex flex-col items-center gap-1 transition-all ${
                    formData.position === key
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border-subtle bg-surface-2 text-text-muted hover:text-text-main"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  <span className="text-xs leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Content */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-main">Injected Prompt Content *</label>
              {/* Variable Chips */}
              <div className="flex items-center gap-1 text-[11px] text-text-muted">
                <span>Insert variable:</span>
                {["{{model}}", "{{provider}}", "{{date}}", "{{time}}"].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className="px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle hover:bg-surface-3 font-mono text-[10px] text-primary"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Type the prompt text to inject automatically..."
              rows={6}
              className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-border-subtle bg-surface-2 text-text-main focus:outline-none focus:border-primary/50 leading-relaxed custom-scrollbar"
              required
            />
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-border-subtle bg-surface-2">
            <div>
              <span className="text-xs font-medium text-text-main block">Enable This Rule</span>
              <span className="text-[11px] text-text-muted">Aturan akan langsung dieksekusi pada gateway saat aktif.</span>
            </div>
            <Toggle
              checked={formData.enabled}
              onChange={(val) => setFormData({ ...formData, enabled: val })}
            />
          </div>
        </form>
      </Modal>

      {/* Model Picker Modal */}
      {showModelPicker && (
        <ModelSelectModal
          isOpen={showModelPicker}
          onClose={() => setShowModelPicker(false)}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          showStudioTargets
          closeOnSelect={false}
          addedModelValues={formData.targetModels}
          onSelect={(model) => {
            const val = normVal(model);
            if (val && !formData.targetModels.includes(val)) {
              setFormData((prev) => ({
                ...prev,
                targetModels: [...prev.targetModels, val],
              }));
            }
          }}
          onDeselect={(model) => {
            const val = normVal(model);
            setFormData((prev) => ({
              ...prev,
              targetModels: prev.targetModels.filter((m) => m !== val),
            }));
          }}
          onSelectBatch={(models) => {
            setFormData((prev) => {
              const next = [...prev.targetModels];
              for (const m of models) {
                const val = normVal(m);
                if (val && !next.includes(val)) next.push(val);
              }
              return { ...prev, targetModels: next };
            });
          }}
          onDeselectBatch={(models) => {
            const vals = new Set(models.map(normVal));
            setFormData((prev) => ({
              ...prev,
              targetModels: prev.targetModels.filter((m) => !vals.has(m)),
            }));
          }}
          selectedModel=""
          title="Select Target Model"
          />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!deletingRule}
        onClose={() => setDeletingRule(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Prompt Injection Rule"
        message={`Are you sure you want to delete "${deletingRule?.name}"? Subsequent requests will no longer receive this prompt injection.`}
        confirmText="Delete Rule"
        variant="danger"
      />

      {/* Simulator / Test Playground Modal */}
      <Modal
        isOpen={showPlayground}
        onClose={() => setShowPlayground(false)}
        title="Prompt Injection Gateway Simulator"
        size="full"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-text-muted">
            Test how a request is processed and modified by the gateway injection rules before it actually reaches the upstream model.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-xl border border-border-subtle bg-surface-2 items-end">
            {/* Custom Target Dropdown */}
            <div className="sm:col-span-5 flex flex-col gap-1.5 min-w-0 relative" ref={targetDropdownRef}>
              <label className="text-xs font-semibold text-text-main flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-primary">route</span>
                  Target (Combo / Model)
                </span>
                {combos.length > 0 && (
                  <span className="text-[10px] font-normal text-text-muted">
                    {combos.length} combos
                  </span>
                )}
              </label>

              {/* Trigger Button */}
              <button
                type="button"
                onClick={() => {
                  setShowTargetDropdown((v) => !v);
                  setShowKeyDropdown(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg border border-border bg-surface hover:bg-surface-3 text-text-main transition-colors focus:outline-none focus:ring-1 focus:ring-primary h-[38px] cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                    {combos.some((c) => c.name === testTarget) ? "alt_route" : "smart_toy"}
                  </span>
                  <span className="truncate font-mono font-medium">
                    {testTarget || "Select a Combo or Model"}
                  </span>
                </div>
                <span className={`material-symbols-outlined text-[18px] text-text-muted shrink-0 transition-transform duration-150 ${showTargetDropdown ? "rotate-180" : ""}`}>
                  expand_more
                </span>
              </button>

              {/* Dropdown Panel with Search & Custom Scroll */}
              {showTargetDropdown && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-full sm:min-w-[320px] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col">
                  {/* Sticky Search Filter */}
                  <div className="p-2 border-b border-border-subtle bg-surface-2 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-text-muted">search</span>
                    <input
                      type="text"
                      value={targetSearch}
                      onChange={(e) => setTargetSearch(e.target.value)}
                      placeholder="Filter combo or model..."
                      className="w-full bg-transparent text-xs text-text-main focus:outline-none placeholder:text-text-muted/60"
                      autoFocus
                    />
                    {targetSearch && (
                      <button
                        type="button"
                        onClick={() => setTargetSearch("")}
                        className="text-text-muted hover:text-text-main text-xs p-0.5"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    )}
                  </div>

                  {/* Scrollable List Container (max-h-60 overflow-y-auto custom-scrollbar) */}
                  <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 flex flex-col gap-1">
                    {/* Combos Group */}
                    {filteredCombos.length > 0 && (
                      <div className="flex flex-col">
                        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted/80 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[13px] text-sky-500">alt_route</span>
                          Combos ({filteredCombos.length})
                        </div>
                        {filteredCombos.map((c) => {
                          const isSelected = testTarget === c.name;
                          return (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                setTestTarget(c.name);
                                setShowTargetDropdown(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono text-left transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-primary/15 text-primary font-semibold"
                                  : "text-text-main hover:bg-surface-2"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-sans font-medium shrink-0">
                                  Combo
                                </span>
                                <span className="truncate">{c.name}</span>
                              </div>
                              {isSelected && (
                                <span className="material-symbols-outlined text-[15px] text-primary shrink-0 ml-1">check</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Popular Models Group */}
                    {filteredModels.length > 0 && (
                      <div className="flex flex-col mt-1 pt-1 border-t border-border-subtle">
                        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted/80 flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[13px] text-purple-500">smart_toy</span>
                          Popular Models
                        </div>
                        {filteredModels.map((m) => {
                          const isSelected = testTarget === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                setTestTarget(m);
                                setShowTargetDropdown(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono text-left transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-primary/15 text-primary font-semibold"
                                  : "text-text-main hover:bg-surface-2"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 font-sans font-medium shrink-0">
                                  Model
                                </span>
                                <span className="truncate">{m}</span>
                              </div>
                              {isSelected && (
                                <span className="material-symbols-outlined text-[15px] text-primary shrink-0 ml-1">check</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Fallback to custom input if typed */}
                    {targetSearch && !filteredCombos.some((c) => c.name.toLowerCase() === targetSearch.toLowerCase()) && !filteredModels.includes(targetSearch) && (
                      <div className="mt-1 pt-1 border-t border-border-subtle">
                        <button
                          type="button"
                          onClick={() => {
                            setTestTarget(targetSearch.trim());
                            setShowTargetDropdown(false);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono text-left bg-surface-2 hover:bg-primary/10 text-primary transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[15px]">add</span>
                          <span className="truncate">Use custom: <strong>{targetSearch.trim()}</strong></span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Custom Caller API Key Dropdown */}
            <div className="sm:col-span-4 flex flex-col gap-1.5 min-w-0 relative" ref={keyDropdownRef}>
              <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px] text-amber-500">key</span>
                Caller API Key
              </label>

              {/* Trigger Button */}
              <button
                type="button"
                onClick={() => {
                  setShowKeyDropdown((v) => !v);
                  setShowTargetDropdown(false);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg border border-border bg-surface hover:bg-surface-3 text-text-main transition-colors focus:outline-none focus:ring-1 focus:ring-primary h-[38px] cursor-pointer"
              >
                <div className="flex items-center gap-2 truncate min-w-0">
                  <span className="material-symbols-outlined text-[16px] text-amber-500 shrink-0">key</span>
                  <span className="truncate font-medium">
                    {selectedKeyLabel}
                  </span>
                </div>
                <span className={`material-symbols-outlined text-[18px] text-text-muted shrink-0 transition-transform duration-150 ${showKeyDropdown ? "rotate-180" : ""}`}>
                  expand_more
                </span>
              </button>

              {/* Dropdown Panel with Search & Custom Scroll */}
              {showKeyDropdown && (
                <div className="absolute left-0 top-full mt-1.5 z-50 w-full sm:min-w-[280px] rounded-xl border border-border bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col">
                  {apiKeys.length > 4 && (
                    <div className="p-2 border-b border-border-subtle bg-surface-2 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-text-muted">search</span>
                      <input
                        type="text"
                        value={keySearch}
                        onChange={(e) => setKeySearch(e.target.value)}
                        placeholder="Filter API key..."
                        className="w-full bg-transparent text-xs text-text-main focus:outline-none placeholder:text-text-muted/60"
                        autoFocus
                      />
                    </div>
                  )}

                  <div className="max-h-56 overflow-y-auto custom-scrollbar p-1.5 flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTestApiKey("");
                        setShowKeyDropdown(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                        !testApiKey
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                          : "text-text-main hover:bg-surface-2"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="material-symbols-outlined text-[15px] text-emerald-500">public</span>
                        <span className="truncate">(All / Anonymous / Local)</span>
                      </div>
                      {!testApiKey && (
                        <span className="material-symbols-outlined text-[15px] text-amber-500 shrink-0">check</span>
                      )}
                    </button>

                    {filteredApiKeys.map((k) => {
                      const val = k.key || k.id;
                      const isSelected = testApiKey === val || testApiKey === k.id;
                      return (
                        <button
                          key={k.id}
                          type="button"
                          onClick={() => {
                            setTestApiKey(val);
                            setShowKeyDropdown(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                              : "text-text-main hover:bg-surface-2"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="material-symbols-outlined text-[14px] text-amber-500/70">key</span>
                            <span className="truncate">{k.name || "API Key"}</span>
                            {k.key && (
                              <span className="text-[10px] font-mono text-text-muted opacity-70">
                                ({k.key.slice(0, 8)}...)
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <span className="material-symbols-outlined text-[15px] text-amber-500 shrink-0">check</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="sm:col-span-3">
              <Button
                variant="primary"
                size="md"
                onClick={() => runPlaygroundTest()}
                disabled={testing}
                className="w-full gap-2 text-xs h-[38px] justify-center"
              >
                {testing ? (
                  <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                )}
                Run Simulation
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px] text-text-muted">terminal</span>
                Incoming System Prompt (Original)
              </label>
              <textarea
                value={testSystemMsg}
                onChange={(e) => setTestSystemMsg(e.target.value)}
                rows={4}
                className="w-full p-2.5 text-xs font-mono rounded-lg border border-border bg-surface text-text-main focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                placeholder="Pesan system dari client..."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px] text-text-muted">person</span>
                Incoming User Prompt
              </label>
              <textarea
                value={testUserMsg}
                onChange={(e) => setTestUserMsg(e.target.value)}
                rows={4}
                className="w-full p-2.5 text-xs font-mono rounded-lg border border-border bg-surface text-text-main focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                placeholder="Pesan pertanyaan dari user..."
              />
            </div>
          </div>

          {/* Test Results Output */}
          {testResult && (
            <div className="p-3.5 rounded-xl border border-border-subtle bg-surface-2 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-emerald-500">check_circle</span>
                  Gateway Simulation Output
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    testResult.matches
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                  }`}
                >
                  {testResult.matches ? "Rule Matched & Injected" : "No Rule Match"}
                </span>
              </div>

              {testResult.promptText && (
                <div className="text-[11px] text-text-muted">
                  <span className="font-medium text-text-main">Interpolated Prompt: </span>
                  <span className="font-mono bg-surface px-1.5 py-0.5 rounded text-text-main border border-border-subtle">
                    {testResult.promptText}
                  </span>
                </div>
              )}

              <div className="rounded-lg bg-surface border border-border-subtle p-3 text-xs font-mono text-text-main max-h-56 overflow-y-auto custom-scrollbar">
                <span className="text-[10px] text-text-muted uppercase tracking-wider block mb-1 font-semibold">
                  Transformed Body (Sent to Upstream):
                </span>
                <pre className="whitespace-pre-wrap leading-relaxed text-[11px]">
                  {JSON.stringify(testResult.resultBody, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
