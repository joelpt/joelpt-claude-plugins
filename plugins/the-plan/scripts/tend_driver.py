"""Cron driver for the-plan daily/weekly/monthly/quarterly/annual runs."""

from pathlib import Path
import subprocess
from datetime import datetime


class DriverError(Exception):
    """Raised when driver encounters an error."""

    pass


class TendDriver:
    """Manages automated tend-the-plan runs via cron."""

    VALID_OPERATIONS = {"daily", "weekly", "monthly", "quarterly", "annual"}

    def __init__(self, data_dir: Path) -> None:
        """Initialize driver with data directory."""
        self.data_dir = Path(data_dir)

        if not self.data_dir.exists():
            raise DriverError(f"data directory {self.data_dir} not found")

        ethics_file = self.data_dir / "ETHICS.md"
        if not ethics_file.exists():
            raise DriverError(f"ETHICS.md is required but not found in {self.data_dir}")

    def run(self, operation: str) -> int:
        """Run the specified operation (daily/weekly/monthly/quarterly/annual)."""
        if operation not in self.VALID_OPERATIONS:
            raise DriverError(f"unknown operation: {operation}")

        try:
            result = subprocess.run(
                ["claude", "-p", "tend-the-plan", str(self.data_dir), operation],
                capture_output=True,
                text=True,
            )

            self._log_result(operation, result)
            return result.returncode
        except Exception as e:
            raise DriverError(f"failed to run {operation}: {e}")

    def _log_result(self, operation: str, result: subprocess.CompletedProcess) -> None:
        """Log operation result to LOG directory."""
        log_dir = self.data_dir / "LOG"
        log_dir.mkdir(exist_ok=True)

        today = datetime.now().strftime("%Y-%m-%d")
        log_file = log_dir / f"{today}.md"

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = (
            f"## {operation} at {timestamp}\n\n"
            f"**Status**: {'success' if result.returncode == 0 else 'failed'}\n\n"
            f"**Output**:\n\n```\n{result.stdout}\n```\n\n"
        )

        if result.stderr:
            log_entry += f"**Errors**:\n\n```\n{result.stderr}\n```\n\n"

        if log_file.exists():
            log_file.write_text(log_file.read_text() + log_entry)
        else:
            log_file.write_text(log_entry)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Usage: python tend_driver.py <data_dir> <operation>")
        sys.exit(1)

    data_dir = Path(sys.argv[1])
    operation = sys.argv[2]

    try:
        driver = TendDriver(data_dir)
        exit_code = driver.run(operation)
        sys.exit(exit_code)
    except DriverError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
