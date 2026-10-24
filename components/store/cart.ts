"use client";

import { useCallback, useEffect, useState } from "react";

export type Cart = Record<string, number>;

const key = (slug: string) => `munshi-cart-${slug}`;

function read(slug: string): Cart {
  try {
    const raw = localStorage.getItem(key(slug));
    return raw ? (JSON.parse(raw) as Cart) : {};
  } catch {
    return {};
  }
}

/** Per-shop cart kept in the browser; prices are always re-read from the server at checkout. */
export function useCart(slug: string) {
  const [cart, setCart] = useState<Cart>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setCart(read(slug));
    setLoaded(true);
  }, [slug]);

  const persist = useCallback(
    (next: Cart) => {
      setCart(next);
      try {
        localStorage.setItem(key(slug), JSON.stringify(next));
      } catch {
        /* private mode: cart just won't survive a reload */
      }
    },
    [slug],
  );

  const setQty = useCallback(
    (productId: string, qty: number) => {
      const next = { ...read(slug) };
      if (qty <= 0) delete next[productId];
      else next[productId] = Math.min(99, qty);
      persist(next);
    },
    [persist, slug],
  );

  const addMany = useCallback(
    (lines: Array<{ productId: string; qty: number }>) => {
      const next = { ...read(slug) };
      for (const l of lines) next[l.productId] = Math.min(99, (next[l.productId] ?? 0) + l.qty);
      persist(next);
    },
    [persist, slug],
  );

  const clear = useCallback(() => persist({}), [persist]);

  return { cart, loaded, setQty, addMany, clear };
}
