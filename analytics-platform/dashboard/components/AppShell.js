import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useState, useRef, useEffect } from "react";
import { Icons } from "./ui/Icons";
import { Button } from "./ui/Button";
import { useWorkspace } from "@/context/WorkspaceContext";
import { fetchAnalytics } from "@/utils/backendClient";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/charts-analysis", label: "Analysis" },
  { href: "/funnels", label: "Funnels" },
  { href: "/heatmaps", label: "Heatmaps" },
  { href: "/user-journeys", label: "Journeys" },
  { href: "/session-replays", label: "Replay" },
  { href: "/errors", label: "Errors" },
];

const RANGE_OPTIONS = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Custom", value: "custom" },
];

export default function AppShell({ children }) {
  const router = useRouter();
  const { projectId, setProjectId } = useWorkspace();
  const [range, setRange] = useState("7d");
  const [searchText, setSearchText] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [projects, setProjects] = useState([]);
  const userInitials = useMemo(() => "AN", []);

  const filterRef = useRef(null);

  // The human-readable label for the currently selected project
  const selectedProjectLabel = useMemo(() => {
    if (!projectId) return "All Sites";
    const match = projects.find((p) => p.project_id === projectId);
    return match?.name || projectId;
  }, [projectId, projects]);

  // Close filters panel on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load available projects on mount
  useEffect(() => {
    fetchAnalytics("/projects", { skipCache: true })
      .then((data) => {
        const list = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(list);
        // If nothing is persisted yet, auto-select the most recently active project
        const currentProject = typeof window !== "undefined"
          ? localStorage.getItem("analytics_active_project")
          : null;
        if (!currentProject && list.length > 0) {
          setProjectId(list[0].project_id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900 flex flex-col">
      {/* Top Header / Nav */}
      <header className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="layout-container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center text-white font-bold shadow-sm group-hover:shadow group-hover:-translate-y-[1px] transition-all">
                A
              </div>
              <span className="font-semibold text-lg tracking-tight">Analytics</span>
            </Link>
            
            <nav className="hidden md:flex items-center space-x-1">
              {NAV_ITEMS.map((item) => {
                const active = router.pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors duration-200 ${
                      active ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Site selector — always visible */}
            <div className="flex items-center gap-1.5">
              <Icons.Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={projectId || ""}
                onChange={(e) => setProjectId(e.target.value || null)}
                className={`h-8 pl-2 pr-7 rounded-lg border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[180px] ${
                  projectId
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
                title="Select project"
              >
                <option value="">All Sites (unfiltered)</option>
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.name || p.project_id}
                  </option>
                ))}
              </select>
            </div>
            <div className="hidden md:flex relative group">
              <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search..."
                className="w-48 lg:w-64 h-9 pl-9 pr-4 rounded-full border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all hover:bg-white"
              />
            </div>
            
            <Link href="/settings">
              <Button variant="icon" className="h-9 w-9">
                <Icons.Settings className="w-4 h-4" />
              </Button>
            </Link>

            <button
              className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
            >
              {userInitials}
            </button>
          </div>
        </div>
      </header>
      
      {/* Sub Header / Controls */}
      <div className="bg-white border-b border-slate-200 shadow-sm relative z-30">
        <div className="layout-container py-3 flex items-center justify-between relative">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            {/* Context breadcrumbs or title could go here */}
            <h1 className="font-medium text-slate-900 capitalize">
              {router.pathname === "/" ? "Overview" : router.pathname.slice(1).replace("-", " ")}
            </h1>
          </div>
          
          <div className="flex items-center gap-2 relative" ref={filterRef}>
            {/* The Filters Button */}
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters ? "bg-slate-50 border-slate-300" : ""}
            >
              <Icons.Filter className="w-4 h-4 mr-2" />
              Filters
              <Icons.ChevronDown className={`w-3 h-3 ml-2 transition-transform duration-200 ${showFilters ? "rotate-180" : ""}`} />
            </Button>
            
            {/* Filters Dropdown Panel */}
            {showFilters && (
              <div className="absolute top-full mt-2 right-0 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4 animate-fade-in z-50">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">Global Range</h3>
                  <select
                    value={range}
                    onChange={(e) => setRange(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {RANGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {range === "custom" && (
                  <div className="mb-4 space-y-2 animate-fade-in">
                    <label className="text-xs font-medium text-slate-500">Custom Range</label>
                    <div className="flex items-center gap-2">
                      <input type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <span className="text-slate-400 text-xs text-center w-6">to</span>
                      <input type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  </div>
                )}
                
                <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowFilters(false)}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => setShowFilters(false)}>Apply</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* "All Sites" warning — shown when no project is active */}
      {!projectId && projects.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-800 text-xs">
            <span className="font-semibold">Showing data from all sites.</span>
            <span className="text-amber-600">Select a project above to isolate one site&apos;s data.</span>
          </div>
          <button
            type="button"
            onClick={() => projects.length > 0 && setProjectId(projects[0].project_id)}
            className="text-xs font-medium text-amber-700 underline hover:text-amber-900 whitespace-nowrap"
          >
            Use &quot;{projects[0]?.name || projects[0]?.project_id}&quot;
          </button>
        </div>
      )}

      <main key={projectId || "__all__"} className="flex-1 layout-container py-8 animate-fade-in">
        {children}
      </main>
    </div>
  );
}

