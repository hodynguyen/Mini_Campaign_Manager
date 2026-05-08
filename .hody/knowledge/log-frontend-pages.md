---
tags: [log, ui-change, frontend, react]
date: 2026-05-08
author-agent: start-feature
status: completed
---

# Feature Log: F5 — Frontend pages + UX polish

Type: ui-change
Started: 2026-05-08
Mode: auto

## Spec
-> spec-frontend-pages.md

## Agent Work

### architect — F5 frontend scaffolding

- Files created (skeletons with TODO bodies and locked JSDoc contracts):
  - `apps/web/src/pages/LoginPage.tsx`
  - `apps/web/src/pages/RegisterPage.tsx`
  - `apps/web/src/pages/CampaignsListPage.tsx`
  - `apps/web/src/pages/CampaignNewPage.tsx`
  - `apps/web/src/pages/CampaignDetailPage.tsx`
  - `apps/web/src/components/StatsBlock.tsx` (props interface only; body TODO)
  - `apps/web/src/components/RecipientsTable.tsx` (props interface only; body TODO)
  - `apps/web/src/components/CampaignActions.tsx` (props interface only; body TODO)
  - `apps/web/src/hooks/useAuth.ts` (`declare function` exports; frontend implements)
  - `apps/web/src/hooks/useCampaigns.ts` (`declare function` exports; frontend implements)
- Files created (FILLED IN — not skeletons):
  - `apps/web/src/components/ProtectedRoute.tsx` — small enough; logic locked.
  - `apps/web/src/components/StatusBadge.tsx` — `STATUS_MAP` color/label table per spec.
  - `apps/web/src/components/ErrorAlert.tsx` — uses `messageFor(code, fallback)`.
  - `apps/web/src/types/api-error.ts` — `ERROR_MESSAGES` map + `messageFor` + `isApiErrorResponse` type guard. Re-exports `ApiError` from `@app/shared`.
- Files modified:
  - `apps/web/src/App.tsx` — replaced F1 placeholder Home with the locked routing shell (6 routes + 2 redirects).
  - `apps/web/src/store/auth.ts` — renamed `setAuth/clear` to spec's `login(auth)/logout()`; added `User` import from `@app/shared` so the store reuses the canonical type.
  - `apps/web/src/lib/api.ts` — kept axios instance; added the FULL request- and response-interceptor contract as JSDoc TODOs that frontend implements (token injection from `useAuthStore.getState().token`; on 401, logout + `window.location.href = '/login'`).
  - `apps/web/src/App.test.tsx` — F1 placeholder assertion replaced with a routing smoke that asserts unauthenticated `/` redirects to LoginPage (asserts on the `TODO: LoginPage` skeleton marker so the test stays green during BUILD).
- KB updated:
  - `.hody/knowledge/architecture.md` — appended **"F5 Frontend — Locked Decisions"** section: file map, component diagram, error-code map authority, status-color map authority, polling rule, hook signatures + queryKeys, axios interceptor contract, routing shell, F4 carry-forward UX rules, out-of-scope list, deviations.
- Key decisions (architect-locked):
  - **Hook signatures and queryKeys are locked** (`['campaigns', {page,limit,status}]` for the list, `['campaign', id]` for the detail). Mutations invalidate / setQueryData using these exact keys so the polling and the list refresh can be reasoned about across files.
  - **Polling is gated by BOTH `opts.polling` AND cached `data?.status === 'sending'`** — a function-form `refetchInterval` that returns `1500` only when both are true, `false` otherwise. Background tabs do NOT poll (`refetchIntervalInBackground: false`).
  - **Axios 401 handler uses `window.location.href`, not React Router** — interceptors run outside the React tree, so `useNavigate` is unavailable. A hard redirect is acceptable UX for an in-memory-only auth model and avoids the complexity of registering a navigate callback from a top-level useEffect.
  - **`declare function` exports for the hooks** — keeps `tsc -b` clean while signaling clearly that frontend owns the implementations. No runtime stub means a missing implementation will produce a runtime error rather than a silent no-op, which is the safer failure mode during BUILD.
  - **`ProtectedRoute`, `StatusBadge`, `ErrorAlert`, `api-error.ts` are filled in NOW** (not skeletons) — they're small, have no business logic that requires running code to validate, and frontend would otherwise re-discover the same shape. Locking them here removes a branching point for the frontend agent.
  - **F1 store keys renamed `setAuth/clear` -> `login/logout`** — strict superset of the F1 placeholder (no other file in the repo referenced the old names; verified by grep before changing). Aligns with the spec's locked store skeleton.
- Hand-off notes for **frontend** (BUILD):
  - Files to fill (TODO bodies):
    - All five pages in `apps/web/src/pages/`.
    - `StatsBlock.tsx`, `RecipientsTable.tsx`, `CampaignActions.tsx` in `apps/web/src/components/`.
    - Both hook files in `apps/web/src/hooks/` — replace the `declare function` exports with real implementations.
    - `apps/web/src/lib/api.ts` — wire the two interceptors per the JSDoc contract; keep the `api` named export.
  - Files NOT to change without consulting architect:
    - `apps/web/src/App.tsx` route shell.
    - `apps/web/src/components/ProtectedRoute.tsx`, `StatusBadge.tsx`, `ErrorAlert.tsx`.
    - `apps/web/src/types/api-error.ts` (`ERROR_MESSAGES` map + `messageFor`).
    - `apps/web/src/store/auth.ts` (locked `login/logout` shape).
  - **Critical UX rules (do not violate):**
    1. Pattern-match on `error.code`, NEVER on `error.message`. Always go through `messageFor(code, fallback)`.
    2. The Send response is 202 + `{ status: 'sending' }`. UI must NOT mark the campaign as `sent` on the mutation success — let polling carry it.
    3. Polling: `useCampaign(id, { polling: true })` self-stops as soon as status leaves `sending`. Detail page passes `polling: data?.status === 'sending'`.
    4. Open-tracking is silent 204 — re-fetch `['campaign', id]` to refresh stats; no per-call success signal exists.
  - **Imports the BUILD will need** (already installed in F1):
    - `axios` for the typed POST/GET helpers off the shared `api` instance.
    - `@tanstack/react-query` `useQuery`, `useMutation`, `useQueryClient`.
    - `antd` `Form`, `Input`, `Button`, `Table`, `Tag`, `Skeleton`, `Result`, `Empty`, `Alert`, `notification`, `Statistic`, `Progress`, `Popconfirm`, `DatePicker`, `Card`, `Row`, `Col`, `Space`, `Typography`.
    - `@ant-design/icons` for action button icons (optional polish).
    - `react-router-dom` `useParams`, `useNavigate`, `Link`, `useSearchParams`.
  - Recipient_emails parsing: split on `[,\n]`, trim, drop empties, lowercase, dedupe via `Set`. Server validates email shape via zod — surface the resulting VALIDATION_ERROR via `messageFor`.
  - DatePicker -> ISO 8601 with offset: `dayjs(value).toISOString()` works (UTC `Z`); the schedule schema uses `.datetime({ offset: true })` which accepts `Z`. Past-time check is server-side (SCHEDULED_AT_IN_PAST) — frontend can ALSO disable past dates via DatePicker `disabledDate` for UX.
- Hand-off notes for **unit-tester** (VERIFY):
  - Spec calls for ≥4 component tests:
    1. `StatusBadge` — render each of the 4 statuses; assert the `Tag` has the right `color` prop (or rendered className) per the locked map.
    2. `LoginPage` happy — fill creds, submit, mock axios POST /auth/login -> 200, assert `useAuthStore.getState().token` set + navigate to `/campaigns`.
    3. `LoginPage` 401 — mock POST /auth/login -> 401 INVALID_CREDENTIALS, assert the rendered alert text is "Invalid email or password." (i.e. `messageFor` translation, NOT the raw `err.message`).
    4. `CampaignDetailPage` send flow — mock GET /campaigns/:id status=draft, click Send, mock POST /:id/send -> 202 sending, advance polling, mock next GET -> status=sent, assert StatsBlock receives the new stats.
  - Use msw if quick to set up; otherwise vi.mock the `api` axios module directly. The spec says "msw if not too time-consuming".
  - Reset zustand state between tests: `useAuthStore.setState({ token: null, user: null })` in `beforeEach`. The store has no built-in `reset` — re-setState is the canonical pattern.
  - Wrap rendered components with `MemoryRouter` + `QueryClientProvider` (with a fresh per-test `QueryClient`). Don't reuse the production `queryClient` across tests — its cache leaks.
- Build/lint/test status at the end of THINK:
  - `yarn workspace @app/web build` — clean (`tsc -b` 0 errors, vite build 270.14 kB / 89.76 kB gzip).
  - `yarn lint` — 0 errors, 1 pre-existing unrelated warning in `apps/api/src/db/sequelize.ts` (not introduced by F5).
  - `yarn workspace @app/web test` — 1/1 passes (the routing smoke).
- Open questions / risks: none. Frontend has explicit signatures + JSDoc to follow; no ambiguity left.

### frontend — F5 implementation

- Files modified (filled in skeleton bodies; signatures unchanged):
  - `apps/web/src/lib/api.ts` — wired both interceptors per the architect contract. Request: injects `Authorization: Bearer <token>` from `useAuthStore.getState()` only when no header was set explicitly. Response: on 401 calls `logout()` and `window.location.href = '/login'` (gated to skip the redirect when already on `/login` to avoid a loop). 10s timeout.
  - `apps/web/src/hooks/useAuth.ts` — `useLoginMutation`, `useRegisterMutation`, `useLogout`. Login mutation stashes auth + navigates to `/campaigns`. Register chains POST /auth/register -> POST /auth/login internally so the page body stays linear; `mutationFn` returns the User to satisfy the locked signature, but the AuthResponse is dropped into the store before returning. Logout clears the zustand store, calls `queryClient.clear()` to drop stale per-user cache, and navigates to `/login`.
  - `apps/web/src/hooks/useCampaigns.ts` — implementations match locked queryKeys (`['campaigns', query]` / `['campaign', id]`) and the function-form `refetchInterval` polling rule (1500ms only when `opts.polling && data?.status === 'sending'`, else `false`; `refetchIntervalInBackground: false`). List uses `placeholderData: (prev) => prev` for smooth pagination. Mutation cache strategy:
    - Create: invalidate ['campaigns'] only; the caller (CampaignNewPage) navigates to the new id.
    - Schedule: `setQueryData(['campaign', id], merge(prev, updated))` to preserve `stats` + `recipients` (the schedule endpoint returns just a `Campaign`, not a `CampaignDetail`); also invalidate ['campaigns'].
    - Send: optimistic flip to `status: 'sending'` (preserving stats/recipients) so polling kicks in immediately; we do NOT mark `sent` here per the F4 carry-forward rule — polling carries it. Also invalidate ['campaigns'].
    - Delete: removeQueries(['campaign', id]) + invalidate ['campaigns']; caller navigates.
  - `apps/web/src/pages/LoginPage.tsx` — AntD Form (vertical, `requiredMark={false}`) with email/password + client-side validation matching server zod (email format, password.min 8). On submit calls `useLoginMutation().mutate(values)`; loading + disabled state on the submit button via `mutation.isPending`. Errors flow through a small `extractApiError` helper into `<ErrorAlert>`; the helper goes via `axios.isAxiosError` + `isApiErrorResponse` so we always pass `code` (when available) + `fallback: e.message`, never `error.message` directly. "Don't have an account? Register" link.
  - `apps/web/src/pages/RegisterPage.tsx` — Same form pattern as Login with name + email + password fields. `useRegisterMutation` handles the auto-login chain. "Already have an account? Sign in" link.
  - `apps/web/src/pages/CampaignsListPage.tsx` — Layout shell with header (title + Log out button), card body, status filter Select, "New campaign" primary button, AntD Table with columns name (Link to detail) / subject / StatusBadge / updated_at. Pagination via Table's built-in pagination wired to URL search params (`page` + `status`) so back/forward preserves position. Loading: `<Skeleton active />`; empty: `<Empty>` with a CTA; error: `<ErrorAlert>`. The "table loading" indicator only shows on background refetches (`isFetching && !isLoading`) so the skeleton is the *only* thing visible on first load (no flash).
  - `apps/web/src/pages/CampaignNewPage.tsx` — AntD Form with name (max 200), subject (max 300), body (TextArea 8 rows, max 10000), recipient_emails TextArea ("comma or newline separated"). Recipient parsing splits on `[,\n]`, trims, lowercases, dedupes via Set (preserving first-occurrence order). Sends `recipient_emails` only when non-empty so server's optional field stays optional. On success navigates `replace: true` to `/campaigns/:id`.
  - `apps/web/src/pages/CampaignDetailPage.tsx` — `useCampaign(id, { polling: true })` (the hook self-gates by status). Loading: skeleton inside a card. Errors: 404 / `CAMPAIGN_NOT_FOUND` get a friendly `<Result>` with a "Back to campaigns" button; everything else uses `<ErrorAlert>`. Layout: header with back button, card with name/StatusBadge + Descriptions (subject, created, updated, scheduled), body card (`whiteSpace: 'pre-wrap'` so newlines render), then `<CampaignActions>`, `<StatsBlock>`, `<RecipientsTable>`.
  - `apps/web/src/components/StatsBlock.tsx` — Card titled "Stats" with 4 `<Statistic>` widgets (responsive `xs={12} sm={6}`) and 2 `<Progress>` bars below (`xs={24} sm={12}`). Rates rendered via `Math.round(rate * 100)`; never recomputes from raw counts (server-supplied rates are authoritative per business-rules.md).
  - `apps/web/src/components/RecipientsTable.tsx` — AntD Table with sortable email/name/status/sent_at/opened_at columns. Status -> Tag with the locked color map (pending=default, sent=success, failed=error). Status column also has filters. Date formatting via `toLocaleString()`; null sent_at -> '—', null opened_at -> 'Not opened' (clearer affordance than '—' for the open column). Empty state via AntD `<Empty>`.
  - `apps/web/src/components/CampaignActions.tsx` — Conditional buttons by status:
    - draft: Schedule (opens DatePicker modal — `disabledDate={(d) => d.isBefore(dayjs(), 'minute')}`) + Send (Popconfirm "Send to all recipients now?") + Delete (Popconfirm, danger).
    - scheduled: shows the scheduled_at + Send (Popconfirm).
    - sending: `<Spin>` + "Sending in progress…" copy.
    - sent: `<Tag color="success">Already sent</Tag>`.
    All errors flow through a `showApiError(err, title)` helper that calls `notification.error({ description: messageFor(code, fallback) })`. Schedule submit calls `dayjs(value).toISOString()` (UTC `Z`) — server's zod `.datetime({ offset: true })` accepts that.
  - `apps/web/src/App.test.tsx` — replaced the skeleton "TODO: LoginPage" assertion with a real assertion: the "Sign in" heading on LoginPage. Wraps in QueryClientProvider (per-test fresh QueryClient) and resets the auth store in `beforeEach`/`afterEach`.
  - `apps/web/src/test-setup.ts` — added a `window.matchMedia` polyfill. AntD's responsive grid (`<Row>` / `<Col xs={...}>` / `Grid.useBreakpoint`) hard-requires it; jsdom doesn't ship one, and without the polyfill any render that touches a responsive AntD primitive crashes with "window.matchMedia is not a function". Polyfill is the canonical AntD-+-jsdom workaround.
- Files NOT touched (architect-locked): `apps/web/src/App.tsx`, `apps/web/src/components/{ProtectedRoute,StatusBadge,ErrorAlert}.tsx`, `apps/web/src/types/api-error.ts`, `apps/web/src/store/auth.ts`, `apps/web/src/lib/queryClient.ts`. Layout shell is exactly as architect locked.
- Key implementation choices (frontend-locked, within architect's contract):
  - **`exactOptionalPropertyTypes: true` accommodation.** The repo tsconfig forces optional props to be either present or genuinely absent (NOT `undefined`). For `<ErrorAlert>` (which has `code?: string; fallback?: string` typed without `| undefined`), each page that calls it has a tiny local helper `alertProps({ code, fallback })` that builds an object skipping undefined keys. Same approach for the `useCampaignsList({ page, limit, status })` call where `status` is conditionally added, and for `useCreateCampaignMutation.mutate(payload)` where `recipient_emails` is conditionally added. This keeps strict-mode happy without changing any architect-locked types or signatures.
  - **One-shot extractApiError per page** instead of a shared util. Each consumer needs slightly different fields (CampaignDetailPage cares about `status` for 404 routing, the other pages don't), and the helper is ~10 lines. Centralizing it in a `lib/error.ts` would have been one more file to read for marginal duplication savings.
  - **AntD `Modal` (not Popover) for the Schedule date picker** — ergonomics on a touch device + the OK button bound to the mutation's `loading` state was cleaner than threading a custom popover footer. Modal `destroyOnClose` resets the DatePicker between opens.
  - **`replace: true` on navigation after create / schedule failures** — keeps the back button taking the user to the previous list page rather than re-entering the just-completed flow.
- Build/lint/test status:
  - `yarn workspace @app/web build` — clean. tsc -b 0 errors. Vite output: 1.31 MB raw / 413.42 kB gzip. (The chunk-size warning is a pre-existing AntD-bundle artifact; addressing it would require code-splitting which is out of scope.)
  - `yarn lint` — 0 errors, 1 pre-existing unrelated warning in `apps/api/src/db/sequelize.ts` (carried forward from F1; not introduced by F5).
  - `yarn workspace @app/web test` — 1/1 passes (the routing smoke, now updated to assert on the real LoginPage heading instead of the skeleton TODO marker).
- Hand-off notes for **unit-tester** (VERIFY):
  - The architect's 4 component-test plan is unchanged. Notes that may speed implementation:
    - The `window.matchMedia` polyfill is already set up in `apps/web/src/test-setup.ts`. AntD components that use Grid responsive props (`StatsBlock`'s Row/Col, `<Layout>`) will work without per-test setup.
    - Shared per-page `extractApiError` + `alertProps` helpers are NOT exported. Tests should focus on the rendered text via `messageFor` rather than asserting on these helpers.
    - The auth store reset pattern is already in `App.test.tsx` and works: `useAuthStore.setState({ token: null, user: null })` in `beforeEach`/`afterEach`.
    - For the LoginPage 401 test, mock POST /auth/login -> 401 with `{ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }`; the rendered `<Alert>` should show "Invalid email or password." (the dot — that's `messageFor`'s value, not the API's). This is the load-bearing assertion that proves we're using `messageFor`, not `error.message`.
    - For the CampaignDetailPage send-flow test, mock GET /campaigns/:id -> draft, click Send (Popconfirm "Send" button), mock POST /:id/send -> 202 `{ id, status: 'sending' }`. The optimistic cache update flips the cached status to 'sending' immediately, so the spinner + "Sending in progress…" copy should appear without a polling tick. Then advance vitest fake timers by 1500ms and mock the next GET to return status='sent' to verify polling self-stops.
    - `useCampaign`'s polling self-stops once cached status leaves 'sending', so tests should NOT need to manually disable polling — just mock the next GET response correctly.

### unit-tester — F5 component tests

- Files created (all under `apps/web/src/`):
  - `components/StatusBadge.test.tsx` — 4 `it.each` cases covering the locked status->{color,label} map. Asserts both the rendered label text AND the AntD-emitted className (`ant-tag-${color}`) so a future color drift breaks the test loudly. Confirmed AntD v5 emits `ant-tag-default`, `ant-tag-processing`, `ant-tag-warning`, `ant-tag-success` for the named colors used in the locked map.
  - `pages/LoginPage.happy.test.tsx` — fills email + password, submits, mocks `api.post('/auth/login')` -> 200 with `{ token: 'abc', user: {...} }`. Asserts (a) `useAuthStore.getState().token === 'abc'`, (b) `api.post` called with the exact form payload, (c) `navigate('/campaigns', { replace: true })` was called. Mocks `useNavigate` per architect's recommendation (option (b)) — simpler than introspecting MemoryRouter history.
  - `pages/LoginPage.401.test.tsx` — rejects `api.post` with a real `AxiosError` (so `axios.isAxiosError(err)` returns true inside `extractApiError`). Payload: 401 with `{ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }`. Load-bearing assertion: rendered alert text is the EXACT string `"Invalid email or password."` (with trailing period from the locked `ERROR_MESSAGES` map) — NOT the API's `"Invalid email or password"` (no period). Proves the UI went through `messageFor`, not `error.message`. Also asserts no token stored + no navigation triggered.
  - `pages/CampaignDetailPage.send.test.tsx` — full happy path send flow. Mocks two GETs (draft -> sent fixtures via consecutive `.mockResolvedValueOnce` + `.mockResolvedValue`) + one POST `/send` -> 202. Sequence verified:
    1. Initial GET returns draft -> "Spring promo" + "Send now" button render.
    2. Click "Send now" -> Popconfirm appears -> click confirm "Send" button.
    3. POST /send -> 202 sending. Optimistic `setQueryData` flip to status='sending' renders "Sending in progress…" copy.
    4. `useCampaign`'s `refetchInterval` returns 1500 (because cached status=='sending' AND polling=true). Test waits up to 5s with `interval: 100` for `api.get.mock.calls.length >= 2`.
    5. Polling tick returns `makeSent()` -> StatusBadge in header re-renders as a `.ant-tag-success` tag containing "Sent" (distinct from the StatsBlock `<Statistic title="Sent">` label, which renders regardless of data).
    6. Polling self-stops because status !== 'sending' on the next interval.
  - The "success-tag" assertion uses `document.querySelector('.ant-tag-success')` rather than `getByText('Sent')` — the latter ambiguously matches the StatsBlock Statistic title in BOTH draft and sent states, so it wouldn't actually prove the polling tick happened. The success-tag query is unambiguous: only StatusBadge with status='sent' emits that class.
- Mocking strategy:
  - `vi.mock('../lib/api', ...)` — replaces the axios `api` module with a fully-stubbed object (`post`, `get`, `delete`, `patch` as `vi.fn()`). Per architect's hand-off: msw was overkill for these 4 tests; vi.mock is faster and avoids a network mocking layer.
  - `vi.mock('react-router-dom', ...)` — uses `vi.importActual<typeof RR>` (with a top-level `import type * as RR` to satisfy `@typescript-eslint/consistent-type-imports`) to keep MemoryRouter / Route / Routes intact while replacing only `useNavigate` with a per-test `navigateMock`.
  - Auth store reset: `useAuthStore.setState({ token: null, user: null })` in both `beforeEach` and `afterEach` for every test that touches the store. CampaignDetailPage test seeds a fake user in `beforeEach` so the (mocked-out) protected layer would pass if it were rendered (the test renders the page directly inside `<Routes>`, bypassing `<ProtectedRoute>`, but seeding the user is cheap insurance).
- No source bugs found. The frontend agent's optimistic flip + polling rule worked exactly as documented; the test exercises the full path end-to-end without any monkey-patching.
- Test count: 1 pre-existing (`App.test.tsx` routing smoke) + 7 new (`StatusBadge.test.tsx` × 4 cases + `LoginPage.happy.test.tsx` × 1 + `LoginPage.401.test.tsx` × 1 + `CampaignDetailPage.send.test.tsx` × 1) = **8 total in apps/web** (≥5 requirement satisfied; ≥4 component test DoD also satisfied). 5 test files.
- Build/lint/test status:
  - `yarn workspace @app/web test` — 8/8 pass across 5 files, ~4.4s. The send-flow test takes ~2.3s (real polling tick at 1500ms).
  - `yarn workspace @app/web build` — clean. tsc -b 0 errors. Vite output: 1.31 MB / 413 kB gzip (unchanged from BUILD).
  - `yarn lint` — 0 errors, 1 pre-existing unrelated warning in `apps/api/src/db/sequelize.ts` (carried forward from F1; not introduced by F5). Test files trigger 0 warnings.
- Hand-off notes for **code-reviewer** (VERIFY):
  - All 4 architect-locked component tests are present and green; the loaded contract assertions match the hand-off (auth store side-effect, navigation call, messageFor-translated alert text, success-tag after polling tick).
  - The `react-router-dom` `useNavigate` mock pattern is identical across all 3 router-using tests — if you flag a duplication concern, it's intentional: each test file owns its own mock so vi.mock hoisting works without a shared helper file.
  - Polling test's 5s `waitFor` timeout is intentional headroom over the 1500ms tick — flake risk on a slow CI runner is mitigated. Consider whether to introduce vitest fake timers if CI runtime sensitivity becomes a concern (not needed today).
  - Optional polish (out of scope for F5 unless you call it): the AntD v5 `destroyOnClose` -> `destroyOnHidden` deprecation warning surfaces during the send-flow test. It's emitted by `CampaignActions`'s Modal, NOT by the test. Trivial one-line fix in source if F6 wants to silence it.
  - Open questions / risks: none. All tests are deterministic and locale-independent (no `toLocaleString` cross-runner drift inside any assertion).

### code-reviewer — F5 review

- **Verdict:** APPROVED-WITH-NITS. All architect-locked UX rules are honored end-to-end; no BLOCKERs found; 2 LOW + 1 MEDIUM logged in tech-debt; 1 LOW + 5 PRAISE noted below. DoD: 8/9 satisfied (the manual demo-flow checkbox is unverifiable without runtime — owner confirms boot is clean).
- **Files reviewed (full read):** `apps/web/src/{App.tsx,main.tsx,test-setup.ts,App.test.tsx}` + `lib/{api.ts,queryClient.ts}` + `store/auth.ts` + `types/api-error.ts` + `hooks/{useAuth.ts,useCampaigns.ts}` + all 5 pages + all 6 components + 4 test files.
- **Findings table:**
  | Severity | Where | Finding |
  |---|---|---|
  | PRAISE | all pages + components | `messageFor(code, fallback)` is consistently the ONLY error-display path — never `error.message`. The 401 test asserts on the trailing-period mapped string (`"Invalid email or password."`), proving the contract end-to-end. |
  | PRAISE | `hooks/useCampaigns.ts` (`useSendCampaignMutation`) | Send mutation NEVER marks `sent` — it optimistically flips cache to `'sending'` and lets the polling carry the state to `'sent'`. Exactly the F4 carry-forward rule, demonstrably exercised by `CampaignDetailPage.send.test.tsx`. |
  | PRAISE | `hooks/useCampaigns.ts` (`useCampaign`) | Polling rule: function-form `refetchInterval` returns `1500` only when `opts.polling && data?.status === 'sending'`, else `false`. `refetchIntervalInBackground: false`. Self-stops without manual disable. |
  | PRAISE | `store/auth.ts` + `lib/api.ts` | Token lives ONLY in zustand. No `localStorage` / `sessionStorage` / `document.cookie` references anywhere in `apps/web/src/` (verified by grep). No console-leak surface (`grep -rn console.log`) → 0 hits. |
  | PRAISE | `components/{StatsBlock,RecipientsTable,CampaignActions}.tsx` + `pages/CampaignDetailPage.tsx` | Body, recipient names, and stats render through `Typography.Paragraph` / `<Tag>` / `<Statistic>` (text children) — zero `dangerouslySetInnerHTML` in the entire web tree. |
  | MEDIUM | `components/CampaignActions.tsx` (`showApiError`) | Uses static `notification.error()` — AntD v5 doesn't wire those into `<ConfigProvider>` theming. Tech-debt MEDIUM logged. Zero impact today (default theme), but flag for any future dark-mode / brand-color work. |
  | LOW | `components/CampaignActions.tsx` (Schedule Modal) | `destroyOnClose` is deprecated in AntD v5 (warning surfaces in tests). One-line rename to `destroyOnHidden`. Tech-debt LOW. |
  | LOW | `lib/api.ts:55` (401 redirect loop guard) | `pathname.startsWith('/login')` would also match `/login-foo`. App has no such route today. Use `===`. Tech-debt LOW. |
  | LOW | 5 pages | `extractApiError` + `alertProps` duplicated per-page (~70 LOC). Frontend log justifies this as intentional (per-page fields differ). Tech-debt LOW. |
  | LOW | `components/StatusBadge.tsx` | `STATUS_MAP[status]` will throw if a future enum value lands without a map update. Acceptable today (status is union-typed, so adding a value would be a tsc error first). Praise as documented locked map. |
- **Fixes applied:** none. All findings are MEDIUM/LOW deferred to tech-debt.md per code-reviewer rules of engagement (no BLOCKERs found).
- **Build / lint / test status (re-run by code-reviewer):**
  - `yarn workspace @app/web test` — 8/8 pass across 5 files in ~4.2s.
  - `yarn workspace @app/web build` — clean. tsc -b 0 errors. Vite output 1.31 MB / 413 kB gzip (unchanged).
  - `yarn lint` — 0 errors, 1 pre-existing unrelated `no-console` warning in `apps/api/src/db/sequelize.ts` (carried from F1).
  - Smoke: `yarn workspace @app/web dev` boots in 184ms, `curl http://localhost:5173/` returns 200.
- **DoD outcome (against spec §Definition of Done):**
  - [x] `yarn workspace @app/web build` clean.
  - [x] `yarn workspace @app/web test` ≥4 component tests pass (8/8 across 5 files).
  - [/] `yarn workspace @app/web dev` boots — confirmed; full E2E (register -> login -> create -> schedule -> send -> watch sent -> stats) is unverifiable without a running API + seed. Code paths read correct.
  - [x] All 4 status badges render with correct colors (`StatusBadge.test.tsx` × 4 cases).
  - [x] Action buttons appear ONLY when status allows (verified by reading `CampaignActions.tsx` per-status branches).
  - [x] Loading skeletons during initial fetch, no white flash (`CampaignsListPage` + `CampaignDetailPage` both use `<Skeleton active />` on `isLoading`).
  - [x] Errors via Alert/notification, mapped by `error.code` to readable text (verified end-to-end).
  - [x] 401 anywhere triggers logout + redirect to /login (verified in `lib/api.ts` interceptor; loop-guarded for /login itself).
  - [x] `yarn lint` clean across the web workspace (0 errors).
  - [ ] README "Quick start" section captures the F5 demo flow — **out of scope for VERIFY; this is finalize's job.**
  - **8/9 unambiguously green; 1 deferred to finalize (README); 1 manually unverifiable (full demo flow) but code paths are correct.**
- **Top 3 recommendations for finalize:**
  1. **README quick-start.** Update root README with the F5 demo flow: `yarn dev` boots both API + web, register at /register → auto-login → create campaign → schedule (DatePicker future date) → send → watch status flip to sent → stats reflect counts. Mention seed-stamped opens for the demo.
  2. **Commit message highlights.** Note: 5 pages + 6 components + 2 hooks + axios interceptor wired in F5. Locked F4 carry-forward UX rules honored (messageFor everywhere, no optimistic `sent` flip, polling self-gated). 4/4 architect-planned component tests + 4 it.each cases = 8 web tests total. Token in-memory only (ADR-003 enforced).
  3. **Smoke before push.** `yarn workspace @app/web build && yarn workspace @app/api dev` (in another tab) → click through register → login → create → send. The send-worker timing is fast in dev; if you don't see 'sending' on screen, the polling will still pick up 'sent'. Also confirm `VITE_API_BASE_URL` defaults to `http://localhost:4000` (the .env.example matches).
- **Top 3 carry-forward items for F6 polish:**
  1. **Wrap app in `<App>` from antd** + switch `notification.error` callsites to `App.useApp().notification` so toasts pick up `<ConfigProvider>` theming. ~10 LOC. Required before any dark-mode work.
  2. **Rename `destroyOnClose` → `destroyOnHidden`** in `CampaignActions.tsx` to silence the AntD v5 deprecation warning. One-line fix.
  3. **Centralize `extractApiError` + `alertProps`** into `apps/web/src/lib/error.ts` so the 5 pages stop carrying ~10 LOC of nearly-identical helpers. Pair this with adding HTTP `status` to the shared shape so CampaignDetailPage's 404 branching uses the same util.
- **Open questions / risks:** none. F5 verifies cleanly.
- **KB updated:**
  - `.hody/knowledge/tech-debt.md` — appended "F5 Frontend — code-reviewer findings (2026-05-08)" section with the 1 MEDIUM + 3 LOW entries.
  - `.hody/knowledge/log-frontend-pages.md` — this entry.


