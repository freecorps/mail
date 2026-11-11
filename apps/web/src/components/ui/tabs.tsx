// shadcn/ui Tabs (Radix), customized: underlined tabs ("line"), not the boxed segmented look. The active tab gets the
// foreground color and a 2px underline that sits on the container's bottom hairline; nothing slides (filters change
// from the keyboard too, and keyboard actions are never animated).
import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex items-stretch gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-1.5 text-ui font-medium whitespace-nowrap text-muted-foreground outline-none",
        "transition-colors duration-(--motion-hover) hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent",
        "data-[state=active]:text-foreground data-[state=active]:after:bg-foreground",
        "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
