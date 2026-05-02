# Security Specification for BallOut DRS

## Data Invariants
1. A Decision must have a valid `match_id`, `batsman`, `bowler`, `decision_type`, and `result`.
2. The `result` must be one of 'OUT', 'NOT OUT', or "UMPIRE'S CALL".
3. `timestamp` must be a server timestamp.
4. `match_id` must follow alphanumeric pattern.

## The Dirty Dozen (Attacker Payloads)
1. **The ID Poisoner**: Create a decision with a 2KB junk string as `decisionId`.
2. **The Result Hijacker**: Create a decision with `result: "REVERSED_BY_CORRUPTION"`.
3. **The Identity Spoofer**: Create a decision as a guest (unauthenticated).
4. **The Ghost Match**: Update `match_id` of an existing decision to a different match.
5. **The Time Traveler**: Set `timestamp` to a future date manually.
6. **The Shadow Field**: Add `isAdmin: true` to a decision document.
7. **The Bulk Deletion**: Attempt to delete all decisions in a collection.
8. **The PII Scraper**: List all matches and extract internal `stats` without permission.
9. **The Oversized Payload**: Create a match with a 1MB `name` string.
10. **The Negative Stat**: Update `total_decisions` to `-500`.
11. **The Orphaned Write**: Create a decision for a non-existent match ID (if existence check is possible).
12. **The Immutable Breaker**: Attempt to change the `batsman` of an already recorded decision.

## Tests to Implement
- [ ] Deny unauthenticated writes to `decisions`.
- [ ] Validate `result` enum values.
- [ ] Enforce server timestamp for `timestamp` and `updatedAt`.
- [ ] Deny updates to immutable fields in `decisions`.
- [ ] Enforce field size limits (e.g., name < 200 chars).
