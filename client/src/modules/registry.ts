import {
  BarChart3,
  Cable,
  Diamond,
  Home,
  ListChecks,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ModuleId } from "@/mock/types";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Settings sits pinned at the bottom of the rail. */
  pinned?: "bottom";
}

/**
 * The rail renders from this array, filtered by per-module enabled flags
 * from app state: unchosen modules are absent, chosen-but-empty dimmed.
 */
export const moduleRegistry: readonly ModuleDef[] = [
  { id: "home", label: "Home", path: "/", icon: Home },
  { id: "competitors", label: "Competitors", path: "/competitors", icon: Users },
  { id: "customers", label: "Customers", path: "/customers", icon: BarChart3 },
  { id: "strategy", label: "Strategy", path: "/strategy", icon: Diamond },
  { id: "roadmap", label: "Roadmap", path: "/roadmap", icon: ListChecks },
  {
    id: "connections",
    label: "Connections",
    path: "/connections",
    icon: Cable,
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    pinned: "bottom",
  },
];
