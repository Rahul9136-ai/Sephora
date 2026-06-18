#!/bin/sh
set -e
PERSIST=/mnt/persistent
mkdir -p "$PERSIST/data/raw" "$PERSIST/data/processed" "$PERSIST/mlruns"

if [ ! -f "$PERSIST/data/raw/contacts_export.xlsx" ]; then
  cp /app/data/raw/*.xlsx "$PERSIST/data/raw/"
fi

rm -rf /app/data /app/mlruns
ln -s "$PERSIST/data" /app/data
ln -s "$PERSIST/mlruns" /app/mlruns
# mlflow.db (SQLite) stays on local ephemeral storage: Azure Files (SMB)
# doesn't support the file locking SQLite needs.

exec "$@"
