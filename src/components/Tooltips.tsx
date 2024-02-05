import { Tooltips as TS } from "@/utils";
import { Tooltip } from "react-tooltip";

export const Tooltips = () => {
    return (
        <>
            {Object.values(TS).map((t, idx) => (
                <Tooltip id={t} key={idx} />
            ))}
        </>
    );
};
