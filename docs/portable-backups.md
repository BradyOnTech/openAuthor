# Portable backup and recovery

**Create a backup**

In Settings, use Portable Backup, choose a new `.openauthor.zip` filename, and select Create verified backup. Pending scene writing is saved first; failed saves prevent the backup. Keep a second copy on a separate drive. Revisions inside the project do not protect against loss of the whole device.

The CLI equivalent, from the project folder, is `openauthor backup create --target /absolute/path/novel.openauthor.zip --json`.

**Recover a book**

From the project chooser, select Restore backup, select the archive and a new or empty recovery folder, then Verify and restore. Existing folders containing data are rejected. Checksums and paths are checked before extraction, the Story Memory database is rebuilt from its JSON snapshot, and reachable Revision objects are verified before the recovered project is published.

Recovery can run outside a project: `openauthor backup restore --source /absolute/path/novel.openauthor.zip --target /absolute/path/recovered-book --json`. Use `openauthor backup verify --source /absolute/path/novel.openauthor.zip --json` for a checksum-only archive check without restoring.

**Included and excluded**

- Includes manuscript files, Plan, Story Memory, Revision objects/history, project configuration, Change Sets, chats, and generation provenance.
- Includes local Storyline branches as a Git bundle. Their committed history may contain more than the currently visible book if the project was also used as a general Git repository.
- Does not copy provider credential stores, environment files, database journals, Git hooks/configuration/remotes, caches, or recovery drafts that have not successfully saved.
- Archives are not encrypted. They include earlier prose and prompts, including material later removed from the current manuscript. Treat them as private author data.
- Hash verification detects corruption; it does not authenticate the sender. Restore only archives you trust.
- Recovery preserves the book identity. Opening the recovered copy updates this device's project binding to that folder; the original folder remains untouched.

**Runtime and release evidence**

Packaged builds carry a local-only Git executable so Storylines and branch recovery do not depend on system Git. The checksum-pinned source and license are shipped beside the executable. The builder uses Git's [official source distribution](https://www.kernel.org/pub/software/scm/git/) and native architecture runners documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

`scripts/verify_packaged_recovery.py` tests the bundled runtime with system tools absent from PATH. It is not a substitute for signed-app installation, GUI interaction, or an upgrade drill on a clean Mac.
