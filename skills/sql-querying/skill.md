# Skill: SQL Database Querying
**Trigger:** User asks to query a database, extract metrics, or analyze records.
**Action:**
1. Write a Python script using `sqlite3`, `duckdb`, `SQLAlchemy`, or `psycopg2` as appropriate.
2. Prefer read-only queries unless the user explicitly asks for writes.
3. Format results as a Pandas DataFrame and print to stdout (and optionally save CSV under `/mnt/data/`).
4. Call `execute_code` to run the script.
5. Never hard-code production secrets — use env vars only if the sandbox provides them.
