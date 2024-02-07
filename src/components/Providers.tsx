import { ControlStateProvider } from "@/contexts/control-state";
import type { ChildrenProps } from "@/types";

export const Providers = ({ children }: ChildrenProps) => (
    <ControlStateProvider>{children}</ControlStateProvider>
);
