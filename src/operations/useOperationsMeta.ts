import { useEffect,useState } from "react";
import { operationsFetch,formatOperationsError } from "./api";
import type { OperationLocation,OperationStatus } from "./types";
export function useOperationsMeta(){const [locations,setLocations]=useState<OperationLocation[]>([]);const [statuses,setStatuses]=useState<OperationStatus[]>([]);const [error,setError]=useState("");useEffect(()=>{operationsFetch<{locations:OperationLocation[];statuses:OperationStatus[]}>("meta").then(r=>{setLocations(r.locations);setStatuses(r.statuses);}).catch(e=>setError(formatOperationsError(e)));},[]);return{locations,statuses,error};}
