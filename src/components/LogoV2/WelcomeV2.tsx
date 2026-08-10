import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from 'src/ink.js';
import { env } from '../../utils/env.js';
import { NexusLogo } from './NexusLogo.js';
const WELCOME_V2_WIDTH = 58;
export function WelcomeV2() {
  const $ = _c(10);
  const [theme] = useTheme();
  if (env.terminal === "Apple_Terminal") {
    let t0;
    if ($[0] !== theme) {
      t0 = <Box flexDirection="column" alignItems="center" width={WELCOME_V2_WIDTH}><Text bold={true} color="white">{"欢迎使用 Nexus Code"} <Text dimColor={true}>v{MACRO.VERSION} </Text></Text><NexusLogo /></Box>;
      $[0] = theme;
      $[1] = t0;
    } else {
      t0 = $[1];
    }
    return t0;
  }
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box flexDirection="column" alignItems="center" width={WELCOME_V2_WIDTH}><Text><Text color="claude">{"欢迎使用 Nexus Code"} </Text><Text dimColor={true}>v{MACRO.VERSION} </Text></Text><NexusLogo /></Box>;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  return t1;
}
