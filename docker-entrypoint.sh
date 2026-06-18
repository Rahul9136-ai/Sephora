#!/bin/sh
set -e
PERSIST=/mnt/persistent
mkdir -p "$PERSIST/data/raw" "$PERSIST/data/processed" "$PERSIST/mlruns"
touch "$PERSIST/mlflow.db"

if [ ! -f "$PERSIST/data/raw/contacts_export.xlsx" ]; then
  cp /app/data/raw/*.xlsx "$PERSIST/data/raw/"
fi

rm -rf /app/data /app/mlruns
ln -s "$PERSIST/data" /app/data
ln -s "$PERSIST/mlruns" /app/mlruns
ln -sf "$PERSIST/mlflow.db" /app/mlflow.db

exec "$@"
