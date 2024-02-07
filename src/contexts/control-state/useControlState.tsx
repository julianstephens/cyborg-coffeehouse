import { useContext } from "react";
import { ControlContext } from "./ControlStateProvider";

export const useControlState = () => {
    const context = useContext(ControlContext);

    if (!context) {
        throw new Error(
            "useControlContext must be used within a ControlBarProvider",
        );
    }

    return context;
};
