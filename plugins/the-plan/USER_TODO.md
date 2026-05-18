# USER_TODO — the-plan

## Blocking v0.1 completion

- [ ] [BLOCKING] User fills in END_GOALS.md detail
  - Context: System skeleton is ready; plan needs actual goals with horizon/status
  - Options: (1) Fill in sample goals for testing, (2) Skip and start with empty
  
- [ ] [BLOCKING] User picks v0.1 active wedge in data/STATE.md
  - Context: Single active goal needed to focus tend runs
  - Options: (1) Pick an actual goal from END_GOALS, (2) Create a sample wedge for testing

- [ ] [NON-BLOCKING] First manual `/plan-tend` run end-to-end
  - Context: Verify the skill works before automation
  - Note: Can defer until cron entries exist

## Blocking v0.2 cron automation

- [ ] [BLOCKING] Set up cron entries (daily/weekly/monthly/quarterly/annual)
  - Context: Cron driver (scripts/tend_driver.py) is implemented and tested, ready to invoke
  - OS-specific setup required:
    - **macOS**: Create LaunchAgent plist files in `~/Library/LaunchAgents/` for each schedule
    - **Linux**: Add entries to user crontab via `crontab -e`
  - Options: 
    - (1) Manual setup (user runs `crontab -e` with provided entries)
    - (2) Provide setup script (not yet written; would need to detect OS)
  - Suggested entries:
    ```
    # daily at 09:00
    0 9 * * * python3 /path/to/scripts/tend_driver.py /path/to/data daily
    
    # weekly Sunday at 10:00
    0 10 * * 0 python3 /path/to/scripts/tend_driver.py /path/to/data weekly
    
    # monthly first day at 09:00
    0 9 1 * * python3 /path/to/scripts/tend_driver.py /path/to/data monthly
    
    # quarterly (1st, 4th, 7th, 10th) at 09:00
    0 9 1 1,4,7,10 * python3 /path/to/scripts/tend_driver.py /path/to/data quarterly
    
    # annual Jan 1st at 09:00
    0 9 1 1 * python3 /path/to/scripts/tend_driver.py /path/to/data annual
    ```

## Next items (v1.0 onward)

Once v0.1 and v0.2 USER_TODOs are cleared:

### v1.0 — Hardening
- [ ] ETHICS refusal-protocol unit tests
- [ ] HMAC or signed-commit-based approval token scheme
- [ ] Run cron under `_claude` POSIX user (sandbox)
- [ ] Backup strategy (encrypted offsite snapshot of `data/`)

### Commands needing implementation
- [ ] `/plan-approve` — Walk approval queue, get decisions, update file and STATE
  - Current spec: commands/plan-approve.md
  - Complexity: moderate (file parsing, user interaction loop, state update)
  - Could be skill + helper script or pure skill

### Larger features (v2.0+)
- Web UI (Flask app)
- Goal-tree visualization
- Status dashboard
- Read-only mobile view
