-- Reserved version. This migration deliberately changes nothing.
--
-- Version 41 was skipped during Phase 9B: two work packages were in flight at
-- once, one claimed 00041 and was then folded into 00040 before it landed, and
-- the sequence went 00040 → 00042. A gap in the sequence is not itself a
-- problem, but an *unclaimed* gap is: the next author to pick "the next free
-- number" by looking for a hole would write a 00041 that every deployment
-- already past 42 sees as a migration below its current version. Goose treats
-- that as an out-of-order migration and refuses to apply it, and Mosaic's
-- `migrate preflight` reports the schema as dirty — an interrupted-run verdict
-- that is wrong and that an operator cannot clear without manual intervention.
--
-- Claiming the number with a no-op removes the hole, so the only way to add a
-- migration is to take the next number above the highest one.
--
-- Operator note: this file lands while Phase 9B is unreleased, so no deployed
-- database has applied 00042 and above. A *development* database already at
-- version 42 or higher will report 00041 as pending-below-current; recreate it
-- (`docker compose down -v`) rather than forcing the row.
--
-- Do not reuse this file for schema work. Reserved means reserved: a future
-- change that edited it would rewrite the meaning of a version some databases
-- have already recorded as applied.

-- +goose Up
SELECT 1;

-- +goose Down
SELECT 1;
