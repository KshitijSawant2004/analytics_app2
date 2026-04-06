import { Button } from "@/components/ui/Button";
import { Icons } from "@/components/ui/Icons";

export default function AnalysisEmptyState({ onSelectEvent }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <div className="mb-4 rounded-full bg-slate-100 p-3 text-slate-500">
        <Icons.BarChart className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900">Build your first analysis</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">Select an event to start exploring your data</p>
      <Button type="button" variant="primary" className="mt-5" onClick={onSelectEvent}>
        Select Event
      </Button>
    </div>
  );
}
