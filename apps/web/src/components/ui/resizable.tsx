// shadcn/ui Resizable (react-resizable-panels v4), customized: the handle is the pane's hairline. Hovering or dragging it
// thickens it to 2px in the ring color (the library keeps a wider hit area), with no grip icon; arrow keys resize it
// when focused.
import * as ResizablePrimitive from "react-resizable-panels";
import { cn } from "@/lib/utils";

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({ className, ...props }: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative z-10 flex w-px items-center justify-center bg-border outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors after:duration-(--motion-hover)",
        "data-[separator=hover]:after:bg-ring/50 data-[separator=active]:after:bg-ring focus-visible:after:bg-ring",
        className,
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
export { usePanelRef, type PanelImperativeHandle, type PanelSize } from "react-resizable-panels";
