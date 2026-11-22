import { isInBundledMode } from 'src/utils/bundledMode.js';
import { getCurrentInstallationType } from 'src/utils/doctorDiagnostic.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { useStartupNotification } from './useStartupNotification.js';
const NPM_DEPRECATION_MESSAGE = 'Nexus Code has switched from npm to native installer. Run `nexus install` or see https://github.com/Whale-Talk/Nexus-Code for more options.';
export function useNpmDeprecationNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  // Nexus: restored npm-based build — the official npm→native installer
  // deprecation notice does not apply here.
  return null;
}
