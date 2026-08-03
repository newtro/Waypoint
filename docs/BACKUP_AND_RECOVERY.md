# Backup and recovery

Waypoint provides a local JSON workspace export and atomic restore path. This is a portability and baseline recovery mechanism, not yet a comprehensive encrypted backup system.

## Plaintext warning

**Current `.json` exports are plaintext.** They may include workspace content, attachments encoded into the archive, activity data, security-profile metadata, and AI execution history. Anyone who can read the file may be able to read that data.

Store exports only on an encrypted disk or in a backup destination whose access and retention you control. Do not email them, place them in a broadly shared folder, or upload them to a service without understanding that service's encryption, deletion, and version-retention behavior.

## Create and verify an export

1. Open the workspace you want to protect.
2. Choose **Export** in the Waypoint header.
3. Save the `.json` archive to a protected location outside Waypoint's application-data directory.
4. Keep the application open until the save completes. Waypoint writes a temporary file and renames it into place to avoid presenting a partially written archive as complete.
5. On the same compatible app version, choose **Restore**, select the archive, and confirm that a newly named restored workspace appears.
6. Inspect representative notes, chats, memories, relationships, attachments, activity, and execution history. Search restored content and then delete the disposable restored workspace objects if no longer needed.

Restore creates new object identities where required and does not overwrite the source workspace. A failed restore rolls back database changes and cleans files written by the failed attempt.

## Recovery priorities

1. Preserve the last known-good export; never edit it in place.
2. Make a copy before investigating suspected corruption.
3. Restore into a new workspace and validate it before deleting any older data.
4. Keep more than one dated recovery point in separately controlled storage.
5. After intentionally deleting sensitive material, separately expire every export, filesystem copy, snapshot, and provider-retained version containing it.

## What is not yet covered

- automatic or scheduled backups;
- encrypted Waypoint-native backup archives;
- production workspace-key recovery or rotation;
- coordinator snapshots and disaster recovery;
- recovery across unverified schema/client combinations;
- real Mac/Windows/Ubuntu multi-peer restore and deletion convergence.

Those capabilities, public release signing/notarization, and publishing/update infrastructure remain deferred. Until production compatibility rules exist, retain the exact Waypoint build used to create an important archive when practical.
