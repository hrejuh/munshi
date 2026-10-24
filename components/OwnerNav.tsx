"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Props {
  labels: { home: string; products: string; orders: string; settings: string };
  newOrders: number;
}

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  products: <path d="M4 7h16l-1.5 13h-13zM8 7a4 4 0 0 1 8 0" />,
  orders: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .2-1.2-1.2L17 5l-3-1-1 2h-2L10 4 7 5l.2 2L6 8.2 4 8l-1 3 2 1v0l-2 1 1 3 2-.2 1.2 1.2L7 19l3 1 1-2h2l1 2 3-1-.2-2 1.2-1.2 2 .2 1-3z" />,
};

export function OwnerNav({ labels, newOrders }: Props) {
  const path = usePathname();
  const items = [
    { href: "/app", key: "home", label: labels.home },
    { href: "/app/products", key: "products", label: labels.products },
    { href: "/app/orders", key: "orders", label: labels.orders },
    { href: "/app/settings", key: "settings", label: labels.settings },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((item) => {
          const active = item.href === "/app" ? path === "/app" : path.startsWith(item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold ${active ? "text-ink" : "text-mute"}`}
                aria-current={active ? "page" : undefined}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.7} strokeLinejoin="round" strokeLinecap="round">
                  {ICONS[item.key]}
                </svg>
                {item.label}
                {item.key === "orders" && newOrders > 0 && (
                  <span className="absolute right-[28%] top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sindoor px-1 text-[11px] text-white">
                    {newOrders}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
