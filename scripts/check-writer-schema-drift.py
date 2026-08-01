#!/usr/bin/env python3
"""Flag PostgreSQL writers that omit a column the schema requires.

Four defects of one shape were found during the Phase 8 GA drills: a migration
added a NOT NULL column (or an existing one had no usable default), the
repository INSERT was never updated, and the failure only appeared at runtime as
a 500 on a path no test exercised -- `experiment_scheduling_jobs.available_at`,
`provider_product_metadata_snapshots.normalized_metadata`, and two read-side
equivalents. Compiling proves nothing here: the column list is a string.

This compares, per table:

  required = NOT NULL columns with no DEFAULT and no generated expression,
             as the migrations leave them after all ALTERs are applied
  written  = the column list of every literal `INSERT INTO <table>(...)` in the
             Go repositories

and reports any required column a writer omits.

Usage:
    python3 scripts/check-writer-schema-drift.py [--repo ROOT] [--verbose]

Exit codes: 0 clean, 1 drift found, 2 could not run.

Limitations, stated so the output is not over-trusted: the schema is parsed from
the migration text rather than from a live database, so a column whose NOT NULL
is added by a plain `UPDATE ... ; ALTER COLUMN ... SET NOT NULL` pair is caught
only if the ALTER is present; INSERTs built by string concatenation are not
analysed and are listed separately as unchecked. A live-database cross-check is
the authoritative form; this is the cheap one that runs without one.
"""
import argparse
import os
import re
import sys

# Columns a writer never supplies because the database or a trigger does.
GENERATED = re.compile(r"\bGENERATED\b|\bDEFAULT\b", re.IGNORECASE)

# A table-level constraint rather than a column definition.
TABLE_CONSTRAINT = re.compile(
    r"(primary|unique|foreign|check|constraint|exclude|like)\b", re.IGNORECASE
)


def strip_line_comments(sql):
    """Drop `--` comments, leaving the statement structure intact.

    A comment sitting above a column is otherwise absorbed into that column's
    definition, because definitions are split on commas. The chunk then starts
    with `--`, so the column it documents is never recorded as required and the
    comment is recorded instead. Quotes are tracked so a `--` inside a string
    literal or an identifier stays put.
    """
    out = []
    for line in sql.split("\n"):
        quote = None
        cut = None
        index = 0
        while index < len(line):
            character = line[index]
            if quote:
                if character == quote:
                    # A doubled quote escapes itself rather than closing.
                    if index + 1 < len(line) and line[index + 1] == quote:
                        index += 1
                    else:
                        quote = None
            elif character in "'\"":
                quote = character
            elif character == "-" and line.startswith("--", index):
                cut = index
                break
            index += 1
        out.append(line if cut is None else line[:cut])
    return "\n".join(out)


def read_migrations(root):
    directory = os.path.join(root, "apps", "api", "migrations")
    files = sorted(f for f in os.listdir(directory) if f.endswith(".sql"))
    text = []
    for name in files:
        with open(os.path.join(directory, name)) as handle:
            body = handle.read()
        # Only the Up section defines the live schema. The split runs before
        # comments are stripped, since the goose marker is itself a comment.
        up = body.split("-- +goose Down")[0]
        text.append(strip_line_comments(up))
    return "\n".join(text)


def parse_trigger_supplied(sql):
    """Return {table: set(columns a BEFORE INSERT trigger assigns)}.

    A `BEFORE INSERT` trigger that sets `NEW.<column>` supplies the value ahead
    of the NOT NULL check, exactly as a DEFAULT would, so a writer that omits
    the column is correct rather than drifted.
    """
    bodies = {}
    for match in re.finditer(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][a-z0-9_]*)\s*\(.*?\$\$(.*?)\$\$",
        sql, re.IGNORECASE | re.DOTALL,
    ):
        bodies[match.group(1).lower()] = match.group(2)

    supplied = {}
    for match in re.finditer(
        r"CREATE\s+TRIGGER\s+[a-z_][a-z0-9_]*\s+BEFORE\s+INSERT[^;]*?\bON\s+([a-z_][a-z0-9_]*)"
        r"[^;]*?EXECUTE\s+(?:PROCEDURE|FUNCTION)\s+([a-z_][a-z0-9_]*)",
        sql, re.IGNORECASE | re.DOTALL,
    ):
        table, function = match.group(1).lower(), match.group(2).lower()
        body = bodies.get(function)
        if not body:
            continue
        assigned = {
            assignment.group(1).lower()
            for assignment in re.finditer(r"NEW\.([a-z_][a-z0-9_]*)\s*:=", body, re.IGNORECASE)
        }
        assigned |= {
            into.group(1).lower()
            for into in re.finditer(r"\bINTO\s+NEW\.([a-z_][a-z0-9_]*)", body, re.IGNORECASE)
        }
        supplied.setdefault(table, set()).update(assigned)
    return supplied


def parse_schema(sql):
    """Return {table: set(required columns)} after applying CREATE and ALTER."""
    required = {}
    dropped = {}

    for match in re.finditer(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\((.*?)\n\);",
        sql, re.IGNORECASE | re.DOTALL,
    ):
        table, body = match.group(1), match.group(2)
        columns = set()
        depth = 0
        current = ""
        for character in body:
            if character == "(":
                depth += 1
            elif character == ")":
                depth -= 1
            if character == "," and depth == 0:
                columns.add(current)
                current = ""
                continue
            current += character
        columns.add(current)
        table_required = set()
        for definition in columns:
            definition = definition.strip()
            if not definition:
                continue
            # A table constraint may open its parenthesis with no space, as in
            # `CHECK((status='running')=...)`, so the keyword is matched on a
            # word boundary rather than by splitting on whitespace.
            if TABLE_CONSTRAINT.match(definition):
                continue
            name = definition.split()[0].lower()
            if "NOT NULL" in definition.upper() and not GENERATED.search(definition):
                table_required.add(name)
        required[table] = table_required
        dropped[table] = set()

    for match in re.finditer(
        r"ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+(.*?);", sql, re.IGNORECASE | re.DOTALL
    ):
        table, body = match.group(1).lower(), match.group(2)
        required.setdefault(table, set())
        dropped.setdefault(table, set())
        for add in re.finditer(r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)([^,]*)", body, re.IGNORECASE):
            name, rest = add.group(1).lower(), add.group(2)
            if "NOT NULL" in rest.upper() and not GENERATED.search(rest):
                required[table].add(name)
        for alter in re.finditer(r"ALTER\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+SET\s+NOT\s+NULL", body, re.IGNORECASE):
            required[table].add(alter.group(1).lower())
        for alter in re.finditer(r"ALTER\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+DROP\s+NOT\s+NULL", body, re.IGNORECASE):
            required[table].discard(alter.group(1).lower())
        for alter in re.finditer(r"ALTER\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+SET\s+DEFAULT", body, re.IGNORECASE):
            # A default only rescues a writer that omits the column entirely,
            # which is exactly the case being checked, so it is not a rescue for
            # an explicit NULL. Keep it required.
            pass
        for drop in re.finditer(r"DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)", body, re.IGNORECASE):
            name = drop.group(1).lower()
            required[table].discard(name)
            dropped[table].add(name)

    for match in re.finditer(r"DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)", sql, re.IGNORECASE):
        required.pop(match.group(1).lower(), None)

    return required


def parse_writers(root):
    """Return {table: [(file, line, set(columns))]} and a list of unchecked writes."""
    writers = {}
    unchecked = []
    base = os.path.join(root, "apps", "api")
    for directory, _, files in os.walk(base):
        if "/migrations" in directory:
            continue
        for name in files:
            if not name.endswith(".go") or name.endswith("_test.go"):
                continue
            path = os.path.join(directory, name)
            with open(path) as handle:
                body = handle.read()
            for match in re.finditer(
                r"INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)", body, re.IGNORECASE
            ):
                table = match.group(1).lower()
                raw = match.group(2)
                line = body[: match.start()].count("\n") + 1
                relative = os.path.relpath(path, root)
                if "%s" in raw or "+" in raw:
                    unchecked.append((relative, line, table))
                    continue
                columns = {c.strip().lower() for c in raw.split(",") if c.strip()}
                writers.setdefault(table, []).append((relative, line, columns))
            for match in re.finditer(r"INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*(?!\()", body, re.IGNORECASE):
                fragment = body[match.start():match.start() + 120]
                if "(" not in fragment.split("\n")[0]:
                    unchecked.append((os.path.relpath(path, root), body[: match.start()].count("\n") + 1,
                                      match.group(1).lower()))
    return writers, unchecked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    parser.add_argument("--verbose", action="store_true", help="also list tables checked and clean")
    arguments = parser.parse_args()
    root = os.path.abspath(arguments.repo)

    try:
        migrations = read_migrations(root)
    except OSError as error:
        print("cannot read migrations: %s" % error, file=sys.stderr)
        return 2

    schema = parse_schema(migrations)
    # A BEFORE INSERT trigger fills its columns before NOT NULL is checked, so
    # the writers that omit them are correct.
    for table, columns in parse_trigger_supplied(migrations).items():
        if table in schema:
            schema[table] -= columns

    writers, unchecked = parse_writers(root)

    drift = []
    clean = []
    for table in sorted(writers):
        needed = schema.get(table)
        if needed is None:
            clean.append((table, "no CREATE TABLE found in migrations (view or renamed?)"))
            continue
        for path, line, columns in writers[table]:
            missing = sorted(needed - columns)
            if missing:
                drift.append((table, path, line, missing))
        if not any(sorted(needed - columns) for _, _, columns in writers[table]):
            clean.append((table, "%d writer(s), %d required column(s)" % (len(writers[table]), len(needed))))

    print("=== writer/schema drift sweep")
    print("tables with literal INSERT writers: %d" % len(writers))
    print("writes not analysed (dynamic SQL): %d" % len(unchecked))
    print()
    if drift:
        print("DRIFT (%d):" % len(drift))
        for table, path, line, missing in drift:
            print("  %s  %s:%d  omits required column(s): %s" % (table, path, line, ", ".join(missing)))
    else:
        print("DRIFT: none")
    if arguments.verbose:
        print()
        print("checked and clean:")
        for table, note in clean:
            print("  %-46s %s" % (table, note))
        if unchecked:
            print()
            print("not analysed (dynamic column list):")
            for path, line, table in unchecked:
                print("  %s:%d  %s" % (path, line, table))
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
