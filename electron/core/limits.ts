export const ARCHIVE_LIMITS = {
  maxFileBytes: 256 * 1024 * 1024,
  maxRowsPerTable: 100_000,
  maxStringBytes: 2_100_000,
  maxAttachments: 2_000,
  maxAttachmentBytes: 25 * 1024 * 1024,
  maxTotalAttachmentBytes: 192 * 1024 * 1024,
  maxMeetings: 100,
  maxMeetingAudioBytes: 100 * 1024 * 1024,
  maxTotalMeetingAudioBytes: 192 * 1024 * 1024,
} as const
