# Context

**Current Task:** Code-tab nav redesign — Insert & Favorites became column megamenus with plugin cross-filter; navbar equal-height; Cmd+K palette padding. Built, installed to /Applications, launched. Committed on branch `ui/code-megamenu-columns` (NOT merged/pushed).

**Key Decisions:**

- Insert = 5 live columns (Plugins|MCP|Commands|Agents|Skills); click a Plugin → `selectedSource` cross-filters the other 4 by `item.source === plugin.name` (✕ chip clears). Leaves still insert. Category pills removed.
- Favorites = 4-column megamenu (Skills|Agents|Commands|MCP); category inferred at render from invocation text — no localStorage schema change. Both share one drawer (old compact popover gone).
- Navbar controls unified to `h-9`; cmdk palette (`index.css` `[cmdk-*]`) roomier. Doc: `docs/ask-work-center.md` §6.

**Next Steps:**

- Merge `ui/code-megamenu-columns` → main + push when ready; delete branch.
- Decide: should Favorites drawer also show a Plugins column (currently leaf-only)?
- Old app rollback backup `/tmp/Coruro-old-1782199964.app` — delete once new build confirmed good.
