import { useRef } from "react";
import { useResizablePanels } from "../../hooks/useResizablePanels";
import { SplitterHandle } from "../common/SplitterHandle";
import { FolderTree } from "../library/FolderTree";
import { TrackTable } from "../library/TrackTable";
import { AutomixPanel } from "../library/AutomixPanel";

/** The resizable 3-column lower bay: folder tree / track table / automix (ImplementationPlan §1). */
export function LowerBay() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { ratios, beginDrag, resetRatios } = useResizablePanels(containerRef);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <div style={{ width: `${ratios.left * 100}%` }} className="min-w-0 overflow-hidden">
        <FolderTree />
      </div>
      <SplitterHandle onDragStart={(clientX) => beginDrag("left", clientX)} onReset={resetRatios} />
      <div style={{ width: `${ratios.center * 100}%` }} className="min-w-0 overflow-hidden">
        <TrackTable />
      </div>
      <SplitterHandle
        onDragStart={(clientX) => beginDrag("right", clientX)}
        onReset={resetRatios}
      />
      <div style={{ width: `${ratios.right * 100}%` }} className="min-w-0 overflow-hidden">
        <AutomixPanel />
      </div>
    </div>
  );
}
