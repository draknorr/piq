"""Extract structured data from raw PICS response."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, FrozenSet, List, Optional

logger = logging.getLogger(__name__)

PICS_PAYLOAD_EVIDENCE_VERSION = "pics-product-payload-evidence/v1"


@dataclass(frozen=True)
class RelationshipFamilyEvidence:
    """Whether one relationship family can safely replace current state."""

    source_path: str
    status: str

    @property
    def is_complete(self) -> bool:
        return self.status == "complete"


@dataclass(frozen=True)
class PICSPayloadEvidence:
    """Presence and completeness retained from the unnormalized PICS payload."""

    schema_version: str
    source_complete: bool
    missing_token: bool
    source_change_number: Optional[int]
    source_sha: Optional[str]
    source_size: Optional[int]
    present_fields: FrozenSet[str]
    relationship_families: Dict[str, RelationshipFamilyEvidence]

    def field_is_present(self, field_name: str) -> bool:
        return field_name in self.present_fields

    def family_is_complete(self, family_name: str) -> bool:
        family = self.relationship_families.get(family_name)
        return family is not None and family.is_complete


@dataclass
class SteamDeckCompatibility:
    """Steam Deck compatibility info."""

    category: int  # 0=Unknown, 1=Unsupported, 2=Playable, 3=Verified
    test_timestamp: Optional[int] = None
    tested_build_id: Optional[str] = None
    tests: Optional[Dict[str, Any]] = None


@dataclass
class Association:
    """Developer/Publisher/Franchise association."""

    type: str  # 'developer', 'publisher', 'franchise', 'award'
    name: str


@dataclass
class ExtractedPICSData:
    """All extracted PICS data for an app."""

    appid: int
    name: Optional[str] = None
    type: Optional[str] = None

    # Developer/Publisher
    developer: Optional[str] = None
    publisher: Optional[str] = None
    associations: List[Association] = field(default_factory=list)

    # Relationships
    parent_appid: Optional[int] = None
    dlc_appids: List[int] = field(default_factory=list)

    # Dates
    steam_release_date: Optional[datetime] = None
    original_release_date: Optional[datetime] = None
    store_asset_mtime: Optional[datetime] = None  # When store page was created
    release_state: Optional[str] = None
    last_update_timestamp: Optional[datetime] = None

    # Reviews
    review_score: Optional[int] = None
    review_percentage: Optional[int] = None
    metacritic_score: Optional[int] = None
    metacritic_url: Optional[str] = None

    # Tags & Categories
    store_tags: List[int] = field(default_factory=list)
    genres: List[int] = field(default_factory=list)
    primary_genre: Optional[int] = None
    categories: Dict[int, bool] = field(default_factory=dict)

    # Platform & Compatibility
    platforms: List[str] = field(default_factory=list)
    controller_support: Optional[str] = None
    steam_deck: Optional[SteamDeckCompatibility] = None

    # Features
    has_workshop: bool = False
    is_free: bool = False

    # Content
    content_descriptors: Dict[str, Any] = field(default_factory=dict)
    languages: Dict[str, Any] = field(default_factory=dict)

    # URLs
    homepage_url: Optional[str] = None

    # State
    app_state: Optional[str] = None

    # Build info
    current_build_id: Optional[str] = None

    # Raw-source evidence. Legacy callers can omit this; durable promotion
    # requires it and fails closed when it is absent or incomplete.
    source_evidence: Optional[PICSPayloadEvidence] = None


class PICSExtractor:
    """Extracts structured data from raw PICS response."""

    def extract(self, appid: int, raw_data: Dict[str, Any]) -> ExtractedPICSData:
        """Extract all relevant fields from PICS app data."""
        # Handle both wrapped and unwrapped formats
        if "appinfo" in raw_data:
            appinfo = raw_data.get("appinfo", raw_data)
        else:
            appinfo = raw_data

        common = appinfo.get("common", {}) if isinstance(appinfo, dict) else {}
        common_is_mapping = isinstance(common, dict)
        if not common_is_mapping:
            common = {}

        # Debug logging to diagnose type extraction issues
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"[{appid}] Raw keys: {list(raw_data.keys())[:5]}")
            if isinstance(appinfo, dict):
                logger.debug(f"[{appid}] appinfo keys: {list(appinfo.keys())[:5]}")
            logger.debug(
                f"[{appid}] common keys: {list(common.keys())[:10] if common else 'EMPTY'}"
            )
            logger.debug(f"[{appid}] common.type = {common.get('type')}")
        extended = appinfo.get("extended", {}) if isinstance(appinfo, dict) else {}
        config = appinfo.get("config", {}) if isinstance(appinfo, dict) else {}
        depots = appinfo.get("depots", {}) if isinstance(appinfo, dict) else {}
        if not isinstance(extended, dict):
            extended = {}
        if not isinstance(config, dict):
            config = {}
        if not isinstance(depots, dict):
            depots = {}
        evidence = self._extract_payload_evidence(
            raw_data=raw_data,
            appinfo=appinfo,
            common=common,
            extended=extended,
            config=config,
            depots=depots,
            common_is_mapping=common_is_mapping,
        )

        return ExtractedPICSData(
            appid=appid,
            name=common.get("name"),
            type=common.get("type"),
            # Developer/Publisher (prefer common, fallback to extended)
            developer=common.get("developer") or extended.get("developer"),
            publisher=common.get("publisher") or extended.get("publisher"),
            associations=self._extract_associations(common.get("associations", {})),
            # Relationships
            parent_appid=self._safe_int(common.get("parent") or extended.get("parent")),
            dlc_appids=self._parse_dlc_list(extended.get("listofdlc", "")),
            # Dates
            steam_release_date=self._parse_timestamp(common.get("steam_release_date")),
            original_release_date=self._parse_timestamp(common.get("original_release_date")),
            store_asset_mtime=self._parse_timestamp(common.get("store_asset_mtime")),
            release_state=common.get("releasestate"),
            last_update_timestamp=self._extract_last_update(depots),
            # Reviews
            review_score=self._safe_int(common.get("review_score")),
            review_percentage=self._safe_int(common.get("review_percentage")),
            metacritic_score=self._safe_int(common.get("metacritic_score")),
            metacritic_url=common.get("metacritic_url") or common.get("metacritic_fullurl"),
            # Tags & Categories
            store_tags=self._extract_tag_ids(common.get("store_tags", {})),
            genres=self._extract_tag_ids(common.get("genres", {})),
            primary_genre=self._safe_int(common.get("primary_genre")),
            categories=self._extract_categories(common.get("category", {})),
            # Platform & Compatibility
            platforms=self._parse_platforms(common.get("oslist", "")),
            controller_support=common.get("controller_support"),
            steam_deck=self._extract_steam_deck(common.get("steam_deck_compatibility", {})),
            # Features
            has_workshop="workshop" in config or common.get("workshop_visible") == "1",
            is_free=(common.get("isfreeapp") or extended.get("isfreeapp")) == "1",
            # Content
            content_descriptors=common.get("content_descriptors", {}),
            languages=common.get("languages", {}),
            # URLs
            homepage_url=extended.get("homepage") or extended.get("developer_url"),
            # State
            app_state=extended.get("state"),
            # Build info
            current_build_id=self._extract_build_id(depots),
            source_evidence=evidence,
        )

    def _extract_payload_evidence(
        self,
        *,
        raw_data: Dict[str, Any],
        appinfo: Any,
        common: Dict[str, Any],
        extended: Dict[str, Any],
        config: Dict[str, Any],
        depots: Dict[str, Any],
        common_is_mapping: bool,
    ) -> PICSPayloadEvidence:
        """Retain field presence before normalization can collapse missing to empty."""

        missing_token = bool(raw_data.get("_missing_token"))
        source_complete = (
            isinstance(appinfo, dict) and common_is_mapping and bool(common) and not missing_token
        )
        present_fields = set()

        common_fields = {
            "name": ("name",),
            "type": ("type",),
            "steam_release_date": ("steam_release_date",),
            "original_release_date": ("original_release_date",),
            "store_asset_mtime": ("store_asset_mtime",),
            "release_state": ("releasestate",),
            "review_score": ("review_score",),
            "review_percentage": ("review_percentage",),
            "metacritic_score": ("metacritic_score",),
            "metacritic_url": ("metacritic_url", "metacritic_fullurl"),
            "platforms": ("oslist",),
            "controller_support": ("controller_support",),
            "steam_deck": ("steam_deck_compatibility",),
            "content_descriptors": ("content_descriptors",),
            "languages": ("languages",),
            "primary_genre": ("primary_genre",),
        }
        for field_name, source_keys in common_fields.items():
            if any(source_key in common for source_key in source_keys):
                present_fields.add(field_name)
        if "developer" in common:
            present_fields.add("developer")
        if "publisher" in common:
            present_fields.add("publisher")

        extended_fields = {
            "developer": ("developer",),
            "publisher": ("publisher",),
            "parent_appid": ("parent",),
            "homepage_url": ("homepage", "developer_url"),
            "app_state": ("state",),
            "is_free": ("isfreeapp",),
        }
        for field_name, source_keys in extended_fields.items():
            if any(source_key in extended for source_key in source_keys):
                present_fields.add(field_name)
        if "parent" in common:
            present_fields.add("parent_appid")
        if "isfreeapp" in common:
            present_fields.add("is_free")

        if "releasestate" in common:
            present_fields.add("is_released")
        if (isinstance(appinfo, dict) and "config" in appinfo) or "workshop_visible" in common:
            present_fields.add("has_workshop")

        public_branch = (
            depots.get("branches", {}).get("public", {})
            if isinstance(depots.get("branches"), dict)
            else {}
        )
        if isinstance(public_branch, dict):
            if "timeupdated" in public_branch:
                present_fields.add("last_content_update")
            if "buildid" in public_branch:
                present_fields.add("current_build_id")

        relationship_families = {
            "associations": self._family_evidence(
                source_complete=source_complete,
                container=common,
                key="associations",
                expected_types=(dict,),
                source_path="common.associations",
                validator=self._valid_associations_family,
            ),
            "categories": self._family_evidence(
                source_complete=source_complete,
                container=common,
                key="category",
                expected_types=(dict,),
                source_path="common.category",
                validator=self._valid_categories_family,
            ),
            "genres": self._family_evidence(
                source_complete=source_complete,
                container=common,
                key="genres",
                expected_types=(dict,),
                source_path="common.genres",
                validator=self._valid_id_values_family,
            ),
            "store_tags": self._family_evidence(
                source_complete=source_complete,
                container=common,
                key="store_tags",
                expected_types=(dict,),
                source_path="common.store_tags",
                validator=self._valid_id_values_family,
            ),
            "dlc": self._family_evidence(
                source_complete=source_complete,
                container=extended,
                key="listofdlc",
                expected_types=(str, list),
                source_path="extended.listofdlc",
                validator=self._valid_dlc_family,
            ),
        }

        return PICSPayloadEvidence(
            schema_version=PICS_PAYLOAD_EVIDENCE_VERSION,
            source_complete=source_complete,
            missing_token=missing_token,
            source_change_number=self._safe_int(raw_data.get("_change_number")),
            source_sha=(
                str(raw_data["_sha"]).lower()
                if isinstance(raw_data.get("_sha"), str) and raw_data.get("_sha")
                else None
            ),
            source_size=self._safe_int(raw_data.get("_size")),
            present_fields=frozenset(present_fields),
            relationship_families=relationship_families,
        )

    @staticmethod
    def _family_evidence(
        *,
        source_complete: bool,
        container: Dict[str, Any],
        key: str,
        expected_types: tuple[type, ...],
        source_path: str,
        validator: Optional[Callable[[Any], bool]] = None,
    ) -> RelationshipFamilyEvidence:
        if not source_complete:
            status = "partial"
        elif key not in container:
            status = "absent"
        elif isinstance(container.get(key), expected_types):
            value = container.get(key)
            status = "complete" if validator is None or validator(value) else "partial"
        else:
            status = "partial"
        return RelationshipFamilyEvidence(source_path=source_path, status=status)

    @staticmethod
    def _valid_associations_family(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        return all(
            isinstance(association, dict)
            and isinstance(association.get("type"), str)
            and bool(association["type"].strip())
            and isinstance(association.get("name"), str)
            and bool(association["name"].strip())
            for association in value.values()
        )

    @staticmethod
    def _valid_categories_family(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        for category_key, enabled in value.items():
            if not isinstance(category_key, str) or not category_key.startswith("category_"):
                return False
            try:
                int(category_key.removeprefix("category_"))
            except ValueError:
                return False
            if enabled not in {"0", "1"}:
                return False
        return True

    @staticmethod
    def _valid_id_values_family(value: Any) -> bool:
        if not isinstance(value, dict):
            return False
        try:
            return all(int(item) > 0 for item in value.values())
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _valid_dlc_family(value: Any) -> bool:
        if not isinstance(value, (str, list)):
            return False
        if value == "":
            return True
        raw_values = value if isinstance(value, list) else value.split(",")
        if not raw_values:
            return True
        try:
            return all(str(item).strip() and int(str(item).strip()) > 0 for item in raw_values)
        except (TypeError, ValueError):
            return False

    def _extract_associations(self, data: Dict) -> List[Association]:
        """Extract associations from numbered dict format."""
        associations = []
        if not isinstance(data, dict):
            return associations

        for _, assoc in data.items():
            if isinstance(assoc, dict) and "type" in assoc and "name" in assoc:
                associations.append(Association(type=assoc["type"], name=assoc["name"]))
        return associations

    def _extract_tag_ids(self, data: Dict) -> List[int]:
        """Extract tag IDs from numbered dict format."""
        if not isinstance(data, dict):
            return []
        result = []
        for v in data.values():
            try:
                result.append(int(v))
            except (ValueError, TypeError):
                pass
        return result

    def _extract_categories(self, data: Dict) -> Dict[int, bool]:
        """Extract category flags as category_id -> True mapping."""
        if not isinstance(data, dict):
            return {}

        result = {}
        for k, v in data.items():
            if k.startswith("category_"):
                try:
                    cat_id = int(k.replace("category_", ""))
                    result[cat_id] = v == "1"
                except ValueError:
                    pass
        return result

    def _parse_platforms(self, oslist: str) -> List[str]:
        """Parse comma-separated platform list."""
        if not oslist:
            return []
        return [p.strip() for p in oslist.split(",") if p.strip()]

    def _parse_dlc_list(self, dlc_str: Any) -> List[int]:
        """Parse comma-separated DLC appid list."""
        if not dlc_str:
            return []
        values = dlc_str if isinstance(dlc_str, list) else str(dlc_str).split(",")
        result = []
        for x in values:
            try:
                result.append(int(str(x).strip()))
            except (TypeError, ValueError):
                pass
        return result

    def _extract_steam_deck(self, data: Dict) -> Optional[SteamDeckCompatibility]:
        """Extract Steam Deck compatibility info."""
        if not data or not isinstance(data, dict):
            return None
        return SteamDeckCompatibility(
            category=self._safe_int(data.get("category")) or 0,
            test_timestamp=self._safe_int(data.get("test_timestamp")),
            tested_build_id=data.get("tested_build_id"),
            tests=data.get("tests"),
        )

    def _extract_last_update(self, depots: Dict) -> Optional[datetime]:
        """Extract last update timestamp from public branch."""
        if not isinstance(depots, dict):
            return None
        try:
            branches = depots.get("branches", {})
            public = branches.get("public", {})
            timestamp = public.get("timeupdated")
            return self._parse_timestamp(timestamp)
        except Exception:
            return None

    def _extract_build_id(self, depots: Dict) -> Optional[str]:
        """Extract current build ID from public branch."""
        if not isinstance(depots, dict):
            return None
        try:
            branches = depots.get("branches", {})
            public = branches.get("public", {})
            return public.get("buildid")
        except Exception:
            return None

    def _parse_timestamp(self, value) -> Optional[datetime]:
        """Safely parse a Unix timestamp to a host-independent UTC value."""
        if not value:
            return None
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except (ValueError, TypeError, OSError):
            return None

    def _safe_int(self, value) -> Optional[int]:
        """Safely convert to int."""
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None
