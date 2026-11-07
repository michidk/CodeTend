# Repository controls

Add an Automatic scanning switch and Archive button directly to dashboard cards and repository details. Keep all stored scan data. Archiving disables scheduling, clears pending scheduled work, and moves the card into a collapsed Archived repositories section at the bottom. Restore returns the card with scheduling off. Running scans finish and manual scans remain available.

## Approaches

Reuse the existing scheduleEnabled setting and add an archived flag. A separate archive table would duplicate repository identity; deleting repositories would discard history. Existing edit forms remain available, but cannot enable scheduling for archived repositories.
