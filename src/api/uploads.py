"""Helpers for receiving uploaded source workbooks that replace the raw ETL inputs."""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from fastapi import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
BACKUP_DIR = RAW_DIR / "backups"

CONTACTS_PATH = RAW_DIR / "contacts_export.xlsx"
ORDERS_EVENTS_PATH = RAW_DIR / "orders_events.xlsx"


def save_upload(file: UploadFile, dest: Path) -> dict:
    """Back up the existing file (if any) and write the upload to `dest`."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if dest.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        shutil.copy2(dest, BACKUP_DIR / f"{dest.stem}_{ts}{dest.suffix}")

    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    stat = dest.stat()
    return {
        "filename": dest.name,
        "size_bytes": stat.st_size,
        "saved_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }
