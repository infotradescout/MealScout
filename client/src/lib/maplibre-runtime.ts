/** Shared browser entry for both Scout maps. Vite must bundle the worker's
 * shared-module dependency; a plain ?url asset works in dev but breaks builds.
 * https://maplibre.org/maplibre-gl-js/docs/#esm
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

export * from "maplibre-gl";
