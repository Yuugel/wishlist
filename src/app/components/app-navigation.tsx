"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: "heart" | "people" | "sparkles" | "person";
};

const navigationItems: NavigationItem[] = [
  { href: "/wishlist", label: "Meine Wunschliste", shortLabel: "Wünsche", icon: "heart" },
  { href: "/groups", label: "Gruppen", shortLabel: "Gruppen", icon: "people" },
  { href: "/activity", label: "Activity", shortLabel: "Activity", icon: "sparkles" },
  { href: "/account", label: "Konto", shortLabel: "Konto", icon: "person" },
];

function NavigationIcon({ icon }: { icon: NavigationItem["icon"] }) {
  const paths = {
    heart: <path d="M12 20.2S4.5 16 4.5 9.8A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 7.5 2.9C19.5 16 12 20.2 12 20.2Z" />,
    people: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3" /><path d="M17 11a3 3 0 1 0 0-6m5 15v-1.5a4 4 0 0 0-3-3.87" /></>,
    sparkles: <><path d="m12 3 1.35 3.65L17 8l-3.65 1.35L12 13l-1.35-3.65L7 8l3.65-1.35L12 3Z" /><path d="m5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14Zm13-1 .9 2.1 2.1.9-2.1.9L18 19l-.9-2.1L15 16l2.1-.9L18 13Z" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  };

  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      {paths[icon]}
    </svg>
  );
}

function isCurrentPath(pathname: string, href: string): boolean {
  return pathname === href || (href === "/groups" && pathname.startsWith("/groups/"));
}

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={mobile ? "mobile-navigation" : "desktop-navigation"} aria-label="Hauptnavigation">
      {navigationItems.map((item) => {
        const current = isCurrentPath(pathname, item.href);
        return (
          <Link
            className="navigation-link"
            href={item.href}
            key={item.href}
            aria-current={current ? "page" : undefined}
          >
            <NavigationIcon icon={item.icon} />
            <span>{mobile ? item.shortLabel : item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
