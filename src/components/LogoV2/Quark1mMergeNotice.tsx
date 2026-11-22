import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useEffect, useState } from 'react';
import { UP_ARROW } from '../../constants/figures.js';
import { Box, Text } from '../../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { getContextWindowForModel, is1mContextDisabled } from '../../utils/context.js';
import { getMainLoopModel } from '../../utils/model/model.js';
import { getCatalogModel } from '../../services/api/provider/catalog.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { AnimatedAsterisk } from './AnimatedAsterisk.js';
const MAX_SHOW_COUNT = 6;
export function shouldShowQuark1mMergeNotice(): boolean {
  return (getGlobalConfig().quark1mMergeNoticeSeenCount ?? 0) < MAX_SHOW_COUNT && hasConfigured1mWindow(getMainLoopModel());
}
function hasConfigured1mWindow(model: string): boolean {
  if (is1mContextDisabled()) return false;
  const configured = getCatalogModel(model)?.contextWindow;
  return (configured === 1_000_000 || /\[1m\]$/i.test(model)) && getContextWindowForModel(model) === 1_000_000;
}
export function Quark1mMergeNotice() {
  const $ = _c(4);
  const [show] = useState(shouldShowQuark1mMergeNotice);
  const model = useMainLoopModel();
  let t0;
  let t1;
  if ($[0] !== show) {
    t0 = () => {
      if (!show) {
        return;
      }
      const newCount = (getGlobalConfig().quark1mMergeNoticeSeenCount ?? 0) + 1;
      saveGlobalConfig(prev => {
        if ((prev.quark1mMergeNoticeSeenCount ?? 0) >= newCount) {
          return prev;
        }
        return {
          ...prev,
          quark1mMergeNoticeSeenCount: newCount
        };
      });
    };
    t1 = [show];
    $[0] = show;
    $[1] = t0;
    $[2] = t1;
  } else {
    t0 = $[1];
    t1 = $[2];
  }
  useEffect(t0, t1);
  if (!show || !hasConfigured1mWindow(model)) {
    return null;
  }
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box paddingLeft={2}><AnimatedAsterisk char={UP_ARROW} /><Text dimColor={true}>{" "}当前模型已配置 1M 上下文窗口</Text></Box>;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
