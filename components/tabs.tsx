"use client";

import { cn } from "@/lib/cn";

export interface TabItem {
  key: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Accessible tabs. Renders all panels but hides inactive ones via the `hidden`
 * attribute (not unmounting) so a tab's fetched list / MeshCentral iframe don't
 * refetch/reload on every switch.
 */
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div
        role="tablist"
        aria-label="Detail sections"
        className="flex gap-1 border-b border-border"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.key}`}
              onClick={() => onChange(tab.key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-brand-600 text-brand-700 dark:text-brand-300"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={`panel-${tab.key}`}
            aria-labelledby={`tab-${tab.key}`}
            hidden={!isActive}
            className="pt-6"
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}