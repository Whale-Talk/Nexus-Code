import { basename, join, sep } from 'path';
import { getNexusConfigHomeDir } from '../../../utils/envUtils.js';
import React, { type ReactNode } from 'react';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { Text } from '../../../ink.js';
import { getShortcutDisplay } from '../../../keybindings/shortcutFormat.js';
import type { ToolPermissionContext } from '../../../Tool.js';
import { expandPath, getDirectoryForPath } from '../../../utils/path.js';
import { normalizeCaseForComparison, pathInAllowedWorkingPath } from '../../../utils/permissions/filesystem.js';
import type { OptionWithDescription } from '../../CustomSelect/select.js';
/**
 * Check if a path is within the project's .nexus/ folder.
 * This is used to determine whether to show the special ".nexus folder" permission option.
 */
export function isInNexusFolder(filePath: string): boolean {
  const absolutePath = expandPath(filePath);
  const nexusFolderPath = expandPath(`${getOriginalCwd()}/.nexus`);

  // Check if the path is within the project's .nexus folder
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedNexusFolderPath = normalizeCaseForComparison(nexusFolderPath);

  // Path must start with the .nexus folder path (and be inside it, not just the folder itself)
  return normalizedAbsolutePath.startsWith(normalizedNexusFolderPath + sep.toLowerCase()) ||
  // Also match case where sep is / on posix systems
  normalizedAbsolutePath.startsWith(normalizedNexusFolderPath + '/');
}

/**
 * Check if a path is within the global ~/.nexus/ folder.
 * This is used to determine whether to show the special ".nexus folder" permission option
 * for files in the user's home directory.
 */
export function isInGlobalNexusFolder(filePath: string): boolean {
  const absolutePath = expandPath(filePath);
  const globalNexusFolderPath = getNexusConfigHomeDir();
  const normalizedAbsolutePath = normalizeCaseForComparison(absolutePath);
  const normalizedGlobalNexusFolderPath = normalizeCaseForComparison(globalNexusFolderPath);
  return normalizedAbsolutePath.startsWith(normalizedGlobalNexusFolderPath + sep.toLowerCase()) || normalizedAbsolutePath.startsWith(normalizedGlobalNexusFolderPath + '/');
}
export type PermissionOption = {
  type: 'accept-once';
} | {
  type: 'accept-session';
  scope?: 'nexus-folder' | 'global-nexus-folder';
} | {
  type: 'reject';
};
export type PermissionOptionWithLabel = OptionWithDescription<string> & {
  option: PermissionOption;
};
export type FileOperationType = 'read' | 'write' | 'create';
export function getFilePermissionOptions({
  filePath,
  toolPermissionContext,
  operationType = 'write',
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false
}: {
  filePath: string;
  toolPermissionContext: ToolPermissionContext;
  operationType?: FileOperationType;
  onRejectFeedbackChange?: (value: string) => void;
  onAcceptFeedbackChange?: (value: string) => void;
  yesInputMode?: boolean;
  noInputMode?: boolean;
}): PermissionOptionWithLabel[] {
  const options: PermissionOptionWithLabel[] = [];
  const modeCycleShortcut = getShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab');

  // When in input mode, show input field
  if (yesInputMode && onAcceptFeedbackChange) {
    options.push({
      type: 'input',
      label: '仅允许本次',
      value: 'yes',
      placeholder: '可附上后续指示',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'accept-once'
      }
    });
  } else {
    options.push({
      label: '仅允许本次',
      value: 'yes',
      option: {
        type: 'accept-once'
      }
    });
  }
  const inAllowedPath = pathInAllowedWorkingPath(filePath, toolPermissionContext);

  // Check if this is a .nexus/ folder path (project or global)
  const inNexusFolder = isInNexusFolder(filePath);
  const inGlobalNexusFolder = isInGlobalNexusFolder(filePath);

  // Option 2: For .nexus/ folder, show special option instead of generic session option
  // Note: Session-level options are always shown since they only affect in-memory state,
  // not persisted settings. The allowManagedPermissionRulesOnly setting only restricts
  // persisted permission rules.
  if ((inNexusFolder || inGlobalNexusFolder) && operationType !== 'read') {
    options.push({
      label: `本次会话允许编辑${inGlobalNexusFolder ? '用户' : '项目'}的 .nexus 配置`,
      value: 'yes-nexus-folder',
      option: {
        type: 'accept-session',
        scope: inGlobalNexusFolder ? 'global-nexus-folder' : 'nexus-folder'
      }
    });
  } else {
    // Option 2: Allow all changes/reads during session
    let sessionLabel: ReactNode;
    if (inAllowedPath) {
      // Inside working directory
      if (operationType === 'read') {
        sessionLabel = '本次会话允许读取工作区文件';
      } else {
        sessionLabel = <Text>
            本次会话允许编辑工作区文件{' '}
            <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    } else {
      // Outside working directory - include directory name
      const dirPath = getDirectoryForPath(filePath);
      const dirName = basename(dirPath);
      const displayDirectory = dirName ? dirName + sep : dirPath;
      if (operationType === 'read') {
        sessionLabel = <Text>
            本次会话允许读取 <Text bold>{displayDirectory}</Text>
          </Text>;
      } else {
        sessionLabel = <Text>
            本次会话允许编辑 <Text bold>{displayDirectory}</Text> <Text bold>({modeCycleShortcut})</Text>
          </Text>;
      }
    }
    options.push({
      label: sessionLabel,
      value: 'yes-session',
      option: {
        type: 'accept-session'
      }
    });
  }

  // When in input mode, show input field for reject
  if (noInputMode && onRejectFeedbackChange) {
    options.push({
      type: 'input',
      label: '拒绝',
      value: 'no',
      placeholder: '可说明希望如何调整',
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true,
      option: {
        type: 'reject'
      }
    });
  } else {
    // Not in input mode - simple option
    options.push({
      label: '拒绝',
      value: 'no',
      option: {
        type: 'reject'
      }
    });
  }
  return options;
}
