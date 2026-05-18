"""Tests for the tend_driver cron script."""

import sys
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from tend_driver import TendDriver, DriverError


@pytest.fixture
def temp_data_dir() -> None:
    """Create a temporary data directory with required files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        data_dir = Path(tmpdir) / "data"
        data_dir.mkdir()
        (data_dir / "ETHICS.md").write_text("# Ethics\n\nRefusal protocol.")
        (data_dir / "STATE.md").write_text("---\nid: state\ntype: state\n---\n# State\n")
        (data_dir / "LOG").mkdir()
        yield data_dir  # type: ignore


@pytest.fixture
def driver(temp_data_dir: Path) -> TendDriver:
    """Create a TendDriver instance."""
    return TendDriver(temp_data_dir)


class TestTendDriverInit:
    """Test TendDriver initialization."""

    def test_init_with_valid_data_dir(self, temp_data_dir: Path) -> None:
        """Initialize with valid data directory."""
        driver = TendDriver(temp_data_dir)
        assert driver.data_dir == temp_data_dir

    def test_init_raises_on_missing_data_dir(self, tmp_path: Path) -> None:
        """Raise error if data directory does not exist."""
        missing_dir = tmp_path / "nonexistent"
        with pytest.raises(DriverError, match="data directory.*not found"):
            TendDriver(missing_dir)

    def test_init_raises_on_missing_ethics(self, temp_data_dir: Path) -> None:
        """Raise error if ETHICS.md is missing."""
        (temp_data_dir / "ETHICS.md").unlink()
        with pytest.raises(DriverError, match="ETHICS.md.*required"):
            TendDriver(temp_data_dir)


class TestTendDriverDailyTend:
    """Test daily tend operation."""

    @patch("tend_driver.subprocess.run")
    def test_daily_tend_runs_claude(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Daily tend invokes Claude with daily prompt."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("daily")
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert "claude" in call_args[0][0]
        assert "-p" in call_args[0][0]

    @patch("tend_driver.subprocess.run")
    def test_daily_tend_passes_data_dir(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Daily tend passes data directory to Claude."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("daily")
        call_args = mock_run.call_args
        assert str(driver.data_dir) in call_args[0][0]

    @patch("tend_driver.subprocess.run")
    def test_daily_tend_returns_zero_on_success(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Daily tend returns exit code 0 on success."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Success")
        exit_code = driver.run("daily")
        assert exit_code == 0

    @patch("tend_driver.subprocess.run")
    def test_daily_tend_returns_nonzero_on_claude_failure(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Daily tend returns non-zero exit code if Claude fails."""
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        exit_code = driver.run("daily")
        assert exit_code != 0


class TestTendDriverWeeklyReview:
    """Test weekly review operation."""

    @patch("tend_driver.subprocess.run")
    def test_weekly_review_runs_claude(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Weekly review invokes Claude."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("weekly")
        mock_run.assert_called_once()

    @patch("tend_driver.subprocess.run")
    def test_monthly_recalibrate_runs_claude(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Monthly recalibrate invokes Claude."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("monthly")
        mock_run.assert_called_once()

    @patch("tend_driver.subprocess.run")
    def test_quarterly_anchor_check_runs_claude(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Quarterly anchor check invokes Claude."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("quarterly")
        mock_run.assert_called_once()

    @patch("tend_driver.subprocess.run")
    def test_annual_epic_review_runs_claude(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Annual epic review invokes Claude."""
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        driver.run("annual")
        mock_run.assert_called_once()


class TestTendDriverInvalidOperation:
    """Test error handling for invalid operations."""

    def test_invalid_operation_raises_error(self, driver: TendDriver) -> None:
        """Invalid operation raises DriverError."""
        with pytest.raises(DriverError, match="unknown.*operation"):
            driver.run("invalid")


class TestTendDriverLogging:
    """Test logging behavior."""

    @patch("tend_driver.subprocess.run")
    def test_logs_operation_to_log_dir(
        self, mock_run: Mock, driver: TendDriver
    ) -> None:
        """Operation result is logged to LOG directory."""
        mock_run.return_value = MagicMock(returncode=0, stdout="Output from Claude")
        driver.run("daily")
        log_files = list((driver.data_dir / "LOG").glob("*.md"))
        assert len(log_files) > 0
