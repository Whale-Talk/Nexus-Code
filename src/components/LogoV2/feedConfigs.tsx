import figures from 'figures';
import { homedir } from 'os';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Step } from '../../projectOnboardingState.js';
import type { LogOption } from '../../types/logs.js';
import { getCwd } from '../../utils/cwd.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import type { FeedConfig, FeedLine } from './Feed.js';
export function createRecentActivityFeed(activities: LogOption[]): FeedConfig {
  const lines: FeedLine[] = activities.map(log => {
    const time = formatRelativeTimeAgo(log.modified);
    const description = log.summary && log.summary !== 'No prompt' ? log.summary : log.firstPrompt;
    return {
      text: description || '',
      timestamp: time
    };
  });
  return {
    title: '最近活动',
    lines,
    footer: lines.length > 0 ? '/resume for more' : undefined,
    emptyMessage: '暂无最近活动'
  };
}
export function createWhatsNewFeed(releaseNotes: string[]): FeedConfig {
  const lines: FeedLine[] = releaseNotes.map(note => {
    if ("external" === 'development') {
      const match = note.match(/^(\d+\s+\w+\s+ago)\s+(.+)$/);
      if (match) {
        return {
          timestamp: match[1],
          text: match[2] || ''
        };
      }
    }
    return {
      text: note
    };
  });
  const emptyMessage = "external" === 'development' ? 'Unable to fetch latest nexus-cli-internal commits' : '请查看 Nexus Code 更新日志';
  return {
    title: "external" === 'development' ? "What's new [ANT-ONLY]" : '更新内容',
    lines,
    footer: lines.length > 0 ? '/release-notes for more' : undefined,
    emptyMessage
  };
}
export function createProjectOnboardingFeed(steps: Step[]): FeedConfig {
  const enabledSteps = steps.filter(({
    isEnabled
  }) => isEnabled).sort((a, b) => Number(a.isComplete) - Number(b.isComplete));
  const lines: FeedLine[] = enabledSteps.map(({
    text,
    isComplete
  }) => {
    const checkmark = isComplete ? `${figures.tick} ` : '';
    return {
      text: `${checkmark}${text}`
    };
  });
  const warningText = getCwd() === homedir() ? '提示：您已在主目录启动 nexus。为了获得最佳体验，请在项目目录中启动。' : undefined;
  if (warningText) {
    lines.push({
      text: warningText
    });
  }
  return {
    title: '新手入门提示',
    lines
  };
}
