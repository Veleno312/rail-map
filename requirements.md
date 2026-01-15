We need a repair pass, not new features. Things used to work: tracks displayed, and Build Track/Build Line worked. Now they don’t.

PRIORITY 1 — Restore track rendering between stations (must match prior behavior)
1) Find the last-known working rendering path for tracks:
   - Identify the layer group / function that used to draw track polylines (e.g., in app/map_layers.js or similar).
   - Restore that same approach: tracks must render as polylines connecting station coordinates (or rail node coords if using rail_nodes).
2) Ensure the track layer is actually populated:
   - Verify state.tracks (or state.railLinks) contains edges at runtime.
   - Add a console/debug panel line showing track count and sample edge IDs so we can confirm data exists.
3) Fix coordinate source:
   - If tracks are station-to-station edges: draw from station.lat/lon.
   - If tracks are rail_nodes links: draw from rail_node lat/lon.
   - If both exist, prefer rail_nodes for “infra” layer, and station-to-station for “line routes”.
4) Ensure track rendering is not gated incorrectly:
   - Check zoom thresholds, viewMode, mapLayers flags, and Metro mode toggles.
   - Track layer must be visible by default in the mode where it previously worked.

Acceptance:
- With real infra JSON present OR fallback, I can see tracks on the map without clicking anything.
- Track count in debug panel is > 0 and polylines are drawn.

PRIORITY 2 — Fix Build Track and Build Line tools (currently unusable)
Goal: I can create tracks and lines again.

Do this systematically:
1) Identify the tool state machine:
   - What variable controls current tool/mode? (e.g. state.tool / state.mode)
   - What click handler receives map clicks? Confirm it’s still wired.
2) Restore selection flow:
   Build Track:
   - click station A -> store selectedA
   - click station B -> store selectedB -> create track edge -> clear selection
   Build Line:
   - click stations to append to pendingStops
   - show pendingStops count in UI
   - “Commit line” button creates a line and clears pending
3) Fix any broken references:
   - station IDs must be used consistently
   - line stops must be station IDs only
4) Add minimal in-app debug UI (dev-only) to confirm input works:
   - current tool
   - selectedA/selectedB
   - pending line stop count
5) After fixing, run this manual script yourself in code (not a test framework):
   - On app load: log “builder ready”
   - When station clicked in builder mode: log which station ID
   so we can see events firing.

Acceptance:
- Build Track: click two stations => track polyline appears, track count increments.
- Build Line: click 3+ stations => line appears in list and on map, no errors.
- Save/reload preserves both.

PRIORITY 3 — Revert the tabs UI to icon-only (symbols)
Goal: Tabs should be just a symbol again (no text labels) as they were before.

Implementation:
- Find the tabs component (likely in app/ui.js).
- Remove text labels from the tab buttons; keep aria-label/tooltips for accessibility.
- Ensure the icons remain and layout doesn’t shift.
- If there was an earlier commit that had icon-only tabs, match that style.

PRIORITY 4 — Verification
- Run: npm run lint
- Run: npm run test:golden (or test:regression)
- Fix failures.
- Provide a short summary: what broke tracks/builders, what was restored, and what file(s) changed.

IMPORTANT:
Do not introduce new architecture changes; focus on restoring previously working behavior.
If you’re unsure why it broke, search the repo for the track rendering function and builder handlers and compare to earlier logic; restore the missing wiring and state.
