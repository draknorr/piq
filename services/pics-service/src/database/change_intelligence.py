"""Pure helpers for PICS change-intelligence snapshotting and diffing."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..extractors.common import Association, ExtractedPICSData

PICS_CHANGE_SOURCE = "pics"
PICS_SNAPSHOT_SOURCE = "pics"


@dataclass(frozen=True)
class PICSEvent:
    """Structured change event derived from normalized PICS snapshots."""

    change_type: str
    before_value: Any
    after_value: Any
    context: Dict[str, Any] = field(default_factory=dict)


def normalize_pics_snapshot(app: ExtractedPICSData) -> Dict[str, Any]:
    """Normalize extracted PICS payload to a stable JSON shape for hashing/versioning."""
    developer_names = _normalize_association_names(app.developer, app.associations, "developer")
    publisher_names = _normalize_association_names(app.publisher, app.associations, "publisher")
    franchise_names = _normalize_association_names(None, app.associations, "franchise")

    return {
        "appid": app.appid,
        "name": app.name,
        "type": app.type,
        "developer_names": developer_names,
        "publisher_names": publisher_names,
        "franchise_names": franchise_names,
        "parent_appid": app.parent_appid,
        "dlc_appids": sorted({int(appid) for appid in app.dlc_appids}),
        "release_state": app.release_state,
        "review_score": app.review_score,
        "review_percentage": app.review_percentage,
        "metacritic_score": app.metacritic_score,
        "metacritic_url": _normalize_optional_string(app.metacritic_url),
        "store_tags": sorted({int(tag_id) for tag_id in app.store_tags}),
        "genres": sorted({int(genre_id) for genre_id in app.genres}),
        "primary_genre": app.primary_genre,
        "categories": sorted(int(cat_id) for cat_id, enabled in app.categories.items() if enabled),
        "platforms": sorted({platform.strip().lower() for platform in app.platforms if platform}),
        "controller_support": _normalize_optional_string(app.controller_support),
        "steam_deck_category": _normalize_steam_deck_category(app),
        "steam_deck_details": _normalize_steam_deck_details(app),
        "has_workshop": app.has_workshop,
        "is_free": app.is_free,
        "content_descriptors": _canonicalize(app.content_descriptors),
        "languages": _canonicalize(app.languages),
        "homepage_url": app.homepage_url,
        "app_state": app.app_state,
        "current_build_id": app.current_build_id,
        "last_content_update": _normalize_datetime(app.last_update_timestamp),
        "store_asset_mtime": _normalize_datetime(app.store_asset_mtime),
        "steam_release_date": _normalize_datetime(app.steam_release_date),
        "original_release_date": _normalize_datetime(app.original_release_date),
    }


def hash_normalized_snapshot(snapshot: Dict[str, Any]) -> str:
    """Create a deterministic hash for a normalized snapshot."""
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def diff_pics_snapshots(before: Dict[str, Any], after: Dict[str, Any]) -> List[PICSEvent]:
    """Generate structured diff events between two normalized PICS snapshots."""
    events: List[PICSEvent] = []

    before_tags = set(before.get("store_tags", []))
    after_tags = set(after.get("store_tags", []))
    added_tags = sorted(after_tags - before_tags)
    removed_tags = sorted(before_tags - after_tags)
    if added_tags:
        events.append(
            PICSEvent("tags_added", sorted(before_tags), sorted(after_tags), {"added": added_tags})
        )
    if removed_tags:
        events.append(
            PICSEvent(
                "tags_removed", sorted(before_tags), sorted(after_tags), {"removed": removed_tags}
            )
        )

    _append_set_change(events, "genres_changed", before, after, "genres")
    _append_set_change(events, "categories_changed", before, after, "categories")
    _append_value_change(events, "languages_changed", before, after, "languages")
    _append_set_change(events, "platforms_changed", before, after, "platforms")
    _append_value_change(events, "controller_support_changed", before, after, "controller_support")
    _append_value_change(events, "steam_deck_status_changed", before, after, "steam_deck_category")
    _append_set_change(events, "publisher_association_changed", before, after, "publisher_names")
    _append_set_change(events, "developer_association_changed", before, after, "developer_names")
    _append_set_change(events, "dlc_references_changed", before, after, "dlc_appids")
    _append_value_change(events, "build_id_changed", before, after, "current_build_id")
    _append_value_change(
        events, "last_content_update_changed", before, after, "last_content_update"
    )

    return events


def _append_set_change(
    events: List[PICSEvent],
    change_type: str,
    before: Dict[str, Any],
    after: Dict[str, Any],
    key: str,
) -> None:
    before_set = set(before.get(key, []))
    after_set = set(after.get(key, []))
    if before_set == after_set:
        return

    events.append(
        PICSEvent(
            change_type=change_type,
            before_value=sorted(before_set),
            after_value=sorted(after_set),
            context={
                "added": sorted(after_set - before_set),
                "removed": sorted(before_set - after_set),
            },
        )
    )


def _append_value_change(
    events: List[PICSEvent],
    change_type: str,
    before: Dict[str, Any],
    after: Dict[str, Any],
    key: str,
) -> None:
    before_value = before.get(key)
    after_value = after.get(key)
    if before_value == after_value:
        return

    events.append(
        PICSEvent(change_type=change_type, before_value=before_value, after_value=after_value)
    )


def _normalize_association_names(
    primary_name: Optional[str],
    associations: List[Association],
    assoc_type: str,
) -> List[str]:
    names = set()

    if primary_name:
        names.add(primary_name.strip())

    for association in associations:
        if association.type == assoc_type and association.name:
            names.add(association.name.strip())

    return sorted(names)


def _normalize_steam_deck_category(app: ExtractedPICSData) -> Optional[str]:
    if not app.steam_deck:
        return None

    category_map = {
        0: "unknown",
        1: "unsupported",
        2: "playable",
        3: "verified",
    }
    return category_map.get(app.steam_deck.category, "unknown")


def _normalize_steam_deck_details(app: ExtractedPICSData) -> Optional[Dict[str, Any]]:
    if not app.steam_deck:
        return None
    return {
        "category": _normalize_steam_deck_category(app),
        "test_timestamp": app.steam_deck.test_timestamp,
        "tested_build_id": app.steam_deck.tested_build_id,
        "tests": _canonicalize(app.steam_deck.tests),
    }


def _normalize_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat()


def _normalize_optional_string(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _canonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _canonicalize(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        canonical_items = [_canonicalize(item) for item in value]
        return sorted(
            canonical_items,
            key=lambda item: json.dumps(
                item, sort_keys=True, separators=(",", ":"), ensure_ascii=True
            ),
        )
    return value
