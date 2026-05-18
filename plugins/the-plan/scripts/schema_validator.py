"""
Schema validator for the-plan markdown tree.

Validates frontmatter, parent references, status invariants, IDs, and trigger conditions.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re
import yaml


class ValidationError(Exception):
    """Raised when validation fails."""

    pass


class ValidationResult:
    """Result of a validation pass."""

    def __init__(self):
        self.errors: List[str] = []
        self.is_valid: bool = True

    def add_error(self, message: str) -> None:
        """Add an error message."""
        self.errors.append(message)
        self.is_valid = False


class SchemaValidator:
    """Validates the-plan schema."""

    VALID_TYPES = {"end-goal", "pillar", "goal", "initiative", "milestone", "task", "enabler"}
    VALID_STATUSES = {"draft", "active", "parked", "done", "abandoned"}
    VALID_HORIZONS = {"short", "medium", "long", "epic", "conditional"}

    REQUIRED_FIELDS = {"id", "type", "parent", "confidence", "horizon", "status"}

    HIERARCHY_RULES = {
        "pillar": ["end-goal"],
        "goal": ["pillar", "end-goal"],
        "initiative": ["goal"],
        "milestone": ["initiative"],
        "task": ["initiative", "milestone"],
        "enabler": ["end-goal", "pillar", "goal", None],
    }

    def __init__(self, data_dir: Path):
        """Initialize validator with data directory."""
        self.data_dir = Path(data_dir)
        self.nodes: Dict[str, Dict] = {}

    def validate_node(self, node_path: Path) -> None:
        """Validate a single node file."""
        try:
            frontmatter, body = self._parse_file(node_path)
        except Exception as e:
            raise ValidationError(f"{node_path.name}: failed to parse: {e}")

        self._validate_frontmatter(node_path, frontmatter)

        node_id = frontmatter.get("id")
        if node_id and node_id not in self.nodes:
            self.nodes[node_id] = {"file": node_path.name, "frontmatter": frontmatter, "body": body}

        self._validate_parent_reference(node_path, frontmatter)
        self._validate_hierarchy(node_path, frontmatter)
        self._validate_status_invariants(node_path, frontmatter)
        self._validate_horizon(node_path, frontmatter, body)

    def validate_all(self) -> ValidationResult:
        """Validate entire tree and return all errors."""
        result = ValidationResult()

        self.nodes = {}
        node_files: List[Path] = []

        for subdir in ["END_GOALS", "GOALS", "INITIATIVES", "ENABLERS", "TASKS"]:
            category_dir = self.data_dir / subdir
            if category_dir.exists():
                node_files.extend(sorted(category_dir.glob("*.md")))

        for node_file in node_files:
            try:
                frontmatter, body = self._parse_file(node_file)
            except Exception as e:
                result.add_error(f"{node_file.name}: failed to parse: {e}")
                continue

            node_id = frontmatter.get("id")
            if node_id in self.nodes:
                result.add_error(f"ID '{node_id}' already exists (first at {self.nodes[node_id]['file']}, duplicate at {node_file.name})")
                continue

            self.nodes[node_id] = {"file": node_file.name, "frontmatter": frontmatter, "body": body}

        for node_file in node_files:
            try:
                frontmatter, body = self._parse_file(node_file)
            except Exception:
                continue

            errors = self._validate_node_comprehensive(node_file, frontmatter, body)
            result.errors.extend(errors)

        if result.errors:
            result.is_valid = False

        return result

    def _parse_file(self, path: Path) -> Tuple[Dict, str]:
        """Parse frontmatter and body from markdown file."""
        content = path.read_text()

        if not content.startswith("---"):
            raise ValidationError("file does not start with ---")

        try:
            parts = content.split("---", 2)
            if len(parts) < 3:
                raise ValidationError("incomplete frontmatter")

            frontmatter = yaml.safe_load(parts[1])
            body = parts[2].strip()

            if not isinstance(frontmatter, dict):
                raise ValidationError("frontmatter is not valid YAML")

            return frontmatter, body
        except yaml.YAMLError as e:
            raise ValidationError(f"YAML parse error: {e}")

    def _validate_frontmatter(self, path: Path, frontmatter: Dict) -> None:
        """Validate required frontmatter fields."""
        for field in self.REQUIRED_FIELDS:
            if field not in frontmatter:
                raise ValidationError(f"{path.name}: '{field}' field is required")

        if not isinstance(frontmatter["id"], str):
            raise ValidationError(f"{path.name}: 'id' must be a string")

        if frontmatter["type"] not in self.VALID_TYPES:
            raise ValidationError(
                f"{path.name}: 'type' must be one of {', '.join(sorted(self.VALID_TYPES))}"
            )

        if frontmatter["status"] not in self.VALID_STATUSES:
            raise ValidationError(
                f"{path.name}: 'status' must be one of {', '.join(sorted(self.VALID_STATUSES))}"
            )

        if frontmatter["horizon"] not in self.VALID_HORIZONS:
            raise ValidationError(
                f"{path.name}: 'horizon' must be one of {', '.join(sorted(self.VALID_HORIZONS))}"
            )

        try:
            conf = float(frontmatter["confidence"])
            if not (0.0 <= conf <= 1.0):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValidationError(f"{path.name}: 'confidence' must be a number between 0 and 1")

    def _validate_parent_reference(self, path: Path, frontmatter: Dict) -> None:
        """Validate parent field references existing node."""
        parent = frontmatter.get("parent")

        if parent is None:
            node_type = frontmatter.get("type")
            if node_type != "end-goal":
                raise ValidationError(
                    f"{path.name}: only end-goal nodes can have parent: null"
                )
            return

        if not isinstance(parent, str):
            raise ValidationError(f"{path.name}: 'parent' must be a string or null")

        if parent not in self.nodes:
            raise ValidationError(
                f"{path.name}: parent '{parent}' not found in tree"
            )

    def _validate_hierarchy(self, path: Path, frontmatter: Dict) -> None:
        """Validate parent-child type relationships."""
        node_type = frontmatter.get("type")
        parent_id = frontmatter.get("parent")

        if parent_id is None:
            return

        if parent_id not in self.nodes:
            return

        parent_node = self.nodes[parent_id]
        parent_type = parent_node["frontmatter"].get("type")

        allowed_parents = self.HIERARCHY_RULES.get(node_type, [])
        if parent_type not in allowed_parents:
            raise ValidationError(
                f"{path.name}: {node_type} node's parent must be one of {', '.join(allowed_parents)}, not {parent_type}"
            )

    def _validate_status_invariants(self, path: Path, frontmatter: Dict) -> None:
        """Validate status constraints."""
        status = frontmatter.get("status")
        parent_id = frontmatter.get("parent")

        if status != "active" or parent_id is None:
            return

        if parent_id not in self.nodes:
            return

        parent_node = self.nodes[parent_id]
        parent_status = parent_node["frontmatter"].get("status")

        if parent_status in {"parked", "abandoned"}:
            raise ValidationError(
                f"{path.name}: active node cannot have parent with status '{parent_status}' (parent must be draft or done)"
            )

    def _validate_horizon(self, path: Path, frontmatter: Dict, body: str) -> None:
        """Validate conditional horizon nodes have trigger conditions."""
        horizon = frontmatter.get("horizon")

        if horizon != "conditional":
            return

        if not re.search(r"(?:trigger|when|if)", body, re.IGNORECASE):
            raise ValidationError(
                f"{path.name}: conditional horizon node must have a trigger condition in the body"
            )

    def _validate_node_comprehensive(
        self, path: Path, frontmatter: Dict, body: str
    ) -> List[str]:
        """Validate a node and return list of errors (not exceptions)."""
        errors = []

        try:
            self._validate_frontmatter(path, frontmatter)
        except ValidationError as e:
            errors.append(str(e))

        try:
            self._validate_parent_reference(path, frontmatter)
        except ValidationError as e:
            errors.append(str(e))

        try:
            self._validate_hierarchy(path, frontmatter)
        except ValidationError as e:
            errors.append(str(e))

        try:
            self._validate_status_invariants(path, frontmatter)
        except ValidationError as e:
            errors.append(str(e))

        try:
            self._validate_horizon(path, frontmatter, body)
        except ValidationError as e:
            errors.append(str(e))

        return errors


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python schema_validator.py <data_dir>")
        sys.exit(1)

    data_dir = Path(sys.argv[1])
    if not data_dir.exists():
        print(f"Error: {data_dir} does not exist")
        sys.exit(1)

    validator = SchemaValidator(data_dir)
    result = validator.validate_all()

    if result.errors:
        print(f"Validation failed with {len(result.errors)} error(s):")
        for error in result.errors:
            print(f"  - {error}")
        sys.exit(1)
    else:
        print("Validation passed!")
        sys.exit(0)
