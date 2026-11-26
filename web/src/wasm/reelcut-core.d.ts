/* tslint:disable */
/* eslint-disable */

/**
 * Cut a time range out of a timeline given as JSON, and return the
 * new timeline as JSON. Returns an empty string when the input does
 * not parse.
 */
export function wasm_cut_range(timeline_json: string, start: number, end: number): string;

/**
 * Cut a timeline given as JSON down to its first `target` seconds,
 * and return the new timeline as JSON. Returns an empty string when
 * the input does not parse.
 */
export function wasm_cutdown(timeline_json: string, target: number): string;

/**
 * Silence detection for the browser. Takes a Float32Array of
 * amplitudes and returns a JSON array of {start, end} ranges.
 */
export function wasm_detect_silence(samples: Float32Array | number[], sample_rate: number, threshold: number, min_silence_ms: number): string;

/**
 * Total duration of a timeline given as JSON. Returns -1 when the
 * JSON does not parse.
 */
export function wasm_timeline_duration(timeline_json: string): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasm_cut_range: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_cutdown: (a: number, b: number, c: number) => [number, number];
    readonly wasm_detect_silence: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasm_timeline_duration: (a: number, b: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
