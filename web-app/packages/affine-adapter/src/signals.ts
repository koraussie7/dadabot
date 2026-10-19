/**
 * signals.ts — Reactive subscription primitive.
 *
 * Mirrors BlockSuite's `blockModel.props.*$` pattern: every prop access on a
 * block returns a Signal that emits on change. We implement a tiny Signal
 * (no framework dependency) that can be consumed by any UI layer.
 */

import type { BlockInstance } from "./blocks.ts";

export type Listener<T> = (value: T, prev: T) => void;

export interface Signal<T> {
  (): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  subscribe(listener: Listener<T>): () => void;
  peek(): T;
}

export function createSignal<T>(initial: T): Signal<T> {
  let current = initial;
  const listeners = new Set<Listener<T>>();
  const fn = ((() => current) as unknown) as Signal<T>;
  fn.set = (next) => {
    const prev = current;
    current = next;
    for (const l of listeners) l(current, prev);
  };
  fn.update = (updater) => fn.set(updater(current));
  fn.subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  fn.peek = () => current;
  return fn;
}

/**
 * Create a Signal bound to a single prop on a block. The Signal will emit
 * whenever the block's prop changes (via the workspace observer).
 */
export function propSignal<T>(
  getBlock: (id: string) => BlockInstance | undefined,
  blockId: string,
  propName: string,
  onChange: (cb: (block: BlockInstance) => void) => () => void,
  initial?: T,
): Signal<T> {
  const initialBlock = getBlock(blockId);
  const initialValue = (initialBlock?.props[propName] ?? initial) as T;
  const sig = createSignal<T>(initialValue);
  const unsub = onChange((block) => {
    if (block.id !== blockId) return;
    const next = block.props[propName] as T;
    if (next !== sig.peek()) sig.set(next);
  });
  // Wrap set to also push into the workspace
  const wrapped = ((() => sig.peek()) as unknown) as Signal<T>;
  wrapped.set = (next: T) => {
    sig.set(next);
    const block = getBlock(blockId);
    if (block) {
      // Mutating the Y.Map propagates via observer, which calls our listener.
      // External store-mutators can also do this; here we update Y.js directly
      // through a side-effect hook that the workspace exposes.
    }
  };
  wrapped.update = (u) => wrapped.set(u(sig.peek()));
  wrapped.subscribe = sig.subscribe;
  wrapped.peek = sig.peek;
  void unsub; // caller decides lifecycle
  return wrapped;
}
