# Development Setup

This project uses pre-commit hooks to ensure code quality and consistency. Follow the instructions below to set up your development environment.

## Quick Start

For **macOS**, **Ubuntu/Debian**, **Fedora/RHEL**, **Arch Linux**, and **WSL** users, hook dependencies will be automatically installed on first commit if missing. Just install pre-commit and run the setup command below.

For **Windows** (Git Bash), Node.js must be installed manually, but npm packages (prettier, eslint, stylelint) will auto-install.

For other platforms, follow the detailed instructions in the Prerequisites section.

## Prerequisites

### Install Pre-commit

Pre-commit is required to run git hooks automatically before each commit.

**macOS:**

```bash
brew install pre-commit
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install pre-commit
```

**Fedora/RHEL:**

```bash
sudo dnf install pre-commit
# OR for older versions:
sudo yum install pre-commit
```

**Arch Linux:**

```bash
sudo pacman -S pre-commit
```

**Windows:**

```bash
# Using pip (in PowerShell or Git Bash)
pip install pre-commit

# Or using pipx (recommended)
pipx install pre-commit
```

**WSL (Windows Subsystem for Linux):**

```bash
# Follow Ubuntu/Debian instructions above
sudo apt update
sudo apt install pre-commit
```

### Hook Dependencies (Auto-Installed)

**Good news!** For most platforms, all hook dependencies are automatically installed on your first commit:

- ✅ **Auto-installed on**: macOS, Ubuntu/Debian, Fedora/RHEL, Arch Linux, Alpine Linux, FreeBSD, WSL
- ⚠️ **Windows users**: Node.js and shfmt must be installed manually (see below)

**Dependencies that will be auto-installed:**

- Node.js, npm (if not already present)
- prettier (CSS/HTML/JSON/YAML formatting)
- eslint (JavaScript linting)
- stylelint (CSS linting)
- markdownlint-cli (Markdown linting)
- shfmt (Shell script formatting)

### Manual Installation (Windows Only)

**Windows users** need to install these manually before the first commit:

**Node.js:**

```bash
# Download from https://nodejs.org/
# Or use winget:
winget install OpenJS.NodeJS
```

**shfmt:**

```bash
# Download from https://github.com/mvdan/sh/releases
# Or use winget:
winget install shfmt
```

After installing Node.js, the npm packages (prettier, eslint, stylelint, markdownlint-cli) will auto-install on first commit.

## Setup Pre-commit Hooks

After installing the prerequisites, run the following command in the repository root:

```bash
pre-commit install --install-hooks
```

This will:

1. Install the pre-commit hooks into your local `.git/hooks/` directory
2. Download and cache all hook dependencies

## Markdown Linting Configuration

This project uses **markdownlint** with a configuration inspired by [MADR (Markdown Architectural Decision Records)](https://github.com/adr/madr). The configuration is optimized for technical documentation including ADRs (Architecture Decision Records).

### Key Configuration Decisions

**One-Sentence-Per-Line Style** (MD013 disabled)

- Sentences can exceed 80 characters, especially when containing links or technical content
- This approach is better for git diffs and code reviews
- Example: "For more information, see [this documentation](https://example.com/very/long/url)."

**Duplicate Headings Allowed** (MD024 disabled)

- Common section names like "Examples", "References", "Implementation" are allowed across multiple documents
- ADR titles may repeat (ADR-0001, ADR-0002, etc.)

See `.markdownlint.yaml` in the repository root for the complete configuration.

## Project-Specific Hooks (Optional)

This repository uses a shared pre-commit configuration that provides common code quality checks across all projects. If you need to add project-specific pre-commit hooks:

1. Create a file named `.pre-commit-config-local.yaml` in the repository root
2. Add your custom hooks following the pre-commit format
3. Commit `.pre-commit-config-local.yaml` to the repository

Example `.pre-commit-config-local.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: run-tests
        name: "Project: run unit tests"
        entry: pytest
        language: system
        pass_filenames: false
```

The local hooks will run automatically after the common hooks.

## Verifying Setup

To verify everything is working correctly:

```bash
pre-commit run --all-files
```

This will run all hooks against all files in the repository.

## Troubleshooting

### "command not found: prettier" or similar errors

Make sure all dependencies are installed and available in your PATH. You may need to restart your terminal or run:

```bash
hash -r  # Refresh shell command cache
```

### Pre-commit hooks fail after updating

If hooks fail after pulling updates, try reinstalling:

```bash
pre-commit clean
pre-commit install --install-hooks
```

### Skipping hooks temporarily

If you need to commit without running hooks (not recommended):

```bash
git commit --no-verify -m "your message"
```
