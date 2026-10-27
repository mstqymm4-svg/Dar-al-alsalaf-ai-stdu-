# Security Specification — Dar Al Uloom Firestore Rules

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched are denied for both `read` and `write`.
2. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates its path ID using `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
3. **Admin Authorization (`isAdmin`)**: Only verified users (`request.auth.token.email_verified == true`) whose email matches the bootstrapped owner (`mstqymm4@gmail.com`) or whose UID exists in `/admins/$(request.auth.uid)` may mutate public library collections (`books`, `videos`, `video_channels`, `social_channels`, `app_settings`, `admins`).
4. **PII & Private Data Isolation**:
   - `/users/{userId}` contains PII (`email`, `full_name`) and is strictly readable only by the document owner (`request.auth.uid == userId`) or `isAdmin()`.
   - `/favorites/{favId}` and `/account_data/{accountId}` are strictly scoped to `resource.data.ownerUid == request.auth.uid` (or `isAdmin()`).
5. **Validation Blueprints & Anti-Update-Gap**:
   - Every `create` and `update` invokes `isValid[Entity](incoming())`.
   - Every `update` uses action-based `incoming().diff(existing()).affectedKeys().hasOnly([...])` and preserves immutable fields (`id`, `ownerUid`, `created_date`).

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection on Book**: `{ id: "b1", title: "T", author: "A", category: "C", created_date: "2026-01-01", updated_date: "2026-01-01", is_hacked: true }` -> Rejected by `hasOnly`.
2. **Unverified Admin Email Spoof**: Request with `email == 'mstqymm4@gmail.com'` and `email_verified == false` attempting to create a book -> Rejected by `isVerifiedUser()`.
3. **ID Poisoning Attack**: Document ID with 2000 characters or special characters `../admin` -> Rejected by `isValidId()`.
4. **Privilege Escalation on User Creation**: User creating `/users/{uid}` with `role: 'admin'` when not bootstrapped admin -> Rejected by `create` role gate.
5. **Privilege Escalation on User Update**: Non-admin user updating `role` field on `/users/{uid}` -> Rejected by `affectedKeys().hasOnly(...)` excluding `role`.
6. **Cross-User AccountData Read**: User A attempting `get` or `list` on User B's `/account_data/{id}` -> Rejected by `resource.data.ownerUid == request.auth.uid`.
7. **Cross-User Favorite Creation**: User A creating `/favorites/{id}` with `ownerUid: "userB"` -> Rejected by `isValidFavorite` checking `data.ownerUid == request.auth.uid`.
8. **Immutable Field Mutation**: Updating `created_date` or `id` on an existing `/books/{bookId}` or `/favorites/{favId}` -> Rejected by immutability invariant `incoming().created_date == existing().created_date`.
9. **Oversized String DoS (Denial of Wallet)**: Sending a 2MB `description` string on `/books/{bookId}` -> Rejected by `.size() <= 5000`.
10. **Type Confusion on Update**: Updating `pages_count` on `/books/{bookId}` to a boolean -> Rejected by `isValidBook(incoming())` wrapping the `update` block.
11. **Unauthorized Public Catalog Deletion**: Regular signed-in user attempting `delete` on `/books/{bookId}` or `/videos/{videoId}` -> Rejected by `isAdmin()`.
12. **Blanket User List Scraping**: Non-admin user running an unconstrained `list` query on `/users` -> Rejected because `allow list` requires `resource.data.uid == request.auth.uid || isAdmin()`.
