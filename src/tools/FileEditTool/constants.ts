// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .nexus/ folder
export const NEXUS_FOLDER_PERMISSION_PATTERN = '/.nexus/**'

// Permission pattern for granting session-level access to the global ~/.nexus/ folder
export const GLOBAL_NEXUS_FOLDER_PERMISSION_PATTERN = '~/.nexus/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
