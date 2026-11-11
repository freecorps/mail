import type { ReactNode } from "react";
import type { IconSpec } from "../icons";

export interface SegmentedProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
  /** Spoken name of the control (the segments speak their own labels). */
  label: string;
}

export interface EmptyStateProps {
  icon: IconSpec;
  title: string;
  body?: string | undefined;
  actions?: Array<{ label: string; onPress(): void; prominent?: boolean; destructive?: boolean }>;
}

export interface RowMenuAction {
  label: string;
  icon: IconSpec;
  destructive?: boolean;
  onPress(): void;
}

export interface RowMenuProps {
  /** The row; long-press (Android) or the system context menu (iOS) shows `actions`. */
  children: ReactNode;
  title: string;
  actions: RowMenuAction[];
  href: string;
  disabled?: boolean;
  /** iOS: show the destination as the context menu's preview (default true). */
  preview?: boolean;
}

export interface IconButtonProps {
  icon: IconSpec;
  label: string;
  onPress(): void;
  disabled?: boolean;
}

export interface ListFilterProps<T extends string> {
  filters: Array<{ value: T; label: string }>;
  value: T;
  onChange(v: T): void;
  /** Spoken name of the filter control (and the iOS menu's title). */
  label: string;
}

export interface ListActionsProps<T extends string> {
  /** Filters for the iOS navigation bar menu (Android shows them as chips in the list header instead). */
  filter?: ListFilterProps<T> | undefined;
  compose: { label: string; onPress(): void };
  /** Enters Edit mode ("Editar" in the iOS navigation bar, a select action in the Android top app bar). */
  edit?: { label: string; onPress(): void } | undefined;
}

export interface UndoBannerProps {
  /** Reduce Motion: fade, no rise. */
  reduced: boolean;
}

export interface LabeledPickerProps<T extends string | number> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
}
