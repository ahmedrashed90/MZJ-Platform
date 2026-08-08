import { useOutletContext } from "react-router-dom";
import type { OperationsOutletContext } from "./OperationsLayout";
export function useOperations() { return useOutletContext<OperationsOutletContext>(); }
