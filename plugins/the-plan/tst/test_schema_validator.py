"""
Tests for the-plan schema validator.

Validates frontmatter, parent references, status invariants, IDs, and triggers.
"""

import sys
import tempfile
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from schema_validator import SchemaValidator, ValidationError


@pytest.fixture
def temp_data_dir():
    """Create a temporary data directory for tests."""
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = Path(tmpdir) / "data"
        data_dir.mkdir()
        (data_dir / "END_GOALS").mkdir()
        (data_dir / "GOALS").mkdir()
        (data_dir / "INITIATIVES").mkdir()
        (data_dir / "ENABLERS").mkdir()
        (data_dir / "TASKS").mkdir()
        yield data_dir


@pytest.fixture
def validator(temp_data_dir):
    """Create a validator instance."""
    return SchemaValidator(temp_data_dir)


class TestFrontmatterValidation:
    """Test frontmatter field presence and type validation."""

    def test_missing_id_field(self, temp_data_dir, validator):
        """Raise error if id field is missing."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\ntype: end-goal\nparent: null\nconfidence: 0.5\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="id.*required"):
            validator.validate_node(node)

    def test_missing_type_field(self, temp_data_dir, validator):
        """Raise error if type field is missing."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\nparent: null\nconfidence: 0.5\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="type.*required"):
            validator.validate_node(node)

    def test_missing_confidence_field(self, temp_data_dir, validator):
        """Raise error if confidence field is missing."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="confidence.*required"):
            validator.validate_node(node)

    def test_invalid_confidence_value(self, temp_data_dir, validator):
        """Raise error if confidence is not a number between 0 and 1."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 1.5\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="confidence.*0.*1"):
            validator.validate_node(node)

    def test_invalid_status_value(self, temp_data_dir, validator):
        """Raise error if status is not a valid enum."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.5\nhorizon: epic\nstatus: invalid\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="status.*must be one of"):
            validator.validate_node(node)

    def test_invalid_horizon_value(self, temp_data_dir, validator):
        """Raise error if horizon is not a valid enum."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.5\nhorizon: invalid\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="horizon.*must be one of"):
            validator.validate_node(node)

    def test_valid_minimal_node(self, temp_data_dir, validator):
        """Accept node with all required fields."""
        node = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(node)


class TestParentReferences:
    """Test parent field resolution and hierarchy rules."""

    def test_parent_reference_resolves(self, temp_data_dir, validator):
        """Parent reference must resolve to existing node."""
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: nonexistent\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(eg)
        with pytest.raises(ValidationError, match="parent.*nonexistent.*not found"):
            validator.validate_node(goal)

    def test_valid_parent_reference(self, temp_data_dir, validator):
        """Valid parent reference passes validation."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(eg)
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(goal)

    def test_hierarchy_violation_goal_under_goal(self, temp_data_dir, validator):
        """Goal cannot have goal as parent."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(eg)
        goal1 = temp_data_dir / "GOALS" / "goal-parent.md"
        goal1.write_text(
            "---\nid: goal-parent\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(goal1)
        goal2 = temp_data_dir / "GOALS" / "goal-child.md"
        goal2.write_text(
            "---\nid: goal-child\ntype: goal\nparent: goal-parent\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="goal.*parent.*must be.*pillar.*end-goal"):
            validator.validate_node(goal2)


class TestStatusInvariants:
    """Test status-related rules."""

    def test_active_node_under_parked_parent(self, temp_data_dir, validator):
        """Active node cannot have parked parent."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: parked\n---\n# Test\n"
        )
        validator.validate_node(eg)
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: active\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="active.*parent.*status.*parked"):
            validator.validate_node(goal)

    def test_active_node_under_abandoned_parent(self, temp_data_dir, validator):
        """Active node cannot have abandoned parent."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: abandoned\n---\n# Test\n"
        )
        validator.validate_node(eg)
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: active\n---\n# Test\n"
        )
        with pytest.raises(ValidationError, match="active.*parent.*status.*abandoned"):
            validator.validate_node(goal)

    def test_done_node_under_active_parent(self, temp_data_dir, validator):
        """Done node can have active parent."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: active\n---\n# Test\n"
        )
        validator.validate_node(eg)
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: done\n---\n# Test\n"
        )
        validator.validate_node(goal)


class TestIdUniqueness:
    """Test ID uniqueness across all nodes."""

    def test_duplicate_id_error(self, temp_data_dir, validator):
        """Raise error if two nodes have the same ID."""
        node1 = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node1.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        node2 = temp_data_dir / "GOALS" / "duplicate.md"
        node2.write_text(
            "---\nid: eg1-awakening\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        result = validator.validate_all()
        assert not result.is_valid
        assert any("already exists" in error for error in result.errors)


class TestConditionalHorizon:
    """Test conditional horizon nodes have trigger conditions."""

    def test_conditional_without_trigger(self, temp_data_dir, validator):
        """Conditional node must have trigger condition in body."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(eg)
        node = temp_data_dir / "GOALS" / "conditional-example.md"
        node.write_text(
            "---\nid: goal-conditional\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: conditional\nstatus: draft\n---\n# Test\n\nNo conditional logic here.\n"
        )
        with pytest.raises(ValidationError, match="conditional.*trigger.*condition"):
            validator.validate_node(node)

    def test_conditional_with_trigger(self, temp_data_dir, validator):
        """Conditional node with trigger condition passes."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        validator.validate_node(eg)
        node = temp_data_dir / "GOALS" / "conditional-example.md"
        node.write_text(
            "---\nid: goal-conditional\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: conditional\nstatus: draft\n---\n# Test\n\n## Trigger\n\nWhen EG-4 stalls, pivot to this.\n"
        )
        validator.validate_node(node)


class TestValidateAll:
    """Test full validation across entire tree."""

    def test_validate_all_clean_tree(self, temp_data_dir, validator):
        """Valid tree passes full validation."""
        eg = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        eg.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 0.65\nhorizon: epic\nstatus: active\n---\n# Test\n"
        )
        goal = temp_data_dir / "GOALS" / "goal-example.md"
        goal.write_text(
            "---\nid: goal-example\ntype: goal\nparent: eg1-awakening\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        result = validator.validate_all()
        assert result.is_valid
        assert len(result.errors) == 0

    def test_validate_all_with_errors(self, temp_data_dir, validator):
        """Validation collects all errors."""
        node1 = temp_data_dir / "END_GOALS" / "eg1-awakening.md"
        node1.write_text(
            "---\nid: eg1-awakening\ntype: end-goal\nparent: null\nconfidence: 2.0\nhorizon: epic\nstatus: draft\n---\n# Test\n"
        )
        node2 = temp_data_dir / "GOALS" / "goal-bad.md"
        node2.write_text(
            "---\nid: goal-bad\ntype: goal\nparent: nonexistent\nconfidence: 0.5\nhorizon: medium\nstatus: draft\n---\n# Test\n"
        )
        result = validator.validate_all()
        assert not result.is_valid
        assert len(result.errors) >= 2
