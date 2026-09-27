import { replaceEqualDeep } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Returns `value`, but keeps the previous reference (and the references of
 * any deep-equal parts) when nothing changed. The previous value lives in
 * state rather than a ref so it is never read from a ref during render. See
 * https://react.dev/reference/react/useState#storing-information-from-previous-renders
 */
export function useStable<T>(value: T): T {
  const [stable, setStable] = useState(() => value);
  const next = replaceEqualDeep(stable, value);
  if (next !== stable) {
    setStable(() => next);
  }
  return next;
}
