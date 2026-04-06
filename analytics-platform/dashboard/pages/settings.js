import { useEffect, useMemo, useRef, useState } from "react";

const BASE_URL = "https://analyticsapp2-production.up.railway.app";

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function requestBackend(path, options = {}) {
  const timeout = Number(options.timeout || 10000);
  const candidateBases = [resolvedBackendBase, ...BACKEND_BASES].filter(
    (base, index, values) => Boolean(base) && values.indexOf(base) === index
  );
  const candidatePaths = path.startsWith("/") ? [path, `/analytics${path}`] : [path, `/analytics/${path}`];

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const base of candidateBases) {
      for (const pathVariant of candidatePaths) {
        let timeoutId;

        try {
          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(`${base}${pathVariant}`, {
            ...options,
            signal: controller.signal,
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || payload.message || `Server ${base} returned ${response.status}`);
          }

          resolvedBackendBase = base;
          return await response.json();
        } catch (error) {
          lastError = error;
        } finally {
          clearTimeout(timeoutId);
        }
      }
    }

    if (attempt < 1) {
      await sleep(350);
    }
  }

  throw lastError || new Error("Could not reach backend");
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-slate-900 text-white shadow"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const [projectId, setProjectId] = useState("*");
  const [emailInput, setEmailInput] = useState("");
  const [emails, setEmails] = useState([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [severity, setSeverity] = useState("fatal");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [toast, setToast] = useState("");

  // Projects tab state
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [editingName, setEditingName] = useState({});
  const [savingName, setSavingName] = useState({});
  const [deletingProject, setDeletingProject] = useState({});
  const [expandedSnippet, setExpandedSnippet] = useState({});
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const editRefs = useRef({});

  const prettySource = useMemo(() => {
    if (sourceLabel === "db") return "Project-specific settings";
    if (sourceLabel === "db-global") return "Global settings (*)";
    if (sourceLabel === "env") return "Backend .env fallback";
    return "";
  }, [sourceLabel]);

  async function loadAlertSettings() {
    try {
      setLoading(true);
      setError("");
      setStatus("");

      const payload = await requestBackend(
        `/alerts/settings?project_id=${encodeURIComponent(projectId || "*")}`
      );

      setEmails(Array.isArray(payload.emails) ? payload.emails : []);
      setAlertsEnabled(payload.alerts_enabled !== false);
      setSeverity(payload.severity || "fatal");
      setSourceLabel(payload.source || "");
      setHasLoadedOnce(true);
      setStatus("Current alert settings loaded.");
    } catch (err) {
      setError(
        err.message ||
          "Could not fetch alert settings. Ensure backend is running and restart backend after code changes."
      );
    } finally {
      setLoading(false);
    }
  }

  function addEmail(rawEmail) {
    const candidate = String(rawEmail || "").trim();
    if (!candidate) return;

    if (!isValidEmail(candidate)) {
      setError("Enter a valid email address.");
      return;
    }

    const exists = emails.some((email) => email.toLowerCase() === candidate.toLowerCase());
    if (exists) {
      setError("This email is already added.");
      return;
    }

    const nextEmails = [...emails, candidate];
    setEmails(nextEmails);
    setEmailInput("");
    setError("");
    void saveAlertSettings(nextEmails);
  }

  function removeEmail(emailToRemove) {
    const nextEmails = emails.filter((email) => email !== emailToRemove);
    setEmails(nextEmails);
    void saveAlertSettings(nextEmails);
  }

  async function saveAlertSettings(nextEmails = emails) {
    const normalizedEmails = Array.isArray(nextEmails) ? nextEmails : emails;
    try {
      setSaving(true);
      setError("");
      setStatus("");

      if (alertsEnabled && normalizedEmails.length === 0) {
        setError("Add at least one email when alerts are enabled.");
        setSaving(false);
        return;
      }

      const payload = await requestBackend("/alerts/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId || "*",
          emails: normalizedEmails,
          alerts_enabled: alertsEnabled,
          severity,
        }),
      });

      setEmails(Array.isArray(payload.emails) ? payload.emails : normalizedEmails);
      setAlertsEnabled(payload.alerts_enabled !== false);
      setSeverity(payload.severity || severity);
      setSourceLabel("db");
      setStatus("Alert settings saved successfully.");
      setToast("Settings saved");
    } catch (err) {
      setError(
        err.message ||
          "Could not save alert settings. Ensure backend is running and restart backend after code changes."
      );
    } finally {
      setSaving(false);
    }
  }

  async function testAlertConfiguration() {
    try {
      setTesting(true);
      setError("");
      setStatus("");
      const payload = await requestBackend(
        `/errors/test-alert?project_id=${encodeURIComponent(projectId || "*")}`
      );
      if (payload.success) {
        setStatus(payload.message || "Test alert email sent successfully.");
        setToast("Test successful");
      } else {
        setError(payload.message || "Test alert email failed.");
      }
    } catch (err) {
      setError(err.message || "Could not send test alert email.");
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "alerts" || hasLoadedOnce) return;
    loadAlertSettings();
  }, [activeTab, hasLoadedOnce]);

  useEffect(() => {
    if (activeTab !== "projects" || projectsLoaded) return;
    loadProjects();
  }, [activeTab, projectsLoaded]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  async function loadProjects() {
    try {
      setProjectsLoading(true);
      const data = await requestBackend("/projects");
      const list = Array.isArray(data?.projects) ? data.projects : [];
      setProjects(list);
      const nameMap = {};
      for (const p of list) {
        nameMap[p.project_id] = p.name || "";
      }
      setEditingName(nameMap);
      setProjectsLoaded(true);
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }

  function copyToClipboard(text, id) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  async function deleteProject(pid) {
    if (!window.confirm("Delete this project? This won't delete event data, just the project registration.")) return;
    setDeletingProject((prev) => ({ ...prev, [pid]: true }));
    try {
      await requestBackend(`/projects/${encodeURIComponent(pid)}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.project_id !== pid));
      setToast("Project deleted");
    } catch {
      setToast("Failed to delete project");
    } finally {
      setDeletingProject((prev) => ({ ...prev, [pid]: false }));
    }
  }

  async function saveProjectName(pid) {
    const name = String(editingName[pid] || "").trim();
    if (!name) return;
    setSavingName((prev) => ({ ...prev, [pid]: true }));
    try {
      await requestBackend(`/projects/${encodeURIComponent(pid)}/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setProjects((prev) =>
        prev.map((p) => (p.project_id === pid ? { ...p, name } : p))
      );
      setToast("Name saved");
    } catch {
      setToast("Failed to save name");
    } finally {
      setSavingName((prev) => ({ ...prev, [pid]: false }));
    }
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const data = await requestBackend("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (data?.project) {
        setCreatedProject(data.project);
        setNewProjectName("");
        setProjectsLoaded(false); // trigger reload
        setToast("Project created");
      }
    } catch {
      setToast("Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Configure dashboard behavior and operations.</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TabButton active={activeTab === "general"} onClick={() => setActiveTab("general")}>General</TabButton>
          <TabButton active={activeTab === "projects"} onClick={() => setActiveTab("projects")}>Projects</TabButton>
          <TabButton active={activeTab === "alerts"} onClick={() => setActiveTab("alerts")}>Alerts</TabButton>
        </div>
      </section>

      {activeTab === "general" ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-display text-lg font-semibold">General</h2>
            <p className="mt-2 text-sm text-slate-600">Environment: Local development</p>
            <p className="text-sm text-slate-600">Analytics API: https://analyticsapp2-production.up.railway.app/api</p>
            <p className="text-sm text-slate-600">Website app: https://your-production-website-url.com</p>
            <p className="text-sm text-slate-600">Dashboard app: https://your-production-dashboard-url.com</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-display text-lg font-semibold">Data Retention</h2>
            <p className="mt-2 text-sm text-slate-600">Configure cleanup policies in backend services as needed.</p>
          </article>
        </section>
      ) : null}

      {activeTab === "projects" ? (
        <section className="space-y-4">
          {/* Create new project */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-display text-lg font-semibold">Add New Site</h2>
            <p className="mt-1 text-sm text-slate-600">Create a project to get a unique ID for your SDK script tag.</p>
            <div className="mt-4 flex items-center gap-3">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createProject(); }}
                placeholder="e.g. CerviCare, Loan Website…"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={createProject}
                disabled={creatingProject || !newProjectName.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                {creatingProject ? "Creating…" : "Create Project"}
              </button>
            </div>

            {/* Show SDK snippet for the just-created project */}
            {createdProject && (
              <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-sm font-semibold text-green-800 mb-2">
                  ✓ &quot;{createdProject.name}&quot; created — paste this into your site&apos;s HTML:
                </p>
                <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all select-all">
{`<script
  src="${BASE_URL}/analytics.js"
  data-project-id="${createdProject.project_id}"
  data-endpoint="${BASE_URL}/api"
  defer
></script>`}
                </pre>
              </div>
            )}
          </div>

          {/* Existing projects */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-display text-lg font-semibold">Your Projects</h2>
                <p className="mt-1 text-sm text-slate-600">Rename projects and copy SDK snippets.</p>
              </div>
              <button
                type="button"
                onClick={() => { setProjectsLoaded(false); }}
                className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5"
              >
                Refresh
              </button>
            </div>

          {projectsLoading && (
            <p className="text-sm text-slate-500">Loading projects…</p>
          )}

          {!projectsLoading && projects.length === 0 && (
            <p className="text-sm text-slate-500">
              No projects yet. Create one above to get started.
            </p>
          )}

          {!projectsLoading && projects.length > 0 && (
            <div className="space-y-3">
              {projects.map((p) => {
                const snippet = `<script\n  src="${BASE_URL}/analytics.js"\n  data-project-id="${p.project_id}"\n  data-endpoint="${BASE_URL}/api"\n  defer\n></script>`;
                const isExpanded = expandedSnippet[p.project_id];
                return (
                  <div key={p.project_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {/* Top row: name + stats + actions */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <input
                          ref={(el) => { editRefs.current[p.project_id] = el; }}
                          type="text"
                          value={editingName[p.project_id] || ""}
                          onChange={(e) =>
                            setEditingName((prev) => ({ ...prev, [p.project_id]: e.target.value }))
                          }
                          onKeyDown={(e) => { if (e.key === "Enter") saveProjectName(p.project_id); }}
                          placeholder="Project name"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                        />
                        <button
                          type="button"
                          onClick={() => saveProjectName(p.project_id)}
                          disabled={savingName[p.project_id] || !String(editingName[p.project_id] || "").trim()}
                          className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
                        >
                          {savingName[p.project_id] ? "…" : "Rename"}
                        </button>
                        <span className="text-xs text-slate-500 ml-2">
                          {Number(p.event_count || 0).toLocaleString()} events
                          {p.last_seen ? ` · Last: ${new Date(p.last_seen).toLocaleDateString()}` : " · No events yet"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedSnippet((prev) => ({ ...prev, [p.project_id]: !isExpanded }))}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {isExpanded ? "Hide SDK" : "Show SDK"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProject(p.project_id)}
                          disabled={deletingProject[p.project_id]}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors"
                        >
                          {deletingProject[p.project_id] ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>

                    {/* Project ID row — always visible */}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">Project ID:</span>
                      <code className="text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-0.5 flex-1 break-all">
                        {p.project_id}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(p.project_id, `id-${p.project_id}`)}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        {copiedId === `id-${p.project_id}` ? "Copied!" : "Copy ID"}
                      </button>
                    </div>

                    {/* Expandable SDK snippet */}
                    {isExpanded && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-slate-600">Paste into your site&apos;s &lt;head&gt;:</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(snippet, `snip-${p.project_id}`)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            {copiedId === `snip-${p.project_id}` ? "Copied!" : "Copy snippet"}
                          </button>
                        </div>
                        <pre className="text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre select-all">
                          {snippet}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          </div>
        </section>
      ) : null}

      {activeTab === "alerts" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Alert Settings</h2>
            {prettySource ? <span className="text-xs text-slate-500">Loaded from: {prettySource}</span> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">Configure who gets notified when critical errors happen.</p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-1">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Project</span>
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="*"
              />
            </label>

            <label className="block md:col-span-1">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Severity</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="fatal">Fatal only</option>
                <option value="high">High + Fatal</option>
                <option value="all">All</option>
              </select>
            </label>

            <label className="flex items-end gap-2 md:col-span-1">
              <input
                type="checkbox"
                checked={alertsEnabled}
                onChange={(e) => setAlertsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">Enable Alerts</span>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">🔔 Recipients</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {emails.length === 0 ? <span className="text-sm text-slate-500">No emails added yet.</span> : null}
              {emails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  <span>{email}</span>
                  <button
                    type="button"
                    onClick={() => removeEmail(email)}
                    className="rounded-full px-1 text-slate-500 hover:bg-slate-200"
                    aria-label={`Remove ${email}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail(emailInput);
                  }
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm md:w-80"
                placeholder="name@company.com"
              />
              <button
                type="button"
                onClick={() => addEmail(emailInput)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add Email
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadAlertSettings}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? "Loading..." : "Reload"}
            </button>
            <button
              type="button"
              onClick={() => saveAlertSettings()}
              disabled={saving || loading}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            <button
              type="button"
              onClick={testAlertConfiguration}
              disabled={testing || loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {testing ? "Testing..." : "Test Alert"}
            </button>
          </div>

          {status ? <p className="mt-3 text-sm text-emerald-700">{status}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
      ) : null}

      {toast ? (
        <div className="fixed right-5 top-20 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
