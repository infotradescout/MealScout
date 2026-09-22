import { useState } from "react";
import EvidencePage from "./admin-discovery-evidence";
import TrafficQualityPanel from "@/components/TrafficQualityPanel";

export default function AdminDiscoveryObservatory() {
  const [view,setView]=useState<"quality"|"evidence">("quality");
  const [opened,setOpened]=useState(false);
  return <div className="container mx-auto max-w-7xl px-4 py-6" data-testid="discovery-quality-workspace">
    <nav aria-label="Discovery views" className="flex flex-wrap gap-3">
      <button type="button" aria-pressed={view==="quality"} onClick={()=>setView("quality")} className="min-h-11 rounded-md border px-4 aria-pressed:bg-muted">Traffic quality</button>
      <button type="button" aria-pressed={view==="evidence"} onClick={()=>{setOpened(true);setView("evidence");}} className="min-h-11 rounded-md border px-4 aria-pressed:bg-muted">Existing evidence</button>
    </nav>
    <div hidden={view!=="quality"}><TrafficQualityPanel /></div>
    {opened ? <div hidden={view!=="evidence"}><p role="note" className="mt-6 rounded-md border p-4 text-sm">This preserved view contains unfiltered records. Its historical page “impressions” are recorded landings, not Google impressions or verified people. Use Traffic quality for explicit exclusions; general request/profile evidence expires after 48 hours.</p><EvidencePage /></div>:null}
  </div>;
}
